#!/usr/bin/env node
// Functional test suite for no-bash.mjs — pure Node, cross-OS (no bash / jq / sed).
// Spawns the hook (node no-bash.mjs) with a PreToolUse payload on stdin and asserts the exit code
// (2 = BLOCK, 0 = ALLOW) and, for message cases, that the teaching message names the right tool.
//
//   node plugins/hooks/hooks/tests/run-no-bash-tests.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "no-bash.mjs");
let pass = 0;
let fail = 0;
const oneline = (text) => text.replace(/\n/g, "\\n");
function run(command) {
  const payload = JSON.stringify({ tool_input: { command } });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: "utf8",
  });
  if (r.error) return { code: -1, stderr: "spawn error: " + r.error.message };
  // status is null when the process is killed by a signal (e.g. timeout) — never read that as ALLOW.
  return { code: r.status === null ? -2 : r.status, stderr: r.stderr || "" };
}
const BLOCK = 2;
const ALLOW = 0;
// exit-code assertion
function runCase(expected, label, command) {
  const { code } = run(command);
  if (code === expected) {
    console.log(
      `PASS  [${label} exit=${code === BLOCK ? "BLOCK" : code === ALLOW ? "ALLOW" : code}]  ${oneline(command)}`,
    );
    pass++;
  } else {
    console.log(
      `FAIL  [${label} want=${expected} got=${code}]  ${oneline(command)}`,
    );
    fail++;
  }
}
// BLOCK + the teaching message must contain `substr` (proves the right tool is named back)
function runMessage(label, command, substr) {
  const { code, stderr } = run(command);
  if (code === BLOCK && stderr.includes(substr)) {
    console.log(`PASS  [${label} msg~"${substr}"]  ${oneline(command)}`);
    pass++;
  } else {
    console.log(
      `FAIL  [${label} want=BLOCK&msg~"${substr}" got=${code} stderr="${oneline(stderr).slice(0, 70)}"]  ${oneline(command)}`,
    );
    fail++;
  }
}

console.log("=== Banned tools BLOCK and name the right dedicated tool ===");
runMessage("grep", "grep foo file", "Use the Grep tool");
runMessage("egrep", "egrep foo file", "Use the Grep tool");
runMessage("rg", "rg foo file", "Use the Grep tool");
runMessage("cat-read", "cat file", "Use the Read tool");
runMessage("head", "head -20 file", "Use the Read tool");
runMessage("tail", "tail -20 file", "Use the Read tool");
runMessage("find", "find . -name '*.ts'", "Use the Glob tool");
runMessage("sed-read", "sed -n 10,20p file", "Use the Read tool");
runMessage("awk", "awk '{print $1}' file", "awk");
runMessage("wc", "wc -l file", "output_mode");

console.log("\n=== cat write-vs-read routing (the redirect fix) ===");
runMessage("cat-stdout-write", "cat foo > out.txt", "Use the Write tool");
runMessage("cat-append", "cat a >> b.txt", "Use the Write tool");
runMessage("cat-heredoc", "cat > f <<EOF\nx\nEOF", "Use the Write tool");
runMessage("cat-stderr-read", "cat foo 2>/dev/null", "Use the Read tool"); // stderr redirect = READ
runMessage("cat-2to1-read", "cat foo 2>&1", "Use the Read tool");
runMessage("cat-herestring-read", "cat <<< 'x'", "Use the Read tool"); // <<< here-string = READ

console.log("\n=== git: mutating BLOCKS, read-only/inspection PASSES ===");
runMessage("git-commit", "git commit -m x", "Mutating git");
runCase(BLOCK, "git-push", "git push origin main");
runCase(BLOCK, "git-reset-hard", "git reset --hard HEAD~1");
runCase(BLOCK, "git-C-commit", "git -C /repo commit -m x"); // global option before subcommand
runCase(BLOCK, "git-stash", "git stash");
runCase(BLOCK, "git-clean-force", "git clean -fd");
runCase(BLOCK, "git-branch-del", "git branch -D feature");
runCase(BLOCK, "git-worktree-add", "git worktree add ../wt main");
runMessage("git-grep", "git grep foo", "Use the Grep tool");
runCase(ALLOW, "git-status", "git status");
runCase(ALLOW, "git-log", "git log --oneline -n 5");
runCase(ALLOW, "git-mv", "git mv a b");
runCase(ALLOW, "git-stash-list", "git stash list");
runCase(ALLOW, "git-tag-list", "git tag -l 'v*'");
runCase(ALLOW, "git-config-get", "git config --get remote.origin.url");
runCase(ALLOW, "git-clean-dryrun", "git clean -n");
runCase(ALLOW, "git-apply-check", "git apply --check x.patch");
runCase(ALLOW, "git-fetch-dryrun", "git fetch --dry-run");

console.log("\n=== wrappers / substitutions / shell-wrapping BLOCK ===");
runCase(BLOCK, "abs-path-find", "/usr/bin/find .");
runCase(BLOCK, "backslash-grep", "\\grep foo");
runCase(BLOCK, "timeout-grep", "timeout 5 grep foo f");
runCase(BLOCK, "xargs-grep", "xargs grep foo");
runCase(BLOCK, "xargs-I-grep", "xargs -I {} grep foo {}");
runCase(BLOCK, "dollar-sub", "echo $(grep foo f)");
runCase(BLOCK, "backtick-sub", "echo `cat f`");
runCase(BLOCK, "procsub", "diff <(cat a) <(cat b)");
runMessage("bashc", 'bash -c "grep foo f"', "bash -c");
runCase(BLOCK, "bashc-login", 'bash -lc "cat f"');
runCase(
  BLOCK,
  "node-shellout",
  "node -e \"require('child_process').execSync('grep x')\"",
);
runCase(BLOCK, "command-grep", "command grep x");
runCase(ALLOW, "command-v", "command -v node");

console.log(
  "\n=== chaining BLOCKS; one logical command (quoted/continued/heredoc) PASSES ===",
);
runMessage("chain-and", "pnpm build && pnpm test", "No command chaining");
runCase(BLOCK, "chain-semi", "echo a ; echo b");
runCase(BLOCK, "chain-or", "true || echo no");
runCase(BLOCK, "multiline-block", "dex a\ndex b\ndex c");
runCase(ALLOW, "multiline-body", 'gh pr create --body "line1\nline2"');
runCase(ALLOW, "multiline-echo", 'echo "a\nb"');
runCase(ALLOW, "line-continuation", "docker run --rm \\\n  -v /d:/d img");
runCase(ALLOW, "heredoc-noncat", "psql db <<SQL\nSELECT 1;\nSQL");
runCase(ALLOW, "pipe-jq", "gh pr view --json title | jq .title");
runCase(ALLOW, "redirect", "echo hi > /tmp/x");

console.log("\n=== legit single commands PASS ===");
runCase(ALLOW, "pnpm", "pnpm install");
runCase(ALLOW, "ls", "ls -la");
runCase(ALLOW, "jq", "jq .name package.json");
runCase(ALLOW, "sed-subst", "sed 's/a/b/g' f");
runCase(ALLOW, "make", "make build");
runCase(ALLOW, "banned-in-quotes", 'echo "first; then cat results"');

console.log("\n=== fail-open on empty / absent command ===");
runCase(ALLOW, "empty-string", "");
{
  // absent command key → fail open (exit 0)
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: {} }),
    encoding: "utf8",
  });
  const code = r.status === null ? -2 : r.status;
  if (code === ALLOW) {
    console.log("PASS  [absent-command ALLOW]  {tool_input:{}}");
    pass++;
  } else {
    console.log(`FAIL  [absent-command want=0 got=${code}]  {tool_input:{}}`);
    fail++;
  }
}

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
