#!/usr/bin/env node
/**
 * Stop hook: while background work is still running, nudge the agent to take the next independent
 * task instead of ending the turn idle. Reinforces the agent:discipline rule for background work:
 * "Then continue other work; don't poll, don't sleep."
 *
 * Input contract: code.claude.com/docs/en/hooks, "Stop input". Why additionalContext and not
 * decision:block: see the header of no-honest.mjs. The stop_hook_active guard limits it to one
 * nudge: the continuation it starts ends without one.
 */

import { readFileSync } from "node:fs";

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (input?.stop_hook_active === true) {
    return;
  }
  const tasks = Array.isArray(input?.background_tasks)
    ? input.background_tasks
    : [];
  const runningSummary = tasks
    .filter((task) => task?.status === "running")
    .map((task) => `${task.type}: ${task.description}`)
    .join("; ");
  if (!runningSummary) {
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: `Background work is still running (${runningSummary}). Before ending the turn, take the next independent task of the plan (files it does not touch, read-only checks, records). End the turn only if none is left, and say so in one line.`,
      },
    }),
  );
}

try {
  main();
} catch {
  // fail open: an internal error must never break the session
}
process.exit(0);
