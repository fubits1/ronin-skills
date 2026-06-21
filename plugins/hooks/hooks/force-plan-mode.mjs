#!/usr/bin/env node
// UserPromptSubmit hook: force EnterPlanMode when the user invokes /plan or asks for a plan. Injects a
// hookSpecificOutput.additionalContext directive demanding EnterPlanMode be the first tool call.
// Silent (no output) when the prompt doesn't match — zero overhead for unrelated prompts.
//
// Cross-OS Node port of force-plan-mode.sh — a plugin SHELL hook can't run on native Windows (#18610).
// FAIL-OPEN: empty/absent prompt, unparseable stdin, or any internal throw → exit 0, no output.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIRECTIVE =
  'MANDATORY PLAN MODE: User invoked /plan (or asked for a plan). You MUST call the EnterPlanMode tool as your VERY FIRST action — before any Read, Grep, Glob, Bash, Edit, Write, or other tool call. No reconnaissance first. No "let me check" first. EnterPlanMode immediately. Inside plan mode, follow the /plan skill: research → validation criteria → implementation steps. Write the plan to a plan file, not chat.';

// Narrow on purpose (avoid false positives): a `/plan` slash-command, "plan this/it/that", or
// "make/draft/write a plan". `[!-/:-@\[-`{-~]` is the EXACT ASCII POSIX [[:punct:]] set (the bash
// original used `[[:punct:]]` after plan-this/it/that) — `[^\w\s]` is NOT equivalent (it excludes `_`,
// which is punct, and includes non-ASCII/control chars, which are not), so use the explicit ranges.
const RE_PLAN =
  /(^|\s)\/plan(\s|$)|(^|\s)plan\s+(this|it|that)(\s|[!-/:-@[-`{-~]|$)|\b(make|draft|write)\s+a\s+plan\b/i;

// Returns the additionalContext directive object if the prompt asks for a plan, else null.
export function planDirective(prompt) {
  if (typeof prompt !== "string" || !RE_PLAN.test(prompt)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: DIRECTIVE,
    },
  };
}

function main() {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return; // no stdin: fail open
  }
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return; // unparseable stdin: fail open
  }
  const directive = planDirective(input?.prompt);
  if (directive) {
    process.stdout.write(JSON.stringify(directive) + "\n");
  }
}

// Run only when executed directly; export planDirective when imported (tests).
let runAsHook = true;
try {
  runAsHook =
    realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
} catch {
  runAsHook = true;
}
if (runAsHook) {
  try {
    main();
  } catch {
    // any internal error → fail open
  }
  process.exit(0);
}
