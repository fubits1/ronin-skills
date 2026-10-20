/**
 * the hook's decision for a Bash command, and the exact PreToolUse output contract for it. pure —
 * no I/O; index.js is the stdin/stdout adapter. the hook has no policy of its own: it re-applies
 * the permission rules from your Claude Code settings, and where none matches it restores what
 * Claude Code would do without snip.
 *
 *   1. deny    — any reading of any command matches a permissions.deny rule       -> exit 2 (block)
 *   2. ask     — any reading of any command matches a permissions.ask rule        -> emit ask
 *   3. allow   — EVERY command matches a permissions.allow rule Claude Code would honour, and
 *                nothing in the script is un-inspectable                       -> emit allow
 *   4. restore — a command no allow rule covers and that isn't read-only, or a script Claude Code
 *                can't analyse, in a mode where Claude Code would prompt, and snip's own hook
 *                would auto-allow it                                            -> emit ask
 *   else: silent exit 0 (let snip / the normal permission flow decide)
 *
 * precedence deny > ask > allow is Claude Code's own. allow is the only outcome that can auto-run
 * something, so it is the strictest: every command must match, in the reading Claude Code matches
 * (command.js `grantReading`), and any doubt -> silent.
 */
import { isUnapprovableByPrefixRule, parseCommands } from "./command.js";
import { ghApiWriteReadings } from "./gh.js";
import { compileRules, firstMatch } from "./rules.js";

const HOOK_NAME = "snip-hook";

/**
 * permission modes in which Claude Code prompts for a command no rule covers (`dontAsk` turns the
 * prompt into a denial). `auto` sends it to the classifier, which snip's hook "allow" doesn't skip
 * (anthropics/claude-code#94740), and `bypassPermissions` runs it: there the hook stays silent
 */
const PROMPTING_MODES = new Set(["default", "acceptEdits", "plan", "dontAsk"]);

/**
 * the first deny/ask rule matching any reading of any command, or null. a command's readings are
 * its wrapper readings (command.js) plus, for a `gh api` write, the same call with an
 * explicit method
 */
function firstMatchInReadings(commands, rules) {
  for (const { readings, effective } of commands) {
    for (const reading of [...readings, ...ghApiWriteReadings(effective)]) {
      const rule = firstMatch(reading.join(" "), rules);
      if (rule !== null) {
        return rule;
      }
    }
  }
  return null;
}

// does an allow rule approve this command the way Claude Code would?
function isCovered(command, allowRules) {
  return (
    !command.pathAsk &&
    firstMatch(command.grantText, allowRules) !== null &&
    !isUnapprovableByPrefixRule(command.effective)
  );
}

/**
 * returns {action:'deny'|'ask', rule} | {action:'allow'} | {action:'restore'} | null for a command
 * and the {allow, deny, ask} rule bodies from rules.js loadRules(). `snipAllows()` is called
 * only for a restore candidate: whether snip's own hook would auto-allow the command
 */
export function scan(command, rules, { mode = "default", snipAllows } = {}) {
  const { commands, grantable, analyzable } = parseCommands(command);
  if (commands.length === 0) {
    return null;
  }
  const denyRule = firstMatchInReadings(commands, compileRules(rules.deny));
  if (denyRule !== null) {
    return { action: "deny", rule: denyRule };
  }
  const askRule = firstMatchInReadings(commands, compileRules(rules.ask));
  if (askRule !== null) {
    return { action: "ask", rule: askRule };
  }
  const allowRules = compileRules(rules.allow);
  const uncovered = commands.filter((entry) => !isCovered(entry, allowRules));
  if (grantable && uncovered.length === 0) {
    return { action: "allow" };
  }
  const wouldPrompt = !analyzable || uncovered.some((entry) => !entry.readOnly);
  if (wouldPrompt && PROMPTING_MODES.has(mode) && snipAllows?.()) {
    return { action: "restore" };
  }
  return null;
}

function decision(permissionDecision, permissionDecisionReason) {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason,
      },
    }),
    stderr: "",
  };
}

export const SILENT = { exitCode: 0, stdout: "", stderr: "" };

/**
 * the full PreToolUse contract for one hook input: exit 2 + stderr to block, a JSON
 * permissionDecision on stdout to ask/allow, or nothing (silent). non-Bash tools and absent,
 * empty or non-string commands are silent. `snipAllows(input)` reports whether snip's own hook
 * would auto-allow this input
 */
export function decide(input, rules, snipAllows) {
  if (input?.tool_name && input.tool_name !== "Bash") {
    return SILENT;
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || command === "") {
    return SILENT;
  }
  const result = scan(command, rules, {
    mode: input.permission_mode || "default",
    snipAllows: () => snipAllows?.(input) === true,
  });
  if (result === null) {
    return SILENT;
  }
  if (result.action === "deny") {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `[deterministic hook block from ${HOOK_NAME} — NOT a user rejection] BLOCKED | reason=deny\nBlocked by your permissions.deny rule Bash(${result.rule}). snip's rewrite hid this from Claude Code's native matcher; ${HOOK_NAME} re-applied it to the original command.\n`,
    };
  }
  if (result.action === "ask") {
    return decision(
      "ask",
      `${HOOK_NAME}: matches your permissions.ask rule Bash(${result.rule})`,
    );
  }
  if (result.action === "restore") {
    return decision(
      "ask",
      `${HOOK_NAME}: no permissions rule covers this command; without snip Claude Code would ask`,
    );
  }
  return decision(
    "allow",
    `${HOOK_NAME}: every command matches a permissions.allow rule`,
  );
}
