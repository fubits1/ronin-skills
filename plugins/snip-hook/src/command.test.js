import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isUnapprovableByPrefixRule,
  parseCommands,
  readCommand,
} from "./command.js";

const readOnly = (source) =>
  parseCommands(source).commands.map((command) => command.readOnly);

test("readOnly: the documented read-only commands, in read-only forms", () => {
  for (const source of [
    "ls -la",
    "cat README.md",
    "grep -rn foo src",
    "find . -name x",
    "git status",
    "git log -5",
    "git diff HEAD~1",
    "git branch -a",
    "git tag",
    "git stash list",
    "git remote -v",
    "git log 2>&1",
    "echo hi > /dev/null",
    "nohup ls",
  ]) {
    assert.deepEqual(readOnly(source), [true], source);
  }
});

test("readOnly: never for writes, globs, assignments, unknown or mutating forms", () => {
  for (const source of [
    "npx cowsay hi",
    "curl -sS https://example.com",
    "git push",
    "git branch -D x",
    "git tag v1",
    "git stash",
    "git -C /tmp status",
    "find . -name x -delete",
    "git log > out.txt",
    "ls *.ts",
    "FOO=1 ls",
    "env ls",
  ]) {
    assert.deepEqual(readOnly(source), [false], source);
  }
  assert.deepEqual(readOnly("cd x && git status"), [true, false]);
  assert.deepEqual(readOnly("ls " + "a".repeat(10_001)), [false]);
});

test("isUnapprovableByPrefixRule: exec wrappers and find actions", () => {
  assert.equal(isUnapprovableByPrefixRule(["watch", "ls"]), true);
  assert.equal(
    isUnapprovableByPrefixRule(["find", ".", "-exec", "rm", "{}", ";"]),
    true,
  );
  assert.equal(isUnapprovableByPrefixRule(["find", ".", "-name", "x"]), false);
  assert.equal(isUnapprovableByPrefixRule(["ls"]), false);
});

test("readCommand: every reading, outermost first", () => {
  const { readings, effective, grantable } = readCommand([
    "FOO=1",
    "timeout",
    "30s",
    "git",
    "log",
  ]);
  assert.deepEqual(
    readings.map((reading) => reading.join(" ")),
    ["FOO=1 timeout 30s git log", "timeout 30s git log", "git log"],
  );
  assert.deepEqual(effective, ["git", "log"]);
  assert.equal(grantable, false);
});

test("readCommand: Claude Code's own wrappers stay grantable, env does not", () => {
  assert.equal(readCommand(["nohup", "git", "log"]).grantable, true);
  assert.equal(readCommand(["env", "git", "log"]).grantable, false);
  assert.deepEqual(readCommand(["command", "-v", "npx"]).effective, [
    "command",
    "-v",
    "npx",
  ]);
});

test("readCommand: grantReading is the reading Claude Code matches an allow rule against", () => {
  const grant = (tokens) => readCommand(tokens).grantReading?.join(" ");
  assert.equal(grant(["nohup", "timeout", "5", "git", "log"]), "git log");
  assert.equal(grant(["nohup", "env", "git", "log"]), "env git log");
  assert.equal(
    grant(["FOO=1", "timeout", "5", "git", "log"]),
    "FOO=1 timeout 5 git log",
  );
  assert.equal(grant(["xargs", "-n1", "grep", "x"]), "xargs -n1 grep x");
  assert.equal(grant(["timeout", "-s", "KILL", "5", "git", "log"]), "git log");
  assert.equal(grant(["nice", "-n10", "git", "log"]), "nice -n10 git log");
  assert.equal(grant(["/usr/bin/nice", "git", "log"]), "/usr/bin/nice git log");
});

test("parseCommands: pipelines, lists, redirects and quotes", () => {
  const { commands, grantable } = parseCommands(
    `git log -10 2>&1 | grep "a b" && npx --yes 'prettier@3' x &`,
  );
  assert.deepEqual(
    commands.map(({ text }) => text),
    ["git log -10", "grep a b", "npx --yes prettier@3 x"],
  );
  assert.equal(grantable, true);
});

test("parseCommands: nested commands are found, but never grantable", () => {
  const { commands, grantable } = parseCommands("echo $(gh repo delete x)");
  assert.deepEqual(
    commands.map(({ text }) => text),
    ["echo $(gh repo delete x)", "gh repo delete x"],
  );
  assert.equal(grantable, false);
});

test("parseCommands: heredocs are data unless a shell reads them", () => {
  assert.deepEqual(
    parseCommands("cat <<EOF\nrm -rf /\nEOF").commands.map(({ text }) => text),
    ["cat"],
  );
  assert.deepEqual(
    parseCommands("sh <<EOF\nrm -rf /\nEOF").commands.map(({ text }) => text),
    ["sh", "rm -rf /"],
  );
});
