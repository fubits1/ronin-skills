#!/usr/bin/env node
// Red-team / adversarial suite for nogrep.mjs — pure Node, cross-OS. Shell control structures,
// multi-line, line continuation, escaped/boundary quotes, every documented bypass vector. Each
// assertion encodes the INTENDED design; a divergence is a real finding. Exit 0 iff all match.
//
//   node plugins/hooks/hooks/tests/redteam-nogrep.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "nogrep.mjs");

let pass = 0;
let fail = 0;
const oneline = (s) => s.replace(/\n/g, "~").replace(/\t/g, ">");

function expect(want, label, cmd) {
  const payload = JSON.stringify({ tool_input: { command: cmd } });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: "utf8",
  });
  const got = r.status === 2 ? "BLOCK" : "ALLOW";
  const m = (r.stderr || "").split("\n")[0].match(/reason=([a-z-]+)/);
  const reason = m ? m[1] : "-";
  if (got === want) {
    console.log(`PASS  [${label} want=${want} ${reason}]  ${oneline(cmd)}`);
    pass++;
  } else {
    console.log(
      `FAIL  [${label} want=${want} got=${got} ${reason}]  ${oneline(cmd)}`,
    );
    fail++;
  }
}

console.log("=== Banned tools must BLOCK ===");
for (const t of ["grep", "egrep", "fgrep", "rg", "awk"])
  expect("BLOCK", `banned:${t}`, `${t} x f`);
expect("BLOCK", "banned:cat", "cat f");
expect("BLOCK", "banned:head", "head -5 f");
expect("BLOCK", "banned:tail", "tail -5 f");
expect("BLOCK", "banned:find", "find . -name x");
expect("BLOCK", "banned:wc", "wc -l f");

console.log("\n=== Bypass vectors must BLOCK ===");
expect("BLOCK", "builtin-command", "command grep x");
expect("BLOCK", "abs-path", "/usr/bin/find .");
expect("BLOCK", "backslash-escape", "\\grep x");
expect("BLOCK", "bash-c", 'bash -c "cat x"');
expect("BLOCK", "bash-c-wrapped", 'bash -c "env grep x"'); // wrapper-prefixed banned inside -c
expect("BLOCK", "dollar-sub", "echo $(grep x f)");
expect("BLOCK", "backtick-sub", "echo `grep x f`");
expect("BLOCK", "proc-sub", "diff <(cat a) <(cat b)");
expect("BLOCK", "wrapper-timeout", "timeout 5 grep x f");
expect("BLOCK", "sed-read-n", "sed -n 1,5p f");
expect("BLOCK", "sed-read-np", "sed 5p f");
expect("BLOCK", "subshell-group", "(cat secret)");
expect("BLOCK", "brace-group", "{ cat secret; }");

console.log("\n=== Chaining must BLOCK (one command per call) ===");
expect("BLOCK", "chain-and", "pnpm build && pnpm test");
expect("BLOCK", "chain-semi", "echo done ; echo here");
expect("BLOCK", "chain-or", "true || echo fallback");
expect("BLOCK", "chain-trailing-echo", "npx foo ; echo exit=$?");

console.log(
  "\n=== One command per call: multi-line + control structures BLOCK (intended) ===",
);
expect("BLOCK", "for-loop", "for x in a b; do echo $x; done");
expect("BLOCK", "while-loop", 'while read l; do echo "$l"; done < f.txt');
expect("BLOCK", "if-then", "if true; then echo yes; fi");
expect("BLOCK", "case", "case $x in a) echo a;; *) echo b;; esac");
expect(
  "BLOCK",
  "multiline-arg",
  'dex create "t" --description "line one\nline two\nline three"',
);
expect("BLOCK", "multiline-echo", 'echo "a\nb\nc"');
expect("BLOCK", "line-continuation", "pnpm run build \\\n  --verbose");
expect(
  "BLOCK",
  "multiline-block",
  'dex create "a"\ndex create "b"\ndex create "c"',
);

console.log("\n=== Legit single commands must ALLOW ===");
expect("ALLOW", "single-pnpm", "pnpm test");
expect("ALLOW", "single-git-status", "git status");
expect("ALLOW", "single-ls", "ls");
expect("ALLOW", "single-echo", "echo hi");
expect("ALLOW", "single-jq", "jq . package.json");
expect("ALLOW", "sed-substitution", "sed s/a/b/ f");
expect("ALLOW", "git-mv", "git mv a b");
expect("ALLOW", "subshell-allowed", "(ls)");
expect("ALLOW", "pipe-into-jq", "gh pr view --json title | jq .title");
expect("ALLOW", "redirect-stdout", "echo hi > /tmp/x");
expect("ALLOW", "redirect-2to1", "pnpm build 2>&1");
expect(
  "ALLOW",
  "semi-in-quotes",
  'dex create "a; b" --description "s1; s2; s3"',
);
expect("ALLOW", "and-in-quotes", 'echo "a && b"');
expect("ALLOW", "semi-in-jq-prog", 'jq ".a; .b" f.json');

console.log("\n=== Edge cases ===");
expect("ALLOW", "trailing-semi", "echo hi;");
expect("ALLOW", "escaped-inner-quotes", 'echo "say \\"hi; bye\\""');
expect("ALLOW", "single-quote-semi", "echo 'a; b; c'");
expect("ALLOW", "git-log-readonly", "git log --oneline");

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
