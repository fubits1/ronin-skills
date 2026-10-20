import { spawnSync } from "node:child_process";
import { snipHookHandler } from "./rules.js";

const SNIP_TIMEOUT_MS = 2000;

/**
 * would snip's own hook auto-allow this hook input? asks snip itself, with the handler registered
 * in the settings files, else `snip hook` on PATH. any failure -> false, so the hook stays silent
 */
export function snipAllowsFor(files) {
  return (input) => {
    const handler = snipHookHandler(files) ?? { command: "snip hook" };
    const result = spawnSync(handler.command, handler.args ?? [], {
      input: JSON.stringify(input),
      encoding: "utf8",
      shell: handler.args === undefined,
      timeout: SNIP_TIMEOUT_MS,
    });
    try {
      return (
        JSON.parse(result.stdout).hookSpecificOutput.permissionDecision ===
        "allow"
      );
    } catch {
      return false;
    }
  };
}
