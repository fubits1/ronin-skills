import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  compileRules,
  firstMatch,
  settingsFiles,
  snipHookHandler,
} from "./rules.js";

const FIXTURES = join(import.meta.dirname, "..", "tests", "fixtures");

test("snipHookHandler: the snip hook registered under PreToolUse, or null", () => {
  assert.deepEqual(snipHookHandler([{ path: join(FIXTURES, "hooks.json") }]), {
    command: "/opt/homebrew/bin/snip hook",
    args: undefined,
  });
  assert.equal(
    snipHookHandler([{ path: join(FIXTURES, "settings.json") }]),
    null,
  );
  assert.equal(
    snipHookHandler([{ path: join(FIXTURES, "missing.json") }]),
    null,
  );
});

// has both a project settings.json and a settings.local.json
const PROJECT = join(import.meta.dirname, "..", "tests", "fixtures", "project");
const PROJECT_REPO = {
  topLevel: PROJECT,
  gitDir: join(PROJECT, ".git"),
  commonDir: join(PROJECT, ".git"),
};

/**
 * stands in for git: `repo` answers `rev-parse` (null = not a repository), `tracked` answers
 * `ls-files --error-unmatch` for the local settings file
 */
function fakeGit({ repo = null, tracked = false } = {}) {
  return (args) => {
    if (args[0] === "rev-parse") {
      return repo && `${repo.topLevel}\n${repo.gitDir}\n${repo.commonDir}\n`;
    }
    return tracked ? ".claude/settings.local.json\n" : null;
  };
}

// stands in for ~/.claude.json: every listed folder has accepted the trust dialog
const trusting =
  (...dirs) =>
  () =>
    Object.fromEntries(
      dirs.map((dir) => [dir, { hasTrustDialogAccepted: true }]),
    );

const files = (options) =>
  settingsFiles({
    env: {},
    home: "/home/me",
    trustedProjects: trusting(),
    ...options,
  });
const summary = (list) => list.map(({ path, grants }) => [path, grants]);

test("settingsFiles: outside a repository the local file sits in the start directory", () => {
  assert.deepEqual(
    summary(files({ projectDir: "/work/app", git: fakeGit() })),
    [
      [join("/home/me", ".claude", "settings.json"), true],
      [join("/work/app", ".claude", "settings.json"), false], // missing
      [join("/work/app", ".claude", "settings.local.json"), false], // missing
    ],
  );
});

test("settingsFiles: the local file sits at the repository root, from subdirectories too", () => {
  const list = files({
    projectDir: "/repo/packages/web",
    git: fakeGit({
      repo: {
        topLevel: "/repo",
        gitDir: "/repo/.git",
        commonDir: "/repo/.git",
      },
    }),
  });
  assert.equal(
    list[1].path,
    join("/repo/packages/web", ".claude", "settings.json"),
  );
  assert.equal(list[2].path, join("/repo", ".claude", "settings.local.json"));
});

test("settingsFiles: a linked worktree resolves the local file to the main checkout", () => {
  const list = files({
    projectDir: "/wt/feature",
    git: fakeGit({
      repo: {
        topLevel: "/wt/feature",
        gitDir: "/main/.git/worktrees/feature",
        commonDir: "/main/.git",
      },
    }),
  });
  assert.equal(list[2].path, join("/main", ".claude", "settings.local.json"));
});

test("settingsFiles: an untrusted project grants nothing", () => {
  const list = files({
    projectDir: PROJECT,
    git: fakeGit({ repo: PROJECT_REPO }),
  });
  assert.deepEqual(summary(list).slice(1), [
    [join(PROJECT, ".claude", "settings.json"), false],
    [join(PROJECT, ".claude", "settings.local.json"), false],
  ]);
});

test("settingsFiles: a trusted project grants its settings.json and own local file", () => {
  const list = files({
    projectDir: PROJECT,
    git: fakeGit({ repo: PROJECT_REPO }),
    trustedProjects: trusting(PROJECT),
  });
  assert.deepEqual(summary(list).slice(1), [
    [join(PROJECT, ".claude", "settings.json"), true],
    [join(PROJECT, ".claude", "settings.local.json"), true],
  ]);
});

test("settingsFiles: a tracked local file never grants, even when trusted", () => {
  const list = files({
    projectDir: PROJECT,
    git: fakeGit({ repo: PROJECT_REPO, tracked: true }),
    trustedProjects: trusting(PROJECT),
  });
  assert.equal(list[2].grants, false);
});

test("settingsFiles: a trusted parent folder does not cover a repository", () => {
  const list = files({
    projectDir: PROJECT,
    git: fakeGit({ repo: PROJECT_REPO }),
    trustedProjects: trusting(join(PROJECT, "..")),
  });
  assert.deepEqual(
    summary(list)
      .slice(1)
      .map(([, grants]) => grants),
    [false, false],
  );
});

test("settingsFiles: outside a repository a trusted parent covers the local file only", () => {
  const list = files({
    projectDir: PROJECT,
    git: fakeGit(),
    trustedProjects: trusting(join(PROJECT, "..")),
  });
  assert.deepEqual(
    summary(list)
      .slice(1)
      .map(([, grants]) => grants),
    [false, true],
  );
});

test("settingsFiles: the configuration home's local file applies without trust", () => {
  // in ~ the project settings.json is the user file, so the list has two entries
  const list = files({ projectDir: PROJECT, home: PROJECT, git: fakeGit() });
  assert.deepEqual(summary(list), [
    [join(PROJECT, ".claude", "settings.json"), true],
    [join(PROJECT, ".claude", "settings.local.json"), true],
  ]);
});

test("settingsFiles: CLAUDE_CONFIG_DIR and SNIP_WRAPPER_SETTINGS", () => {
  const configured = files({
    projectDir: "/work/app",
    env: { CLAUDE_CONFIG_DIR: "/cfg" },
    git: fakeGit(),
  });
  assert.equal(configured[0].path, join("/cfg", "settings.json"));
  assert.deepEqual(
    settingsFiles({ env: { SNIP_WRAPPER_SETTINGS: "/x.json" } }),
    [{ path: "/x.json", grants: true }],
  );
});

test("rule matcher: word boundary, bare form, mid-pattern glob, exact", () => {
  const rules = compileRules([
    "ls *",
    "git log:*",
    "* --help *",
    "pnpm build",
    "gh * view",
  ]);
  assert.equal(firstMatch("ls -la", rules), "ls *");
  assert.equal(firstMatch("ls", rules), "ls *");
  assert.equal(firstMatch("lsof", rules), null);
  assert.equal(firstMatch("git log", rules), "git log:*");
  assert.equal(firstMatch("npm --help x", rules), "* --help *");
  assert.equal(firstMatch("npm --help", rules), null);
  assert.equal(firstMatch("pnpm build", rules), "pnpm build");
  assert.equal(firstMatch("pnpm build --watch", rules), null);
  assert.equal(firstMatch("gh pr view", rules), "gh * view");
  assert.equal(firstMatch("a.b", compileRules(["a.b"])), "a.b");
  assert.equal(firstMatch("aXb", compileRules(["a.b"])), null);
});
