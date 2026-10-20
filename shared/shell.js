/**
 * the shell parser both Bash hooks share: no-bash (plugins/hooks) and snip-hook. it turns one Bash
 * tool command into every simple command it would run, parsed with unbash (a real bash AST, pure
 * JS), so quotes, escapes, heredocs, substitutions and line continuations resolve the way bash
 * resolves them. rolldown bundles it into each hook, so the hooks load only `node:` modules at
 * runtime.
 *
 * wrapper policy (which prefixes like `timeout` or `env` to look through) differs per hook, so each
 * hook passes its own `readCommand(tokens)`; it must return at least `{ effective }`, the command
 * words with those prefixes removed, and everything it returns is kept on the command.
 */
import { forEachChild, parse } from "unbash";

const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

const SHELL_SHORT_OPTIONS = /^[-+][a-zA-Z]+$/;
const SHELL_LONG_OPTIONS_WITH_VALUE = new Set(["--rcfile", "--init-file"]);

export const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * process-wrapper flags whose value is the next word, so the value isn't read as the wrapped
 * command (`xargs -I % grep`, `timeout -s KILL 5 grep`, `env -u FOO grep`), for the GNU and the
 * BSD/macOS tools (`xargs -J %`, `env -P altpath`). GNU xargs `-i`, `-e` and `-l` take only an
 * attached value (`-i{}`), so they are not listed
 */
export const WRAPPER_FLAGS_WITH_VALUE = {
  time: new Set(["-o", "--output", "-f", "--format"]),
  exec: new Set(["-a"]),
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  nice: new Set(["-n", "--adjustment"]),
  stdbuf: new Set(["-i", "--input", "-o", "--output", "-e", "--error"]),
  env: new Set(["-u", "--unset", "-C", "--chdir", "-P"]),
  xargs: new Set([
    "-I",
    "-J",
    "--process-slot-var",
    "-d",
    "--delimiter",
    "-E",
    "-L",
    "-n",
    "--max-args",
    "-P",
    "--max-procs",
    "-s",
    "--max-chars",
    "-a",
    "--arg-file",
  ]),
};

// compound commands that join commands into one call, like `;` and `&&` do
export const CONTROL_NODES = new Set([
  "If",
  "For",
  "ArithmeticFor",
  "While",
  "Case",
  "Select",
  "Function",
  "Coproc",
]);

// `git branch` flags that delete, move, copy, force or set upstream
export const GIT_BRANCH_WRITE_FLAG =
  /^(-d|-D|--delete|-m|-M|--move|-c|-C|--copy|-f|--force|--set-upstream-to(=.*)?|-u|--unset-upstream|--edit-description)$/;

// String(): a command made only of assignments (`FOO=bar`) has no head token
export function baseName(token) {
  return String(token).replace(/\\/g, "/").split("/").pop();
}

// assignments, name and arguments as the shell sees them (quotes removed); redirects dropped
function commandTokens(node) {
  const words = [...node.prefix, node.name, ...node.suffix].filter(
    (part) => part?.type === "Word" || part?.type === "Assignment",
  );
  return words.map((part) => (part.type === "Word" ? part.value : part.text));
}

/**
 * where a shell command takes its script from, read the way the shell reads its options: up to the
 * first operand or `--`, each short-option letter counts (`c`: the first operand is the script, `s`:
 * stdin is the script, `o`/`O`: the next word is that option's value). so `bash -euo pipefail -c X`
 * and `bash -c -e X` run X, `bash setup.sh -c X` runs setup.sh, and the stdin of
 * `bash setup.sh <<EOF` is data. returns `{ operand }`, `{ stdin: true }`, or null for a script
 * file or a command that isn't a shell
 */
function scriptSource(effective) {
  if (!SHELLS.has(baseName(effective[0]))) {
    return null;
  }
  let scriptFromOperand = false;
  let scriptFromStdin = false;
  let i = 1;
  for (; i < effective.length; i++) {
    const token = effective[i];
    if (token === "--" || token === "-") {
      i++;
      break;
    }
    if (SHELL_LONG_OPTIONS_WITH_VALUE.has(token)) {
      i++;
    } else if (SHELL_SHORT_OPTIONS.test(token)) {
      for (const letter of token.slice(1)) {
        if (letter === "c") {
          scriptFromOperand = true;
        } else if (letter === "s") {
          scriptFromStdin = true;
        } else if (letter === "o" || letter === "O") {
          i++;
        }
      }
    } else if (!token.startsWith("--")) {
      break;
    }
  }
  if (scriptFromOperand) {
    return effective[i] === undefined ? null : { operand: effective[i] };
  }
  return i < effective.length && !scriptFromStdin ? null : { stdin: true };
}

// the inline text of a heredoc or herestring; a `< file` names a script file instead
function inlineText(stdin) {
  if (stdin?.type === "HereDoc") {
    return stdin.body.text;
  }
  return stdin?.type === "HereString" ? stdin.target?.value : undefined;
}

// bash applies redirects left to right, so the last one on fd 0 is stdin
function lastStdinInput(redirects) {
  return redirects.filter(isStdinInput).at(-1);
}

function isStdinInput(redirect) {
  const input =
    redirect.type === "HereDoc" ||
    redirect.type === "HereString" ||
    (redirect.type === "Redirect" &&
      (redirect.operator === "<" || redirect.operator === "<>"));
  return (
    input &&
    (redirect.descriptor === undefined || redirect.descriptor.value === 0)
  );
}

/**
 * does this statement list join commands with `;`, `&`, a newline, `&&` or `||`? a pipeline is one
 * command, and so is a single command sent to the background
 */
function joinsCommands(statements) {
  return (
    statements.length > 1 ||
    statements.some((statement) => statement.command.type === "AndOr")
  );
}

/**
 * every simple command in `source`, in source order, as `{ node, context, redirects,
 * ...readCommand(tokens) }`. `redirects` holds the command's own redirects plus those on every
 * enclosing subshell or group (`(cat a) > out` writes a file). `context` says where it runs:
 *   - `top`: the command line itself, including subshells, groups, loops and pipelines
 *   - `dollar-sub` / `backtick-sub`: inside `$(…)` / `` `…` ``
 *   - `procsub`: inside `<(…)` / `>(…)`
 *   - `shell-script`: in a script handed to a shell (`bash -c`, a heredoc or herestring)
 * an inner context wins over an outer one, except that `shell-script` sticks.
 *
 * also returned:
 *   - `chained`: two or more commands joined with `;`, `&`, a newline, `&&` or `||`, or a loop,
 *     `if`, `case` or function, outside a shell script
 *   - `nodeTypes`: every syntax node type seen
 *   - `parseError`: unbash reported an error in the command or an inner script; whatever it could
 *     parse is still returned
 */
export function parseShell(source, readCommand) {
  const commands = [];
  const nodeTypes = new Set();
  let chained = false;
  let parseError = false;
  // a group's stdin that a shell inside it has already read to its end
  const consumedStdin = new Set();

  /**
   * a shell's stdin is its own last fd-0 input, else the nearest enclosing group's, which only the
   * first stage of a pipeline inherits and only the first shell to read it gets
   */
  const shellStdin = (node, outerStdin) => {
    const own = lastStdinInput(node.redirects);
    if (
      own !== undefined ||
      outerStdin === undefined ||
      consumedStdin.has(outerStdin)
    ) {
      return own;
    }
    consumedStdin.add(outerStdin);
    return outerStdin;
  };

  const visit = (node, context, outerRedirects, outerStdin) => {
    nodeTypes.add(node.type);
    let inner = context;
    let redirects = outerRedirects;
    let stdin = outerStdin;
    if (node.type === "Redirected") {
      redirects = [...node.redirects, ...outerRedirects];
      stdin = lastStdinInput(node.redirects) ?? outerStdin;
    }
    if (context !== "shell-script") {
      if (node.type === "CommandExpansion") {
        inner = node.text.startsWith("`") ? "backtick-sub" : "dollar-sub";
      } else if (node.type === "ArithmeticCommandExpansion") {
        inner = "dollar-sub";
      } else if (node.type === "ProcessSubstitution") {
        inner = "procsub";
      } else if (CONTROL_NODES.has(node.type)) {
        chained = true;
      } else if (node.type === "Script" || node.type === "CompoundList") {
        chained ||= joinsCommands(node.commands);
      }
    }
    if (node.type === "Command") {
      const reading = readCommand(commandTokens(node));
      const commandRedirects = [...node.redirects, ...outerRedirects];
      commands.push({
        ...reading,
        node,
        context,
        redirects: commandRedirects,
      });
      const source = scriptSource(reading.effective);
      const script = source?.stdin
        ? inlineText(shellStdin(node, outerStdin))
        : source?.operand;
      if (script !== undefined) {
        visitScript(script, "shell-script");
      }
    }
    forEachChild(node, (child) =>
      visit(
        child,
        inner,
        redirects,
        node.type === "Pipeline" && child !== node.commands[0]
          ? undefined
          : stdin,
      ),
    );
  };

  const visitScript = (script, context) => {
    const ast = parse(script);
    if (ast.errors?.length) {
      parseError = true;
    }
    visit(ast, context, [], undefined);
  };

  visitScript(source, "top");
  return { commands, chained, nodeTypes, parseError };
}
