// PreToolUse(Bash) hook: a DISCIPLINE nudge, not a firewall. It catches the model's reflex of
// reaching for Bash `grep`/`cat`/`find`/`head`/`tail`/`awk`/`wc`/`rg`/`sed -n` (and `cat > file`
// heredocs, mutating git, gratuitous chaining) instead of the dedicated Read/Grep/Glob/Write tools —
// because the model ignores its own system-prompt guidance ~40% of sessions (claude-code#39979).
// It is NOT an adversarial sandbox: the model produces these commands plainly and has no reason to
// obfuscate them to evade its own discipline hook, so the matcher does not chase encoding or
// expansion. Threat model + rationale: no-bash.md.
//
// Cross-OS: a plugin SHELL hook can't run on native Windows (#18610). Node runs everywhere. Block
// mechanism: exit 2 + a stderr message naming the right tool. FAIL-OPEN BY DESIGN — empty/absent/
// non-string command, unparseable stdin, or any internal throw → exit 0; a hook bug must never break
// the session. The command is parsed with unbash (shared/shell.js), bundled into no-bash.mjs by
// `pnpm build`, so the shipped hook has no runtime dependencies.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  baseName,
  ENV_ASSIGNMENT,
  GIT_BRANCH_WRITE_FLAG,
  parseShell,
  WRAPPER_FLAGS_WITH_VALUE,
} from "../../../shared/shell.js";

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
/**
 * a wrapper's own flags and numeric args. the `{}` replstr of `xargs -I {}` (the dominant xargs
 * idiom) is consumed as `-I`'s value (WRAPPER_FLAGS_WITH_VALUE), so it never becomes the effective
 * command
 */
const WRAPPER_ARG = /^(-|[0-9])/;
const GREP_TOOLS = new Set(["grep", "egrep", "fgrep", "rg"]);

// JS/Python bodies aren't shell, so the parser can't see a banned tool run from a subprocess API
const RE_NODE_SHELLOUT =
  /(^|\s)(node|deno|bun)\s+(-e|--eval)\s+["'].*(child[_]process|exec[S]ync|spawn[S]ync)/;
const RE_PY_SHELLOUT = /(^|\s)(python|python3)\s+(-c)\s+["'].*subprocess/;

// git global options that can precede the subcommand (`git -C <path> commit`, `git -c k=v commit`,
// `git --no-pager log`). A subcommand never starts with `-`, so every leading option is skipped, plus
// the value of the ones that take it as the next word — otherwise a global option lets a real
// mutation slip past (`git -C /repo commit` was allowed).
const GIT_GLOBAL_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--super-prefix",
  "--attr-source",
]);
const GIT_WRITE_SUBCOMMANDS = {
  worktree: new Set([
    "add",
    "remove",
    "move",
    "prune",
    "repair",
    "lock",
    "unlock",
  ]),
  submodule: new Set([
    "add",
    "update",
    "init",
    "deinit",
    "set-url",
    "set-branch",
    "sync",
    "absorbgitdirs",
  ]),
  remote: new Set([
    "add",
    "remove",
    "rename",
    "set-url",
    "set-head",
    "set-branches",
    "prune",
    "rm",
  ]),
};
const GIT_APPLY_READ_FLAGS = new Set([
  "--check",
  "--stat",
  "--numstat",
  "--summary",
]);
// a sed script that only prints a line range (`5p`, `1,5p`, `$p`), alone or as `--expression=…`
const SED_PRINT_RANGE = /^(--expression=)?(\$|[0-9]+)(,(\$|[0-9]+))?p$/;

// redirects that send a command's stdout to a file; `>&` duplicates a descriptor instead
const STDOUT_WRITES = new Set([">", ">>", ">|", "&>", "&>>"]);

// Shared note for search/read messages. The Grep/Glob tools were removed on native macOS/Linux
// builds in 2.1.117 (Windows/npm keep them), so the dedicated alternative is fff there; Read works
// on every build. Centralized so the seven messages below can't drift apart.
const SEARCH_FALLBACK =
  "Read for reads; the Grep/Glob tool where present, or the fff MCP (mcp__fff__grep / mcp__fff__find_files) on native macOS/Linux builds where 2.1.117 removed Grep/Glob";
/**
 * NO_BASH_SEARCH_FALLBACK hint
 *
 * worded for the setting both on and off: git grep / perl stay blocked while it is on, so the hint
 * names plain grep/find instead of asking the user to set a variable that is already set
 */
const BASH_SEARCH_FALLBACK_HINT =
  "If neither is available in this session, Bash search is the one fallback: with NO_BASH_SEARCH_FALLBACK=1 set (settings.json env), plain grep/find pass through to the embedded ugrep/bfs; if it is not set, ask the user to set it. Do not work around the block any other way.";

const MSG = {
  "node-shellout": `Use the dedicated tool (${SEARCH_FALLBACK}) instead of shelling out to a subprocess API from inside an embedded JS script.`,
  "python-shellout": `Use the dedicated tool (${SEARCH_FALLBACK}) instead of shelling out to subprocess from inside an embedded Python script.`,
  "bashc-banned": `A banned file-read/search tool (or sed-read) was invoked via 'bash -c' / 'sh -c'. Run it directly at the top level instead of wrapping it in a shell, so the hook can name the right tool (${SEARCH_FALLBACK}).`,
  "bashc-sed-read":
    "'sed' used as a reader inside bash -c / sh -c. Use the Read tool (offset/limit) instead.",
  "dollar-sub": `Banned tool inside command substitution $(...). Use the dedicated tool (${SEARCH_FALLBACK}).`,
  "backtick-sub": `Banned tool inside backtick command substitution. Use the dedicated tool (${SEARCH_FALLBACK}).`,
  procsub: `Banned tool inside process substitution <(...)/>(...). Use the dedicated tool (${SEARCH_FALLBACK}).`,
  "command-builtin": `The 'command' builtin is banned as a tool-execution bypass (e.g. 'command grep'). Use the dedicated tool (${SEARCH_FALLBACK}). ('command -v foo' existence checks are allowed and pass.)`,
  "git-mutation":
    "Mutating git command. Use gh for remote state, or suggest the user run ! git <command> locally.",
  "cat-write":
    "Use the Write tool to create files, not 'cat > file' / heredocs. Write shows a diff and its approval caches; heredoc content is unique and re-reviewed every time. See claude-code#19649.",
  "cat-read":
    "Use the Read tool instead of Bash cat. Read supports: offset, limit (for head/tail behavior). Line numbers included by default.",
  "bash-find": `Use the Glob tool instead of Bash find. Glob supports: pattern (e.g. '**/*.ts', '**/*test*'). On native macOS/Linux builds the Glob tool was removed in 2.1.117; use the fff MCP (mcp__fff__find_files) instead. ${BASH_SEARCH_FALLBACK_HINT}`,
  "sed-read":
    "Use the Read tool instead of Bash sed for reading file ranges (-n / Np / N,Mp / $p). Read supports: offset, limit.",
  "bash-awk":
    "Use the Grep tool (for searching) or Read tool (for reading) instead of Bash awk. On native macOS/Linux builds the Grep tool was removed in 2.1.117; use the fff MCP (mcp__fff__grep) instead.",
  "bash-wc":
    "Use the Grep tool with output_mode: 'count' instead of Bash wc. On native macOS/Linux builds the Grep tool was removed in 2.1.117; use the fff MCP (mcp__fff__grep, output_mode 'count') instead.",
  chaining:
    "No command chaining. You joined multiple commands with && / || / ; / & / a newline, or a loop / if / case, in one Bash call. Run each as a SEPARATE Bash call instead. Chaining hides later commands from per-command approval and is a documented permission-bypass vector. (The working directory persists across Bash calls, so 'cd dir && cmd' is unnecessary too. Pipes into jq and redirections like 2>&1 are fine.)",
};
function block(tag, message) {
  return { tag, msg: message || MSG[tag] };
}
function grepMessage(tool) {
  return `Use the Grep tool instead of Bash ${tool}. Grep supports: multiline: true, output_mode (content/files_with_matches/count), -A/-B/-C context, -i case-insensitive, glob/type filtering, head_limit, offset. On native macOS/Linux builds the Grep tool was removed in 2.1.117; use the fff MCP (mcp__fff__grep) instead, which returns structured, frecency-ranked results. ${BASH_SEARCH_FALLBACK_HINT}`;
}
function readMessage(tool) {
  return `Use the Read tool instead of Bash ${tool}. Read supports: offset (start line), limit (number of lines).`;
}

// blocks that keep their own tag when nested; every other block takes the substitution's or
// shell's tag
const KEEPS_OWN_TAG = new Set(["command-builtin", "git-mutation", "sed-read"]);
// a nested banned tool reports in this order (shell scripts first), then the command line itself
const CONTEXT_ORDER = [
  "shell-script",
  "dollar-sub",
  "backtick-sub",
  "procsub",
  "top",
];

/**
 * the command past leading `VAR=value` assignments and process wrappers (`timeout 5 nice -n 10
 * grep`), so the effective command is the one checked
 */
function readCommand(tokens) {
  let i = 0;
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i])) {
    i++;
  }
  while (i < tokens.length && WRAPPERS.has(baseName(tokens[i]))) {
    const flagsWithValue = WRAPPER_FLAGS_WITH_VALUE[baseName(tokens[i])];
    i++;
    while (i < tokens.length) {
      if (flagsWithValue?.has(tokens[i])) {
        i += 2;
      } else if (
        WRAPPER_ARG.test(tokens[i]) ||
        ENV_ASSIGNMENT.test(tokens[i])
      ) {
        i++;
      } else {
        break;
      }
    }
  }
  return { effective: tokens.slice(i) };
}

function gitSubcommand(gitArgs) {
  let i = 0;
  while (i < gitArgs.length && gitArgs[i].startsWith("-")) {
    i += GIT_GLOBAL_WITH_VALUE.has(gitArgs[i]) ? 2 : 1;
  }
  return { subcommand: gitArgs[i] ?? "", args: gitArgs.slice(i + 1) };
}

// Is this `git …` call a MUTATION (block) or a read-only/inspection form (pass)? The hook's
// contract (no-bash.md): mutating git blocks while read-only git and `git mv` pass. Every subcommand
// with a common read-only form is discriminated — mirroring how `remote` already was — so reads like
// `git stash list`, `git tag -l`, `git config --get`, `git clean -n`, `git apply --check` pass.
function gitMutates({ subcommand, args }) {
  switch (subcommand) {
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
      return args[0] !== "list" && args[0] !== "show"; // list/show read; bare/push/pop/drop/… mutate
    case "clean":
      return !args.some(
        (arg) => arg === "--dry-run" || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(arg),
      ); // -n / --dry-run only previews
    case "apply":
      return !args.some((arg) => GIT_APPLY_READ_FLAGS.has(arg));
    case "fetch":
      return !args.includes("--dry-run");
    case "branch":
      return args.some((arg) => GIT_BRANCH_WRITE_FLAG.test(arg)); // delete/move/copy/force/upstream mutate; -a/-l/-v/--contains/bare list read
    case "worktree": // `worktree list` reads
    case "submodule": // `submodule status` reads
    case "remote": // `remote -v` / `remote show` read
      return GIT_WRITE_SUBCOMMANDS[subcommand].has(args[0]);
    // `config` and `tag`: local, with very common read forms (`config --get/--list`, `tag -l`); their
    // write forms (set a key, create/delete a tag) are minor, non-destructive, and have no gh
    // equivalent — so neither is blocked. `git mv` and any other subcommand: read-only → pass.
    default:
      return false;
  }
}

// route `cat` to Write only for a genuine stdout file-write or a heredoc; a stderr redirect
// (`2>/dev/null`, `2>&1`, `1>&2`) or a here-string (`<<<`) is still a READ → cat-read
function catWrites(redirects) {
  return redirects.some(
    (redirect) =>
      redirect.type === "HereDoc" ||
      (redirect.type === "Redirect" &&
        STDOUT_WRITES.has(redirect.operator) &&
        (redirect.descriptor === undefined || redirect.descriptor.value === 1)),
  );
}

function checkCommand({ effective, redirects }, bashSearchAllowed) {
  const tool = baseName(effective[0]);
  if (tool === "command") {
    // `command -v` is an existence check, not tool execution
    return /^-[vV]/.test(effective[1] ?? "") ? null : block("command-builtin");
  }
  if (tool === "git") {
    const git = gitSubcommand(effective.slice(1));
    if (git.subcommand === "grep") {
      return block("bash-grep", grepMessage("git grep")); // content search → Grep
    }
    return gitMutates(git) ? block("git-mutation") : null;
  }
  if (GREP_TOOLS.has(tool)) {
    return bashSearchAllowed ? null : block("bash-" + tool, grepMessage(tool));
  }
  if (tool === "cat") {
    return block(catWrites(redirects) ? "cat-write" : "cat-read");
  }
  if (tool === "head" || tool === "tail") {
    return block("bash-" + tool, readMessage(tool));
  }
  if (tool === "find") {
    return bashSearchAllowed ? null : block("bash-find");
  }
  if (tool === "sed") {
    const args = effective.slice(1);
    const reads =
      args.includes("-n") || args.some((arg) => SED_PRINT_RANGE.test(arg));
    return reads ? block("sed-read") : null;
  }
  // `perl` is banned outright, unlike `sed`: a one-liner is a grep/cat substitute the model
  // reaches for once the named readers block, and no workflow here needs it — `sed -i 's///'`
  // covers in-place editing. Enumerating interpreters cannot close the class (claude-code#40408);
  // this closes the one the agent actually reaches for.
  if (tool === "perl") {
    return block(
      "bash-perl",
      `${grepMessage("perl")} For in-place edits use the Edit tool, or sed -i 's///' (GNU) / sed -i '' 's///' (macOS).`,
    );
  }
  if (tool === "awk") {
    return block("bash-awk");
  }
  if (tool === "wc") {
    return block("bash-wc");
  }
  return null;
}

/**
 * a banned tool in a substitution or a shell script takes that construct's tag, so the message
 * says where it was; inside a shell script a sed read is `bashc-sed-read`
 */
function nestedBlock(hit, context) {
  if (context === "shell-script" && hit.tag === "sed-read") {
    return block("bashc-sed-read");
  }
  if (KEEPS_OWN_TAG.has(hit.tag)) {
    return hit;
  }
  return block(context === "shell-script" ? "bashc-banned" : context);
}

/**
 * bashSearchAllowed lets grep/find through (NO_BASH_SEARCH_FALLBACK=1, read in main())
 *
 * the one case where blocking search leaves no allowed way to search: a native macOS/Linux build
 * (2.1.117 removed the Grep/Glob tools) with the fff MCP unavailable. there, Bash `grep`/`rg`/`find`
 * are Claude Code's embedded search (the shell snapshot replaces the names, see no-bash.md), so
 * they are the only search left. the hook cannot detect fff on its own (stdin carries no tool
 * list, and there is no tool-availability API), so the user switches it on in settings.json `env`.
 * reads stay blocked either way: `Read` is present on every build. it applies to the command line
 * only: a search inside `$(…)` or `bash -c` still blocks
 */
export function scan(command, bashSearchAllowed = false) {
  if (typeof command !== "string" || command === "") return null; // empty/absent/non-string: fail open

  if (RE_NODE_SHELLOUT.test(command)) return block("node-shellout");
  if (RE_PY_SHELLOUT.test(command)) return block("python-shellout");

  const { commands, chained } = parseShell(command, readCommand);
  for (const context of CONTEXT_ORDER) {
    for (const entry of commands) {
      if (entry.context !== context) continue;
      const hit = checkCommand(entry, context === "top" && bashSearchAllowed);
      if (hit) {
        return context === "top" ? hit : nestedBlock(hit, context);
      }
    }
  }

  /**
   * No-chaining check (runs after the per-tool arms, so a banned-tool message wins). A pipe, and a
   * single command sent to the background, aren't chaining; a newline inside quotes, a
   * `\`-continuation or a heredoc body is part of one command.
   */
  if (chained) return block("chaining");
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
  // the hook's own env, not the command: a `NO_BASH_SEARCH_FALLBACK=1 grep …` prefix does not count
  const hit = scan(
    input?.tool_input?.command,
    process.env.NO_BASH_SEARCH_FALLBACK === "1",
  );
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
