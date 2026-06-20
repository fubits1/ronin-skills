#!/usr/bin/env node
// Red-team / adversarial suite for nogrep.mjs — pure Node, cross-OS. Asserts BLOCK/ALLOW AND the
// exact `reason=` tag (a block firing for the wrong reason is a FAIL). Strict exit-code check: a
// crashed (exit 1) or signal-killed (status null) hook is NOT silently read as ALLOW. Exit 0 iff all
// match.
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

// expect(want, reason, label, cmd): want ∈ {BLOCK, ALLOW}; reason = expected reason tag for BLOCK,
// or "-" for ALLOW. Asserts the exit code (2=BLOCK, 0=ALLOW, anything else = FAIL) AND the reason.
function expect(want, reason, label, cmd) {
  const payload = JSON.stringify({ tool_input: { command: cmd } });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: "utf8",
  });
  if (r.error) {
    fail++;
    console.log(`FAIL  [${label}] spawn error: ${r.error.message}`);
    return;
  }
  const status = r.status; // null when the process was killed by a signal
  const got =
    status === 2 ? "BLOCK" : status === 0 ? "ALLOW" : `EXIT(${status})`;
  const m = (r.stderr || "").split("\n")[0].match(/reason=([a-z-]+)/);
  const gotReason = m ? m[1] : "-";
  if (got === want && gotReason === reason) {
    console.log(`PASS  [${label} ${want} ${gotReason}]  ${oneline(cmd)}`);
    pass++;
  } else {
    console.log(
      `FAIL  [${label} want=${want}/${reason} got=${got}/${gotReason}]  ${oneline(cmd)}`,
    );
    fail++;
  }
}

console.log("=== Banned tools must BLOCK ===");
for (const t of ["grep", "egrep", "fgrep", "rg"])
  expect("BLOCK", `bash-${t}`, `banned:${t}`, `${t} x f`);
expect("BLOCK", "bash-awk", "banned:awk", "awk x f");
expect("BLOCK", "cat-read", "banned:cat", "cat f");
expect("BLOCK", "bash-head", "banned:head", "head -5 f");
expect("BLOCK", "bash-tail", "banned:tail", "tail -5 f");
expect("BLOCK", "bash-find", "banned:find", "find . -name x");
expect("BLOCK", "bash-wc", "banned:wc", "wc -l f");

console.log("\n=== Bypass vectors must BLOCK ===");
expect("BLOCK", "command-builtin", "builtin-command", "command grep x");
expect("BLOCK", "bash-find", "abs-path", "/usr/bin/find .");
expect("BLOCK", "bash-grep", "backslash-escape", "\\grep x");
expect("BLOCK", "bash-grep", "quoted-full", "'grep' x");
expect("BLOCK", "bash-grep", "quoted-empty", 'g""rep x');
expect("BLOCK", "bash-grep", "quoted-partial", '"g"rep x');
expect("BLOCK", "bash-grep", "quoted-split", "g'r'ep x");
expect("BLOCK", "cat-read", "quoted-cat", "'cat' f");
expect("BLOCK", "bash-grep", "mid-backslash", "g\\rep x");
expect("BLOCK", "cat-read", "split-backslash", "\\c\\a\\t f");
expect("BLOCK", "bash-grep", "ansi-c-quote", "$'grep' x");
expect("BLOCK", "dollar-sub", "dollar-sub", "echo $(grep x f)");
expect("BLOCK", "backtick-sub", "backtick-sub", "echo `grep x f`");
expect("BLOCK", "procsub", "proc-sub", "diff <(cat a) <(cat b)");
expect("BLOCK", "bash-grep", "wrapper-timeout", "timeout 5 grep x f");
expect("BLOCK", "bash-grep", "nbsp-obfuscation", "grep x"); // non-breaking space; V8 \s splits it
expect("BLOCK", "sed-read", "sed-read-n", "sed -n 1,5p f");
expect("BLOCK", "sed-read", "sed-read-np", "sed 5p f");
expect("BLOCK", "cat-read", "subshell-group", "(cat secret)");
expect("BLOCK", "cat-read", "brace-group", "{ cat secret; }");

console.log(
  "\n=== bash -c bypasses (flags, wrappers, sed, recursion) must BLOCK ===",
);
expect("BLOCK", "bashc-banned", "bashc-plain", 'bash -c "cat x"');
expect("BLOCK", "bashc-banned", "bashc-env", 'bash -c "env grep x"');
expect("BLOCK", "bashc-banned", "bashc-lc-flag", 'bash -lc "grep x"');
expect("BLOCK", "bashc-banned", "bashc-ic-flag", 'zsh -ic "rg secret"');
expect("BLOCK", "bashc-banned", "bashc-login", 'bash --login -c "cat x"');
expect(
  "BLOCK",
  "bashc-banned",
  "bashc-nested-wrap",
  'bash -c "env timeout grep x"',
);
expect("BLOCK", "bashc-sed-read", "bashc-sed-n", 'bash -c "sed -n 1,5p f"');
expect("BLOCK", "bashc-sed-read", "bashc-sed-np", 'bash -c "sed 5p f"');

console.log("\n=== Wrapper + interpreter shell-out bypasses must BLOCK ===");
expect("BLOCK", "bash-grep", "sudo-grep", "sudo grep x");
expect("BLOCK", "cat-read", "doas-cat", "doas cat f");
expect("BLOCK", "bash-grep", "watch-grep", "watch grep x f");
expect("BLOCK", "bash-grep", "parallel-grep", "parallel grep x");
expect(
  "BLOCK",
  "node-shellout",
  "node-shellout",
  "node -e \"require('child_process').execSync('grep x')\"",
);
expect(
  "BLOCK",
  "python-shellout",
  "py-shellout",
  "python3 -c \"import subprocess; subprocess.run(['cat'])\"",
);
expect(
  "BLOCK",
  "perl-ruby-shellout",
  "perl-shellout",
  "perl -e 'system(\"grep x\")'",
);
expect(
  "BLOCK",
  "perl-ruby-shellout",
  "ruby-shellout",
  "ruby -e 'exec \"cat f\"'",
);
expect(
  "BLOCK",
  "wrapper-depth",
  "wrapper-cap",
  "env env env env env env env env env grep x",
);

console.log("\n=== git mutation (incl. remote rm) must BLOCK ===");
expect("BLOCK", "git-mutation", "git-commit", "git commit -m x");
expect("BLOCK", "git-mutation", "git-remote-rm", "git remote rm origin");
expect("BLOCK", "git-mutation", "git-remote-add", "git remote add o url");

console.log("\n=== Chaining + control structures must BLOCK ===");
expect("BLOCK", "chaining", "chain-and", "pnpm build && pnpm test");
expect("BLOCK", "chaining", "chain-semi", "echo done ; echo here");
expect("BLOCK", "chaining", "chain-or", "true || echo fallback");
expect("BLOCK", "chaining", "chain-trailing-echo", "npx foo ; echo exit=$?");
expect("BLOCK", "chaining", "for-loop", "for x in a b; do echo $x; done");
expect(
  "BLOCK",
  "chaining",
  "while-loop",
  'while read l; do echo "$l"; done < f.txt',
);
expect("BLOCK", "chaining", "if-then", "if true; then echo yes; fi");
expect("BLOCK", "chaining", "case", "case $x in a) echo a;; *) echo b;; esac");
expect(
  "BLOCK",
  "chaining",
  "multiline-arg",
  'dex create "t" --description "line one\nline two\nline three"',
);
expect("BLOCK", "chaining", "multiline-echo", 'echo "a\nb\nc"');
expect(
  "BLOCK",
  "chaining",
  "line-continuation",
  "pnpm run build \\\n  --verbose",
);
expect(
  "BLOCK",
  "chaining",
  "multiline-block",
  'dex create "a"\ndex create "b"\ndex create "c"',
);

console.log("\n=== Legit single commands must ALLOW (no false positives) ===");
expect("ALLOW", "-", "single-pnpm", "pnpm test");
expect("ALLOW", "-", "single-git-status", "git status");
expect("ALLOW", "-", "single-ls", "ls");
expect("ALLOW", "-", "single-echo", "echo hi");
expect("ALLOW", "-", "single-jq", "jq . package.json");
expect("ALLOW", "-", "sed-substitution", "sed s/a/b/ f");
expect("ALLOW", "-", "git-mv", "git mv a b");
expect("ALLOW", "-", "git-remote-v", "git remote -v");
expect("ALLOW", "-", "git-log-readonly", "git log --oneline");
expect("ALLOW", "-", "subshell-allowed", "(ls)");
expect("ALLOW", "-", "pipe-into-jq", "gh pr view --json title | jq .title");
expect("ALLOW", "-", "redirect-stdout", "echo hi > /tmp/x");
expect("ALLOW", "-", "redirect-2to1", "pnpm build 2>&1");
expect(
  "ALLOW",
  "-",
  "semi-in-quotes",
  'dex create "a; b" --description "s1; s2; s3"',
);
expect("ALLOW", "-", "and-in-quotes", 'echo "a && b"');
expect("ALLOW", "-", "semi-in-jq-prog", 'jq ".a; .b" f.json');
expect("ALLOW", "-", "bashc-echo-cat", 'bash -c "echo cat"');
expect("ALLOW", "-", "perl-print", 'perl -e "print 1"');
expect("ALLOW", "-", "ruby-puts", 'ruby -e "puts 1"');
expect("ALLOW", "-", "node-clean", 'node -e "let x=1; console.log(x)"');
expect("ALLOW", "-", "watch-date", "watch date");
expect("ALLOW", "-", "sudo-make", "sudo make install");
expect("ALLOW", "-", "make-build", "make build");
expect("ALLOW", "-", "banned-in-quote-semi", 'echo "step 1; cat results"');
expect("ALLOW", "-", "banned-in-quote-and", 'pnpm run "build && grep"');
expect("ALLOW", "-", "semi-in-dq-arg", 'echo "first; awk it then cat"');

console.log("\n=== Edge cases ===");
expect("ALLOW", "-", "trailing-semi", "echo hi;");
expect("ALLOW", "-", "escaped-inner-quotes", 'echo "say \\"hi; bye\\""');
expect("ALLOW", "-", "single-quote-semi", "echo 'a; b; c'");

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
