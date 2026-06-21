#!/usr/bin/env node
// Subprocess test harness for no-honest.mjs (Stop hook) — Node ESM, zero-dependency (no bash / jq).
// Builds a transcript JSONL + a Stop-hook stdin payload, spawns the REAL hook, and asserts whether it
// emits a non-blocking nudge. "BLOCK" = the hook produced `hookSpecificOutput.additionalContext`;
// "ALLOW" = it stayed silent. (The hook never emits decision:block — see no-honest.mjs header.)
//
// In-process unit tests of the pure core (detectVouching / turnAssistantText) live in run-hook-tests.mjs;
// this is the black-box end-to-end check that the spawned hook reads a real transcript file and nudges.
//
//   node plugins/hooks/hooks/tests/run-no-honest-tests.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "no-honest.mjs");
const WORK = mkdtempSync(join(tmpdir(), "nh-"));

let pass = 0;
let fail = 0;

// Spawn the hook with a Stop payload on stdin; return its stdout.
function runHook(payload) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10000,
  });
  return r.stdout || "";
}

// Did the hook emit a non-blocking nudge (additionalContext)?
function nudged(stdout) {
  try {
    const json = JSON.parse(stdout.trim());
    return (json?.hookSpecificOutput?.additionalContext || "") !== "";
  } catch {
    return false;
  }
}

const assistantEntry = (text) =>
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });

// runCase(BLOCK|ALLOW, stop_hook_active, label, assistant-message-text): single assistant message.
function runCase(expect, active, label, msg) {
  const tx = join(WORK, "t.jsonl");
  writeFileSync(tx, assistantEntry(msg));
  const got = nudged(
    runHook({
      stop_hook_active: active,
      transcript_path: tx,
      hook_event_name: "Stop",
    }),
  )
    ? "BLOCK"
    : "ALLOW";
  if (got === expect) {
    pass++;
  } else {
    console.log(`FAIL  [${label} expected=${expect} got=${got}]  ${msg}`);
    fail++;
  }
}

// runTurn(BLOCK|ALLOW, label, ...assistant-msgs): a user prompt, then each assistant message
// interleaved with a tool_result, proving the scan covers the WHOLE turn (not just the last message).
function runTurn(expect, label, ...msgs) {
  const tx = join(WORK, "turn.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "go" } }),
  ];
  for (const m of msgs) {
    lines.push(assistantEntry(m));
    lines.push(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "ok" }],
        },
      }),
    );
  }
  writeFileSync(tx, lines.join("\n"));
  const got = nudged(runHook({ stop_hook_active: false, transcript_path: tx }))
    ? "BLOCK"
    : "ALLOW";
  if (got === expect) {
    pass++;
  } else {
    console.log(
      `FAIL  [${label} expected=${expect} got=${got}]  turn(${msgs.length} msgs)`,
    );
    fail++;
  }
}

console.log('=== BLOCK: "honest" or "honestly" (incl. openers) ===');
runCase("BLOCK", false, "tobehonest", "To be honest, I did not run it.");
runCase("BLOCK", false, "theanswer", "I will give you the honest answer.");
runCase("BLOCK", false, "beinghon", "Being honest, I skipped that step.");
runCase("BLOCK", false, "lethonest", "Let me be honest about the risk.");
runCase("BLOCK", false, "opener", "Honestly, the tests pass.");

console.log(
  '\n=== ALLOW: noun "honesty", "dishonest", code, false-positive guards ===',
);
runCase("ALLOW", false, "honesty", "In all honesty, this is incomplete.");
runCase(
  "ALLOW",
  false,
  "dishonest",
  "That would be a dishonest summary, so I avoided it.",
);
runCase(
  "ALLOW",
  false,
  "honnoun",
  "The honesty policy doc is unrelated to code.",
);
runCase("ALLOW", false, "clean", "The tests pass: 12 of 12. Output is above.");
runCase(
  "ALLOW",
  false,
  "fenced",
  "Here is the code:\n```\n# honest flag\nhonest=1\n```\nDone.",
);
runCase(
  "ALLOW",
  false,
  "inline",
  "The variable `honest` is set in the config.",
);
runCase(
  "ALLOW",
  false,
  "phone",
  "I called the phone state API and it returned ok.",
);

console.log("\n=== Loop guard: stop_hook_active=true never blocks ===");
runCase(
  "ALLOW",
  true,
  "loopguard",
  "Be honest, this must still be allowed (loop guard).",
);

console.log(
  "\n=== Whole-turn scan: the word in ANY message this turn, not just the last ===",
);
runTurn(
  "BLOCK",
  "earlyhit",
  "To be honest I am not sure about this.",
  "The output above shows 12 of 12.",
);
runTurn(
  "ALLOW",
  "cleanturn",
  "First I ran the suite.",
  "It passes: 12 of 12. Output above.",
);

rmSync(WORK, { recursive: true, force: true });
console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
