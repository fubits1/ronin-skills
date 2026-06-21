#!/usr/bin/env node
// Functional tests for the Node-ported workflow hooks: no-absolute-paths.mjs, force-plan-mode.mjs,
// fix-formatting.mjs, session-start.mjs. Each hook exports a pure core function (tested in-process)
// and is also spawned as a subprocess to check stdin parsing, exit codes, and stdout/stderr wiring.
//
//   node plugins/hooks/hooks/tests/run-hook-tests.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkAbsolutePaths } from "../no-absolute-paths.mjs";
import { planDirective } from "../force-plan-mode.mjs";
import { formatterFor } from "../fix-formatting.mjs";
import { sessionStartPayload } from "../session-start.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(HERE, "..");

let pass = 0;
let fail = 0;
function ok(condition, label) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
  }
}

// spawn a hook with a JSON payload on stdin; return { code, stdout, stderr }
function runHook(file, payload, env) {
  const result = spawnSync(process.execPath, [join(HOOKS, file)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: result.status === null ? -1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

console.log("=== no-absolute-paths ===");
const ROOT = "/test/proj";
const HOME = "/test/home";
ok(
  checkAbsolutePaths(`cat ${ROOT}/src/x`, ROOT, HOME) !== null,
  "abs root → block",
);
ok(checkAbsolutePaths("cat src/x", ROOT, HOME) === null, "relative → allow");
ok(checkAbsolutePaths("git diff", ROOT, HOME) === null, "no path → allow");
// tilde + $HOME forms when root is under home
const HROOT = `${HOME}/proj`;
ok(checkAbsolutePaths("cd ~/proj", HROOT, HOME) !== null, "tilde form → block");
ok(
  checkAbsolutePaths("cd $HOME/proj", HROOT, HOME) !== null,
  "$HOME form → block",
);
ok(
  checkAbsolutePaths("cd ~/other", HROOT, HOME) === null,
  "tilde non-root → allow",
);
// root IS home
ok(
  checkAbsolutePaths("ls ~", HOME, HOME) !== null,
  "root==home, bare ~ → block",
);
ok(checkAbsolutePaths("", ROOT, HOME) === null, "empty command → allow");
// subprocess wiring
const nap1 = runHook(
  "no-absolute-paths.mjs",
  { tool_input: { command: `ls ${ROOT}/a` } },
  { CLAUDE_PROJECT_DIR: ROOT },
);
ok(
  nap1.code === 2 && nap1.stderr.includes("BLOCKED"),
  "subprocess: abs root → exit 2 + message",
);
const nap2 = runHook(
  "no-absolute-paths.mjs",
  { tool_input: { command: "ls a" } },
  { CLAUDE_PROJECT_DIR: ROOT },
);
ok(nap2.code === 0, "subprocess: relative → exit 0");
const nap3 = runHook(
  "no-absolute-paths.mjs",
  { tool_input: {} },
  { CLAUDE_PROJECT_DIR: ROOT },
);
ok(nap3.code === 0, "subprocess: absent command → exit 0 (fail open)");
// root falls back to $PWD (logical) when CLAUDE_PROJECT_DIR is unset — must match the bash original,
// which used `${CLAUDE_PROJECT_DIR:-$PWD}` (NOT the symlink-resolved process.cwd()).
const nap4 = runHook(
  "no-absolute-paths.mjs",
  { tool_input: { command: "ls /fake/logical/root/x" } },
  { CLAUDE_PROJECT_DIR: "", PWD: "/fake/logical/root" },
);
ok(
  nap4.code === 2,
  "subprocess: PWD fallback (no CLAUDE_PROJECT_DIR) → exit 2",
);

console.log("=== force-plan-mode ===");
ok(planDirective("/plan") !== null, "/plan → directive");
ok(
  planDirective("/plan the migration") !== null,
  "/plan with args → directive",
);
ok(planDirective("plan this") !== null, "plan this → directive");
ok(planDirective("plan it.") !== null, "plan it. → directive");
ok(planDirective("make a plan") !== null, "make a plan → directive");
ok(planDirective("draft a plan for x") !== null, "draft a plan → directive");
ok(planDirective("planning the trip") === null, "planning → no false positive");
ok(planDirective("explain this") === null, "explain this → no false positive");
ok(planDirective("just do it") === null, "unrelated → null");
ok(planDirective("") === null, "empty → null");
// POSIX [[:punct:]] equivalence (the bash original): `_` IS punct → must match; non-ASCII / control
// are NOT punct → must NOT match (JS `[^\w\s]` got both backwards before the fix).
ok(
  planDirective("plan this_module") !== null,
  "plan this_ (underscore is punct) → directive",
);
ok(planDirective("plan it_x") !== null, "plan it_ (underscore) → directive");
ok(
  planDirective("plan thisé") === null,
  "plan thisé (non-ASCII, not punct) → null",
);
ok(planDirective("plan this") === null, "plan this+control (not punct) → null");
const fpm1 = runHook("force-plan-mode.mjs", { prompt: "/plan this feature" });
ok(
  fpm1.code === 0 && fpm1.stdout.includes("EnterPlanMode"),
  "subprocess: /plan → directive on stdout, exit 0",
);
const fpm2 = runHook("force-plan-mode.mjs", { prompt: "hello there" });
ok(
  fpm2.code === 0 && fpm2.stdout.trim() === "",
  "subprocess: unrelated → no output, exit 0",
);

console.log("=== fix-formatting ===");
ok(formatterFor("src/x.ts") === "prettier", ".ts → prettier");
ok(formatterFor("a/b.json") === "prettier", ".json → prettier");
ok(formatterFor("README.md") === "markdownlint", ".md → markdownlint");
ok(formatterFor("doc.mdx") === null, ".mdx → skip");
ok(formatterFor("") === null, "empty → null");
ok(formatterFor(undefined) === null, "undefined → null");
// never blocks: absent file_path → no formatter spawned → exit 0
const fmt1 = runHook("fix-formatting.mjs", { tool_input: {} });
ok(fmt1.code === 0, "subprocess: absent file_path → exit 0 (no spawn)");

console.log("=== session-start ===");
ok(
  sessionStartPayload.hookSpecificOutput.hookEventName === "SessionStart",
  "payload hookEventName === SessionStart",
);
ok(
  sessionStartPayload.hookSpecificOutput.additionalContext.includes(
    "/discipline",
  ),
  "payload mentions /discipline",
);
const ss = runHook("session-start.mjs", {});
let ssParsed = null;
try {
  ssParsed = JSON.parse(ss.stdout);
} catch {
  /* leave null */
}
ok(
  ss.code === 0 &&
    ssParsed &&
    ssParsed.hookSpecificOutput.hookEventName === "SessionStart",
  "subprocess: emits valid SessionStart JSON, exit 0",
);

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
