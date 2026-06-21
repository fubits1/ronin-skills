#!/usr/bin/env node
// PostToolUse(Write|Edit) hook: format the edited file — Prettier for non-Markdown, markdownlint for
// `.md` (`.mdx` is skipped — Prettier pads markdown tables). Silent, and NEVER blocks (always exit 0).
//
// Cross-OS Node port of fix-formatting.sh — a plugin SHELL hook can't run on native Windows (#18610).
// `npx` (not pnpm) is intentional: this runs inside Claude Code's env, and npx ships with Node
// everywhere. FAIL-OPEN: a missing formatter, unparseable stdin, or any throw → exit 0.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Decide which formatter applies to a path (pure + testable): "markdownlint" for `.md`, null for
// `.mdx`, "prettier" for any other path. Matches the .sh skip rules.
export function formatterFor(filePath) {
  if (typeof filePath !== "string" || filePath === "") return null;
  if (filePath.endsWith(".md")) return "markdownlint";
  if (filePath.endsWith(".mdx")) return null; // prettier pads md tables; markdownlint is .md-only
  return "prettier";
}

function runFormatter(formatter, filePath) {
  // Resolve npx per-OS without a shell (avoids shell-injection and is cross-OS): npx.cmd on Windows.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const args =
    formatter === "markdownlint"
      ? ["-y", "markdownlint-cli2", "--fix", filePath]
      : ["-y", "prettier", "--write", filePath];
  spawnSync(npx, args, { stdio: "ignore" });
}

function main() {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return; // no stdin: nothing to format
  }
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return; // unparseable stdin
  }
  const filePath = input?.tool_input?.file_path;
  const formatter = formatterFor(filePath);
  if (formatter) {
    runFormatter(formatter, filePath);
  }
}

// Run only when executed directly; export formatterFor when imported (tests).
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
    // never block a tool call on a formatter error
  }
  process.exit(0);
}
