#!/usr/bin/env node
// Functional test suite for nogrep.mjs — pure Node, cross-OS (no bash / jq / sed).
// Spawns the hook (node nogrep.mjs) with a PreToolUse payload on stdin and asserts the exit code
// (2 = BLOCK, 0 = ALLOW) and, for message cases, a stderr substring.
//
//   node plugins/hooks/hooks/tests/run-nogrep-tests.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "nogrep.mjs");

let pass = 0;
let fail = 0;
const oneline = (s) => s.replace(/\n/g, "\\n");

function run(cmd) {
  const payload = JSON.stringify({ tool_input: { command: cmd } });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: "utf8",
  });
  if (r.error) return { code: -1, stderr: "spawn error: " + r.error.message };
  // status is null when the process is killed by a signal (e.g. timeout) — never read that as ALLOW.
  return { code: r.status === null ? -2 : r.status, stderr: r.stderr || "" };
}
function runCase(expected, label, cmd) {
  const { code } = run(cmd);
  if (code === expected) {
    console.log(`PASS  [${label} exit=${code}]  ${oneline(cmd)}`);
    pass++;
  } else {
    console.log(
      `FAIL  [${label} expected=${expected} got=${code}]  ${oneline(cmd)}`,
    );
    fail++;
  }
}
function runMsg(want, label, cmd) {
  const { code, stderr } = run(cmd);
  if (code === 2 && stderr.includes(want)) {
    console.log(`PASS  [${label} msg~${want}]  ${oneline(cmd)}`);
    pass++;
  } else {
    console.log(
      `FAIL  [${label} want-msg=${want} exit=${code}]  ${oneline(cmd)}\n    got: ${stderr.trim()}`,
    );
    fail++;
  }
}

console.log("=== BLOCK fixtures (expect exit 2) ===");
runCase(2, "BLOCK", "cat x");
runCase(2, "BLOCK", "ls; cat x");
runCase(2, "BLOCK", "echo a && grep b");
runCase(2, "BLOCK", "echo ok | grep x");
runCase(2, "BLOCK", "echo a & cat secret");
runCase(2, "BLOCK", "(cat secret)");
runCase(2, "BLOCK", "{ cat secret; }");
runCase(2, "BLOCK", "diff <(cat a) <(cat b)");
runCase(2, "BLOCK", "echo a\ngrep b");
runCase(2, "BLOCK", "\\grep x");
runCase(2, "BLOCK", "/usr/bin/find .");
runCase(2, "BLOCK", 'bash -c "cat x"');
runCase(2, "BLOCK", "timeout 5 grep x f");
runCase(2, "BLOCK", "command cat x");
runCase(2, "BLOCK", "sed -n 1,5p f");
runCase(2, "BLOCK", "sed 5p f");
runCase(2, "BLOCK", "git commit -m x");
runCase(2, "BLOCK", "pnpm build && pnpm test");
runCase(2, "BLOCK", "echo a ; echo b");
runCase(2, "BLOCK", "true || echo fallback");
runCase(2, "BLOCK", "npx markdownlint-cli2 README.md ; echo done");
runCase(2, "BLOCK", "cd src && pnpm test");
// bash -c bypasses (flags / wrappers / sed / recursion)
runCase(2, "BLOCK", 'bash -lc "grep x"');
runCase(2, "BLOCK", 'bash --login -c "cat x"');
runCase(2, "BLOCK", 'bash -c "env timeout grep x"');
runCase(2, "BLOCK", 'bash -c "sed -n 1,5p f"');
// wrapper + interpreter shell-out bypasses
runCase(2, "BLOCK", "sudo grep x");
runCase(2, "BLOCK", "doas cat f");
runCase(2, "BLOCK", "watch grep x f");
runCase(2, "BLOCK", "parallel grep x");
runCase(2, "BLOCK", "perl -e 'system(\"grep x\")'");
runCase(2, "BLOCK", "ruby -e 'exec \"cat f\"'");
runCase(2, "BLOCK", "node -e \"require('child_process').execSync('grep x')\"");
runCase(
  2,
  "BLOCK",
  "python3 -c \"import subprocess; subprocess.run(['cat'])\"",
);
runCase(2, "BLOCK", "env env env env env env env env env grep x"); // 9 wrappers > cap
runCase(2, "BLOCK", "git remote rm origin");
runCase(2, "BLOCK", "cat <<EOF"); // heredoc → Write
runCase(2, "BLOCK", "echo `grep x`"); // backtick-sub
runCase(2, "BLOCK", "'grep' x"); // fully-quoted tool name
runCase(2, "BLOCK", 'g""rep x'); // empty-quote split
runCase(2, "BLOCK", '"g"rep x'); // partial quote
runCase(2, "BLOCK", "g\\rep x"); // mid-token backslash
runCase(2, "BLOCK", "\\c\\a\\t f"); // backslash between every char
runCase(2, "BLOCK", "$'grep' x"); // ANSI-C literal quoting

console.log("\n=== ALLOW fixtures (expect exit 0) ===");
runCase(0, "ALLOW", "ls");
runCase(0, "ALLOW", "jq . x");
runCase(0, "ALLOW", "git mv a b");
runCase(0, "ALLOW", "echo hi");
runCase(0, "ALLOW", "pnpm test");
runCase(0, "ALLOW", 'echo "the word grep in a string"');
runCase(0, "ALLOW", "sed s/a/b/ f");
runCase(0, "ALLOW", "git status");
runCase(0, "ALLOW", "(ls)");
runCase(0, "ALLOW", "gh pr view --json title | jq .title");
runCase(0, "ALLOW", "pnpm build 2>&1");
runCase(0, "ALLOW", "echo hi > /tmp/x");
runCase(0, "ALLOW", 'echo "a && b"');
runCase(0, "ALLOW", 'node -e "let x=1; console.log(x)"');
runCase(0, "ALLOW", 'sed "s/;/,/g" file');
runCase(0, "ALLOW", 'bash -c "echo cat"'); // banned word as echo arg, not a command
runCase(0, "ALLOW", 'perl -e "print 1"'); // no shell-out
runCase(0, "ALLOW", "git remote -v");
runCase(0, "ALLOW", "watch date");
runCase(0, "ALLOW", "make build");
runCase(0, "ALLOW", "sudo make install");
runCase(0, "ALLOW", 'echo "step 1; cat results"'); // banned word in quoted arg after ; — not a command
runCase(0, "ALLOW", 'pnpm run "build && grep"'); // banned word in quoted arg after &&

console.log(
  "\n=== Message-content fixtures (block fires with the RIGHT message) ===",
);
runMsg("NOT a user rejection", "MSG", "cat x");
runMsg("reason=cat-read", "MSG", "cat x");
runMsg("Write tool", "MSG", "cat > f");
runMsg("reason=cat-write", "MSG", "cat > f");
runMsg("Read tool", "MSG", "cat f");
runMsg("reason=chaining", "MSG", "pnpm build && pnpm test");
runMsg("SEPARATE Bash call", "MSG", "pnpm build && pnpm test");
runMsg("Grep tool", "MSG", "grep x f");
runMsg("Glob tool", "MSG", "find .");
runMsg("reason=bashc-banned", "MSG", 'bash -lc "grep x"');
runMsg("reason=perl-ruby-shellout", "MSG", "perl -e 'system(\"grep\")'");
runMsg(
  "reason=wrapper-depth",
  "MSG",
  "env env env env env env env env env grep x",
);
runMsg("reason=git-mutation", "MSG", "git remote rm origin");

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
