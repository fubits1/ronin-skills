#!/usr/bin/env node
// Performance benchmark for no-bash.mjs — pure Node, cross-OS. Times the hook per call on typical
// commands, and on ADVERSARIAL LARGE inputs to prove the regexes + splitSegments + recursion stay
// LINEAR (no ReDoS / catastrophic backtracking). The hooks.json timeout is 5000ms; algorithm cost
// on a 200KB+ crafted input must be a tiny fraction of that.
//
//   node plugins/hooks/hooks/tests/bench-no-bash.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "no-bash.mjs");

function timeHook(command, count) {
  const payload = JSON.stringify({ tool_input: { command: command } });
  const timings = [];
  let stalls = 0;
  for (let i = 0; i < count; i++) {
    const startTime = process.hrtime.bigint();
    const options = { input: payload, encoding: "utf8", timeout: 10000 };
    // Node's spawnSync sometimes never closes a large `input` pipe (~1% at 200KB, even for a child
    // that only reads stdin), so the hook waits for EOF forever: retry, but fail on a real hang.
    if (spawnSync(process.execPath, [HOOK], options).status === null) {
      if (++stalls > 3) {
        throw new Error(`no-bash hook timed out ${stalls} times`);
      }
      i--;
      continue;
    }
    const endTime = process.hrtime.bigint();
    timings.push(Number(endTime - startTime) / 1e6);
  }
  timings.sort((x, y) => x - y);
  return timings[Math.floor(count / 2)];
}

const N = 31;
const baseline = timeHook("ls", N);
console.log(
  `Per-call wall-clock, median of ${N} (each call = Node cold start + hook):\n`,
);
console.log(
  `  baseline (cold start + 'ls' allow)   : ${baseline.toFixed(1)} ms`,
);
for (const [label, command] of [
  ["typical block (cat x)", "cat x"],
  ["chaining", "pnpm build && pnpm test"],
  ["bash -c (nested wrappers)", 'bash -c "env timeout grep x"'],
  ["quoted bypass ('grep' x)", "'grep' x"],
  ["quoted arg w/ ops", 'echo "step 1; cat results"'],
]) {
  console.log(`  ${label.padEnd(36)} : ${timeHook(command, N).toFixed(1)} ms`);
}

console.log(
  `\nAdversarial LARGE inputs — algorithm cost ≈ total − baseline; MUST stay far below the 5000 ms timeout:\n`,
);
const largeInputs = [
  ["200KB single token", "a".repeat(200000)],
  ["100k '-x ' flags then -c", "bash " + "-x ".repeat(100000) + '-c "grep x"'],
  ["50k ops inside one quote", 'echo "' + "a; ".repeat(50000) + '"'],
  ["50k real segments", "echo a; ".repeat(50000) + "ls"],
  ["200KB $(...) body", "echo $(" + "a ".repeat(100000) + ")"],
  ["100k backslashes", "\\".repeat(100000) + "grep x"],
  ["50 nested wrappers", "env ".repeat(50) + "grep x"],
  // heredoc-strip stressors for the lazy `[\s\S]*?` scan:
  //  - flood: >4 `<<` openers FAIL the `<=4` guard, so the regex is skipped (proves the guard caps it)
  //  - guard-passing: exactly 4 openers + a huge non-terminating body DOES run the regex — the worst
  //    case that actually reaches it; must stay LINEAR (one lazy pass to EOS per opener, not quadratic)
  ["40k '<<X' flood (guard skips regex)", "<<X\n".repeat(40000)],
  [
    "4 openers + 1MB body (runs regex)",
    "<<A\n<<B\n<<C\n<<D\n" + ("a ".repeat(50000) + "q\n").repeat(10),
  ],
];
let worst = 0;
for (const [label, command] of largeInputs) {
  const total = timeHook(command, 5);
  worst = Math.max(worst, total);
  console.log(
    `  ${label.padEnd(36)} (${String(command.length).padStart(7)} chars): ${total.toFixed(1).padStart(7)} ms total  (~${(total - baseline).toFixed(1)} ms algo)`,
  );
}
console.log(
  `\nWorst large-input total: ${worst.toFixed(1)} ms  (${((worst / 5000) * 100).toFixed(2)}% of the 5000 ms hook timeout). ${worst < 250 ? "LINEAR — no ReDoS." : "INVESTIGATE — possible super-linear blowup."}`,
);
// Gate: fail CI only on a genuine super-linear blowup (these linear cases run ~100ms even on a 1MB
// body; 2000ms = 40% of the timeout would mean a real ReDoS regression). Wall-clock is noisy, so the
// threshold is generous to avoid flakes.
process.exit(worst < 2000 ? 0 : 1);
