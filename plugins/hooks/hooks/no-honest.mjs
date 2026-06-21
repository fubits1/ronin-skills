#!/usr/bin/env node
// Stop hook: when ANY assistant message in the current turn contains the word "honest" (or its
// adverb "honestly"), inject a non-blocking `additionalContext` nudge — the agent vouching for its
// own truthfulness instead of showing proof, which is where unverified claims hide. This is
// ADVISORY, not enforcement (the model may ignore it); the enforceable rule lives in the
// agent:discipline skill, which this hook only reinforces.
//
// Why additionalContext and NOT {"decision":"block"} (researched against the hooks docs + GitHub):
//   - decision:block on Stop during an Opus 4.6/4.7/4.8 extended-thinking session corrupts the
//     finished message's thinking blocks on re-entry -> hard API 400 (anthropics/claude-code#63287,
//     open). additionalContext-only never re-enters or modifies the message, so it sidesteps that.
//   - Blocking Stop is won't-fix / ignored anyway (#3656, closed not_planned), and assistant-output
//     content cannot be hard-enforced by design (#61152, closed). Output hooks are advisory.
//   - The model can split the word ("hon est") to evade the match (#29691). Best-effort.
//   - Plugin Stop hooks are themselves unreliable (#66557 $CLAUDE_PLUGIN_ROOT not injected,
//     #64064 node-not-found in the hook env), so treat this as opportunistic and rely on the
//     agent:discipline rule as the real backstop.
//   - Loop guard: if stop_hook_active is true the hook already ran this turn, so it exits 0.
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
  statSync,
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
function tailBytes(path, maxBytes) {
  // Only read a REGULAR file. A transcript_path pointing at a directory (readSync → EISDIR) or, worse,
  // a FIFO/named pipe would make the blocking openSync HANG waiting for a writer — past the hook's
  // timeout, stalling the session (a "hang" violates the fail-open contract). statSync does not
  // open/block, so gate on it; a non-regular path fails open here. (Claude Code always writes a
  // regular .jsonl — this only hardens against pathological inputs.)
  if (!statSync(path).isFile()) return { text: "", truncated: false };
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const len = size - start;
    if (len <= 0) return { text: "", truncated: false };
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, start);
    return { text: buf.toString("utf8"), truncated: start > 0 };
  } finally {
    closeSync(fd);
  }
}

const isUser = (e) => e?.type === "user" || e?.message?.role === "user";
const isAssistant = (e) =>
  e?.type === "assistant" || e?.message?.role === "assistant";

// A genuine user prompt (turn boundary) vs a tool-result entry (also role:user). Prompts carry
// text; tool results carry tool_result blocks only.
function isUserPrompt(e) {
  if (!isUser(e)) return false;
  const c = e?.message?.content;
  if (typeof c === "string") return c.length > 0;
  if (Array.isArray(c)) return c.some((b) => b?.type === "text");
  return false;
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
    const content = entry?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "text" && block.text) text += block.text + "\n";
      }
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
    process.exit(0);
  }

  if (input.stop_hook_active === true) process.exit(0); // loop guard
  const path = input.transcript_path;
  if (!path) process.exit(0);

  let chunk, truncated;
  try {
    ({ text: chunk, truncated } = tailBytes(path, TAIL_BYTES));
  } catch {
    process.exit(0); // unreadable transcript: fail open
  }
  if (!chunk) process.exit(0);

  const lines = chunk.split("\n");
  if (truncated) lines.shift(); // first line is partial when the window truncated the file

  const entries = [];
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    try {
      entries.push(JSON.parse(s));
    } catch {
      // skip a malformed/partial line rather than failing the whole hook
    }
  }

  if (detectVouching(turnAssistantText(entries))) {
    // additionalContext only — NOT decision:block (that crashes Opus 4.x thinking sessions; see
    // header). Non-blocking: the turn already ended; the model reads this on the next turn.
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
  process.exit(0);
}

// Run only when executed directly (`node no-honest.mjs`); when imported (tests) export the core
// without reading stdin / exiting. realpath both sides so a symlinked install path still matches; on
// any uncertainty default to running (a Stop hook that no-ops is harmless, but consistency matters).
let runAsHook = true;
try {
  runAsHook =
    realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
} catch {
  runAsHook = true;
}
if (runAsHook) {
  try {
    main();
  } catch {
    // any internal error (e.g. stdin parsed to a non-object) → fail open; never break the session
  }
  process.exit(0);
}
