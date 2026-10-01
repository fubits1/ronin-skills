#!/usr/bin/env node
// Mock-install proof for no-bash.mjs — pure Node, cross-OS. Stages the hook in a FRESH install-layout
// dir whose name CONTAINS A SPACE (the real cross-OS hazard: `C:\Users\My Name\…`,
// `~/Library/Application Support/…`), reads the PreToolUse(Bash) command straight from hooks.json,
// substitutes ${CLAUDE_PLUGIN_ROOT}, and invokes it the EXACT way Claude Code does. Proves the
// wiring resolves on a spaced path with ZERO runtime deps (only no-bash.mjs is copied).
//
//   node plugins/hooks/hooks/tests/mock-install-no-bash.mjs
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, ".."); // plugins/hooks/hooks
// Find the no-bash PreToolUse command BEFORE creating any temp dir (so an early exit can't leak it).
const hooksJson = JSON.parse(readFileSync(join(SRC, "hooks.json"), "utf8"));
let template = null;
for (const entry of hooksJson.hooks.PreToolUse || []) {
  for (const result of entry.hooks || []) {
    if (result.command && result.command.includes("no-bash")) {
      template = result.command;
    }
  }
}
if (!template) {
  console.error("FATAL: no no-bash PreToolUse command found in hooks.json");
  process.exit(1);
}

let pass = 0;
let fail = 0;
let base = null;
try {
  // Install layout with a SPACE in the path: <tmp>/ronin-XXXX/My Plugin Root/hooks/no-bash.mjs
  base = mkdtempSync(join(tmpdir(), "ronin-mock-"));
  const root = join(base, "My Plugin Root");
  const hooksDir = join(root, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  copyFileSync(join(SRC, "no-bash.mjs"), join(hooksDir, "no-bash.mjs"));

  // Zero-dep check: only no-bash.mjs was staged.
  const staged = readdirSync(hooksDir);
  if (staged.length === 1 && staged[0] === "no-bash.mjs") {
    console.log("PASS  [zero-dep] only no-bash.mjs staged in hooks/");
    pass++;
  } else {
    console.log(
      `FAIL  [zero-dep] unexpected staged files: ${staged.join(", ")}`,
    );
    fail++;
  }

  /**
   * substitute ${CLAUDE_PLUGIN_ROOT} → the spaced root and run it through bash (the documented
   * default hook shell), exactly as Claude Code does. only a real shell splits an unquoted root,
   * and the resulting exit 1 is a non-blocking hook error, so the hook goes silent
   */
  const command = template.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root);

  function invoke(toolCommand) {
    const result = spawnSync(command, {
      shell: "bash",
      input: JSON.stringify({ tool_input: { command: toolCommand } }),
      encoding: "utf8",
      timeout: 10000, // a hook that hangs is a failure, not a pass
    });
    return {
      code: result.status === null ? -2 : result.status,
      stderr: result.stderr || "",
    };
  }

  // A banned tool blocks (exit 2) and names the right tool — through the spaced-path wiring.
  const blocked = invoke("cat secret.txt");
  if (blocked.code === 2 && blocked.stderr.includes("Use the Read tool")) {
    console.log(
      "PASS  [spaced-path block] 'cat secret.txt' → exit 2, names Read",
    );
    pass++;
  } else {
    console.log(
      `FAIL  [spaced-path block] got exit ${blocked.code}, stderr="${blocked.stderr.split("\n")[0]}"`,
    );
    fail++;
  }

  // A legit command passes (exit 0) — through the same wiring.
  const allowed = invoke("pnpm test");
  if (allowed.code === 0) {
    console.log("PASS  [spaced-path allow] 'pnpm test' → exit 0");
    pass++;
  } else {
    console.log(
      `FAIL  [spaced-path allow] 'pnpm test' got exit ${allowed.code}`,
    );
    fail++;
  }
} finally {
  if (base) rmSync(base, { recursive: true, force: true }); // leak-free cleanup
}

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
