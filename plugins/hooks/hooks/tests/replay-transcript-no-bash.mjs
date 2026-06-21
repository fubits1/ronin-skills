#!/usr/bin/env node
// AD-HOC validation gate (not CI — ships no data, takes a path). Replays the REAL Bash commands a
// coding agent actually issued (mined from Claude Code session transcripts) through the hook and
// reports what BLOCKS, grouped by reason. This is the only false-positive oracle whose ground truth
// is NOT the author's enumeration: a legit everyday command that BLOCKS here is a real false positive.
//
//   node plugins/hooks/hooks/tests/replay-transcript-no-bash.mjs <file-or-dir.jsonl ...>
//
// With no args it tries this repo's transcript dir under ~/.claude/projects/. Pass paths explicitly
// to scan other corpora. Distinct commands are deduped; blocks are listed per reason for triage.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../no-bash.mjs";

const args = process.argv.slice(2);
const targets = args.length
  ? args
  : [
      "../../../../.claude/projects/-Users-fubits-Developer-FOSS-skills-ronin-skills",
    ];

function jsonlFiles(p) {
  let st;
  try {
    st = statSync(p);
  } catch {
    return [];
  }
  if (st.isDirectory())
    return readdirSync(p)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(p, f));
  return p.endsWith(".jsonl") ? [p] : [];
}

// recursively collect every Bash tool_use command in a parsed transcript record
function collectBash(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectBash(x, out);
    return;
  }
  if (
    node.type === "tool_use" &&
    node.name === "Bash" &&
    node.input &&
    typeof node.input.command === "string"
  ) {
    out.add(node.input.command);
  }
  for (const k of Object.keys(node)) collectBash(node[k], out);
}

const files = targets.flatMap(jsonlFiles);
if (!files.length) {
  console.log("No .jsonl transcripts found at: " + targets.join(", "));
  process.exit(0);
}

const cmds = new Set();
let lines = 0;
for (const f of files) {
  let txt;
  try {
    txt = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    lines++;
    try {
      collectBash(JSON.parse(line), cmds);
    } catch {
      /* skip non-JSON / partial lines */
    }
  }
}

const byReason = new Map();
let allowed = 0;
for (const c of cmds) {
  let r;
  try {
    r = scan(c);
  } catch (e) {
    r = { tag: "THREW:" + e.message };
  }
  if (!r) {
    allowed++;
    continue;
  }
  if (!byReason.has(r.tag)) byReason.set(r.tag, []);
  byReason.get(r.tag).push(c);
}

const ol = (s) => s.replace(/\n/g, "\\n");
console.log(
  `Replayed ${cmds.size} distinct Bash commands from ${files.length} transcript(s) (${lines} lines).`,
);
console.log(`  ALLOW: ${allowed}    BLOCK: ${cmds.size - allowed}\n`);
const order = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [reason, list] of order) {
  console.log(`reason=${reason}  (${list.length})`);
  for (const c of list.slice(0, 12)) console.log(`    ${ol(c).slice(0, 160)}`);
  if (list.length > 12) console.log(`    … and ${list.length - 12} more`);
  console.log("");
}
// Always exit 0 — this is a triage report, not a pass/fail gate (real commands have no labels).
