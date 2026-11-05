#!/usr/bin/env node
// FULL-SCALE validation for no-bash.mjs. Unlike the hand-picked fixtures (run-no-bash-tests /
// redteam), this does NOT trust the author's enumeration: it cross-checks the hook against an
// INDEPENDENT POSIX parsing oracle (python3 `shlex`, via oracle.py) and against seeded-fuzz
// invariants. It imports scan() in-process so 6k+ cases (18k+ checks) run in well under a second.
//
//   node plugins/hooks/hooks/tests/validate-no-bash.mjs            # default seed
//   node plugins/hooks/hooks/tests/validate-no-bash.mjs 12345      # explicit seed
//
// Three checks:
//   A. labeled corpus      — each case carries the expected verdict; assert hook agrees.
//   B. shlex-oracle differential — for pure-tokenization cases, derive the expected (BLOCK/ALLOW)
//      from shlex's parse (quotes/escapes/separators resolved) INDEPENDENTLY of the labels, and
//      assert the hook agrees. This is the check that catches "the author's model of bash is wrong"
//      — e.g. the single-quote escape regression (`echo 'a\' ; cat secret`).
//   C. seeded fuzz         — random tool/quote/separator combinations checked against invariants.

import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

// Hook under test defaults to the sibling no-bash.mjs; NO_BASH_HOOK=<path> points it elsewhere (used
// to prove this harness has TEETH by running it against a deliberately-buggy copy).
const hookSpec = process.env.NO_BASH_HOOK
  ? pathToFileURL(resolve(process.env.NO_BASH_HOOK)).href
  : new URL("../no-bash.mjs", import.meta.url).href;
const { scan } = await import(hookSpec);

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE = join(HERE, "oracle.py");

let pass = 0;
let fail = 0;
const fails = [];
const oneline = (input) => input.replace(/\n/g, "\\n");
function check(passed, label, detail) {
  if (passed) {
    pass++;
  } else {
    fail++;
    fails.push(`FAIL [${label}] ${detail}`);
  }
}

// hook verdict: "BLOCK"/"ALLOW" + reason tag
function getVerdict(command) {
  const result = scan(command);
  return {
    verdict: result ? "BLOCK" : "ALLOW",
    reason: result ? result.tag : null,
  };
}

// ---------------------------------------------------------------------------
// Corpus generation. Each case: { cmd, expect, reason|null, oracleable, note }
// oracleable = a pure-tokenization case (no $()/backtick/procsub/bash -c/heredoc, no wrapper/path/
// VAR/group/backslash on the command word) where shlex can independently derive the verdict.
// ---------------------------------------------------------------------------
const cases = [];
const add = (cmd, expect, reason, oracleable, note) =>
  cases.push({
    cmd,
    expect,
    reason: reason || null,
    oracleable: !!oracleable,
    note,
  });

const SEARCH = {
  grep: "bash-grep",
  egrep: "bash-egrep",
  fgrep: "bash-fgrep",
  rg: "bash-rg",
  head: "bash-head",
  tail: "bash-tail",
  find: "bash-find",
  awk: "bash-awk",
  wc: "bash-wc",
};
const ARG = {
  grep: "foo f",
  egrep: "foo f",
  fgrep: "foo f",
  rg: "foo f",
  head: "-5 f",
  tail: "-5 f",
  find: ". -name x",
  awk: "p f",
  wc: "-l f",
};

// 1) banned search tools — active (BLOCK) and inert-in-quotes (ALLOW), across positions/quoting
for (const [tool, reason] of Object.entries(SEARCH)) {
  const arg = ARG[tool];
  add(`${tool} ${arg}`, "BLOCK", reason, true, "bare");
  add(`timeout 5 ${tool} ${arg}`, "BLOCK", reason, false, "wrap:timeout");
  add(`env ${tool} ${arg}`, "BLOCK", reason, false, "wrap:env");
  add(`\\${tool} ${arg}`, "BLOCK", reason, false, "backslash-escape");
  add(`/usr/bin/${tool} ${arg}`, "BLOCK", reason, false, "abs-path");
  add(`FOO=bar ${tool} ${arg}`, "BLOCK", reason, false, "var-prefix");
  add(`(${tool} ${arg})`, "BLOCK", reason, false, "subshell");
  for (const sep of ["&&", "||", ";", "|"]) {
    add(`echo hi ${sep} ${tool} ${arg}`, "BLOCK", reason, true, `after ${sep}`);
  }
  // the single-quote-escape bug class: `'a\'` closes, then the tool is a real command
  add(
    `echo 'a\\' ; ${tool} ${arg}`,
    "BLOCK",
    reason,
    true,
    "sq-trailing-backslash",
  );
  // inert: tool buried in a quote → not a command → ALLOW
  add(`echo "${tool} ${arg}"`, "ALLOW", null, true, "in-dquote");
  add(`echo '${tool} ${arg}'`, "ALLOW", null, true, "in-squote");
  add(`echo "x; ${tool} ${arg}"`, "ALLOW", null, true, "sep+tool-in-dquote");
  add(
    `echo "say \\"${tool} ${arg}\\""`,
    "ALLOW",
    null,
    true,
    "escaped-inner-quotes",
  );
}

// 2) cat read/write routing
add("cat f", "BLOCK", "cat-read", true, "cat bare");
add("cat f > out.txt", "BLOCK", "cat-write", false, "cat stdout-write");
add("cat f >> out.txt", "BLOCK", "cat-write", false, "cat append");
add("cat f 2>/dev/null", "BLOCK", "cat-read", false, "cat stderr-redirect");
add("cat f 2>&1", "BLOCK", "cat-read", false, "cat 2>&1");
add("cat <<< 'x'", "BLOCK", "cat-read", false, "cat here-string");
add("cat > f <<EOF\nx\nEOF", "BLOCK", "cat-write", false, "cat heredoc");
add('echo "cat f"', "ALLOW", null, true, "cat in quote");

// 3) sed reader vs substitution
add("sed -n 1,5p f", "BLOCK", "sed-read", false, "sed -n");
add("sed 5p f", "BLOCK", "sed-read", false, "sed Np");
add("sed s/a/b/ f", "ALLOW", null, false, "sed substitution");
add("sed 's/a/b/g' f", "ALLOW", null, false, "sed substitution quoted");

// 3b) perl is banned outright; sed -i stays the sanctioned in-place edit
add("perl -ne 'print if /x/' f", "BLOCK", "bash-perl", false, "perl -ne");
add("perl -lne 'print' f", "BLOCK", "bash-perl", false, "perl cluster");
add("perl -pi -e 's/a/b/' f", "BLOCK", "bash-perl", false, "perl in-place");
add("perl -e 'print 1'", "BLOCK", "bash-perl", false, "perl -e script");
add("/usr/bin/perl -ne 'x' f", "BLOCK", "bash-perl", false, "perl abs path");
add("sed -i 's/a/b/' f", "ALLOW", null, false, "sed in-place");
add("ruby script.rb", "ALLOW", null, false, "ruby not banned");

// 4) git mutate (BLOCK) vs read/inspection (ALLOW)
for (const write of [
  "commit -m x",
  "push origin main",
  "reset --hard HEAD~1",
  "stash",
  "stash pop",
  "clean -fd",
  "apply p.patch",
  "branch -D feature",
  "worktree add ../w main",
  "submodule update --init",
  "gc",
  "merge x",
  "rebase main",
  "cherry-pick abc",
  "revert abc",
  "checkout main",
  "switch main",
  "restore f",
  "remote add o url",
  "remote rm o",
  "pull",
  "fetch origin",
  "add .",
  "rm f",
  "init",
  "clone url",
  "-C /r commit -m x",
  "-c k=v commit -m x",
  "--no-pager add .",
]) {
  add(`git ${write}`, "BLOCK", "git-mutation", false, `git mutate: ${write}`);
}
add("git grep foo", "BLOCK", "bash-grep", false, "git grep");
for (const readCommand of [
  "status",
  "log --oneline",
  "diff",
  "show HEAD",
  "mv a b",
  "stash list",
  "stash show -p",
  "tag -l",
  "tag",
  "tag v1.0.0",
  "config --get user.name",
  "config --list",
  "config user.name x",
  "clean -n",
  "clean --dry-run",
  "apply --check p.patch",
  "apply --stat p.patch",
  "fetch --dry-run",
  "branch -a",
  "branch",
  "worktree list",
  "submodule status",
  "remote -v",
  "-C /r log",
]) {
  add(`git ${readCommand}`, "ALLOW", null, false, `git read: ${readCommand}`);
}

// 5) command builtin
add("command grep x", "BLOCK", "command-builtin", false, "command exec bypass");
add("command -v node", "ALLOW", null, false, "command -v");

// 6) pre-scan arms (substitution / shell-wrap / shellout) — NOT oracleable (shlex won't expand)
add("echo $(grep x f)", "BLOCK", "dollar-sub", false, "dollar-sub");
add("echo `cat f`", "BLOCK", "backtick-sub", false, "backtick-sub");
add("diff <(cat a) <(cat b)", "BLOCK", "procsub", false, "procsub");
add('bash -c "grep x"', "BLOCK", "bashc-banned", false, "bashc plain");
add('bash -lc "cat f"', "BLOCK", "bashc-banned", false, "bashc -lc");
add('sh -xc "cat f"', "BLOCK", "bashc-banned", false, "shc -xc");
add('bash -c "sed -n 1,5p f"', "BLOCK", "bashc-sed-read", false, "bashc sed");
add(
  "node -e \"require('child_process').execSync('grep x')\"",
  "BLOCK",
  "node-shellout",
  false,
  "node shellout",
);
add(
  "python3 -c \"import subprocess; subprocess.run(['cat'])\"",
  "BLOCK",
  "python-shellout",
  false,
  "py shellout",
);
add('bash -c "echo cat"', "ALLOW", null, false, "bashc echo cat (no banned)");

// 7) chaining vs single-logical-command
add("pnpm build && pnpm test", "BLOCK", "chaining", true, "chain &&");
add("echo a ; echo b", "BLOCK", "chaining", true, "chain ;");
add("true || echo b", "BLOCK", "chaining", true, "chain ||");
add('echo "a\nb\nc"', "ALLOW", null, false, "multiline in quotes");
add("dex a\ndex b\ndex c", "BLOCK", "chaining", false, "bare-newline = 3 cmds");
add(
  "docker run --rm \\\n  -v /d:/d img",
  "ALLOW",
  null,
  false,
  "line-continuation",
);
add('gh pr create --body "a\nb"', "ALLOW", null, false, "multiline body");
add("psql db <<SQL\nSELECT 1;\nSQL", "ALLOW", null, false, "non-cat heredoc");
add("echo hi > /tmp/x", "ALLOW", null, true, "redirect");
add("gh pr view --json t | jq .t", "ALLOW", null, true, "pipe into jq");

// allowed singles
for (const command of [
  "pnpm test",
  "ls -la",
  "jq .x f.json",
  "make build",
  "echo hi",
]) {
  add(command, "ALLOW", null, true, "legit single");
}

// 8) space-less operators — the hook splits on |/&&/||/; regardless of spacing; the oracle must too
add("true|grep x", "BLOCK", "bash-grep", true, "spaceless pipe");
add("echo a&&grep x", "BLOCK", "bash-grep", true, "spaceless &&");
add("echo a;cat f", "BLOCK", "cat-read", true, "spaceless ;");
add("echo a||head -5 f", "BLOCK", "bash-head", true, "spaceless ||");
add("echo a|jq .x", "ALLOW", null, true, "spaceless pipe into jq");

// ---------------------------------------------------------------------------
// Seeded fuzz (deterministic). Build random pure-tokenization commands and tag the INTENT, then
// check invariants. Math.random is avoided for reproducibility — mulberry32 seeded from argv.
// ---------------------------------------------------------------------------
const seed = (process.argv[2] ? parseInt(process.argv[2], 10) : 0xc0ffee) >>> 0;
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);
const pick = (arr) => arr[Math.floor(random() * arr.length)];

const SEARCH_TOOLS = Object.keys(SEARCH);
const ALLOWED_TOOLS = ["ls", "echo", "jq", "pnpm", "make", "true"];
const SEPS = ["&&", "||", ";"]; // command separators (chaining)
const FUZZ_N = 6000;
const fuzz = [];
for (let i = 0; i < FUZZ_N; i++) {
  const shape = Math.floor(random() * 5);
  if (shape === 0) {
    // banned tool bare → BLOCK (P1)
    const tool = pick(SEARCH_TOOLS);
    fuzz.push({ cmd: `${tool} ${ARG[tool]}`, inv: "P1-block", tool });
  } else if (shape === 1) {
    // banned tool buried in a quote of echo → ALLOW (P2)
    const tool = pick(SEARCH_TOOLS);
    const quoteChar = pick(['"', "'"]);
    fuzz.push({
      cmd: `echo ${quoteChar}x ${tool} ${ARG[tool]}${quoteChar}`,
      inv: "P2-allow",
      tool,
    });
  } else if (shape === 2) {
    // two allowed commands joined by a separator → BLOCK chaining
    const separator = pick(SEPS);
    fuzz.push({
      cmd: `${pick(ALLOWED_TOOLS)} a ${separator} ${pick(ALLOWED_TOOLS)} b`,
      inv: "P1-block",
    });
  } else if (shape === 3) {
    // allowed tool + redirect or pipe-into-jq → ALLOW (P4)
    const tail = pick(["2>&1", "> /tmp/x", "| jq .x"]);
    fuzz.push({ cmd: `${pick(ALLOWED_TOOLS)} a ${tail}`, inv: "P4-allow" });
  } else {
    // single-quote-trailing-backslash then a banned tool → BLOCK (the regression class)
    const tool = pick(SEARCH_TOOLS);
    fuzz.push({
      cmd: `echo 'x\\' ${pick(SEPS)} ${tool} ${ARG[tool]}`,
      inv: "P1-block",
      tool,
    });
  }
}

// ---------------------------------------------------------------------------
// Run the shlex oracle once over every oracleable + fuzz command.
// ---------------------------------------------------------------------------
const oracleCmds = [
  ...cases.filter((c) => c.oracleable).map((c) => c.cmd),
  ...fuzz.map((f) => f.cmd),
];
let oracleByCmd = null;
const oracleRun = spawnSync("python3", [ORACLE], {
  input: oracleCmds.join("\n") + "\n",
  encoding: "utf8",
});
if (oracleRun.status === 0 && oracleRun.stdout) {
  oracleByCmd = new Map();
  for (const line of oracleRun.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      oracleByCmd.set(parsed.cmd, parsed);
    } catch {
      /* ignore */
    }
  }
} else {
  console.log(
    "NOTE: python3/shlex oracle unavailable — skipping oracle checks (Check B).",
  );
}

// Derive an INDEPENDENT verdict from a shlex parse (banned search tool or cat as a real command
// word in any top-level segment → BLOCK; ≥2 real ;/&&/||-segments → BLOCK chaining; else ALLOW).
// Both the segment split AND the separator count come from the SAME `parsed.toks` stream, so they cannot
// disagree on space-less operators (`true|grep x` → ["true","|","grep","x"] → grep IS the 2nd
// segment's first word → BLOCK, matching the hook).
const BANNED_WORDS = new Set([...SEARCH_TOOLS, "cat"]);
function oracleVerdict(parsed) {
  if (!parsed || parsed.error || !parsed.toks) return null; // malformed / unparseable → can't oracle
  const segments = [[]];
  for (const token of parsed.toks) {
    if ([";", "&&", "||", "|", "&"].includes(token)) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(token);
    }
  }
  for (const segment of segments) {
    if (segment.length && BANNED_WORDS.has(segment[0])) return "BLOCK";
  }
  // chaining: `segsep` is a COMMAND COUNT, not a separator count — oracle.py sets it to
  // 1 + (number of top-level `;`/`&&`/`||` tokens), so `>= 2` means two or more commands joined by
  // those operators (pipe `|` and single `&` are NOT chaining per the hook's policy, so not counted).
  if (parsed.segsep && parsed.segsep >= 2) return "BLOCK";
  return "ALLOW";
}

// ---------------------------------------------------------------------------
// Check A — labeled corpus
// ---------------------------------------------------------------------------
for (const c of cases) {
  const result = getVerdict(c.cmd);
  const verdictMatches = result.verdict === c.expect;
  const reasonMatches =
    c.expect === "ALLOW" || c.reason === null || result.reason === c.reason;
  check(
    verdictMatches && reasonMatches,
    `A:${c.note}`,
    `want ${c.expect}${c.reason ? "/" + c.reason : ""} got ${result.verdict}${result.reason ? "/" + result.reason : ""}  ::  ${oneline(c.cmd)}`,
  );
}

// ---------------------------------------------------------------------------
// Check B — shlex-oracle differential (independent of the labels)
// ---------------------------------------------------------------------------
let oracleChecked = 0;
if (oracleByCmd) {
  for (const c of cases.filter((c) => c.oracleable)) {
    const parsed = oracleByCmd.get(c.cmd);
    const expected = oracleVerdict(parsed);
    if (expected === null) continue;
    oracleChecked++;
    const result = getVerdict(c.cmd);
    check(
      result.verdict === expected,
      `B:${c.note}`,
      `oracle says ${expected}, hook says ${result.verdict}${result.reason ? "/" + result.reason : ""}  ::  ${oneline(c.cmd)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Check C — fuzz invariants
// ---------------------------------------------------------------------------
for (const f of fuzz) {
  let result;
  try {
    result = getVerdict(f.cmd);
  } catch (e) {
    check(false, `C:throw`, `scan threw: ${e.message}  ::  ${oneline(f.cmd)}`);
    continue;
  }
  // P3: verdict is always BLOCK or ALLOW
  check(
    result.verdict === "BLOCK" || result.verdict === "ALLOW",
    `C:P3`,
    `bad verdict ${result.verdict}  ::  ${oneline(f.cmd)}`,
  );
  const expectedVerdict = f.inv === "P1-block" ? "BLOCK" : "ALLOW";
  check(
    result.verdict === expectedVerdict,
    `C:${f.inv}`,
    `expected ${expectedVerdict} got ${result.verdict}  ::  ${oneline(f.cmd)}`,
  );
  // cross-check fuzz against the oracle too (independent)
  if (oracleByCmd) {
    const expected = oracleVerdict(oracleByCmd.get(f.cmd));
    if (expected !== null) {
      check(
        result.verdict === expected,
        `C:oracle`,
        `oracle ${expected} vs hook ${result.verdict}  ::  ${oneline(f.cmd)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
console.log(
  `validate-no-bash: ${cases.length} labeled + ${oracleChecked} oracle-checked + ${fuzz.length} fuzz   (seed=${seed})`,
);
if (fails.length) {
  console.log(`\n${fails.length} FAILURES:`);
  for (const f of fails.slice(0, 40)) console.log("  " + f);
  if (fails.length > 40) console.log(`  … and ${fails.length - 40} more`);
}
console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
