#!/usr/bin/env node
// PreToolUse(Bash) hook: block Bash calls that prepend the project-root absolute path (or its `~` /
// `$HOME` forms) to a command. cwd is already the project root, so relative paths suffice; prepending
// absolute project-root paths bloats permissions.allow with single-use entries because Claude Code's
// matcher treats relative and absolute paths as unrelated strings (anthropics/claude-code#18200).
//
// Cross-OS Node port of no-absolute-paths.sh — a plugin SHELL hook can't run on native Windows
// (#18610). Block: exit 2 + a stderr message. FAIL-OPEN: empty/absent command, missing root, or any
// internal throw → exit 0 (a hook bug must never break the session). Zero dependencies.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { sep } from "node:path";

// Returns { message } if the command references the project root in absolute, `~`, or `$HOME` form;
// else null. root/homeDir are passed in so the logic is pure and testable. Literal substring match
// (like `grep -F`) — no regex surprises with slashes or `$`.
export function checkAbsolutePaths(command, root, homeDir) {
  if (!command || !root) return null;
  if (command.includes(root)) {
    return {
      message: `BLOCKED: command contains absolute path "${root}". cwd IS already that path. Use relative paths from cwd (e.g. 'src/lib/foo.ts' not '${root}/src/lib/foo.ts', 'git diff' not 'git -C ${root} diff'). Prepending project-root absolute paths bloats permissions.allow with single-use entries — see anthropics/claude-code#18200.`,
    };
  }
  // tilde-form (`~/path`) and $HOME-form (`$HOME/path`) equivalents of root, so `cd ~/proj` and
  // `cd $HOME/proj` are caught alongside the absolute form.
  let tildeRoot = "";
  let dollarHomeRoot = "";
  if (homeDir) {
    if (root === homeDir) {
      tildeRoot = "~";
      dollarHomeRoot = "$HOME";
    } else if (root.startsWith(homeDir + sep)) {
      // use path.sep, not a hardcoded "/", so this works on Windows (`\`) too, where the hook now
      // runs. On Unix sep === "/", so this is byte-identical to the old behavior.
      const relative = root.slice(homeDir.length + sep.length);
      tildeRoot = "~" + sep + relative;
      dollarHomeRoot = "$HOME" + sep + relative;
    }
  }
  if (tildeRoot && command.includes(tildeRoot)) {
    return {
      message: `BLOCKED: command contains tilde-form project root "${tildeRoot}". cwd IS already that path. Use relative paths from cwd. Prepending project-root paths (tilde-form or absolute) bloats permissions.allow with single-use entries — see anthropics/claude-code#18200.`,
    };
  }
  if (dollarHomeRoot && command.includes(dollarHomeRoot)) {
    return {
      message: `BLOCKED: command contains $HOME-form project root "${dollarHomeRoot}". cwd IS already that path. Use relative paths from cwd. Prepending project-root paths bloats permissions.allow with single-use entries — see anthropics/claude-code#18200.`,
    };
  }
  return null;
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
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || command === "") return;
  // match the .sh's `${CLAUDE_PROJECT_DIR:-$PWD}`: `$PWD` is the shell's LOGICAL cwd (symlink path
  // preserved), so use process.env.PWD, not process.cwd() (which resolves symlinks, e.g.
  // /tmp→/private/tmp on macOS — that would flip block/allow on a symlinked project path).
  const root =
    process.env.CLAUDE_PROJECT_DIR || process.env.PWD || process.cwd();
  const homeDir = process.env.HOME || homedir();
  const hit = checkAbsolutePaths(command, root, homeDir);
  if (hit) {
    process.stderr.write(hit.message + "\n");
    process.exit(2);
  }
}

// Run only when executed directly; export checkAbsolutePaths when imported (tests). realpath both
// sides so a symlinked invocation path still matches; on any uncertainty default to running.
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
