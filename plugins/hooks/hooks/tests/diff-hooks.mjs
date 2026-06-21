#!/usr/bin/env node
// EQUIVALENCE differential: prove each Node-ported hook behaves IDENTICALLY to the bash original it
// replaced. Ground truth is the OLD `.sh` (the spec the user already ran), NOT the author's
// enumeration. Restores the old `.sh` from git, runs BOTH old + new over a large generated + fuzzed
// corpus, and diffs the observable behavior (exit code, and semantic output / formatter decision).
// Any divergence is a port bug. Ad-hoc gate — needs bash, jq, and git.
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
// a deliberately-broken copy). The old .sh always come from git — the real spec.
const HOOKS = process.env.DIFF_HOOKS_DIR || join(HERE, "..");

let pass = 0;
let fail = 0;
const divergences = [];
const oneline = (value) => String(value).replace(/\n/g, "\\n");
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

// --- restore old .sh from git into a temp dir ---
const work = mkdtempSync(join(tmpdir(), "diff-hooks-"));
function gitShow(path) {
  // try HEAD first; once the .sh are migrated away (deleted), fall back to the last commit that had
  // them — `git rev-list -1 HEAD -- <path>` is the commit that last touched the path (the deletion if
  // deleted), so its parent `~1` holds the content. Keeps this differential durable past the commit.
  let shown = spawnSync("git", ["show", "HEAD:" + path], { encoding: "utf8" });
  if (shown.status === 0) return shown.stdout;
  const lastTouch = spawnSync("git", ["rev-list", "-1", "HEAD", "--", path], {
    encoding: "utf8",
  });
  const sha = (lastTouch.stdout || "").trim();
  if (!sha) return null;
  shown = spawnSync("git", ["show", sha + "~1:" + path], { encoding: "utf8" });
  if (shown.status === 0) return shown.stdout;
  shown = spawnSync("git", ["show", sha + ":" + path], { encoding: "utf8" });
  return shown.status === 0 ? shown.stdout : null;
}
function restoreSh(name) {
  const content = gitShow("plugins/hooks/hooks/" + name);
  if (content === null) return null;
  const shPath = join(work, name);
  writeFileSync(shPath, content);
  chmodSync(shPath, 0o755);
  return shPath;
}

const oldNoAbs = restoreSh("no-absolute-paths.sh");
const oldPlan = restoreSh("force-plan-mode.sh");
const oldFmt = restoreSh("fix-formatting.sh");

// deterministic PRNG (mulberry32) for fuzz
const seed = (process.argv[2] ? parseInt(process.argv[2], 10) : 0x5eed) >>> 0;
let prngState = seed >>> 0;
function nextRandom() {
  prngState = (prngState + 0x6d2b79f5) | 0;
  let hash = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
  hash = (hash + Math.imul(hash ^ (hash >>> 7), 61 | hash)) ^ hash;
  return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
}
const pick = (choices) => choices[Math.floor(nextRandom() * choices.length)];

function runHook(command, args, input, env) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: result.status === null ? -1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
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
  const fragments = [
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
      `${pick(["ls", "cat", "git diff", "echo", "cd", "grep x"])} ${pick(fragments)} ${pick(["", "-l", "x", "../y"])}`.trim(),
    );
  }
  for (const command of corpus) {
    const payload = JSON.stringify({ tool_input: { command } });
    const oldRun = runHook("bash", [oldNoAbs], payload, env);
    const newRun = runHook(
      process.execPath,
      [join(HOOKS, "no-absolute-paths.mjs")],
      payload,
      env,
    );
    compare("no-absolute-paths:exit", command, oldRun.code, newRun.code);
    // both blocks must carry a "BLOCKED" stderr (a stronger check than the exit code alone)
    compare(
      "no-absolute-paths:blocked",
      command,
      /BLOCKED/.test(oldRun.stderr),
      /BLOCKED/.test(newRun.stderr),
    );
  }
}

// ===========================================================================
// 2) force-plan-mode — compare parsed-JSON stdout (jq pretty vs JSON.stringify differ in bytes)
// ===========================================================================
function parseOrNull(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === "") return null;
  try {
    return JSON.stringify(JSON.parse(trimmed)); // normalize for comparison
  } catch {
    return "UNPARSEABLE:" + oneline(stdout);
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
    // a legit "make a plan" preceded by a word (must still match in BOTH; the divergent substring
    // cases like "remake a planet" are intentional improvements over the old .sh, so they live only
    // in run-hook-tests, not here — this differential asserts old==new):
    "please make a plan",
  ];
  const planFragments = [
    "/plan",
    "plan this",
    "plan it",
    "plan that",
    "make a plan",
    "draft a plan",
    "write a plan",
  ];
  const noiseFragments = [
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
    const partCount = 1 + Math.floor(nextRandom() * 3);
    for (let j = 0; j < partCount; j++) {
      parts.push(
        pick(nextRandom() < 0.5 ? planFragments : noiseFragments).concat(
          pick(["", ".", "!", " x", "?"]),
        ),
      );
    }
    corpus.push(parts.join(nextRandom() < 0.5 ? " " : "\n"));
  }
  for (const prompt of corpus) {
    const payload = JSON.stringify({ prompt });
    const oldRun = runHook("bash", [oldPlan], payload, {});
    const newRun = runHook(
      process.execPath,
      [join(HOOKS, "force-plan-mode.mjs")],
      payload,
      {},
    );
    compare("force-plan-mode:exit", prompt, oldRun.code, newRun.code);
    compare(
      "force-plan-mode:json",
      prompt,
      parseOrNull(oldRun.stdout),
      parseOrNull(newRun.stdout),
    );
  }
}

// ===========================================================================
// 3) fix-formatting — compare which npx formatter is invoked, via a PATH stub
// ===========================================================================
if (oldFmt) {
  // stub `npx` that appends its args to $STUB_LOG and exits 0 (so no real formatter runs). Nested
  // under `work` so the single rmSync(work) at the end cleans it up too (no leaked temp dir).
  const stubDir = mkdtempSync(join(work, "stub-"));
  const stubPath = join(stubDir, "npx");
  writeFileSync(
    stubPath,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$STUB_LOG"\nexit 0\n',
  );
  chmodSync(stubPath, 0o755);
  const stubEnvPath = stubDir + ":" + process.env.PATH;

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
  function invokedFormatter(hookCommand, hookArgs, filePath) {
    const logFile = join(stubDir, "log-" + Math.floor(nextRandom() * 1e9));
    const result = spawnSync(hookCommand, hookArgs, {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      encoding: "utf8",
      env: { ...process.env, PATH: stubEnvPath, STUB_LOG: logFile },
    });
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8").trim() : "";
    return { code: result.status === null ? -1 : result.status, log };
  }
  // normalize the logged npx invocation to formatter + mode (ignore -y ordering noise)
  const normalize = (log) => {
    if (!log) return "NONE";
    if (/prettier/.test(log)) {
      return "prettier:" + (/--write/.test(log) ? "write" : "?");
    }
    if (/markdownlint/.test(log)) {
      return "markdownlint:" + (/--fix/.test(log) ? "fix" : "?");
    }
    return "OTHER:" + oneline(log);
  };
  for (const filePath of paths) {
    const oldRun = invokedFormatter("bash", [oldFmt], filePath);
    const newRun = invokedFormatter(
      process.execPath,
      [join(HOOKS, "fix-formatting.mjs")],
      filePath,
    );
    compare("fix-formatting:exit", filePath, oldRun.code, newRun.code);
    compare(
      "fix-formatting:formatter",
      filePath,
      normalize(oldRun.log),
      normalize(newRun.log),
    );
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
  const newRun = runHook(
    process.execPath,
    [join(HOOKS, "session-start.mjs")],
    "",
    {},
  );
  compare("session-start:exit", "(run)", 0, newRun.code);
  compare("session-start:json", "(run)", oldJson, parseOrNull(newRun.stdout));
}

rmSync(work, { recursive: true, force: true });

console.log(
  `diff-hooks (seed=${seed}): old-vs-new equivalence — ${pass} matched, ${fail} diverged` +
    (oldNoAbs && oldPlan && oldFmt
      ? ""
      : "  [WARN: some old .sh missing from git history]"),
);
if (divergences.length) {
  console.log("");
  for (const divergence of divergences.slice(0, 50)) console.log(divergence);
  if (divergences.length > 50) {
    console.log(`… and ${divergences.length - 50} more`);
  }
}
process.exit(fail === 0 ? 0 : 1);
