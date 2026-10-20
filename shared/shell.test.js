import assert from "node:assert/strict";
import { test } from "node:test";
import { baseName, parseShell } from "./shell.js";

// reads every command as written: no wrapper stripping
const asWritten = (tokens) => ({ effective: tokens });
const contexts = (source) =>
  parseShell(source, asWritten).commands.map(
    ({ effective, context }) => `${context}:${effective.join(" ")}`,
  );
const chained = (source) => parseShell(source, asWritten).chained;

test("contexts: where each command runs", () => {
  assert.deepEqual(contexts("echo $(grep a f)"), [
    "top:echo $(grep a f)",
    "dollar-sub:grep a f",
  ]);
  assert.deepEqual(contexts("echo `cat f`"), [
    "top:echo `cat f`",
    "backtick-sub:cat f",
  ]);
  assert.deepEqual(contexts("diff <(cat a) b"), [
    "top:diff <(cat a) b",
    "procsub:cat a",
  ]);
  assert.deepEqual(contexts("(cat a) | wc -l"), ["top:cat a", "top:wc -l"]);
});

test("contexts: scripts handed to a shell, and the context sticks inside them", () => {
  assert.deepEqual(contexts("bash -lc 'cat f'"), [
    "top:bash -lc cat f",
    "shell-script:cat f",
  ]);
  // an unquoted heredoc is expanded by the outer shell too, so `cat f` also runs as `$(…)` there
  assert.deepEqual(contexts("sh <<EOF\necho $(cat f)\nEOF"), [
    "top:sh",
    "shell-script:echo $(cat f)",
    "shell-script:cat f",
    "dollar-sub:cat f",
  ]);
  assert.deepEqual(contexts("sh <<'EOF'\necho $(cat f)\nEOF"), [
    "top:sh",
    "shell-script:echo $(cat f)",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("cat <<EOF\ngrep a f\nEOF"), ["top:cat"]);
});

test("shell scripts: -c among the shell's options, else stdin when -s is set or no script file is named", () => {
  assert.deepEqual(contexts("bash -c 'read x' <<< 'find me'"), [
    "top:bash -c read x",
    "shell-script:read x",
  ]);
  assert.deepEqual(contexts("bash ./setup.sh <<EOF\ncat f\nEOF"), [
    "top:bash ./setup.sh",
  ]);
  assert.deepEqual(contexts("bash setup.sh -c 'cat f'"), [
    "top:bash setup.sh -c cat f",
  ]);
  assert.deepEqual(contexts("bash -e <<< 'cat f'"), [
    "top:bash -e",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash -o pipefail -c 'cat f'"), [
    "top:bash -o pipefail -c cat f",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash --rcfile x -c 'cat f'"), [
    "top:bash --rcfile x -c cat f",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash -s arg <<EOF\ncat f\nEOF"), [
    "top:bash -s arg",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash -euo pipefail -c 'cat f'"), [
    "top:bash -euo pipefail -c cat f",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash -eo pipefail <<EOF\ncat f\nEOF"), [
    "top:bash -eo pipefail",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash -c -- 'cat f'"), [
    "top:bash -c -- cat f",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("{ bash; } <<EOF\ncat f\nEOF"), [
    "top:bash",
    "shell-script:cat f",
  ]);
  // options after -c are still options; the first operand is the script
  assert.deepEqual(contexts("bash -c -e 'cat f'"), [
    "top:bash -c -e cat f",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash -co pipefail 'cat f'"), [
    "top:bash -co pipefail cat f",
    "shell-script:cat f",
  ]);
  assert.deepEqual(contexts("bash -so pipefail arg <<< 'cat f'"), [
    "top:bash -so pipefail arg",
    "shell-script:cat f",
  ]);
  // only fd 0 feeds the shell, and the command's own stdin wins over an enclosing one
  assert.deepEqual(contexts("bash 3<<EOF\ncat f\nEOF"), ["top:bash"]);
  assert.deepEqual(contexts("bash <<A <<B\ncat a\nA\ncat b\nB"), [
    "top:bash",
    "shell-script:cat b",
  ]);
  assert.deepEqual(contexts("{ bash < s.sh; } <<EOF\ncat f\nEOF"), [
    "top:bash",
  ]);
  assert.deepEqual(contexts("{ bash <<'A'\ncat a\nA\n} <<'B'\ncat b\nB"), [
    "top:bash",
    "shell-script:cat a",
  ]);
  assert.deepEqual(contexts("{ bash; } <<A <<B\necho a\nA\ncat b\nB"), [
    "top:bash",
    "shell-script:cat b",
  ]);
  // the first shell reads the group's stdin to its end; a later pipeline stage reads the pipe
  assert.deepEqual(contexts("{ bash; bash; } <<EOF\ncat f\nEOF"), [
    "top:bash",
    "shell-script:cat f",
    "top:bash",
  ]);
  assert.deepEqual(contexts("{ echo ls | bash; } <<EOF\ncat f\nEOF"), [
    "top:echo ls",
    "top:bash",
  ]);
});

test("redirects: a command carries those of every enclosing subshell or group", () => {
  const redirectsOf = (source) =>
    parseShell(source, asWritten).commands.map(({ redirects }) =>
      redirects.map(({ operator }) => operator),
    );
  assert.deepEqual(redirectsOf("(cat a) > out"), [[">"]]);
  assert.deepEqual(redirectsOf("{ cat a 2>&1; } >> out"), [[">&", ">>"]]);
  assert.deepEqual(redirectsOf("cat a | wc -l"), [[], []]);
});

test("contexts: the hook's readCommand decides what counts as the shell", () => {
  const pastEnv = (tokens) => ({
    effective: tokens[0] === "env" ? tokens.slice(1) : tokens,
  });
  const { commands } = parseShell("env bash -c 'cat f'", pastEnv);
  assert.deepEqual(
    commands.map(({ context, effective }) => [context, effective.join(" ")]),
    [
      ["top", "bash -c cat f"],
      ["shell-script", "cat f"],
    ],
  );
});

test("chained: two or more commands, or a control structure; not a pipe or one backgrounded command", () => {
  for (const source of [
    "a && b",
    "a || b",
    "a ; b",
    "a\nb",
    "a & b",
    "a &\nb",
    "(a; b)",
    "for x in 1; do a; done",
    "while true; do a; done",
    "if a; then b; fi",
    "case x in y) a;; esac",
    "f() { a; }",
  ]) {
    assert.equal(chained(source), true, source);
  }
  for (const source of [
    "a | b",
    "a &",
    "a;",
    'echo "a; b"',
    "a \\\n  --flag",
    "psql <<SQL\nSELECT 1;\nSQL",
    "bash -c 'a; b'",
    "{ a; }",
  ]) {
    assert.equal(chained(source), false, source);
  }
});

test("parseError: reported, and what parsed is still returned", () => {
  const { commands, parseError } = parseShell("echo 'unterminated", asWritten);
  assert.equal(parseError, true);
  assert.equal(parseShell("echo ok", asWritten).parseError, false);
  assert.ok(Array.isArray(commands));
});

test("baseName: the command name without its directory", () => {
  assert.equal(baseName("/usr/bin/grep"), "grep");
  assert.equal(baseName("grep"), "grep");
  assert.equal(baseName(undefined), "undefined");
});
