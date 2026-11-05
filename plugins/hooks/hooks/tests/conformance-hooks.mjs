#!/usr/bin/env node
// Protocol-conformance + fail-open harness for every hook in the plugin. Unlike run-hook-tests (which
// checks each hook's pure core + a partial payload), this feeds the FULL Claude Code stdin envelope
// per event and asserts the OBSERVABLE protocol contract from code.claude.com/docs/en/hooks:
//   - PreToolUse block  = exit 2, message on STDERR, STDOUT empty (stderr is the block channel).
//   - UserPromptSubmit / SessionStart context = exit 0, STDOUT JSON hookSpecificOutput.hookEventName
//     matching the event + additionalContext (stdout is the context channel for these two events).
//   - PostToolUse        = exit 0, never blocks.
//   - Stop (no-honest)   = exit 0; on a vouching turn, STDOUT JSON hookEventName "Stop".
//   - Fail-open: malformed/empty/garbage stdin must never crash, hang, or exit non-0/2.
//   - Wiring: every hooks.json command resolves when the plugin root contains a space.
//
//   node plugins/hooks/hooks/tests/conformance-hooks.mjs
// CONF_HOOKS_DIR=<dir> overrides which hooks are tested (used to prove this harness has teeth against
// deliberately-broken copies).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS = process.env.CONF_HOOKS_DIR || join(HERE, "..");

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
function runHook(file, payload, env) {
  const result = spawnSync(process.execPath, [join(HOOKS, file)], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10000, // a hook that hangs is a failure, not a pass
    env: { ...process.env, ...env },
  });
  return {
    code: result.status === null ? -1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}
function parseStdout(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

// the full envelope Claude Code sends on stdin (per the spec) — hooks must tolerate every field.
const base = {
  session_id: "abc123",
  transcript_path: "/nonexistent/transcript.jsonl",
  cwd: "/some/where",
  permission_mode: "default",
};

console.log("=== PreToolUse (block = exit 2, STDERR, empty STDOUT) ===");
{
  const block = runHook("no-bash.mjs", {
    ...base,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "cat secret" },
  });
  ok(block.code === 2, "no-bash block: exit 2");
  ok(block.stderr.trim() !== "", "no-bash block: message on STDERR");
  ok(
    block.stdout.trim() === "",
    "no-bash block: STDOUT empty (not the channel)",
  );
  const allow = runHook("no-bash.mjs", {
    ...base,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
  });
  ok(allow.code === 0, "no-bash allow: exit 0");
  const absolutePathBlock = runHook(
    "no-absolute-paths.mjs",
    {
      ...base,
      cwd: "/proj", // the hook blocks only while the shell sits at or under the root
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls /proj/x" },
    },
    { CLAUDE_PROJECT_DIR: "/proj" },
  );
  ok(
    absolutePathBlock.code === 2 &&
      absolutePathBlock.stderr.includes("BLOCKED") &&
      absolutePathBlock.stdout.trim() === "",
    "no-absolute-paths block: exit 2 + STDERR + empty STDOUT",
  );
}

console.log("=== UserPromptSubmit (context = exit 0, STDOUT JSON) ===");
{
  const match = runHook("force-plan-mode.mjs", {
    ...base,
    hook_event_name: "UserPromptSubmit",
    prompt: "/plan this feature",
  });
  const json = parseStdout(match.stdout);
  ok(match.code === 0, "force-plan match: exit 0");
  ok(
    json && json.hookSpecificOutput?.hookEventName === "UserPromptSubmit",
    "force-plan match: STDOUT JSON hookEventName === UserPromptSubmit",
  );
  ok(
    typeof json?.hookSpecificOutput?.additionalContext === "string" &&
      json.hookSpecificOutput.additionalContext.length > 0,
    "force-plan match: additionalContext present",
  );
  const noMatch = runHook("force-plan-mode.mjs", {
    ...base,
    hook_event_name: "UserPromptSubmit",
    prompt: "just say hi",
  });
  ok(
    noMatch.code === 0 && noMatch.stdout.trim() === "",
    "force-plan no-match: exit 0, no output",
  );
}

console.log("=== PostToolUse (never blocks) ===");
{
  const result = runHook("fix-formatting.mjs", {
    ...base,
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: "" },
  });
  ok(result.code === 0, "fix-formatting: exit 0 (never blocks)");
}

console.log("=== SessionStart (context = exit 0, STDOUT JSON) ===");
{
  const result = runHook("session-start.mjs", {
    ...base,
    hook_event_name: "SessionStart",
    source: "startup",
  });
  const json = parseStdout(result.stdout);
  ok(result.code === 0, "session-start: exit 0");
  ok(
    json &&
      json.hookSpecificOutput?.hookEventName === "SessionStart" &&
      json.hookSpecificOutput.additionalContext,
    "session-start: STDOUT JSON hookEventName === SessionStart + additionalContext",
  );
}

console.log("=== Stop / no-honest (STDOUT JSON on a vouching turn) ===");
{
  const work = mkdtempSync(join(tmpdir(), "conf-"));
  const writeTranscript = (name, assistantText) => {
    const transcriptPath = join(work, name);
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "do it" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: assistantText }],
          },
        }),
      ].join("\n"),
    );
    return transcriptPath;
  };
  const transcriptVouch = writeTranscript("vouch.jsonl", "To be honest, done.");
  const vouch = runHook("no-honest.mjs", {
    ...base,
    hook_event_name: "Stop",
    transcript_path: transcriptVouch,
    stop_hook_active: false,
  });
  const json = parseStdout(vouch.stdout);
  ok(vouch.code === 0, "no-honest vouch: exit 0");
  ok(
    json &&
      json.hookSpecificOutput?.hookEventName === "Stop" &&
      json.hookSpecificOutput.additionalContext,
    "no-honest vouch: STDOUT JSON hookEventName === Stop + additionalContext",
  );
  const transcriptClean = writeTranscript(
    "clean.jsonl",
    "Done. exit 0, proof above.",
  );
  const clean = runHook("no-honest.mjs", {
    ...base,
    hook_event_name: "Stop",
    transcript_path: transcriptClean,
    stop_hook_active: false,
  });
  ok(
    clean.code === 0 && clean.stdout.trim() === "",
    "no-honest no-vouch: exit 0, no output",
  );
  const looped = runHook("no-honest.mjs", {
    ...base,
    hook_event_name: "Stop",
    transcript_path: transcriptVouch,
    stop_hook_active: true,
  });
  ok(
    looped.code === 0 && looped.stdout.trim() === "",
    "no-honest loop-guard: stop_hook_active → no output",
  );
  rmSync(work, { recursive: true, force: true });
}

console.log(
  "=== Fail-open: malformed / empty / garbage stdin never crashes ===",
);
{
  const allHooks = [
    "no-bash.mjs",
    "no-absolute-paths.mjs",
    "force-plan-mode.mjs",
    "fix-formatting.mjs",
    "session-start.mjs",
    "no-honest.mjs",
    "no-idle-wait.mjs",
    "no-tmp.mjs",
  ];
  const badInputs = [
    "",
    "not json at all",
    "{",
    "[]",
    "null",
    '"a string"',
    '{"tool_input":null}',
    "\u0000\u0001",
  ];
  for (const hook of allHooks) {
    for (const bad of badInputs) {
      const result = runHook(hook, bad);
      ok(
        result.code === 0 || result.code === 2,
        `fail-open ${hook} <- ${JSON.stringify(bad).slice(0, 20)}: exit ${result.code} (must be 0 or 2, never crash/hang)`,
      );
    }
  }
  // a huge command must not crash or hang either
  const huge = runHook("no-bash.mjs", {
    ...base,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "echo " + "a".repeat(500000) },
  });
  ok(
    huge.code === 0 || huge.code === 2,
    "fail-open no-bash <- 500KB command: bounded, exit 0/2",
  );
}

console.log(
  "=== hooks.json wiring: every command resolves from a spaced install path ===",
);
{
  // every hook fails open on `{}`, so exit 0 proves node found the file (bash: default hook shell)
  const root = join(
    mkdtempSync(join(tmpdir(), "conf-wiring-")),
    "My Plugin Root",
  );
  mkdirSync(join(root, "hooks"), { recursive: true });
  for (const file of readdirSync(HOOKS).filter((name) =>
    name.endsWith(".mjs"),
  )) {
    copyFileSync(join(HOOKS, file), join(root, "hooks", file));
  }
  const hooksJson = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8"));
  for (const [event, entries] of Object.entries(hooksJson.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) {
        if (typeof hook.command !== "string") continue;
        const result = spawnSync(
          hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root),
          { shell: "bash", input: "{}", encoding: "utf8", timeout: 10000 },
        );
        ok(
          result.status === 0,
          `spaced-root wiring ${event} ${hook.command}: exit ${result.status} ${(result.stderr || "").split("\n").find((line) => line.startsWith("Error")) || ""}`,
        );
      }
    }
  }
  rmSync(dirname(root), { recursive: true, force: true });
}

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
