#!/usr/bin/env node
// PreToolUse(Bash) hook: a DISCIPLINE nudge, not a firewall. It catches the model's reflex of
// reaching for Bash `grep`/`cat`/`find`/`head`/`tail`/`awk`/`wc`/`rg`/`sed -n` (and `cat > file`
// heredocs, mutating git, gratuitous chaining) instead of the dedicated Read/Grep/Glob/Write tools —
// because the model ignores its own system-prompt guidance ~40% of sessions (claude-code#39979).
// It is NOT an adversarial sandbox: the model produces these commands plainly and has no reason to
// obfuscate them to evade its own discipline hook, so the matcher does not chase quote/escape
// mutation, encoding, or expansion. Threat model + rationale: no-bash.md.
//
// Cross-OS: a plugin SHELL hook can't run on native Windows (#18610). Node runs everywhere. Block
// mechanism: exit 2 + a stderr message naming the right tool. FAIL-OPEN BY DESIGN — empty/absent/
// non-string command, unparseable stdin, or any internal throw → exit 0; a hook bug must never break
// the session. Zero dependencies (stdin + JSON.parse).

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BANNED = "grep|egrep|fgrep|rg|cat|head|tail|find|awk|wc";
const WRAP =
  "((timeout|time|nice|nohup|stdbuf|env|exec|eval|builtin|xargs)\\s+(-\\S+\\s+|[0-9]+\\s+)*)?([A-Za-z_][A-Za-z0-9_]*=\\S+\\s+)*";
const PATHQ = "(\\\\?[A-Za-z0-9_./-]*/)?";
const TAIL = "([^A-Za-z0-9_]|$)";
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

// Pre-extraction scans: a banned tool the segment splitter can't see (wrapped in bash -c, $(...),
// backticks, <(...), or a node/python -e shell-out).
const RE_NODE_SHELLOUT =
  /(^|\s)(node|deno|bun)\s+(-e|--eval)\s+["'].*(child[_]process|exec[S]ync|spawn[S]ync)/;
const RE_PY_SHELLOUT = /(^|\s)(python|python3)\s+(-c)\s+["'].*subprocess/;
// `-[a-z]*c[a-z]*` matches the -c flag alone or fused in a short cluster (-lc/-ic/-cl/-xc), since the
// model writes those plainly; it is not chasing evasion. Still requires a literal `c` flag.
const RE_BASHC_BANNED = new RegExp(
  "(^|\\s)(bash|sh|zsh|dash)\\s+-[a-z]*c[a-z]*\\s+[\"']\\s*" +
    WRAP +
    PATHQ +
    "(" +
    BANNED +
    ")" +
    TAIL,
);
const RE_BASHC_SED_N =
  /(^|\s)(bash|sh|zsh|dash)\s+-[a-z]*c[a-z]*\s+["'][^"']*sed\s+(\S+\s+)*-n(\s|$)/;
const RE_BASHC_SED_NP =
  /(^|\s)(bash|sh|zsh|dash)\s+-[a-z]*c[a-z]*\s+["'][^"']*sed\s+(\S+\s+)*(-e\s+|--expression[\s=])?["']?(\$|[0-9]+)(,(\$|[0-9]+))?p["']?(\s|$)/;
const RE_DOLLAR_SUB = new RegExp(
  "\\$\\(\\s*" + WRAP + PATHQ + "(" + BANNED + ")" + TAIL,
);
const RE_BACKTICK_SUB = new RegExp(
  "`\\s*" + WRAP + PATHQ + "(" + BANNED + ")" + TAIL,
);
const RE_PROCSUB = new RegExp(
  "[<>]\\(\\s*" + WRAP + PATHQ + "(" + BANNED + ")" + TAIL,
);

// git global options that can precede the subcommand (`git -C <path> commit`, `git -c k=v commit`,
// `git --no-pager log`). Stripped so the subcommand is read correctly — otherwise a global option
// lets a real mutation slip past (`git -C /repo commit` was allowed).
const GIT_GLOBAL =
  /^(-C\s+\S+|-c\s+\S+|--git-dir(=\S+|\s+\S+)|--work-tree(=\S+|\s+\S+)|--namespace(=\S+|\s+\S+)|--exec-path(=\S+)?|--no-pager|--paginate|-p|--bare|--no-replace-objects|--(no-)?literal-pathspecs|--glob-pathspecs|--icase-pathspecs)\s+/;
const RE_SED_N = /sed\s+(\S+\s+)*-n(\s|$)/;
const RE_SED_NP =
  /sed\s+(\S+\s+)*(-e\s+|--expression[\s=])?["']?(\$|[0-9]+)(,(\$|[0-9]+))?p["']?(\s|$)/;

const MSG = {
  "node-shellout":
    "Use the dedicated tool (Grep/Read/Glob) instead of shelling out to a subprocess API from inside an embedded JS script.",
  "python-shellout":
    "Use the dedicated tool (Grep/Read/Glob) instead of shelling out to subprocess from inside an embedded Python script.",
  "bashc-banned":
    "A banned file-read/search tool (or sed-read) was invoked via 'bash -c' / 'sh -c'. Run it directly at the top level instead of wrapping it in a shell, so the hook can point you at the right tool.",
  "bashc-sed-read":
    "'sed' used as a reader inside bash -c / sh -c. Use the Read tool (offset/limit) instead.",
  "dollar-sub":
    "Banned tool inside command substitution $(...). Use the dedicated tool (Grep/Read/Glob).",
  "backtick-sub":
    "Banned tool inside backtick command substitution. Use the dedicated tool (Grep/Read/Glob).",
  procsub:
    "Banned tool inside process substitution <(...)/>(...). Use the dedicated tool (Grep/Read/Glob).",
  "command-builtin":
    "The 'command' builtin is banned as a tool-execution bypass (e.g. 'command grep'). Use the dedicated tool (Grep/Read/Glob). ('command -v foo' existence checks are allowed and pass.)",
  "git-mutation":
    "Mutating git command. Use gh for remote state, or suggest the user run ! git <command> locally.",
  "cat-write":
    "Use the Write tool to create files, not 'cat > file' / heredocs. Write shows a diff and its approval caches; heredoc content is unique and re-reviewed every time. See claude-code#19649.",
  "cat-read":
    "Use the Read tool instead of Bash cat. Read supports: offset, limit (for head/tail behavior). Line numbers included by default.",
  "bash-find":
    "Use the Glob tool instead of Bash find. Glob supports: pattern (e.g. '**/*.ts', '**/*test*').",
  "sed-read":
    "Use the Read tool instead of Bash sed for reading file ranges (-n / Np / N,Mp / $p). Read supports: offset, limit.",
  "bash-awk":
    "Use the Grep tool (for searching) or Read tool (for reading) instead of Bash awk.",
  "bash-wc": "Use the Grep tool with output_mode: 'count' instead of Bash wc.",
  chaining:
    "No command chaining. You joined multiple commands with && / || / ; in one Bash call. Run each as a SEPARATE Bash call instead. Chaining hides later commands from per-command approval and is a documented permission-bypass vector. (The working directory persists across Bash calls, so 'cd dir && cmd' is unnecessary too. Pipes into jq and redirections like 2>&1 are fine.)",
};
function blk(tag, msg) {
  return { tag, msg: msg || MSG[tag] };
}
function grepMsg(tool) {
  return `Use the Grep tool instead of Bash ${tool}. Grep supports: multiline: true, output_mode (content/files_with_matches/count), -A/-B/-C context, -i case-insensitive, glob/type filtering, head_limit, offset.`;
}
function readMsg(tool) {
  return `Use the Read tool instead of Bash ${tool}. Read supports: offset (start line), limit (number of lines).`;
}

function firstToken(s) {
  const m = s.replace(/^\s+/, "").match(/^\S+/);
  return m ? m[0] : "";
}
function stripBackslashAndPath(w) {
  let f = w.replace(/^\\/, ""); // strip ONE leading backslash (\grep -> grep)
  if (f.includes("/")) f = f.split("/").pop(); // basename
  return f;
}
function normalizeFirst(cmdIn) {
  let cmd = cmdIn.replace(/^\s+/, ""); // ltrim
  while (cmd[0] === "(" || cmd[0] === "{") {
    cmd = cmd.slice(1).replace(/^\s+/, ""); // strip leading group-openers
  }
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) {
    cmd = cmd.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, ""); // strip VAR=value prefixes
  }
  let first = stripBackslashAndPath(firstToken(cmd));
  // Unwrap process wrappers (timeout 5 nice -n 10 grep). Cap 8; on overflow, fall through (a bare
  // wrapper or pathological stacking is not the model's reflex this hook targets).
  let i = 0;
  while (i < 8 && WRAPPERS.has(first)) {
    let rest = cmd.replace(new RegExp("^\\s*" + first + "(\\s+|$)"), "");
    // strip wrapper flags / numerics, plus the `{}` replstr of `xargs -I {}` (the dominant xargs
    // idiom — `-I` is consumed as a flag, then `{}` would otherwise become the effective first token)
    while (/^\s*(-|[0-9]|\{\})/.test(rest)) {
      rest = rest.replace(/^\s*\S+\s*/, "");
    }
    while (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(rest)) {
      rest = rest.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, "");
    }
    cmd = rest;
    first = stripBackslashAndPath(firstToken(rest));
    i++;
  }
  return first;
}

// Count top-level commands, quote/heredoc/continuation aware, so only a real `&&` / `||` / `;` /
// bare-newline BETWEEN commands counts as chaining. A newline inside a quoted argument (multi-line
// `--body`/`-m`), a `\`-newline continuation, or a heredoc body is ONE command, not a chain — the old
// per-line strip split on `\n` first and miscounted all three.
function chainCount(command) {
  // Heredoc bodies (`cmd <<EOF … EOF`) are stdin, not separate commands — blank them so their inner
  // newlines don't count as chaining. The lazy `[\s\S]*?` scan is bounded two ways so it stays
  // LINEAR: it runs only on multi-line input, and only when there are FEW heredoc openers. A real
  // command has one or two; a `<<X\n<<X…` token flood (not a model reflex; each non-terminating
  // opener would otherwise rescan to end → O(n²)) is skipped and simply counts as chaining.
  let s = command;
  if (s.includes("\n") && (s.match(/<</g) || []).length <= 4) {
    s = s.replace(/<<-?\s*["']?([A-Za-z_]\w*)["']?[\s\S]*?\n[ \t]*\1\b/g, " ");
  }
  s = s.replace(/\\\n/g, " "); // join `\`-newline line-continuations into one logical line
  let out = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && q !== "'") {
      i++; // an escaped char is inert (e.g. \" never toggles a quote) — but bash does NOT process
      continue; // backslash inside single quotes, so don't treat it as an escape there
    }
    if (q) {
      if (c === q) q = null; // inside a quote: drop everything (incl. ; && and newlines)
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    out += c;
  }
  const segs = out.replace(/(&&|\|\||;)/g, "\n").split("\n");
  let n = 0;
  for (const seg of segs) if (seg.replace(/\s/g, "") !== "") n++;
  return n;
}

// Is this `git …` segment a MUTATION (block) or a read-only/inspection form (pass)? The hook's
// contract (no-bash.md): mutating git blocks while read-only git and `git mv` pass. Every subcommand
// with a common read-only form is discriminated — mirroring how `remote` already was — so reads like
// `git stash list`, `git tag -l`, `git config --get`, `git clean -n`, `git apply --check` pass.
function gitMutates(seg) {
  let rest = seg.replace(/^[^A-Za-z]*git\s+/, ""); // drop leading `git ` (and any indent/operator)
  let prev;
  do {
    prev = rest;
    rest = rest.replace(GIT_GLOBAL, ""); // strip global options before the subcommand
  } while (rest !== prev);
  const sc = (rest.match(/^\S+/) || [""])[0];
  const args = rest.slice(sc.length); // leading-space-prefixed remainder after the subcommand
  switch (sc) {
    // unconditional mutations (no common read-only form)
    case "add":
    case "commit":
    case "push":
    case "pull":
    case "merge":
    case "rebase":
    case "reset":
    case "restore":
    case "checkout":
    case "switch":
    case "cherry-pick":
    case "revert":
    case "am":
    case "rm":
    case "clone":
    case "init":
    case "gc":
      return true;
    // discriminated: block the write form, pass the read/inspection form
    case "stash":
      return !/^\s+(list|show)\b/.test(args); // list/show read; bare/push/pop/drop/… mutate
    case "clean":
      return !(
        /(^|\s)--dry-run(\s|$)/.test(args) ||
        /(^|\s)-[a-zA-Z]*n[a-zA-Z]*(\s|$)/.test(args)
      ); // -n / --dry-run only previews
    case "apply":
      return !/(^|\s)(--check|--stat|--numstat|--summary)(\s|$)/.test(args);
    case "fetch":
      return !/(^|\s)--dry-run(\s|$)/.test(args);
    case "branch":
      return /(^|\s)(-d|-D|--delete|-m|-M|--move|-c|-C|--copy|-f|--force|--set-upstream-to|-u|--unset-upstream|--edit-description)(\s|=|$)/.test(
        args,
      ); // delete/move/copy/force/upstream mutate; -a/-l/-v/--contains/bare list read
    case "worktree":
      return /^\s+(add|remove|move|prune|repair|lock|unlock)\b/.test(args); // `worktree list` reads
    case "submodule":
      return /^\s+(add|update|init|deinit|set-url|set-branch|sync|absorbgitdirs)\b/.test(
        args,
      ); // `submodule status` reads
    case "remote":
      return /^\s+(add|remove|rename|set-url|set-head|set-branches|prune|rm)\b/.test(
        args,
      ); // `remote -v` / `remote show` read
    // `config` and `tag`: local, with very common read forms (`config --get/--list`, `tag -l`); their
    // write forms (set a key, create/delete a tag) are minor, non-destructive, and have no gh
    // equivalent — so neither is blocked. `git mv` and any other subcommand: read-only → pass.
    default:
      return false;
  }
}

// Quote-aware segment split: operators (&& || ; | &) and newlines OUTSIDE quotes only, so
// `echo "a; cat b"` is ONE segment (no false block on a banned word inside a quoted argument).
function splitSegments(s) {
  const out = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && q !== "'") {
      // an escaped char is literal, never structural: keep both, so `\"` doesn't toggle a quote and
      // `\;`/`\&`/`\|` don't split a segment (mirrors chainCount). Bash does NOT process backslash
      // inside single quotes, so don't treat it as an escape there (else a `'…\'` keeps the quote open).
      cur += c;
      if (i + 1 < s.length) cur += s[++i];
      continue;
    }
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === "\n" || c === ";") {
      out.push(cur);
      cur = "";
    } else if (c === "&" || c === "|") {
      out.push(cur);
      cur = "";
      if (s[i + 1] === c) i++;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function scan(command) {
  if (typeof command !== "string" || command === "") return null;

  if (RE_NODE_SHELLOUT.test(command)) return blk("node-shellout");
  if (RE_PY_SHELLOUT.test(command)) return blk("python-shellout");
  if (RE_BASHC_BANNED.test(command)) return blk("bashc-banned");
  if (RE_BASHC_SED_N.test(command) || RE_BASHC_SED_NP.test(command))
    return blk("bashc-sed-read");
  if (RE_DOLLAR_SUB.test(command)) return blk("dollar-sub");
  if (RE_BACKTICK_SUB.test(command)) return blk("backtick-sub");
  if (RE_PROCSUB.test(command)) return blk("procsub");

  for (const SUB of splitSegments(command)) {
    if (SUB.replace(/ /g, "") === "") continue;
    const FIRST = normalizeFirst(SUB);
    if (FIRST === "ls") continue;
    if (FIRST === "command") {
      if (/^\s*command\s+-[vV]\b/.test(SUB)) continue; // existence check, not tool execution
      return blk("command-builtin");
    }
    if (FIRST === "git") {
      if (/^\s*git\s+grep\b/.test(SUB))
        return blk("bash-grep", grepMsg("git grep")); // content search → Grep
      if (gitMutates(SUB)) return blk("git-mutation");
      continue;
    }
    if (
      FIRST === "grep" ||
      FIRST === "egrep" ||
      FIRST === "fgrep" ||
      FIRST === "rg"
    )
      return blk("bash-" + FIRST, grepMsg(FIRST));
    if (FIRST === "cat") {
      // route to Write only for a genuine stdout file-write or heredoc; a stderr redirect
      // (`2>/dev/null`, `2>&1`, `1>&2`) or a here-string (`<<<`) is still a READ → cat-read
      const heredoc = /(?<!<)<<(?!<)/.test(SUB); // exactly two `<` (heredoc), not `<<<` (here-string)
      const stdoutWrite = /(^|[^0-9&<])1?>>?\s*[^&\s]/.test(SUB);
      return heredoc || stdoutWrite ? blk("cat-write") : blk("cat-read");
    }
    if (FIRST === "head" || FIRST === "tail")
      return blk("bash-" + FIRST, readMsg(FIRST));
    if (FIRST === "find") return blk("bash-find");
    if (FIRST === "sed") {
      if (RE_SED_N.test(SUB) || RE_SED_NP.test(SUB)) return blk("sed-read");
      continue;
    }
    if (FIRST === "awk") return blk("bash-awk");
    if (FIRST === "wc") return blk("bash-wc");
  }

  // No-chaining check (runs after the per-tool arms, so a banned-tool message wins).
  if (chainCount(command) > 1) return blk("chaining");
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
  if (typeof command !== "string" || command === "") return; // empty/absent/non-string: fail open
  const hit = scan(command);
  if (hit) {
    process.stderr.write(
      `[deterministic hook block from no-bash.mjs — NOT a user rejection] BLOCKED | reason=${hit.tag}\n`,
    );
    process.stderr.write(hit.msg + "\n");
    process.exit(2);
  }
}

// Run the hook only when executed directly (`node no-bash.mjs`); when imported (validation harness),
// export scan() without reading stdin or exiting. realpath BOTH sides so a symlinked invocation path
// (macOS /var→/private/var, %20-encoding, etc.) still matches — and on ANY uncertainty default to
// running, because a hook that silently fails to fire is far worse than one that runs when imported.
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
    // any internal error → fail open (best-effort discipline; never break the session)
  }
  process.exit(0);
}
