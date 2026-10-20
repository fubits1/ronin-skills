/**
 * functional contract of decide(): every case runs in-process against tests/fixtures/settings.json
 * and asserts the outcome class
 *   DENY   -> exit 2 + stderr
 *   ALLOW  -> exit 0 + "permissionDecision":"allow"
 *   ASK    -> exit 0 + "permissionDecision":"ask"
 *   SILENT -> exit 0 + no output (hook defers to snip / normal flow)
 * the spawned-process contract (stdin, exit codes) lives in tests/index.test.js
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { loadRules } from "./rules.js";
import { decide } from "./decide.js";

const FIXTURES = join(import.meta.dirname, "..", "tests", "fixtures");
const RULES = loadRules([
  { path: join(FIXTURES, "settings.json"), grants: true },
]);
const NO_RULES = { allow: [], deny: [], ask: [] };
const SNIP = '"/opt/homebrew/Caskroom/snip/0.22.0/snip" run -- ';

function outcome({ exitCode, stdout }) {
  if (exitCode === 2) {
    return "DENY";
  }
  if (stdout.includes('"permissionDecision":"ask"')) {
    return "ASK";
  }
  return stdout.includes('"permissionDecision":"allow"') ? "ALLOW" : "SILENT";
}

function cases(name, table, rules = RULES) {
  describe(name, () => {
    for (const [expected, command] of table) {
      test(`${expected}: ${JSON.stringify(command)}`, () => {
        const result = decide(
          { tool_name: "Bash", tool_input: { command } },
          rules,
        );
        assert.equal(outcome(result), expected);
      });
    }
  });
}

// NO `*`-prefixed twins in the fixture: plain rules must fire on the original command
cases("deny re-application", [
  ["DENY", "gh api -X DELETE repos/fubits1/x"],
  ["DENY", "gh repo delete fubits1/x"],
  ["DENY", SNIP + "gh api -X DELETE repos/x"],
  ["DENY", "timeout 30 gh repo delete fubits1/x"],
  ["DENY", "timeout 30s gh repo delete fubits1/x"],
  ["DENY", "timeout -s KILL 5 gh repo delete fubits1/x"],
  ["DENY", "env -u FOO gh repo delete fubits1/x"],
  ["DENY", "FOO=bar gh repo delete fubits1/x"],
  ["DENY", "gh pr view 8 && gh repo delete fubits1/x"],
  ["DENY", "gh pr close 8"], // despite the broader Bash(gh pr:*) allow
  ["DENY", "gh pr close 8 --comment 'done\nthanks'"], // `*` spans a quoted newline
]);

// the fixture denies `gh api -X POST|PATCH|PUT|DELETE *` only: every other spelling of the same
// write must reach those rules through its explicit-method reading
cases("gh api writes match rules written with an explicit method", [
  ["DENY", "gh api repos/x/issues -f title=bug"],
  ["DENY", "gh api repos/x -F n=1"],
  ["DENY", "gh api repos/x/rulesets --input file.json"],
  ["DENY", "gh api --method PATCH repos/x -f n=y"],
  ["DENY", "gh api -XDELETE repos/fubits1/x"],
  ["DENY", "gh api -XPOST repos/fubits1/x/issues"],
  ["DENY", "gh api repos/x/issues -ftitle=bug"],
  ["DENY", "gh api repos/x --field=n=1"],
  ["DENY", "gh api repos/x/rulesets --input=payload.json"],
  ["DENY", "gh api graphql -f query='mutation{deleteRepo}'"],
  ["ALLOW", "gh api graphql -f query='query{viewer{login}}'"],
  ["ALLOW", "gh api repos/edouard-claude/snip"],
  ["ALLOW", "gh api -X GET search/issues -f q=repo:cli/cli"],
]);

cases(
  "no rule, no opinion: the hook stays silent",
  [
    ["SILENT", "gh api repos/x/issues -f title=bug"],
    ["SILENT", "npx cowsay hi"],
    ["SILENT", "pnpm dlx evil-pkg"],
    ["SILENT", "git log -10"],
  ],
  NO_RULES,
);

cases("ask re-application", [
  ["ASK", "ssh -V"],
  ["ASK", "ssh"],
  ["ASK", SNIP + "ssh host"],
  ["ASK", "timeout 30 ssh host"],
  ["ASK", "git log -10 && ssh host"],
  ["ASK", "gh pr checkout 8"], // beats the matching Bash(gh pr:*) allow
  ["ASK", "ssh $(whoami)@host"],
  ["DENY", "ssh host && gh repo delete fubits1/x"],
  ["DENY", "ssh host; gh api repos/x -f a=b"],
  ["SILENT", "sshd -t"],
]);

cases("allow re-application", [
  ["ALLOW", "git log -10"],
  ["ALLOW", "pnpm build"],
  ["ALLOW", "git log -10 | pnpm build"],
  ["ALLOW", SNIP + "git log -10"],
  ["ALLOW", "timeout 30s git log -10"],
  ["ALLOW", "timeout 1.5h pnpm build"],
  ["ALLOW", "gh pr view 8"],
  ["ALLOW", "npx prettier --check src/x.ts"],
  ["ALLOW", "npx knip --reporter compact"],
  ["ALLOW", "pnpm exec echo hi"], // Bash(pnpm exec:*)
  ["SILENT", "npx --yes prettier --check src/x.ts"], // no rule matches it as written
  ["SILENT", "npx cowsay hi"],
  ["SILENT", "git log -10 | some-unknown-cmd"],
  ["SILENT", "ls -la /tmp"],
  ["SILENT", ""],
  // R1: redirects are not separators
  ["ALLOW", "git log -10 2>&1"],
  ["ALLOW", "git log -10 >&2"],
  ["ALLOW", "git log -10 &> /dev/null"],
  ["DENY", "gh repo delete fubits1/x 2>&1"],
  ["DENY", "git log -10 & gh repo delete fubits1/x"],
  // R4: no allow past an env assignment or a wrapper Claude Code doesn't strip
  ["SILENT", "LD_PRELOAD=/x.so git log -10"],
  ["SILENT", "env git log -10"],
  // R5: trailing ` *` matches the bare form only when it is the rule's only wildcard
  ["ALLOW", "npm --help install"],
  ["SILENT", "npm --help"],
]);

cases("nested and wrapped commands", [
  // C1: substitutions never allow-emit, and their inner commands are checked like Claude Code does
  ["DENY", "git log $(gh repo delete fubits1/x)"],
  ["DENY", "git log <(gh repo delete fubits1/x)"],
  ["SILENT", "git log `rm -rf build`"],
  ["SILENT", "for f in a b; do git log $f; done"],
  // shell scripts run from -c, a heredoc or a herestring are parsed too
  ["DENY", "bash -c 'gh repo delete fubits1/x'"],
  ["DENY", "sh <<'EOF'\ngh repo delete fubits1/x\nEOF"],
  ["DENY", "bash <<< 'gh repo delete fubits1/x'"],
  ["SILENT", "bash -c 'git log -10'"],
  // a heredoc fed to a non-shell is data, not commands
  ["SILENT", "cat > notes.md <<'EOF'\ngh repo delete fubits1/x\nEOF"],
  // `command` and bare `xargs` are stripped like Claude Code strips them; `command -v` is not
  ["DENY", "command gh repo delete fubits1/x"],
  ["DENY", "xargs gh repo delete fubits1/x"],
  // a flagged `xargs` is seen through for deny/ask, like `env` and `exec`
  ["DENY", "xargs -n1 gh repo delete fubits1/x"],
  ["DENY", "xargs -I {} gh repo delete {}"],
  ["DENY", "xargs -J % gh repo delete %"], // BSD xargs
  ["DENY", "env -P /usr/bin gh repo delete fubits1/x"], // BSD env
  ["DENY", "echo x | xargs -n1 sh -c 'gh repo delete fubits1/x'"],
]);

// allow matches the reading Claude Code matches: as written up to a wrapper it doesn't strip
cases(
  "an allow rule on a wrapper Claude Code doesn't strip matches it as written",
  [
    ["ALLOW", "xargs -n1 pnpm build"],
    ["ALLOW", "xargs -I {} echo {}"],
    ["ALLOW", "env FOO=1 pnpm build"],
    ["SILENT", "xargs -n1 sh -c 'gh repo delete fubits1/x'"],
    ["ALLOW", "timeout -s KILL 5 env pnpm build"],
  ],
  { allow: ["xargs *", "env *"], deny: [], ask: [] },
);

// Claude Code strips a wrapper only in the forms its matcher knows, and only when named without a path
restoreCases(
  "an allow rule looks past a wrapper only in a form Claude Code strips",
  "default",
  [
    ["ALLOW", "timeout 30 npm test"],
    ["ALLOW", "timeout -s KILL 5 npm test"],
    ["ALLOW", "nice -n 10 npm test"],
    ["ALLOW", "stdbuf -oL npm test"],
    ["ASK", "nice -n10 npm test"],
    ["ASK", "stdbuf --output=L npm test"],
    ["ASK", "/usr/bin/nice npm test"],
  ],
  { allow: ["npm test *"], deny: [], ask: [] },
);

// Claude Code's path checks ask before any allow rule is looked at
restoreCases(
  "an allow rule doesn't cover what Claude Code's path checks ask about",
  "default",
  [
    ["ASK", "cp -r src dst"],
    ["ASK", "mv -f a b"],
    ["ASK", "rm -rf ~/x"],
    ["ASK", "rm ../x"],
    ["ASK", "mkdir /tmp/y"],
    ["ASK", "cd sub && rm a"],
    ["ASK", "jq .items < /tmp/resp.json"],
    ["ALLOW", "rm build/x"],
    ["ALLOW", "cp a b"],
    ["ALLOW", "jq .items < resp.json"],
  ],
  {
    allow: ["cp *", "mv *", "rm *", "mkdir *", "cd *", "jq *"],
    deny: [],
    ask: [],
  },
);
restoreCases(
  "a read outside the working directories, or a git write, isn't read-only",
  "default",
  [
    ["ASK", "cat /etc/hosts"],
    ["ASK", "wc -l < /etc/hosts"],
    ["ASK", "git diff --output=x.patch"],
    ["SILENT", "cat README.md"],
    ["SILENT", "git diff"],
  ],
  NO_RULES,
);

cases(
  "deny/ask match every reading, not just the effective command",
  [
    ["DENY", "nohup git log -10"],
    ["ALLOW", "git log -10"],
  ],
  { allow: ["git log:*"], deny: ["nohup *"], ask: [] },
);

// snip's hook auto-allows (stubbed true): where no rule covers a command, Claude Code would prompt
function restoreCases(name, mode, table, rules = RULES, snipAllows = true) {
  describe(name, () => {
    for (const [expected, command] of table) {
      test(`${expected}: ${JSON.stringify(command)}`, () => {
        const result = decide(
          { tool_name: "Bash", tool_input: { command }, permission_mode: mode },
          rules,
          () => snipAllows,
        );
        assert.equal(outcome(result), expected);
      });
    }
  });
}

restoreCases("restore Claude Code's prompt in default mode", "default", [
  ["ASK", "npx cowsay hi"],
  ["ASK", "curl -sS https://example.com"],
  ["ASK", "git push --force"],
  ["ASK", "find / -name x -delete"],
  ["ASK", "git log -10 | npx cowsay hi"],
  ["ASK", "echo hi > out.txt"], // a file-writing redirect isn't read-only
  ["ASK", "ls *.ts"], // unquoted glob: judged not read-only (one prompt too many at worst)
  ["SILENT", "ls -la"],
  ["SILENT", "git status"],
  ["SILENT", "git log -10 2>&1 | head -5"], // allowed + read-only: Claude Code runs it
  ["ALLOW", "git log -10"],
  ["DENY", "gh repo delete fubits1/x"],
  ["ASK", "ssh -V"],
]);

restoreCases("restore in dontAsk", "dontAsk", [
  ["ASK", "npx cowsay hi"],
  ["SILENT", "git status"],
]);
restoreCases("restore in plan mode", "plan", [["ASK", "npx cowsay hi"]]);
restoreCases("restore in acceptEdits mode", "acceptEdits", [
  ["ASK", "npx cowsay hi"],
]);

restoreCases("no restore where Claude Code wouldn't prompt: auto", "auto", [
  ["SILENT", "npx cowsay hi"],
  ["DENY", "gh repo delete fubits1/x"],
]);
restoreCases(
  "no restore where Claude Code wouldn't prompt: bypassPermissions",
  "bypassPermissions",
  [["SILENT", "npx cowsay hi"]],
);

restoreCases(
  "no restore when snip wouldn't auto-allow the command",
  "default",
  [["SILENT", "npx cowsay hi"]],
  RULES,
  false,
);

restoreCases(
  "an allow rule doesn't cover find actions or exec wrappers",
  "default",
  [
    ["ALLOW", "find . -name y"],
    ["ASK", "find . -name y -delete"],
    ["ASK", "watch ls"],
  ],
  { allow: ["find *", "watch *"], deny: [], ask: [] },
);

// "A rule such as `Bash(git commit *)` allows the command, not the target" (permissions docs)
restoreCases(
  "an allow rule covers the command, not a file it writes",
  "default",
  [
    ["ASK", "git log -10 > ~/notes.txt"],
    ["ASK", "pnpm build 2>&1 | tee ../build.log"],
    ["ALLOW", "git log -10 > /dev/null"],
    ["ALLOW", "pnpm build 2>&1 | tee"],
  ],
  { allow: ["git log *", "pnpm *", "tee *"], deny: [], ask: [] },
);

// "Commands longer than 10,000 characters always prompt", and so does an unparseable one
restoreCases(
  "Claude Code prompts for a command it can't analyse, allow rule or not",
  "default",
  [
    ["ALLOW", "npm test"],
    ["ASK", "npm test &&"],
  ],
  { allow: ["npm *"], deny: [], ask: [] },
);
test("a command over 10,000 characters is asked about, allow rule or not", () => {
  const result = decide(
    {
      tool_name: "Bash",
      tool_input: { command: `npm test -- "${"x".repeat(10_000)}"` },
      permission_mode: "default",
    },
    { allow: ["npm *"], deny: [], ask: [] },
    () => true,
  );
  assert.equal(outcome(result), "ASK");
});

restoreCases(
  "a bare Bash allow rule matches every command",
  "default",
  [
    ["ALLOW", "npx cowsay hi"],
    ["ALLOW", "git push"],
  ],
  loadRules([{ path: join(FIXTURES, "bare-bash.json"), grants: true }]),
);

test("B2: a malformed permissions.allow does not disable the valid deny", () => {
  const rules = loadRules([
    { path: join(FIXTURES, "malformed.json"), grants: true },
  ]);
  const result = decide(
    { tool_name: "Bash", tool_input: { command: "gh repo delete fubits1/x" } },
    rules,
  );
  assert.equal(outcome(result), "DENY");
});

test("non-Bash tools and missing commands are silent", () => {
  assert.equal(
    outcome(decide({ tool_name: "Read", tool_input: {} }, RULES)),
    "SILENT",
  );
  assert.equal(
    outcome(decide({ tool_name: "Bash", tool_input: {} }, RULES)),
    "SILENT",
  );
  assert.equal(outcome(decide(null, RULES)), "SILENT");
});
