#!/usr/bin/env node
/**
 * no-tmp: PreToolUse(Bash|Write|Edit|NotebookEdit) hook against scratch work in the temp directory
 *
 * Files in /tmp or the OS temp dir are out of the user's sight, so the agent must work in a folder
 * the user can browse. The Read tool stays allowed, because Claude Code keeps its own task output
 * there.
 *
 * Claude Code's session scratchpad lives under the temp dir as well
 * (code.claude.com/docs/en/claude-directory, "Session scratchpad directory"), so it is blocked too.
 * A scratchpad moved by CLAUDE_CODE_TMPDIR to a folder outside the temp dir stays allowed.
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { posix, win32 } from "node:path";

// a temp root as its own path segment, so a project's `build/tmp/` or `./tmp/` does not match
const TEMP_PATH_RE = /(?<![\w.~/-])(?:\/private)?(?:\/var)?\/tmp(?![\w.-])/;
const TEMP_ENV_TOKENS = ["$TMPDIR", "${TMPDIR}", "%TEMP%", "%TMP%"];
const FILE_TOOLS = ["Write", "Edit", "NotebookEdit"];

function buildBlockMessage(match) {
  return `BLOCKED: this call uses the temp directory (${match}). Files there, including Claude Code's session scratchpad, are out of the user's sight. Put scratch files, scripts and notes in a folder the user can browse, and name its path in chat. If no such folder is agreed for this project, ask the user where.`;
}

// Windows paths compare case-insensitively and may arrive with either slash.
function toComparable(path, platform) {
  return platform === "win32" ? path.replaceAll("\\", "/").toLowerCase() : path;
}

function findInCommand(command, tempDirs, platform) {
  const comparableCommand = toComparable(command, platform);
  return (
    command.match(TEMP_PATH_RE)?.[0] ||
    TEMP_ENV_TOKENS.find((token) => command.includes(token)) ||
    tempDirs.find((tempDir) => comparableCommand.includes(tempDir))
  );
}

function findInPath(path, tempDirs, platform) {
  const resolvePath = platform === "win32" ? win32.resolve : posix.resolve;
  const absolutePath = toComparable(resolvePath(path), platform);
  return (
    absolutePath.match(TEMP_PATH_RE)?.[0] ||
    tempDirs.find(
      (tempDir) =>
        absolutePath === tempDir || absolutePath.startsWith(tempDir + "/"),
    )
  );
}

export function checkTempDir(
  toolName,
  toolInput,
  tempDirs,
  platform = process.platform,
) {
  const comparableTempDirs = tempDirs.map((tempDir) =>
    toComparable(tempDir, platform),
  );
  const command = toolInput?.command;
  const path = toolInput?.file_path ?? toolInput?.notebook_path;
  let match;
  if (toolName === "Bash" && typeof command === "string") {
    match = findInCommand(command, comparableTempDirs, platform);
  } else if (FILE_TOOLS.includes(toolName) && typeof path === "string") {
    match = findInPath(path, comparableTempDirs, platform);
  }
  return match ? buildBlockMessage(match) : null;
}

function getTempDirs() {
  const tempDir = tmpdir();
  try {
    return [tempDir, realpathSync(tempDir)];
  } catch {
    return [tempDir];
  }
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const message = checkTempDir(
    input?.tool_name,
    input?.tool_input,
    getTempDirs(),
  );
  if (message) {
    process.stderr.write(message + "\n");
    process.exit(2);
  }
}

// Run only when executed directly; tests import checkTempDir. realpath both sides so a symlinked
// install path still matches.
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
    // fail open
  }
  process.exit(0);
}
