#!/usr/bin/env node
/**
 * snip-hook: PreToolUse(Bash) entry point
 *
 * snip's own PreToolUse hook rewrites `<cmd>` -> `"…/snip" run -- <cmd>` and auto-allows it, and
 * Claude Code matches permission rules against that REWRITTEN string, so your deny/ask/allow rules
 * stop firing and commands no rule covers run without the prompt Claude Code would show. this hook
 * runs in parallel with snip's, receives the ORIGINAL command, and restores both (decide.js).
 * rationale: ../rationale.md.
 *
 * FAIL-OPEN: unparseable stdin or any internal throw -> exit 0. a hook bug must never break the
 * session.
 */
import { readFileSync } from "node:fs";
import { decide, SILENT } from "./decide.js";
import { loadRules, settingsFiles } from "./rules.js";
import { snipAllowsFor } from "./snip.js";

let output = SILENT;
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  // project settings load from where the session started, not from wherever Claude has `cd`'d to
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  const files = settingsFiles({ projectDir });
  output = decide(input, loadRules(files), snipAllowsFor(files));
} catch {
  // fail open
}
process.stdout.write(output.stdout);
process.stderr.write(output.stderr);
process.exitCode = output.exitCode;
