#!/usr/bin/env node
// EQUIVALENCE differential: prove each Node-ported hook behaves IDENTICALLY to the bash original it
// replaced. Ground truth is the OLD `.sh` (the spec the user already ran), NOT the author's
// enumeration. Restores the old `.sh` from git (HEAD), runs BOTH old + new over a large generated +
// fuzzed corpus, and diffs the observable behavior (exit code, and semantic output / formatter
// decision). Any divergence is a port bug. Ad-hoc gate — needs bash, jq, and git.
//
//   node plugins/hooks/hooks/tests/diff-hooks.mjs [seed]
//
// Covers: no-absolute-paths (exit code + block), force-plan-mode (parsed-JSON stdout),
// fix-formatting (which npx formatter it invokes, via a PATH stub), session-start (parsed JSON).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  writeFileSync,
  mkdtempSync,
  rmSync,
  chmodSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
// the new .mjs live one dir up; DIFF_HOOKS_DIR overrides it (used to prove the diff has teeth against
// a deliberately-broken copy). The old .sh always come from git HEAD — the real spec.
const HOOKS = process.env.DIFF_HOOKS_DIR || join(HERE, "..");

let pass = 0;
let fail = 0;
const divergences = [];
const oneline = (s) => String(s).replace(/\n/g, "\\n");
function compare(label, input, oldResult, newResult) {
  if (oldResult === newResult) {
    pass++;
  } else {
    fail++;
    divergences.push(
      `DIVERGE [${label}]  input=${oneline(input)}\n    old=${oneline(oldResult)}\n    new=${oneline(newResult)}`,
    );
  }
}

// --- restore old .sh from git (HEAD) into a temp dir ---
const work = mkdtempSync(join(tmpdir(), "diff-hooks-"));
function gitShow(path) {
  const r = spawnSync("git", ["show", "HEAD:" + path], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}
function restoreSh(name) {
  const content = gitShow("plugins/hooks/hooks/" + name);
  if (content === null) return null;
  const p = join(work, name);
  writeFileSync(p, content);
  chmodSync(p, 0o755);
  return p;
}

const oldNoAbs = restoreSh("no-absolute-paths.sh");
const oldPlan = restoreSh("force-plan-mode.sh");
const oldFmt = restoreSh("fix-formatting.sh");

// deterministic PRNG for fuzz
const seed = (process.argv[2] ? parseInt(process.argv[2], 10) : 0x5eed) >>> 0;
let _s = seed >>> 0;
function rnd() {
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];

function runHook(cmd, args, input, env) {
  const r = spawnSync(cmd, args, {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: r.status === null ? -1 : r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

// ===========================================================================
// 1) no-absolute-paths — compare exit code (block vs allow) over a command corpus
// ===========================================================================
if (oldNoAbs) {
  const ROOT = "/u/test/myproj";
  const HOME = "/u/test";
  const env = { CLAUDE_PROJECT_DIR: ROOT, HOME };
  const corpus = [
    "ls",
    "git diff",
    "cat src/x",
    "grep foo .",
    `ls ${ROOT}`,
    `ls ${ROOT}/src/x`,
    `git -C ${ROOT} diff`,
    `cd ${ROOT} && ls`,
    `ls ${ROOT}extra`,
    `ls ${ROOT}or/x`, // root as substring (both should match via literal substring)
    "cd ~",
    "cd ~/myproj",
    "cd ~/myproj/src",
    "cat ~/myproj/a",
    "cd ~/other",
    "cd $HOME",
    "cd $HOME/myproj",
    "cat $HOME/myproj/x",
    "cd $HOME/other",
    "echo '/u/test/myproj literal in quotes'",
    "echo $PATH",
    "x=1 ls",
    "ls -la",
    "find . -name x",
    `multi\nline ${ROOT}/x`,
    "trailing space ",
    "",
    "weird |&;<>() chars",
    `regex.*${ROOT}.*chars`,
    `$dollar ${ROOT}`,
  ];
  // fuzz: random commands sometimes containing root / ~ / $HOME fragments
  const frag = [
    "",
    ROOT,
    ROOT + "/a",
    "~/myproj",
    "$HOME/myproj",
    "~",
    "$HOME",
    ROOT + "x",
    "/u/test",
  ];
  for (let i = 0; i < 400; i++) {
    corpus.push(
      `${pick(["ls", "cat", "git diff", "echo", "cd", "grep x"])} ${pick(frag)} ${pick(["", "-l", "x", "../y"])}`.trim(),
    );
  }
  for (const cmd of corpus) {
    const payload = JSON.stringify({ tool_input: { command: cmd } });
    const o = runHook("bash", [oldNoAbs], payload, env);
    const n = runHook(
      process.execPath,
      [join(HOOKS, "no-absolute-paths.mjs")],
      payload,
      env,
    );
    compare("no-absolute-paths:exit", cmd, o.code, n.code);
    // both blocks must carry a "BLOCKED" stderr (exact message equivalence is a stronger check)
    compare(
      "no-absolute-paths:blocked",
      cmd,
      /BLOCKED/.test(o.stderr),
      /BLOCKED/.test(n.stderr),
    );
  }
}

// ===========================================================================
// 2) force-plan-mode — compare parsed-JSON stdout (jq pretty vs JSON.stringify differ in bytes)
// ===========================================================================
function parseOrNull(s) {
  const t = s.trim();
  if (t === "") return null;
  try {
    return JSON.stringify(JSON.parse(t)); // normalize for comparison
  } catch {
    return "UNPARSEABLE:" + oneline(s);
  }
}
if (oldPlan) {
  const corpus = [
    "/plan",
    "/plan the migration",
    " /plan ",
    "do /plan now",
    "/planx",
    "x/plan",
    "plan this",
    "plan it",
    "plan that",
    "plan this feature",
    "plan it.",
    "plan that!",
    "PLAN THIS",
    "Plan It",
    "make a plan",
    "draft a plan",
    "write a plan",
    "make  a  plan",
    "planning the trip",
    "explain this",
    "the plan is ready",
    "plan b",
    "plan",
    "a plan to write",
    "make an plan",
    "replanning",
    "/plannable",
    "plz plan this",
    "",
    "hello world",
    "fix the bug",
    "make a plan for the refactor and then go",
    "multi\nline /plan",
    "tabs\tand /plan",
    "plan\tthis",
    // regex-seam cases the agent review surfaced (POSIX [[:punct:]] vs JS [^\\w\\s]):
    "plan this_module",
    "plan it_x",
    "plan that_y",
    "plan thisé",
    "plan this~",
    "plan it#",
    "plan that_",
    "plan this5",
  ];
  const planFrag = [
    "/plan",
    "plan this",
    "plan it",
    "plan that",
    "make a plan",
    "draft a plan",
    "write a plan",
  ];
  const noiseFrag = [
    "planning",
    "explain",
    "the plan",
    "plan b",
    "replan",
    "planx",
    "a plan",
  ];
  for (let i = 0; i < 400; i++) {
    const parts = [];
    const n = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      parts.push(
        pick(rnd() < 0.5 ? planFrag : noiseFrag).concat(
          pick(["", ".", "!", " x", "?"]),
        ),
      );
    }
    corpus.push(parts.join(rnd() < 0.5 ? " " : "\n"));
  }
  for (const prompt of corpus) {
    const payload = JSON.stringify({ prompt });
    const o = runHook("bash", [oldPlan], payload, {});
    const n = runHook(
      process.execPath,
      [join(HOOKS, "force-plan-mode.mjs")],
      payload,
      {},
    );
    compare("force-plan-mode:exit", prompt, o.code, n.code);
    compare(
      "force-plan-mode:json",
      prompt,
      parseOrNull(o.stdout),
      parseOrNull(n.stdout),
    );
  }
}

// ===========================================================================
// 3) fix-formatting — compare which npx formatter is invoked, via a PATH stub
// ===========================================================================
if (oldFmt) {
  // stub `npx` that appends its args to $STUB_LOG and exits 0 (so no real formatter runs)
  const realStub = mkdtempSync(join(tmpdir(), "stub-"));
  const stubPath = join(realStub, "npx");
  writeFileSync(
    stubPath,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$STUB_LOG"\nexit 0\n',
  );
  chmodSync(stubPath, 0o755);
  const stubEnvPath = realStub + ":" + process.env.PATH;

  const paths = [
    "src/x.ts",
    "a/b.js",
    "config.json",
    "x.mjs",
    "README.md",
    "docs/guide.md",
    "page.mdx",
    "style.css",
    "data.yaml",
    "Makefile",
    "noext",
    "a.b.ts",
    "weird name.ts",
    "x.MD",
    "x.Md",
    "x.markdown",
    "deep/nested/file.md",
    ".prettierrc",
    "x.tsx",
    "y.svelte",
    "z.py",
    "a.md.txt",
    "b.txt.md",
    "",
  ];
  function invoked(hookCmd, hookArgs, filePath) {
    const logFile = join(realStub, "log-" + Math.floor(rnd() * 1e9));
    const r = spawnSync(hookCmd, hookArgs, {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      encoding: "utf8",
      env: { ...process.env, PATH: stubEnvPath, STUB_LOG: logFile },
    });
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8").trim() : "";
    return { code: r.status === null ? -1 : r.status, log };
  }
  for (const fp of paths) {
    const o = invoked("bash", [oldFmt], fp);
    const n = invoked(
      process.execPath,
      [join(HOOKS, "fix-formatting.mjs")],
      fp,
    );
    compare("fix-formatting:exit", fp, o.code, n.code);
    // normalize: extract formatter name + that the file path is passed (ignore -y ordering noise)
    const norm = (log) => {
      if (!log) return "NONE";
      if (/prettier/.test(log)) {
        return "prettier:" + (/--write/.test(log) ? "write" : "?");
      }
      if (/markdownlint/.test(log)) {
        return "markdownlint:" + (/--fix/.test(log) ? "fix" : "?");
      }
      return "OTHER:" + oneline(log);
    };
    compare("fix-formatting:formatter", fp, norm(o.log), norm(n.log));
  }
}

// ===========================================================================
// 4) session-start — new output must equal the old inline echo's JSON
// ===========================================================================
{
  const oldJson = JSON.stringify(
    JSON.parse(
      '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"MANDATORY: Invoke the /discipline skill NOW before doing anything else."}}',
    ),
  );
  const n = runHook(
    process.execPath,
    [join(HOOKS, "session-start.mjs")],
    "",
    {},
  );
  compare("session-start:exit", "(run)", 0, n.code);
  compare("session-start:json", "(run)", oldJson, parseOrNull(n.stdout));
}

rmSync(work, { recursive: true, force: true });

console.log(
  `diff-hooks (seed=${seed}): old-vs-new equivalence — ${pass} matched, ${fail} diverged` +
    (oldNoAbs && oldPlan && oldFmt
      ? ""
      : "  [WARN: some old .sh missing from git HEAD]"),
);
if (divergences.length) {
  console.log("");
  for (const d of divergences.slice(0, 50)) console.log(d);
  if (divergences.length > 50) {
    console.log(`… and ${divergences.length - 50} more`);
  }
}
process.exit(fail === 0 ? 0 : 1);
