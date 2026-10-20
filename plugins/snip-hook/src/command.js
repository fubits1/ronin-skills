import {
  baseName,
  CONTROL_NODES,
  ENV_ASSIGNMENT,
  GIT_BRANCH_WRITE_FLAG,
  parseShell,
  WRAPPER_FLAGS_WITH_VALUE,
} from "../../../shared/shell.js";

/**
 * process wrappers stripped before matching. Claude Code's permissions docs list `timeout`, `time`,
 * `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob` and bare `xargs`; `env`, `exec` and
 * `xargs` with flags are stripped here too, but only for deny/ask and containment, never to grant
 * (see `grantable`)
 */
const CC_WRAPPERS = new Set([
  "timeout",
  "time",
  "nice",
  "nohup",
  "stdbuf",
  "builtin",
  "noglob",
]);
const EXTRA_WRAPPERS = new Set(["env", "exec", "xargs"]);

/**
 * `command` and `xargs` only wrap grantably when no flag follows: `command -v npx` is an existence
 * check, not a run of `npx`, and Claude Code matches `xargs -n1 grep` as `xargs`
 */
const BARE_WRAPPERS = new Set(["command", "xargs"]);

/**
 * the forms in which Claude Code strips a wrapper before matching an allow rule, verbatim from its
 * matcher (Claude Code 2.1.302). a wrapper in any other form (`nice -n10`, `stdbuf -o L`), or named
 * with a path, is matched as written
 */
const CC_WRAPPER_FORMS = {
  timeout:
    /^timeout[ \t]+(?:(?:--(?:foreground|preserve-status|verbose)|--(?:kill-after|signal)=[A-Za-z0-9_.+-]+|--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+|-v|-[ks][ \t]+[A-Za-z0-9_.+-]+|-[ks][A-Za-z0-9_.+-]+)[ \t]+)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
  time: /^time[ \t]+(?:--[ \t]+)?/,
  nice: /^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/,
  stdbuf: /^stdbuf(?:[ \t]+-[ioe][LN0-9]+)+[ \t]+(?:--[ \t]+)?/,
  nohup: /^nohup[ \t]+(?:--[ \t]+)?/,
  command: /^command(?:[ \t]+-p+)*(?:[ \t]+--)?[ \t]+(?!-)/,
  builtin: /^builtin(?:[ \t]+--)?[ \t]+(?!-)/,
  noglob: /^noglob[ \t]+(?!-)/,
};

// commands whose path arguments Claude Code checks against the working directories (Claude Code 2.1.302)
const PATH_CHECKED = new Set([
  "cd",
  "ls",
  "find",
  "mkdir",
  "touch",
  "rm",
  "rmdir",
  "mv",
  "cp",
  "cat",
  "head",
  "tail",
  "sort",
  "uniq",
  "wc",
  "cut",
  "paste",
  "column",
  "tr",
  "file",
  "stat",
  "diff",
  "awk",
  "gawk",
  "mawk",
  "nawk",
  "strings",
  "hexdump",
  "od",
  "base64",
  "nl",
  "tac",
  "man",
  "rev",
  "fold",
  "expand",
  "unexpand",
  "fmt",
  "comm",
  "cmp",
  "pr",
  "numfmt",
  "tsort",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "sed",
  "git",
  "jq",
  "sha256sum",
  "sha1sum",
  "md5sum",
  "tee",
]);
const FILE_WRITERS = new Set(["mkdir", "touch", "rm", "rmdir", "mv", "cp"]);
// a path that may lie outside the working directories: absolute, under `~`, through `..`, a variable
const MAYBE_OUTSIDE = /^[/~]|(^|\/)\.\.(\/|$)|\$/;

const SNIP_SUBCOMMANDS = new Set(["run", "check", "proxy"]);

/**
 * a wrapper's own leading flags and numeric/duration args (e.g. `timeout 30`, `timeout 30s`,
 * `timeout 1.5h`, `nice -n 10`). without the suffix/decimal forms, `timeout 30s gh repo delete`
 * slipped past the deny rule.
 */
const WRAPPER_ARG = /^(-|\d+(\.\d+)?[smhd]?$)/;

/**
 * constructs whose inner commands run in a way a per-command allow check can't vouch for: never
 * allow-emit a script containing one (C1: `git log $(gh repo delete x)` would auto-run the inner
 * command because the visible prefix matches an allow rule). deny/ask/containment still inspect
 * the inner commands.
 */
const UNGRANTABLE_NODES = new Set([
  "CommandExpansion",
  "ProcessSubstitution",
  "ArithmeticCommandExpansion",
  "Subshell",
  "BraceGroup",
  ...CONTROL_NODES,
]);

/**
 * Claude Code's built-in read-only commands, limited to the members its permissions docs name: "The
 * set includes `ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`, `wc`, `which`, `diff`,
 * `stat`, `du`, `cd`, and read-only forms of `git`" (not exhaustive, not configurable,
 * https://code.claude.com/docs/en/permissions#read-only-commands). a read-only command missing
 * here gets one prompt too many, never a silent run
 */
const READ_ONLY = new Set([
  "ls",
  "cat",
  "echo",
  "pwd",
  "head",
  "tail",
  "grep",
  "find",
  "wc",
  "which",
  "diff",
  "stat",
  "du",
  "cd",
]);

// `git` subcommands that only read, plus list forms below (branch write flags shared with no-bash)
const GIT_READ_ONLY = new Set(["status", "log", "diff", "show", "blame"]);

/**
 * `find` actions that run commands, delete or write files, or read paths from a file. Claude Code
 * treats them as not read-only, and a prefix allow rule like `Bash(find *)` doesn't approve them
 */
const FIND_ACTIONS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
  "-files0-from",
]);

// exec wrappers a prefix allow rule can't approve (permissions docs, "Exec wrappers and `find` actions")
const EXEC_WRAPPERS = new Set(["watch", "setsid", "ionice", "flock"]);

// redirects that write a file; `2>&1`-style descriptor duplication and `/dev/null` don't
const WRITE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>", "<>", ">&"]);
const GLOB_PARTS = new Set(["Glob", "ExtendedGlob", "BraceExpansion"]);

// Claude Code prompts for commands it can't fully parse and for any command over 10,000 characters
const MAX_ANALYZED_LENGTH = 10_000;

function hasFindAction(tokens) {
  return (
    baseName(tokens[0]) === "find" &&
    tokens.some((token) => FIND_ACTIONS.has(token))
  );
}

/**
 * a command a prefix allow rule can't approve in Claude Code even when the rule's text matches:
 * an exec wrapper, or `find` with an action
 */
export function isUnapprovableByPrefixRule(tokens) {
  return EXEC_WRAPPERS.has(baseName(tokens[0])) || hasFindAction(tokens);
}

function isReadOnlyGit(args) {
  const [subcommand, ...rest] = args;
  // `git log --output=f` / `git diff --output f` write a file
  if (rest.some((arg) => arg.startsWith("--output"))) {
    return false;
  }
  if (GIT_READ_ONLY.has(subcommand)) {
    return true;
  }
  if (subcommand === "branch") {
    return !rest.some(
      (arg) => !arg.startsWith("-") || GIT_BRANCH_WRITE_FLAG.test(arg),
    );
  }
  if (subcommand === "tag") {
    return rest.length === 0 || rest[0] === "-l" || rest[0] === "--list";
  }
  if (subcommand === "stash") {
    return rest[0] === "list" || rest[0] === "show";
  }
  if (subcommand === "remote") {
    return rest.length === 0 || rest[0] === "-v" || rest[0] === "show";
  }
  return false;
}

// is the effective command one of the documented read-only commands, in a read-only form?
function isReadOnlyTokens(tokens) {
  const base = baseName(tokens[0]);
  if (base === "git") {
    return isReadOnlyGit(tokens.slice(1));
  }
  return READ_ONLY.has(base) && !hasFindAction(tokens);
}

/**
 * every reading of a command, outermost first: as written, then past each leading assignment or
 * wrapper in turn. the last reading is the effective command. deny/ask match any reading, so a
 * rule on the wrapper itself (`Bash(nohup *)`) still fires. allow matches `grantReading`, the
 * reading Claude Code matches: past the prefixes it strips, in the forms it strips them, up to the
 * first one it doesn't (an assignment, `env`, `exec`, a flagged `xargs`, `nice -n10`).
 * `grantable`: every stripped prefix is one Claude Code strips too.
 */
export function readCommand(tokens) {
  const readings = [tokens];
  let grantable = true;
  let grantReading = tokens;
  let i = 0;
  while (i < tokens.length) {
    const base = baseName(tokens[i]);
    const next = tokens[i + 1];
    if (ENV_ASSIGNMENT.test(tokens[i])) {
      grantable = false;
      i++;
    } else if (
      BARE_WRAPPERS.has(base) &&
      next !== undefined &&
      !next.startsWith("-")
    ) {
      grantable &&=
        base === "xargs"
          ? tokens[i] === "xargs"
          : claudeCodeStrips(tokens, i, i + 1);
      i++;
    } else if (CC_WRAPPERS.has(base) || EXTRA_WRAPPERS.has(base)) {
      const start = i;
      i++;
      while (i < tokens.length && WRAPPER_ARG.test(tokens[i])) {
        // a flag's word value (`timeout -s KILL`, `env -u FOO`) is skipped so deny/ask see the wrapped command
        const value = tokens[i + 1];
        if (
          WRAPPER_FLAGS_WITH_VALUE[base]?.has(tokens[i]) &&
          value !== undefined &&
          !WRAPPER_ARG.test(value)
        ) {
          i++;
        }
        i++;
      }
      grantable &&= CC_WRAPPERS.has(base) && claudeCodeStrips(tokens, start, i);
    } else if (base === "snip") {
      // defensive: the hook sees the original command, but unwrap a snip-wrapped one too
      i++;
      if (SNIP_SUBCOMMANDS.has(tokens[i])) {
        i++;
      }
      if (tokens[i] === "--") {
        i++;
      }
    } else {
      break;
    }
    readings.push(tokens.slice(i));
    if (grantable) {
      grantReading = readings.at(-1);
    }
  }
  return { readings, effective: readings.at(-1), grantable, grantReading };
}

// Claude Code strips tokens[start..end) as one wrapper and matches tokens[end..]
function claudeCodeStrips(tokens, start, end) {
  const form = Object.hasOwn(CC_WRAPPER_FORMS, tokens[start])
    ? CC_WRAPPER_FORMS[tokens[start]]
    : null;
  return (
    form !== null &&
    tokens.slice(start).join(" ").replace(form, "") ===
      tokens.slice(end).join(" ")
  );
}

// an unquoted glob, brace expansion or extended glob among the arguments
function hasUnquotedGlob(node) {
  return node.suffix.some((part) =>
    part?.parts?.some((child) => GLOB_PARTS.has(child.type)),
  );
}

function writesFile(redirects) {
  return redirects.some(
    (redirect) =>
      redirect.type === "Redirect" &&
      WRITE_REDIRECTS.has(redirect.operator) &&
      !/^(\d+|-|\/dev\/null)$/.test(redirect.target?.value ?? ""),
  );
}

// Claude Code checks the files a `tee` writes like a redirect's target
function teeWritesFile(tokens) {
  return (
    baseName(tokens[0]) === "tee" &&
    tokens.slice(1).some((arg) => !arg.startsWith("-") && arg !== "/dev/null")
  );
}

const maybeOutside = (path) => path !== "/dev/null" && MAYBE_OUTSIDE.test(path);

/**
 * would Claude Code's path checks ask about this command before it looks at any allow rule? they
 * do for a file it writes (redirect, `tee`), a path that may lie outside the working directories
 * (an argument of a path-checked command, an input redirect), `cp`/`mv` with a flag, and a file
 * write or input redirect after a `cd`. approximated on the safe side: an absolute path that is
 * inside the working directories asks too
 */
function asksForPaths(effective, redirects, changesDirectory) {
  const base = baseName(effective[0]);
  const args = effective.slice(1);
  const inputs = redirects
    .filter(
      (redirect) =>
        redirect.type === "Redirect" &&
        (redirect.operator === "<" || redirect.operator === "<>"),
    )
    .map((redirect) => redirect.target?.value ?? "");
  return (
    writesFile(redirects) ||
    teeWritesFile(effective) ||
    ((base === "cp" || base === "mv") &&
      args.some((arg) => arg.startsWith("-"))) ||
    (PATH_CHECKED.has(base) &&
      args.some((arg) => !arg.startsWith("-") && maybeOutside(arg))) ||
    inputs.some(maybeOutside) ||
    (changesDirectory &&
      base !== "cd" &&
      (FILE_WRITERS.has(base) || inputs.length > 0))
  );
}

/**
 * parse a Bash tool command into every simple command it would run, including commands nested in
 * substitutions, loops, subshells and shell `-c` scripts. `analyzable` is false where Claude Code
 * always prompts: a parse error or a command over 10,000 characters. `grantable` is false when
 * allow must not be emitted for the script as a whole: an unanalyzable script, any construct in
 * UNGRANTABLE_NODES, or an inner shell script.
 *
 * `pathAsk` marks a command Claude Code's path checks ask about (`asksForPaths`), so an allow rule
 * for the command doesn't cover it. `readOnly` marks a command Claude Code would run without a
 * prompt as a built-in read-only command, judged conservatively: never past an assignment or a
 * wrapper Claude Code doesn't strip, never with an unquoted glob or a path check that asks, never
 * in a script Claude Code can't analyse, and never `git` in a script that also changes directory
 * (`cd` + `git` prompts)
 */
export function parseCommands(source) {
  const { commands, nodeTypes, parseError } = parseShell(source, readCommand);
  const analyzable = source.length <= MAX_ANALYZED_LENGTH && !parseError;
  const scriptGrantable =
    analyzable &&
    ![...nodeTypes].some((type) => UNGRANTABLE_NODES.has(type)) &&
    !commands.some(({ context }) => context === "shell-script");
  const changesDirectory = commands.some(
    ({ effective }) => baseName(effective[0]) === "cd",
  );
  return {
    commands: commands.map(
      ({ readings, effective, grantable, grantReading, node, redirects }) => {
        const pathAsk = asksForPaths(effective, redirects, changesDirectory);
        return {
          readings,
          effective,
          grantable,
          pathAsk,
          text: effective.join(" "),
          grantText: grantReading.join(" "),
          readOnly:
            grantable &&
            analyzable &&
            !hasUnquotedGlob(node) &&
            !pathAsk &&
            isReadOnlyTokens(effective) &&
            !(changesDirectory && baseName(effective[0]) === "git"),
        };
      },
    ),
    grantable: scriptGrantable,
    analyzable,
  };
}
