#!/usr/bin/env node
// PreToolUse(Bash) hook: block Bash calls that should use dedicated tools (Grep, Read, Glob, Write),
// block mutating git, and block gratuitous command chaining. Hard-blocks via exit 2 + a stderr
// message naming the right tool — IDENTICAL mechanism and behavior to the original bash hook.
//
// Why this is Node (.mjs) and not bash (.sh):
//   Plugin shell hooks DO NOT run on Windows — Claude Code's /bin/bash cannot resolve Windows
//   plugin paths in any format (anthropics/claude-code#18610, closed not-planned). A Node hook
//   invoked as `node ${CLAUDE_PLUGIN_ROOT}/hooks/nogrep.mjs` works on every OS because Claude Code
//   ships Node on all platforms. This file is a faithful port of the original bash hook (since
//   removed); its behavior is locked by tests/run-nogrep-tests.mjs + tests/redteam-nogrep.mjs.
//
// Block mechanism (unchanged from the .sh): exit 2 + stderr. PreToolUse exit-2 blocks the call and
// feeds stderr back to the model (#24327 is a model-side stop-vs-adapt quirk that hits .sh and .mjs
// equally — not a reason to switch to JSON permissionDecision, which would risk behavioral drift).
//
// Zero dependencies: reads stdin, JSON.parse (no jq subprocess), pure string/regex processing in one
// process (no cat/sed/awk/basename forks), so it is at least as fast as the shell version.
//
// Threat model and full rationale: nogrep.md. A bypass that slips a banned tool through is a bug to
// fix here, not a loophole to use. Best-effort regex matcher; fails open on unparseable input.

import { readFileSync } from "node:fs";

// --- input -------------------------------------------------------------------
let raw;
try {
  raw = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}
let input;
try {
  input = JSON.parse(raw || "{}");
} catch {
  process.exit(0); // unparseable stdin: fail open
}
const COMMAND = input?.tool_input?.command;
if (!COMMAND) process.exit(0); // empty/absent command: fail open

// block(tag, msg): centralised exit-2 path. Self-labels the block so the model can't mislabel a
// deterministic hook rejection as "the user rejected", and emits a structured reason= line.
function block(tag, msg) {
  process.stderr.write(
    `[deterministic hook block from nogrep.mjs — NOT a user rejection] BLOCKED | reason=${tag}\n`,
  );
  process.stderr.write(msg + "\n");
  process.exit(2);
}

// BANNED: tools the hook hard-blocks. jq, fff, ls are NOT here (preferred tools). sed reads are
// caught in a dedicated arm so substitution stays allowed.
const BANNED = "grep|egrep|fgrep|rg|cat|head|tail|find|awk|wc";

// Wrapper/prefix segment mirrored from normalize_first below — process wrappers + VAR=value prefixes.
const WRAP =
  "((timeout|time|nice|nohup|stdbuf|env|exec|eval|builtin|xargs)\\s+(-\\S+\\s+|[0-9]+\\s+)*)?([A-Za-z_][A-Za-z0-9_]*=\\S+\\s+)*";
// Optional leading backslash + path prefix ending in '/', for absolute/escaped banned-tool names.
const PATHQ = "(\\\\?[A-Za-z0-9_./-]*/)?";

// --- Pre-extraction scans (catch wrapped invocations the segment splitter can't see) ----------
// Bracket-charclass form (child[_]process) keeps the literal banned-API substring out of this file.
const RE_NODE_SHELLOUT =
  /(^|\s)(node|deno|bun)\s+(-e|--eval)\s+["'].*(child[_]process|exec[S]ync|spawn[S]ync)/;
if (RE_NODE_SHELLOUT.test(COMMAND)) {
  block(
    "node-shellout",
    "Use the dedicated tool (Grep/Read/Glob) instead of shelling out to a subprocess API from inside an embedded JS script.",
  );
}
const RE_PY_SHELLOUT = /(^|\s)(python|python3)\s+(-c)\s+["'].*subprocess/;
if (RE_PY_SHELLOUT.test(COMMAND)) {
  block(
    "python-shellout",
    "Use the dedicated tool (Grep/Read/Glob) instead of shelling out to subprocess from inside an embedded Python script.",
  );
}

const RE_BASHC_BANNED = new RegExp(
  "(^|\\s)(bash|sh|zsh|dash)\\s+-c\\s+[\"']\\s*" +
    WRAP +
    PATHQ +
    "(" +
    BANNED +
    ")([^A-Za-z0-9_]|$)",
);
if (RE_BASHC_BANNED.test(COMMAND)) {
  block(
    "bashc-banned",
    "Banned tool invoked via 'bash -c' / 'sh -c'. Use the dedicated tool (Grep/Read/Glob) at the top level instead.",
  );
}

const RE_BASHC_SED_N =
  /(^|\s)(bash|sh|zsh|dash)\s+-c\s+["'][^"']*sed\s+(\S+\s+)*-n(\s|$)/;
if (RE_BASHC_SED_N.test(COMMAND)) {
  block(
    "bashc-sed-read",
    "'sed -n' inside bash -c / sh -c is a read. Use the Read tool (offset/limit) instead.",
  );
}
const RE_BASHC_SED_NP =
  /(^|\s)(bash|sh|zsh|dash)\s+-c\s+["'][^"']*sed\s+(\S+\s+)*(-e\s+|--expression[\s=])?["']?(\$|[0-9]+)(,(\$|[0-9]+))?p["']?(\s|$)/;
if (RE_BASHC_SED_NP.test(COMMAND)) {
  block(
    "bashc-sed-read",
    "'sed … Np/N,Mp/$p' inside bash -c / sh -c is a read. Use the Read tool (offset/limit) instead.",
  );
}

// Command substitution $(...) / backticks, and process substitution <(...)/>(...).
const RE_DOLLAR_SUB = new RegExp(
  "\\$\\(\\s*" + WRAP + PATHQ + "(" + BANNED + ")([^A-Za-z0-9_]|$)",
);
if (RE_DOLLAR_SUB.test(COMMAND)) {
  block(
    "dollar-sub",
    "Banned tool inside command substitution $(...). Use the dedicated tool (Grep/Read/Glob).",
  );
}
const RE_BACKTICK_SUB = new RegExp(
  "`\\s*" + WRAP + PATHQ + "(" + BANNED + ")([^A-Za-z0-9_]|$)",
);
if (RE_BACKTICK_SUB.test(COMMAND)) {
  block(
    "backtick-sub",
    "Banned tool inside backtick command substitution. Use the dedicated tool (Grep/Read/Glob).",
  );
}
const RE_PROCSUB = new RegExp(
  "[<>]\\(\\s*" + WRAP + PATHQ + "(" + BANNED + ")([^A-Za-z0-9_]|$)",
);
if (RE_PROCSUB.test(COMMAND)) {
  block(
    "procsub",
    "Banned tool inside process substitution <(...)/>(...). Use the dedicated tool (Grep/Read/Glob).",
  );
}

// --- normalize_first: reduce a segment to its effective first word ----------------------------
const WRAPPERS = new Set([
  "timeout",
  "time",
  "nice",
  "nohup",
  "stdbuf",
  "env",
  "exec",
  "eval",
  "builtin",
  "xargs",
]);
function firstToken(s) {
  const m = s.replace(/^\s+/, "").match(/^\S+/);
  return m ? m[0] : "";
}
function stripBackslashAndPath(w) {
  let f = w.replace(/^\\/, ""); // strip ONE leading backslash
  if (f.includes("/")) f = f.split("/").pop(); // basename
  return f;
}
function normalizeFirst(cmdIn) {
  let cmd = cmdIn.replace(/^\s+/, ""); // ltrim
  // Strip leading group-openers ( or { so `(cat x)` / `{ cat x; }` resolve to the inner tool.
  while (cmd[0] === "(" || cmd[0] === "{") {
    cmd = cmd.slice(1).replace(/^\s+/, "");
  }
  // Strip leading VAR=value assignments.
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) {
    cmd = cmd.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, "");
  }
  let first = stripBackslashAndPath(firstToken(cmd));
  // Unwrap process wrappers, repeating for chained wrappers (timeout 5 nice -n 10 grep). Cap 8.
  let i = 0;
  while (i < 8 && WRAPPERS.has(first)) {
    let rest = cmd.replace(new RegExp("^\\s*" + first + "(\\s+|$)"), "");
    // Drop leading flag tokens AND positional-number tokens (timeout 30, nice -n 10).
    while (/^\s*(-|[0-9])/.test(rest)) {
      rest = rest.replace(/^\s*\S+\s*/, "");
    }
    // Strip any VAR=value left behind by a wrapper like env.
    while (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(rest)) {
      rest = rest.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, "");
    }
    cmd = rest;
    first = stripBackslashAndPath(firstToken(rest));
    i++;
  }
  return first;
}

// --- Main: split on subcommand boundaries (operators) AND newlines, check each segment --------
// sed -E 's/(&&|\|\||;|\||&)/\n/g' then `while read` ≡ replace operators with \n, then split on \n
// (which also splits pre-existing newlines, exactly like the shell heredoc read).
const SUBCMDS = COMMAND.replace(/(&&|\|\||;|\||&)/g, "\n").split("\n");

const RE_GIT_MUT =
  /(^|\s)git\s+(add|commit|push|pull|fetch|merge|rebase|reset|restore|checkout|switch|clean|stash|tag|cherry-pick|revert|am|apply|rm|clone|init|config|remote\s+(add|remove|rename|set-url))([^A-Za-z0-9_]|$)/;
const RE_SED_N = /sed\s+(\S+\s+)*-n(\s|$)/;
const RE_SED_NP =
  /sed\s+(\S+\s+)*(-e\s+|--expression[\s=])?["']?(\$|[0-9]+)(,(\$|[0-9]+))?p["']?(\s|$)/;

for (const SUB of SUBCMDS) {
  if (SUB.replace(/ /g, "") === "") continue; // skip space-only segments (matches ${SUB// /})
  const FIRST = normalizeFirst(SUB);
  if (FIRST === "ls") {
    // always allowed
  } else if (FIRST === "command") {
    block(
      "command-builtin",
      "The 'command' builtin is banned (bypass vector for this hook). For 'command -v foo' existence checks, use 'which foo'. For everything else, use the dedicated tool (Grep/Read/Glob).",
    );
  } else if (FIRST === "git") {
    if (RE_GIT_MUT.test(SUB)) {
      block(
        "git-mutation",
        "Mutating git command. Use gh for remote state, or suggest the user run ! git <command> locally.",
      );
    }
  } else if (
    FIRST === "grep" ||
    FIRST === "egrep" ||
    FIRST === "fgrep" ||
    FIRST === "rg"
  ) {
    block(
      `bash-${FIRST}`,
      `Use the Grep tool instead of Bash ${FIRST}. Grep supports: multiline: true, output_mode (content/files_with_matches/count), -A/-B/-C context, -i case-insensitive, glob/type filtering, head_limit, offset.`,
    );
  } else if (FIRST === "cat") {
    if (SUB.includes(">") || SUB.includes("<<")) {
      block(
        "cat-write",
        "Use the Write tool to create files, not 'cat > file' / heredocs. Write shows a diff and its approval caches; heredoc content is unique and re-reviewed every time. See claude-code#19649.",
      );
    } else {
      block(
        "cat-read",
        "Use the Read tool instead of Bash cat. Read supports: offset, limit (for head/tail behavior). Line numbers included by default.",
      );
    }
  } else if (FIRST === "head" || FIRST === "tail") {
    block(
      `bash-${FIRST}`,
      `Use the Read tool instead of Bash ${FIRST}. Read supports: offset (start line), limit (number of lines).`,
    );
  } else if (FIRST === "find") {
    block(
      "bash-find",
      "Use the Glob tool instead of Bash find. Glob supports: pattern (e.g. '**/*.ts', '**/*test*').",
    );
  } else if (FIRST === "sed") {
    if (RE_SED_N.test(SUB)) {
      block(
        "sed-read",
        "Use the Read tool instead of Bash 'sed -n' for reading file ranges. Read supports: offset, limit.",
      );
    }
    if (RE_SED_NP.test(SUB)) {
      block(
        "sed-read",
        "Use the Read tool instead of Bash sed for reading file ranges (Np / N,Mp / $p). Read supports: offset, limit.",
      );
    }
    // sed substitution is a legitimate Bash use — allow it
  } else if (FIRST === "awk") {
    block(
      "bash-awk",
      "Use the Grep tool (for searching) or Read tool (for reading) instead of Bash awk.",
    );
  } else if (FIRST === "wc") {
    block(
      "bash-wc",
      "Use the Grep tool with output_mode: 'count' instead of Bash wc.",
    );
  }
}

// --- No-chaining check -------------------------------------------------------
// Block GRATUITOUS chaining of two real commands with && / || / ; (one Bash call should be one
// command). Quoted spans + escaped chars are blanked first so a ; / && inside a string isn't
// counted. sed is line-based, so blanking is done PER LINE to match the shell exactly (a quoted
// span across newlines is NOT one span — the multi-line arg then still counts as multiple segments).
function stripPerLine(s) {
  return s
    .split("\n")
    .map((line) =>
      line
        .replace(/\\./g, "") // remove backslash + following char (escaped chars)
        .replace(/"[^"]*"/g, "")
        .replace(/'[^']*'/g, ""),
    )
    .join("\n");
}
const CHAIN_STRIPPED = stripPerLine(COMMAND);
const CHAIN_SEGS = CHAIN_STRIPPED.replace(/(&&|\|\||;)/g, "\n").split("\n");
let chainCount = 0;
for (const seg of CHAIN_SEGS) {
  if (seg.replace(/ /g, "") === "") continue;
  chainCount++;
}
if (chainCount > 1) {
  block(
    "chaining",
    "No command chaining. You joined multiple commands with && / || / ; in one Bash call. Run each as a SEPARATE Bash call instead. Chaining hides later commands from per-command approval and is a documented permission-bypass vector. (The working directory persists across Bash calls, so 'cd dir && cmd' is unnecessary too. Pipes into jq and redirections like 2>&1 are fine.)",
  );
}

process.exit(0);
