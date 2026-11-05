#!/usr/bin/env node
// Functional tests for the Node-ported workflow hooks: no-absolute-paths.mjs, force-plan-mode.mjs,
// fix-formatting.mjs, session-start.mjs. Each hook exports a pure core function (tested in-process)
// and is also spawned as a subprocess to check stdin parsing, exit codes, and stdout/stderr wiring.
// no-idle-wait.mjs exports no core and is tested as a subprocess only.
// no-honest.mjs's pure core (detectVouching / turnAssistantText) is tested in-process here; its
// subprocess checks live in run-no-honest-tests.mjs.
//
//   node plugins/hooks/hooks/tests/run-hook-tests.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { checkAbsolutePaths } from "../no-absolute-paths.mjs";
import { planDirective } from "../force-plan-mode.mjs";
import { formatterFor, formatterSpec } from "../fix-formatting.mjs";
import { sessionStartPayload } from "../session-start.mjs";
import { detectVouching, turnAssistantText } from "../no-honest.mjs";

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
const HOME_ROOT = `${HOME}/proj`;
ok(
  checkAbsolutePaths("cd ~/proj", HOME_ROOT, HOME) !== null,
  "tilde form → block",
);
ok(
  checkAbsolutePaths("cd $HOME/proj", HOME_ROOT, HOME) !== null,
  "$HOME form → block",
);
ok(
  checkAbsolutePaths("cd ~/other", HOME_ROOT, HOME) === null,
  "tilde non-root → allow",
);
// root IS home
ok(
  checkAbsolutePaths("ls ~", HOME, HOME) !== null,
  "root==home, bare ~ → block",
);
ok(checkAbsolutePaths("", ROOT, HOME) === null, "empty command → allow");
// subprocess wiring
const runNoAbsolutePaths = (payload, env = { CLAUDE_PROJECT_DIR: ROOT }) =>
  runHook("no-absolute-paths.mjs", payload, env);
const absoluteRoot = runNoAbsolutePaths({
  tool_input: { command: `ls ${ROOT}/a` },
});
ok(
  absoluteRoot.code === 2 && absoluteRoot.stderr.includes("BLOCKED"),
  "subprocess: abs root → exit 2 + message",
);
const relativePath = runNoAbsolutePaths({ tool_input: { command: "ls a" } });
ok(relativePath.code === 0, "subprocess: relative → exit 0");
const absentCommand = runNoAbsolutePaths({ tool_input: {} });
ok(absentCommand.code === 0, "subprocess: absent command → exit 0 (fail open)");
// root falls back to $PWD (logical) when CLAUDE_PROJECT_DIR is unset — must match the bash original,
// which used `${CLAUDE_PROJECT_DIR:-$PWD}` (NOT the symlink-resolved process.cwd()).
const pwdFallback = runNoAbsolutePaths(
  { tool_input: { command: "ls /fake/logical/root/x" } },
  { CLAUDE_PROJECT_DIR: "", PWD: "/fake/logical/root" },
);
ok(
  pwdFallback.code === 2,
  "subprocess: PWD fallback (no CLAUDE_PROJECT_DIR) → exit 2",
);
// stdin `cwd` follows Bash `cd`: from outside root, the absolute root is the only way back
const cdBack = runNoAbsolutePaths({
  cwd: "/elsewhere/tmp",
  tool_input: { command: `cd ${ROOT}` },
});
ok(cdBack.code === 0, "subprocess: shell outside root, cd back → exit 0");
const shellUnderRoot = runNoAbsolutePaths({
  cwd: `${ROOT}/src`,
  tool_input: { command: `ls ${ROOT}/a` },
});
ok(shellUnderRoot.code === 2, "subprocess: shell under root → exit 2");
const siblingPrefix = runNoAbsolutePaths({
  cwd: `${ROOT}-other`,
  tool_input: { command: `ls ${ROOT}/a` },
});
ok(
  siblingPrefix.code === 0,
  "subprocess: sibling dir sharing the root prefix → exit 0",
);
{
  // stdin `cwd` arrives symlink-resolved, the root stays logical: a shell AT the root still blocks
  const logicalRoot = mkdtempSync(join(tmpdir(), "nap-"));
  const symlinkedRoot = runNoAbsolutePaths(
    {
      cwd: realpathSync(logicalRoot),
      tool_input: { command: `ls ${logicalRoot}/a` },
    },
    { CLAUDE_PROJECT_DIR: logicalRoot },
  );
  rmSync(logicalRoot, { recursive: true });
  ok(symlinkedRoot.code === 2, "subprocess: shell at symlinked root → exit 2");
}

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
// word boundaries on the make/draft/write-a-plan branch (tighter than the old .sh, which matched
// these as substrings): "make"/"plan" must be standalone words.
ok(
  planDirective("please make a plan") !== null,
  "make a plan after a word → directive",
);
ok(
  planDirective("remake a planet") === null,
  "remake a planet (substring) → null",
);
ok(
  planDirective("make a planner now") === null,
  "make a planner (substring) → null",
);
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
const plan = runHook("force-plan-mode.mjs", { prompt: "/plan this feature" });
ok(
  plan.code === 0 && plan.stdout.includes("EnterPlanMode"),
  "subprocess: /plan → directive on stdout, exit 0",
);
const unrelated = runHook("force-plan-mode.mjs", { prompt: "hello there" });
ok(
  unrelated.code === 0 && unrelated.stdout.trim() === "",
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
const absentPath = runHook("fix-formatting.mjs", { tool_input: {} });
ok(absentPath.code === 0, "subprocess: absent file_path → exit 0 (no spawn)");
// formatterSpec per-OS (the Windows .cmd fix — can't spawn npx.cmd without a shell):
const unix = formatterSpec("prettier", "a/b.ts", "linux");
ok(
  unix.command === "npx" &&
    unix.shell === false &&
    unix.args.join(" ") === "-y prettier --write a/b.ts",
  "spec(unix): no-shell argv array",
);
const unixMd = formatterSpec("markdownlint", "x.md", "darwin");
ok(
  unixMd.args.join(" ") === "-y markdownlint-cli2 --fix x.md" && !unixMd.shell,
  "spec(unix): markdownlint argv",
);
const win = formatterSpec("prettier", "C:\\my file.ts", "win32");
ok(
  win.shell === true &&
    win.args.length === 0 &&
    win.command === 'npx -y prettier --write "C:\\my file.ts"',
  "spec(win32): shell:true, path quoted (handles spaces)",
);
const winMd = formatterSpec("markdownlint", "x.md", "win32");
ok(
  winMd.shell === true &&
    winMd.command === 'npx -y markdownlint-cli2 --fix "x.md"',
  "spec(win32): markdownlint shell command",
);
// win32 rejects a path with `"` (breaks quoting) or `%` (cmd %VAR% expansion; % is legal in NTFS, so
// stripping would mis-target a real file) → fail open, skip formatting rather than mutate the path
ok(
  formatterSpec("prettier", 'a"b%c.ts', "win32") === null,
  'spec(win32): unquotable path (" or %) → null (skip, never mis-target)',
);
// a normal win32 path with neither char still formats
ok(
  formatterSpec("prettier", "C:\\proj\\src\\x.ts", "win32")?.command ===
    'npx -y prettier --write "C:\\proj\\src\\x.ts"',
  "spec(win32): clean path → quoted command",
);

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
const sessionStart = runHook("session-start.mjs", {});
let sessionStartJson = null;
try {
  sessionStartJson = JSON.parse(sessionStart.stdout);
} catch {
  /* leave null */
}
ok(
  sessionStart.code === 0 &&
    sessionStartJson &&
    sessionStartJson.hookSpecificOutput.hookEventName === "SessionStart",
  "subprocess: emits valid SessionStart JSON, exit 0",
);

console.log("=== no-honest ===");
ok(
  detectVouching("To be honest, I ran it.") === true,
  "opener 'to be honest' → true",
);
ok(detectVouching("Honestly I did not check.") === true, "'honestly' → true");
ok(
  detectVouching("the honesty policy applies") === false,
  "'honesty' (noun) → false",
);
ok(detectVouching("that would be dishonest") === false, "'dishonest' → false");
ok(
  detectVouching("the word `honest` in code") === false,
  "inline-code 'honest' → false",
);
ok(
  detectVouching("```\nhonestly\n```") === false,
  "fenced-code 'honestly' → false",
);
ok(detectVouching("") === false, "empty → false");
ok(detectVouching("plain proof, exit 0") === false, "no vouch word → false");
// turnAssistantText: only assistant text AFTER the last genuine user PROMPT (tool-results are role
// user but carry no text → not a turn boundary)
const entries = [
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "OLD turn" }],
    },
  },
  {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "the prompt" }] },
  },
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "new A" }] },
  },
  {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: "x" }] },
  },
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "new B" }] },
  },
];
const turn = turnAssistantText(entries);
ok(
  turn.includes("new A") && turn.includes("new B"),
  "turnText: includes both post-prompt assistant blocks",
);
ok(!turn.includes("OLD turn"), "turnText: excludes the previous turn");
// some turns store assistant content as a plain STRING, not a block array (isUserPrompt handles both;
// turnAssistantText must too, or the nudge silently misses those turns)
const stringContentEntries = [
  {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "go" }] },
  },
  {
    type: "assistant",
    message: { role: "assistant", content: "Honestly, I did not verify." },
  },
];
ok(
  detectVouching(turnAssistantText(stringContentEntries)) === true,
  "turnText: string-content assistant message is scanned (honestly → true)",
);

console.log("=== no-idle-wait ===");
function idleNudge(payload) {
  const result = runHook("no-idle-wait.mjs", {
    hook_event_name: "Stop",
    stop_hook_active: false,
    ...payload,
  });
  try {
    const json = JSON.parse(result.stdout);
    return json.hookSpecificOutput.hookEventName === "Stop"
      ? json.hookSpecificOutput.additionalContext
      : "";
  } catch {
    return result.code === 0 ? "" : `exit ${result.code}`;
  }
}
const shellTask = {
  type: "shell",
  status: "running",
  description: "tail logs",
};
const agentTask = {
  type: "subagent",
  status: "running",
  description: "review diff",
};
const doneTask = {
  type: "shell",
  status: "completed",
  description: "pnpm build",
};
ok(
  idleNudge({ background_tasks: [shellTask] }).includes("shell: tail logs"),
  "running task → Stop nudge names it",
);
const mixed = idleNudge({ background_tasks: [shellTask, doneTask, agentTask] });
ok(
  mixed.includes("shell: tail logs; subagent: review diff") &&
    !mixed.includes("pnpm build"),
  "only running tasks listed",
);
ok(
  idleNudge({ background_tasks: [] }) === "",
  "empty background_tasks → silent",
);
ok(idleNudge({}) === "", "background_tasks absent → silent");
ok(
  idleNudge({ background_tasks: [doneTask] }) === "",
  "nothing running → silent",
);
ok(
  idleNudge({ background_tasks: "running" }) === "",
  "background_tasks not an array → silent",
);
ok(
  idleNudge({ stop_hook_active: true, background_tasks: [shellTask] }) === "",
  "loop guard: stop_hook_active → silent",
);

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
