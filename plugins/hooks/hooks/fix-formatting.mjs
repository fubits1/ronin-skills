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
  // SECURITY (option injection → RCE): a path beginning with "-" is parsed by prettier/markdownlint
  // as a CLI FLAG, not a file. e.g. file_path "--plugin=/tmp/evil.js" makes prettier load+EXECUTE
  // that JS module; "--config=…" loads an arbitrary JS/.cjs config. npx args are passed shell-free,
  // but the flag IS the payload so quoting can't help — prettier only treats a token as a flag when
  // it starts with "-", so refusing leading-dash paths is the boundary. A real absolute path starts
  // with "/" (or a drive letter); a relative path starting with "-" is pathological. Skip it.
  if (filePath.startsWith("-")) return null;
  if (filePath.endsWith(".md")) return "markdownlint";
  if (filePath.endsWith(".mdx")) return null; // prettier pads md tables; markdownlint is .md-only
  return "prettier";
}

// Build the spawnSync spec for a formatter run — exported so it's testable per-OS WITHOUT spawning.
// On Windows `npx` is a `.cmd` shim that Node refuses to spawn without a shell (the CVE-2024-27980
// mitigation makes `spawnSync("npx.cmd", …)` throw EINVAL), so there we use shell:true with the path
// quoted (stripping `"`/`%` — illegal in Windows paths / cmd-special — keeps the quoting safe). On
// Unix, a no-shell argv array (injection-safe).
export function formatterSpec(formatter, filePath, platform) {
  const tool = formatter === "markdownlint" ? "markdownlint-cli2" : "prettier";
  const flag = formatter === "markdownlint" ? "--fix" : "--write";
  if (platform === "win32") {
    const safePath = filePath.replace(/["%]/g, "");
    return {
      command: `npx -y ${tool} ${flag} "${safePath}"`,
      args: [],
      shell: true,
    };
  }
  return { command: "npx", args: ["-y", tool, flag, filePath], shell: false };
}

function runFormatter(formatter, filePath) {
  const spec = formatterSpec(formatter, filePath, process.platform);
  spawnSync(spec.command, spec.args, { stdio: "ignore", shell: spec.shell });
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
