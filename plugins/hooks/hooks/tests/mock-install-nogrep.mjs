#!/usr/bin/env node
// Mock-install proof for nogrep.mjs — pure Node, cross-OS. Stages the hook in a FRESH install-layout
// dir whose name CONTAINS A SPACE (the real cross-OS hazard: `C:\Users\My Name\…`,
// `~/Library/Application Support/…`), reads the PreToolUse(Bash) command straight from hooks.json,
// substitutes ${CLAUDE_PLUGIN_ROOT}, and invokes it the EXACT way Claude Code does. Proves the
// wiring resolves on a spaced path with ZERO runtime deps (only nogrep.mjs is copied).
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

// Find the nogrep PreToolUse command BEFORE creating any temp dir (so an early exit can't leak it).
const hooksJson = JSON.parse(readFileSync(join(SRC, "hooks.json"), "utf8"));
let tmpl = null;
for (const entry of hooksJson.hooks.PreToolUse || [])
  for (const h of entry.hooks || [])
    if (h.command && h.command.includes("nogrep")) tmpl = h.command;
if (!tmpl) {
  console.error("FATAL: no nogrep PreToolUse command found in hooks.json");
  process.exit(1);
}

// Space in the prefix → the whole proof runs from a spaced install path.
const root = mkdtempSync(join(tmpdir(), "nogrep install-"));
let fail = 0;
try {
  mkdirSync(join(root, "hooks"), { recursive: true });
  copyFileSync(join(SRC, "nogrep.mjs"), join(root, "hooks", "nogrep.mjs")); // ONLY the hook file

  const resolved = tmpl.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
  // Parse "node <path>" WITHOUT splitting on whitespace — the path may contain spaces. Split once on
  // the first space: program, then the remainder is a single path argument.
  const sp = resolved.indexOf(" ");
  let prog = sp === -1 ? resolved : resolved.slice(0, sp);
  const args = sp === -1 ? [] : [resolved.slice(sp + 1)];
  if (prog === "node") prog = process.execPath; // robust cross-OS resolution of the `node` literal

  console.log(`hooks.json template  : ${tmpl}`);
  console.log(`resolved command     : ${resolved}`);
  console.log(`install dir (spaced) : ${root}`);
  console.log(`prog                 : ${prog}`);
  console.log(`path arg             : ${args[0]}`);
  console.log(
    `install dir contents : ${readdirSync(join(root, "hooks")).join(", ")}\n`,
  );

  const runOne = (want, label, cmd) => {
    const payload = JSON.stringify({ tool_input: { command: cmd } });
    const r = spawnSync(prog, args, { input: payload, encoding: "utf8" });
    if (r.error) {
      fail++;
      console.log(`FAIL ${label.padEnd(14)} spawn error: ${r.error.message}`);
      return;
    }
    const status = r.status; // null if killed by a signal
    const got =
      status === 2 ? "BLOCK" : status === 0 ? "ALLOW" : `EXIT(${status})`;
    const line = (r.stderr || "").split("\n")[0];
    if (got === want) {
      console.log(
        `OK   ${label.padEnd(14)} exit=${status}  ${cmd.padEnd(22)} | ${line}`,
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
  runOne("BLOCK", "sudo-wrap", "sudo grep x");
  runOne("ALLOW", "ls", "ls");
  runOne("ALLOW", "jq", "jq . package.json");
  runOne("ALLOW", "git-status", "git status");
  runOne("ALLOW", "pipe-into-jq", "gh pr view --json x | jq .x");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n=== Mock-install (spaced path): ${fail} mismatch ===`);
process.exit(fail === 0 ? 0 : 1);
