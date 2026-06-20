#!/usr/bin/env node
// Mock-install proof for nogrep.mjs — pure Node, cross-OS. Stages the hook in a FRESH install-layout
// dir, reads the PreToolUse(Bash) command straight from hooks.json, substitutes ${CLAUDE_PLUGIN_ROOT},
// and invokes it the EXACT way Claude Code does. Proves the wiring resolves and the hook fires
// standalone with ZERO runtime deps (only nogrep.mjs is copied — no jq, no sibling files).
//
//   node plugins/hooks/hooks/tests/mock-install-nogrep.mjs

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
const root = mkdtempSync(join(tmpdir(), "nogrep-install-"));
let fail = 0;

try {
  mkdirSync(join(root, "hooks"), { recursive: true });
  copyFileSync(join(SRC, "nogrep.mjs"), join(root, "hooks", "nogrep.mjs")); // ONLY the hook file

  const hooksJson = JSON.parse(readFileSync(join(SRC, "hooks.json"), "utf8"));
  let tmpl = null;
  for (const entry of hooksJson.hooks.PreToolUse || []) {
    for (const h of entry.hooks || []) {
      if (h.command && h.command.includes("nogrep")) tmpl = h.command;
    }
  }
  if (!tmpl) {
    console.error("FATAL: no nogrep PreToolUse command found in hooks.json");
    process.exit(1);
  }

  const resolved = tmpl.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
  console.log(`hooks.json template  : ${tmpl}`);
  console.log(`resolved command     : ${resolved}`);
  console.log(
    `install dir contents : ${readdirSync(join(root, "hooks")).join(", ")}\n`,
  );

  const parts = resolved.split(/\s+/);
  let prog = parts[0];
  const args = parts.slice(1);
  if (prog === "node") prog = process.execPath; // robust cross-OS resolution of the `node` literal

  const runOne = (want, label, cmd) => {
    const payload = JSON.stringify({ tool_input: { command: cmd } });
    const r = spawnSync(prog, args, { input: payload, encoding: "utf8" });
    const got = r.status === 2 ? "BLOCK" : "ALLOW";
    const line = (r.stderr || "").split("\n")[0];
    if (got === want) {
      console.log(
        `OK   ${label.padEnd(14)} exit=${r.status}  ${cmd.padEnd(22)} | ${line}`,
      );
    } else {
      console.log(`FAIL ${label.padEnd(14)} want=${want} got=${got}  ${cmd}`);
      fail++;
    }
  };

  runOne("BLOCK", "cat read", "cat x");
  runOne("BLOCK", "grep search", "grep x f");
  runOne("BLOCK", "cat>write", "cat > f");
  runOne("BLOCK", "chaining", "pnpm a && pnpm b");
  runOne("BLOCK", "bypass-dollar", "echo $(grep x)");
  runOne("ALLOW", "ls", "ls");
  runOne("ALLOW", "jq", "jq . package.json");
  runOne("ALLOW", "git-status", "git status");
  runOne("ALLOW", "pipe-into-jq", "gh pr view --json x | jq .x");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n=== Mock-install: ${fail} mismatch ===`);
process.exit(fail === 0 ? 0 : 1);
