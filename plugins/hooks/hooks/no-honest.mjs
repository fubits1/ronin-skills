#!/usr/bin/env node
// Stop hook: when ANY assistant message in the current turn contains the word "honest" (or its
// adverb "honestly"), inject a non-blocking `additionalContext` nudge — the agent vouching for its
// own truthfulness instead of showing proof, which is where unverified claims hide. This is
// ADVISORY, not enforcement (the model may ignore it); the enforceable rule lives in the
// agent:discipline skill, which this hook only reinforces.
//
// Why additionalContext and NOT {"decision":"block"} (researched against the hooks docs + GitHub):
//   - decision:block on Stop during an Opus 4.6/4.7/4.8 extended-thinking session corrupts the
//     finished message's thinking blocks on re-entry -> hard API 400 (anthropics/claude-code#63287).
//     additionalContext continues the turn too (hooks docs), labelled hook feedback, not an error.
//   - Blocking Stop was ignored on some builds (#3656, closed not_planned), and assistant-output
//     content cannot be hard-enforced by design (#61152, closed). Output hooks are advisory.
//   - The model can split the word ("hon est") to evade the match (#29691). Best-effort.
//   - Plugin Stop hooks are themselves unreliable (#66557 $CLAUDE_PLUGIN_ROOT not injected,
//     #64064 node-not-found in the hook env), so treat this as opportunistic and rely on the
//     agent:discipline rule as the real backstop.
//   - Loop guard: if stop_hook_active is true a Stop hook already continued this turn, so it exits 0.
//
// Plain Node ESM (.mjs): TS was benchmarked (Node 24 strips types natively) but added ~20 ms/Stop
// for the type-strip with no gain, so JS is used for the lower, flat latency. Zero dependencies —
// read a bounded slice of the transcript, parse JSON, match a regex, in one process (no shell
// pipeline, no full-file slurp), so latency is flat regardless of session length.
//
// Scope: "honest" and its adverb "honestly" (\bhonest(ly)?\b) — the opener forms the agent
// actually reaches for ("Honestly, ...", "To be honest, ..."). NOT the plain noun "honesty"
// (e.g. "honesty policy"), not "dishonest", not multi-word phrases. Edit WORD_RE to change it.

import {
  openSync,
  fstatSync,
  readSync,
  closeSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const TAIL_BYTES = 256 * 1024; // bounded read window — covers a turn, flat cost vs session size
const WORD_RE = /\bhonest(ly)?\b/;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Read only the last `maxBytes` of a file (seek from end) — never slurps the whole transcript.
function readTailBytes(path, maxBytes) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const length = size - start;
    if (length <= 0) return { text: "", truncated: false };
    const buffer = Buffer.allocUnsafe(length);
    readSync(fd, buffer, 0, length, start);
    return { text: buffer.toString("utf8"), truncated: start > 0 };
  } finally {
    closeSync(fd);
  }
}

const isUser = (row) => row?.type === "user" || row?.message?.role === "user";
const isAssistant = (row) =>
  row?.type === "assistant" || row?.message?.role === "assistant";
const isTextBlock = (block) => block?.type === "text";

// A genuine user prompt (turn boundary) vs a tool-result entry (also role:user). Prompts carry
// text; tool results carry tool_result blocks only.
function isUserPrompt(entry) {
  if (!isUser(entry)) return false;
  const content = entry.message?.content;
  if (typeof content === "string") return content.length > 0;
  return Array.isArray(content) && content.some(isTextBlock);
}

// The assistant text in the CURRENT turn = every assistant text block after the last genuine user
// prompt. Exported so the decision can be unit-tested without spawning the hook.
export function turnAssistantText(entries) {
  let lastPrompt = -1;
  for (let i = 0; i < entries.length; i++) {
    if (isUserPrompt(entries[i])) lastPrompt = i;
  }
  let text = "";
  for (let i = lastPrompt + 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!isAssistant(entry)) continue;
    const content = entry.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isTextBlock(block) && block.text) text += block.text + "\n";
      }
    } else if (typeof content === "string" && content) {
      text += content + "\n"; // some turns store assistant content as a plain string, not blocks
    }
  }
  return text;
}

// Does the turn text vouch ("honest"/"honestly") outside code? Strip fenced + inline code first so a
// code sample or quoted string containing the word doesn't trip it. Exported for testing.
export function detectVouching(text) {
  if (!text) return false;
  const scanned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .toLowerCase();
  return WORD_RE.test(scanned);
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    return;
  }

  if (input.stop_hook_active === true) return; // loop guard
  const path = input.transcript_path;
  if (!path) return;

  let chunk, truncated;
  try {
    ({ text: chunk, truncated } = readTailBytes(path, TAIL_BYTES));
  } catch {
    return; // unreadable transcript: fail open
  }
  if (!chunk) return;

  const lines = chunk.split("\n");
  if (truncated) lines.shift(); // first line is partial when the window truncated the file

  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip a malformed/partial line rather than failing the whole hook
    }
  }

  if (detectVouching(turnAssistantText(entries))) {
    // additionalContext only — NOT decision:block (that crashes Opus 4.x thinking sessions; see
    // header).
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext:
            'You wrote "honest"/"honestly". Do not vouch for your own truthfulness — the word is not evidence. Next time, state the claim and show the proof (command output, file path, count) instead. See agent:discipline.',
        },
      }),
    );
  }
}

// Run only when executed directly (`node no-honest.mjs`); when imported (tests) export the core
// without reading stdin / exiting. Realpath both sides so a symlinked install path still matches; on
// any uncertainty default to running (a Stop hook that no-ops is harmless, but consistency matters).
let runAsHook = true;
try {
  runAsHook =
    realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
} catch {
  // realpath failed: keep the default and run
}
if (runAsHook) {
  try {
    main();
  } catch {
    // any internal error (e.g. stdin parsed to a non-object) → fail open; never break the session
  }
  process.exit(0);
}
