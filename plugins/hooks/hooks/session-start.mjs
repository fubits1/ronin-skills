#!/usr/bin/env node
// SessionStart hook: inject the mandatory /discipline directive. Cross-OS Node port of the inline
// `echo '{...}'` previously in hooks.json — cmd.exe does not treat single quotes specially, so the
// shell form emits literal quotes and broken JSON on native Windows (#18610). Node prints it the same
// on every OS.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const sessionStartPayload = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext:
      "MANDATORY: Invoke the /discipline skill NOW before doing anything else.",
  },
};

let runAsHook = true;
try {
  runAsHook =
    realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
} catch {
  runAsHook = true;
}
if (runAsHook) {
  process.stdout.write(JSON.stringify(sessionStartPayload) + "\n");
  process.exit(0);
}
