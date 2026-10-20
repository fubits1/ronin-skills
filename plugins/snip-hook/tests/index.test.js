/**
 * the spawned-process contract of the SHIPPED bundle, dist/index.js (`pnpm test` builds it first):
 * stdin payload in, exit code + stdout/stderr out, with real settings discovery (CLAUDE_CONFIG_DIR
 * for the user file, CLAUDE_PROJECT_DIR or the payload `cwd` for the project). `snip` resolves to
 * the stub in tests/fixtures/bin, steered by SNIP_STUB (default: pass-through)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

const BUNDLE = join(import.meta.dirname, "..", "dist", "index.js");
const FIXTURES = join(import.meta.dirname, "fixtures");
const PROJECT = join(FIXTURES, "project");

function runHook(input, env = {}) {
  // drop the caller's own values, so only the test decides which settings the hook reads
  const {
    SNIP_WRAPPER_SETTINGS: _settings,
    CLAUDE_PROJECT_DIR: _projectDir,
    ...inherited
  } = process.env;
  const result = spawnSync(process.execPath, [BUNDLE], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...inherited,
      PATH: join(FIXTURES, "bin") + delimiter + inherited.PATH,
      SNIP_STUB: "none",
      CLAUDE_CONFIG_DIR: join(FIXTURES, "user"),
      // the fixture project sits inside this repository: stop git's search there, so the hook
      // never reads the repository's own .claude/settings.local.json
      GIT_CEILING_DIRECTORIES: FIXTURES,
      ...env,
    },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const bash = (command, cwd = PROJECT) => ({
  tool_name: "Bash",
  tool_input: { command },
  cwd,
});
const decisionOf = ({ stdout }) =>
  JSON.parse(stdout).hookSpecificOutput.permissionDecision;
const SILENT = { exitCode: 0, stdout: "", stderr: "" };

test("deny: exit 2 with the reason on stderr", () => {
  const { exitCode, stdout, stderr } = runHook(
    bash("gh repo delete fubits1/x"),
  );
  assert.equal(exitCode, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /BLOCKED \| reason=deny/);
  assert.match(stderr, /Bash\(gh repo delete \*\)/);
});

test("allow: exit 0 with a PreToolUse allow decision", () => {
  const result = runHook(bash("git log -10"));
  assert.equal(result.exitCode, 0);
  assert.equal(decisionOf(result), "allow");
});

test("untrusted project: deny and ask apply, allow does not grant", () => {
  assert.equal(runHook(bash("git push origin main")).exitCode, 2);
  assert.equal(decisionOf(runHook(bash("curl -I example.com"))), "ask");
  assert.deepEqual(runHook(bash("rm -rf build")), SILENT);
});

test("project settings come from CLAUDE_PROJECT_DIR, not from where Claude cd'd to", () => {
  const moved = bash("git push origin main", FIXTURES);
  assert.deepEqual(runHook(moved), SILENT);
  assert.equal(runHook(moved, { CLAUDE_PROJECT_DIR: PROJECT }).exitCode, 2);
});

test("B2: malformed settings via SNIP_WRAPPER_SETTINGS keep the valid deny", () => {
  const { exitCode } = runHook(bash("gh repo delete fubits1/x"), {
    SNIP_WRAPPER_SETTINGS: join(FIXTURES, "malformed.json"),
  });
  assert.equal(exitCode, 2);
});

test("restore: no rule, snip would auto-allow -> ask, in modes where Claude Code prompts", () => {
  const npx = (mode) => ({ ...bash("npx cowsay hi"), permission_mode: mode });
  const allow = { SNIP_STUB: "allow" };
  for (const mode of ["default", "acceptEdits", "plan", "dontAsk"]) {
    const result = runHook(npx(mode), allow);
    assert.equal(decisionOf(result), "ask", mode);
    assert.match(result.stdout, /without snip Claude Code would ask/);
  }
  for (const mode of ["auto", "bypassPermissions"]) {
    assert.deepEqual(runHook(npx(mode), allow), SILENT, mode);
  }
});

test("restore: silent when snip wouldn't auto-allow, fails, or the command is read-only", () => {
  assert.deepEqual(runHook(bash("npx cowsay hi")), SILENT);
  assert.deepEqual(
    runHook(bash("npx cowsay hi"), { SNIP_STUB: "fail" }),
    SILENT,
  );
  assert.deepEqual(runHook(bash("ls -la"), { SNIP_STUB: "allow" }), SILENT);
});

test("fail-open: unparseable or unexpected stdin is silent", () => {
  for (const input of [
    "",
    " ",
    "not json at all",
    "{",
    "[]",
    "null",
    '"a string"',
    '{"tool_input":null}',
    "\u0000\u0001",
  ]) {
    assert.deepEqual(runHook(input), SILENT, JSON.stringify(input));
  }
});

test("wiring: hooks/hooks.json runs the bundle from an install path with a space", () => {
  const root = join(mkdtempSync(join(tmpdir(), "snip-wiring-")), "My Plugin");
  mkdirSync(join(root, "dist"), { recursive: true });
  copyFileSync(BUNDLE, join(root, "dist", "index.js"));
  const hooksJson = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "hooks", "hooks.json"),
      "utf8",
    ),
  );
  try {
    for (const { hooks } of hooksJson.hooks.PreToolUse) {
      for (const { command, args } of hooks) {
        const result = spawnSync(
          command,
          args.map((arg) => arg.replaceAll("${CLAUDE_PLUGIN_ROOT}", root)),
          { input: "{}", encoding: "utf8" },
        );
        assert.equal(result.status, 0, result.stderr);
      }
    }
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});
