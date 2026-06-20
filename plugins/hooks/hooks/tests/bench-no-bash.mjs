#!/usr/bin/env node
// Performance benchmark for no-bash.mjs — pure Node, cross-OS. Times the hook per call on typical
// commands, and on ADVERSARIAL LARGE inputs to prove the regexes + splitSegments + recursion stay
// LINEAR (no ReDoS / catastrophic backtracking). The hooks.json timeout is 5000 ms; algorithm cost
// on a 200KB+ crafted input must be a tiny fraction of that.
//
//   node plugins/hooks/hooks/tests/bench-no-bash.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "no-bash.mjs");

function medianMs(cmd, n) {
  const payload = JSON.stringify({ tool_input: { command: cmd } });
  const t = [];
  for (let i = 0; i < n; i++) {
    const a = process.hrtime.bigint();
    spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });
    const b = process.hrtime.bigint();
    t.push(Number(b - a) / 1e6);
  }
  t.sort((x, y) => x - y);
  return t[Math.floor(n / 2)];
}

const N = 31;
const baseline = medianMs("ls", N);
console.log(
  `Per-call wall-clock, median of ${N} (each call = Node cold start + hook):\n`,
);
console.log(
  `  baseline (cold start + 'ls' allow)   : ${baseline.toFixed(1)} ms`,
);
for (const [label, cmd] of [
  ["typical block (cat x)", "cat x"],
  ["chaining", "pnpm build && pnpm test"],
  ["bash -c recursion", 'bash -c "env timeout grep x"'],
  ["quoted bypass ('grep' x)", "'grep' x"],
  ["quoted arg w/ ops", 'echo "step 1; cat results"'],
]) {
  console.log(`  ${label.padEnd(36)} : ${medianMs(cmd, N).toFixed(1)} ms`);
}

console.log(
  `\nAdversarial LARGE inputs — algorithm cost ≈ total − baseline; MUST stay far below the 5000 ms timeout:\n`,
);
const big = [
  ["200KB single token", "a".repeat(200000)],
  ["100k '-x ' flags then -c", "bash " + "-x ".repeat(100000) + '-c "grep x"'],
  ["50k ops inside one quote", 'echo "' + "a; ".repeat(50000) + '"'],
  ["50k real segments", "echo a; ".repeat(50000) + "ls"],
  ["200KB $(...) body", "echo $(" + "a ".repeat(100000) + ")"],
  ["100k backslashes", "\\".repeat(100000) + "grep x"],
  ["50 nested wrappers", "env ".repeat(50) + "grep x"],
  // heredoc-strip stressors (lazy `[\s\S]*?` scan): unterminated openers must not go quadratic
  ["40k '<<X ' one-line", "<<X ".repeat(40000)],
  ["40k '<<X\\n' multiline", "<<X\n".repeat(40000)],
];
let worst = 0;
for (const [label, cmd] of big) {
  const total = medianMs(cmd, 5);
  worst = Math.max(worst, total);
  console.log(
    `  ${label.padEnd(26)} (${String(cmd.length).padStart(7)} chars): ${total.toFixed(1).padStart(7)} ms total  (~${(total - baseline).toFixed(1)} ms algo)`,
  );
}
console.log(
  `\nWorst large-input total: ${worst.toFixed(1)} ms  (${((worst / 5000) * 100).toFixed(2)}% of the 5000 ms hook timeout). ${worst < 250 ? "LINEAR — no ReDoS." : "INVESTIGATE — possible super-linear blowup."}`,
);
