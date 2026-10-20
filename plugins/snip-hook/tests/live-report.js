#!/usr/bin/env node
/**
 * live diagnostic (NOT a pass/fail test): classifies a representative set of commands against your
 * REAL settings (user ~/.claude/settings.json plus the current directory's project settings) and
 * your real snip, in Manual (`default`) mode, and prints the outcome. this is what catches
 * over-/under-blocking that the fixture suite cannot. not assertion-based, because the outcome
 * depends on YOUR live rules; read the output and sanity-check it after changing settings or the
 * hook.
 *
 *   node plugins/snip-hook/tests/live-report.js
 */
import { existsSync } from "node:fs";
import { decide } from "../src/decide.js";
import { loadRules, settingsFiles } from "../src/rules.js";
import { snipAllowsFor } from "../src/snip.js";

// [command, what it demonstrates, expected shape so a human can eyeball a regression]
const CASES = [
  ["gh repo delete fubits1/x", "destructive gh", "should BLOCK (deny rule)"],
  [
    "gh api repos/x/issues -f title=y",
    "gh api write (implicit POST)",
    "should BLOCK if you deny gh api -X POST",
  ],
  [
    "gh api graphql -f query='query{viewer{login}}'",
    "graphql read",
    "should allow",
  ],
  ["git log -10", "allowed read", "should allow"],
  ["git log -10 2>&1", "allowed read + redirect", "should allow"],
  ["npx prettier --check src/x.ts", "allow-listed npx tool", "should allow"],
  [
    "npx some-evil-typosquat",
    "no rule, snip auto-allows",
    "should ASK (Claude Code would)",
  ],
  [
    "curl -sS https://example.com",
    "no rule, snip auto-allows",
    "should ASK (Claude Code would)",
  ],
  ["git status", "read-only, snip auto-allows", "allow or silent, no ask"],
  ["ssh -V", "ask-listed command", "should ASK (if Bash(ssh *) in ask)"],
  [
    "pnpm add left-pad",
    "no rule, snip auto-allows",
    "should ASK unless you allow it",
  ],
];

function outcome({ exitCode, stdout }) {
  if (exitCode === 2) {
    return "BLOCK ";
  }
  if (stdout.includes('"permissionDecision":"ask"')) {
    return "ask   ";
  }
  return stdout.includes('"permissionDecision":"allow"') ? "allow " : "silent";
}

const files = settingsFiles();
const rules = loadRules(files);
const snipAllows = snipAllowsFor(files);
console.log("snip-hook live report, settings read:");
for (const { path, grants } of files) {
  const note = !existsSync(path)
    ? " (missing)"
    : grants
      ? ""
      : " (deny/ask only)";
  console.log(`  ${path}${note}`);
}
console.log();
for (const [command, demonstrates, expectation] of CASES) {
  const input = {
    tool_name: "Bash",
    tool_input: { command },
    permission_mode: "default",
  };
  const result = decide(input, rules, snipAllows);
  console.log(`${outcome(result)}  ${demonstrates.padEnd(32)} ${expectation}`);
  console.log(`         ${command}`);
}
