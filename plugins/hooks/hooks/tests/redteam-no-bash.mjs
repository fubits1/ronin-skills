#!/usr/bin/env node
// Adversarial / edge-case suite for no-bash.mjs — pure Node, cross-OS. Asserts BLOCK/ALLOW AND the
// exact `reason=` tag, with strict exit-code handling (a crashed/killed hook is NOT read as ALLOW).
// Scope: the model's realistic patterns + the shapes that previously caused FALSE blocks. This is a
// discipline nudge, not a firewall — it does not chase quote/escape-mutation, encoding, or expansion.
//
//   node plugins/hooks/hooks/tests/redteam-no-bash.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "no-bash.mjs");

let pass = 0;
let fail = 0;
const oneline = (s) => s.replace(/\n/g, "~").replace(/\t/g, ">");

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
  const status = r.status; // null if killed by a signal
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

console.log(
  "\n=== Wrapped / substituted banned tools the model actually writes must BLOCK ===",
);
expect("BLOCK", "command-builtin", "builtin-command", "command grep x");
expect("BLOCK", "bash-find", "abs-path", "/usr/bin/find .");
expect("BLOCK", "bash-grep", "backslash-escape", "\\grep x");
expect("BLOCK", "bash-grep", "wrapper-timeout", "timeout 5 grep x f");
expect("BLOCK", "dollar-sub", "dollar-sub", "echo $(grep x f)");
expect("BLOCK", "backtick-sub", "backtick-sub", "echo `grep x f`");
expect("BLOCK", "procsub", "proc-sub", "diff <(cat a) <(cat b)");
expect("BLOCK", "bashc-banned", "bashc-plain", 'bash -c "cat x"');
expect("BLOCK", "bashc-banned", "bashc-env", 'bash -c "env grep x"');
expect("BLOCK", "bashc-sed-read", "bashc-sed", 'bash -c "sed -n 1,5p f"');
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
expect("BLOCK", "sed-read", "sed-read-n", "sed -n 1,5p f");
expect("BLOCK", "sed-read", "sed-read-np", "sed 5p f");
expect("BLOCK", "cat-read", "subshell-group", "(cat secret)");
expect("BLOCK", "cat-read", "brace-group", "{ cat secret; }");

console.log("\n=== git mutation (incl. remote rm) must BLOCK ===");
expect("BLOCK", "git-mutation", "git-commit", "git commit -m x");
expect("BLOCK", "git-mutation", "git-remote-rm", "git remote rm origin");
expect("BLOCK", "git-mutation", "git-remote-add", "git remote add o url");
// global option before the subcommand must not let a mutation slip through
expect("BLOCK", "git-mutation", "git-C-commit", "git -C /repo commit -m wip");
expect("BLOCK", "git-mutation", "git-c-commit", "git -c k=v commit -m x");
expect("BLOCK", "git-mutation", "git-nopager-add", "git --no-pager add .");
// write forms of subcommands that also have a read form
expect("BLOCK", "git-mutation", "git-stash-bare", "git stash");
expect("BLOCK", "git-mutation", "git-stash-pop", "git stash pop");
expect("BLOCK", "git-mutation", "git-clean-force", "git clean -fd");
expect("BLOCK", "git-mutation", "git-apply", "git apply patch.diff");
expect("BLOCK", "git-mutation", "git-fetch", "git fetch origin");
// previously-missed mutating subcommands
expect("BLOCK", "git-mutation", "git-branch-del", "git branch -D feature");
expect(
  "BLOCK",
  "git-mutation",
  "git-worktree-add",
  "git worktree add ../wt main",
);
expect(
  "BLOCK",
  "git-mutation",
  "git-submodule-update",
  "git submodule update --init",
);
expect("BLOCK", "git-mutation", "git-gc", "git gc");
// git grep is a content search → route to Grep
expect("BLOCK", "bash-grep", "git-grep", "git grep foo");

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
// genuinely SEPARATE commands joined by bare newlines is real chaining
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
expect("ALLOW", "-", "node-clean", 'node -e "let x=1; console.log(x)"');
expect("ALLOW", "-", "bashc-echo-cat", 'bash -c "echo cat"');
expect("ALLOW", "-", "make-build", "make build");

console.log(
  "\n=== Banned word inside a quoted argument must ALLOW (no false block) ===",
);
expect(
  "ALLOW",
  "-",
  "semi-in-quotes",
  'dex create "a; b" --description "s1; s2; s3"',
);
expect("ALLOW", "-", "and-in-quotes", 'echo "a && b"');
expect("ALLOW", "-", "semi-in-jq-prog", 'jq ".a; .b" f.json');
expect("ALLOW", "-", "banned-in-quote-semi", 'echo "step 1; cat results"');
expect("ALLOW", "-", "banned-in-quote-and", 'pnpm run "build && grep"');
expect("ALLOW", "-", "banned-in-dq-arg", 'echo "first; awk it then cat"');
expect("ALLOW", "-", "trailing-semi", "echo hi;");
expect("ALLOW", "-", "escaped-inner-quotes", 'echo "say \\"hi; bye\\""');
expect("ALLOW", "-", "single-quote-semi", "echo 'a; b; c'");

console.log(
  "\n=== Read-only git must ALLOW (mutating git blocks, read-only git passes) ===",
);
expect("ALLOW", "-", "git-stash-list", "git stash list");
expect("ALLOW", "-", "git-stash-show", "git stash show -p stash@{0}");
expect("ALLOW", "-", "git-tag-list", "git tag -l");
expect("ALLOW", "-", "git-config-get", "git config --get user.name");
expect("ALLOW", "-", "git-config-list", "git config --list");
expect("ALLOW", "-", "git-clean-dryrun", "git clean -n");
expect("ALLOW", "-", "git-clean-dryrun-long", "git clean --dry-run -d");
expect("ALLOW", "-", "git-apply-check", "git apply --check patch.diff");
expect("ALLOW", "-", "git-apply-stat", "git apply --stat patch.diff");
expect("ALLOW", "-", "git-fetch-dryrun", "git fetch --dry-run");
expect("ALLOW", "-", "git-branch-list", "git branch -a");
expect("ALLOW", "-", "git-worktree-list", "git worktree list");
expect("ALLOW", "-", "git-submodule-status", "git submodule status");
expect("ALLOW", "-", "git-C-readonly", "git -C /repo log --oneline");

console.log(
  "\n=== Multi-line quoted args / continuations / heredocs are ONE command, must ALLOW ===",
);
expect(
  "ALLOW",
  "-",
  "multiline-body",
  'gh pr create --title Fix --body "First line.\nSecond line."',
);
expect(
  "ALLOW",
  "-",
  "multiline-desc",
  'dex create "t" --description "line one\nline two\nline three"',
);
expect("ALLOW", "-", "multiline-echo", 'echo "a\nb\nc"');
expect("ALLOW", "-", "line-continuation", "pnpm run build \\\n  --verbose");
expect("ALLOW", "-", "heredoc-noncat", "tee /tmp/f <<EOF\nhello\nworld\nEOF");

console.log(
  "\n=== cat read-with-redirect routes to cat-read (not cat-write); command -v allowed ===",
);
expect("BLOCK", "cat-read", "cat-stderr-redirect", "cat f 2>/dev/null");
expect("BLOCK", "cat-read", "cat-2to1", "cat config.json 2>&1");
expect("BLOCK", "cat-read", "cat-herestring", "cat <<< 'oneword'");
expect("BLOCK", "cat-write", "cat-stdout-write", "cat f > out.txt");
expect("ALLOW", "-", "command-v", "command -v node");

console.log(
  "\n=== Wrapped/combined-flag forms the docs promise to catch must BLOCK ===",
);
expect("BLOCK", "bash-grep", "xargs-I-placeholder", "xargs -I {} grep foo {}");
expect("BLOCK", "bashc-banned", "bashc-login-flag", 'bash -lc "grep foo file"');
expect("BLOCK", "bashc-banned", "bashc-xtrace-flag", 'sh -xc "cat file"');

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
