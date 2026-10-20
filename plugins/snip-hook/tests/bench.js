#!/usr/bin/env node
/**
 * perf gate for the hook's decision path
 *
 * the hook runs on EVERY Bash tool call, so its cost must be small and flat. this benchmarks
 * scan() in-process (the spawn overhead is Node startup, not the hook) across representative
 * inputs plus pathological long/many-command/quoted commands, and asserts a hard ceiling far under
 * the hook timeout (10s in hooks/hooks.json). rules come from the fixture
 * through the real loader, so the deny/ask/allow hit paths are timed, not just misses.
 *
 *   node plugins/snip-hook/tests/bench.js
 */
import { join } from "node:path";
import { scan } from "../src/decide.js";
import { loadRules } from "../src/rules.js";

const rules = loadRules([
  {
    path: join(import.meta.dirname, "fixtures", "settings.json"),
    grants: true,
  },
]);

const INPUTS = [
  "git log -10",
  "gh api -X DELETE repos/x",
  "gh api repos/x/issues -f title=bug",
  "bunx some-random-pkg --foo",
  "pnpm exec echo hi",
  "ssh -V",
  "git log -10 | pnpm build && gh pr view 8 || gh repo delete x",
  '"/opt/homebrew/Caskroom/snip/0.22.0/snip" run -- gh api graphql -f query=' +
    "'query{viewer{login}}'",
  // adversarial: long arg run, many commands, deep quoting
  "gh api " + "-f k=v ".repeat(500) + "repos/x",
  Array.from({ length: 200 }, (_, i) => `git log -${i}`).join(" | "),
  'echo "' + "a ".repeat(5000) + '"',
];

const ITERATIONS = 2000;
const CEILING_MS = 2.0; // per call

const clip = (text, width) =>
  text.length > width ? text.slice(0, width - 3) + "..." : text;

// warm up
for (const input of INPUTS) scan(input, rules);

let worst = 0;
let worstInput = "";
for (const input of INPUTS) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) scan(input, rules);
  const perCall = Number(process.hrtime.bigint() - start) / ITERATIONS / 1e6;
  if (perCall > worst) {
    worst = perCall;
    worstInput = clip(input, 60);
  }
  console.log(`  ${perCall.toFixed(4)} ms/call  ${clip(input, 50)}`);
}

console.log(
  `\nworst: ${worst.toFixed(4)} ms/call (ceiling ${CEILING_MS} ms) — "${worstInput}"`,
);
if (worst > CEILING_MS) {
  console.log(`FAIL: exceeded ${CEILING_MS} ms/call`);
  process.exit(1);
}
console.log(
  `PASS: worst ${worst.toFixed(4)} ms/call, ceiling ${CEILING_MS} ms`,
);
