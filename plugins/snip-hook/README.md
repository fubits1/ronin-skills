# snip-hook

A plugin for [snip](https://github.com/edouard-claude/snip) users. It
re-applies your `permissions.deny`/`ask`/`allow` rules to the ORIGINAL Bash
command, which snip's command-rewrite hides from Claude Code. Your deny rules
block, your ask rules prompt, your allow rules let workflows through without
prompting. The hook has no policy of its own: where none of your rules
matches, it restores what Claude Code does without snip. snip auto-approves
every command it supports (`curl`, `npx …`, `git push --force`, …); in the
permission modes where Claude Code would ask about such a command, the hook
asks. In auto and bypass modes it stays out of the way.

Part of the [ronin-skills](https://github.com/fubits1/ronin-skills)
marketplace. Standalone: it needs neither `agent` nor `hooks`.

How it decides, which settings files it reads, and its limits:
[rationale.md](rationale.md).

## Requirements

- [snip](https://github.com/edouard-claude/snip) with its Claude Code hook
  installed (`snip init`). Tested with snip v0.25.2
- Node 20.11 or newer on `PATH` (the hook runs as `node …/dist/index.js`).
  Tested with Node v20.11.0 and v24.19.0
- Claude Code with plugin support. Tested with 2.1.302 on macOS (Apple
  Silicon); other platforms are untested

## Install

```text
/plugin install snip-hook --marketplace fubits1/ronin-skills
```

On Claude Code before 2.1.275, add the marketplace first
(`/plugin marketplace add fubits1/ronin-skills`), then
`/plugin install snip-hook@ronin-skills`. Start a new session
afterwards. The plugin runs in parallel with snip's own hook, which stays
where `snip init` put it.

### Moving from the standalone `jean-claude-snip-hook` marketplace

The old copy is the same hook under another name. Left installed, it runs
beside `snip-hook` on every Bash call, so remove it first:

```text
claude plugin uninstall jean-claude-snip-hook@jean-claude-snip-hook
claude plugin marketplace remove jean-claude-snip-hook
```

If you registered the old hook by hand instead, remove its entry from the
`PreToolUse` `Bash` matcher in `~/.claude/settings.json`: a
`node … index.js` command, or `node …/hook-snip-wrapper.mjs` from the 0.1
install. Keep snip's own `snip hook` entry. Then install as above.

## Verify

In a new session, ask Claude to run a command you denied (e.g.
`gh repo delete <you>/nonexistent`): the call is blocked with
`[deterministic hook block from snip-hook …]`. A command in your
ask rules prompts, and an allowed workflow runs without a prompt.

## Writing rules

Write rules as you would without snip; no `*`-prefixed twins are needed. For
deny and ask rules, a `gh api` write is also checked with an explicit method,
so `Bash(gh api -X POST *)` covers `gh api repos/x/issues -f title=bug`,
`-XPOST` and `--method POST` too. Allow rules match the command past the
wrappers Claude Code strips itself, so `Bash(git log *)` covers
`timeout 30 git log`, and never past others (`env`, `xargs -n1`): a rule on
one of those matches it as written, so `Bash(xargs *)` covers `xargs -n1 …`.
Leave shell quotes out of a rule (`Bash(git commit -m wip)`, not
`-m "wip"`): the hook matches the command with its quotes removed
([rationale.md](rationale.md), Limits).

## Develop

From the repository root:

```sh
pnpm install
pnpm test     # builds both bundles, then node:test (incl. this plugin's bundle)
node plugins/snip-hook/tests/bench.js        # perf gate (local; CI doesn't run it)
node plugins/snip-hook/tests/live-report.js  # classification vs your REAL settings
claude --plugin-dir plugins/snip-hook        # try the working copy
```

```text
src/index.js        entry point: stdin -> decision -> stdout / exit code
src/decide.js       deny / ask / allow / restore and the output contract (pure)
src/command.js      wrapper readings and the read-only set, on ../../shared/shell.js
src/rules.js        settings discovery, trust, rule matching
src/gh.js           explicit-method readings of gh api writes
src/snip.js         asks snip's own hook whether it would auto-allow
dist/index.js       the shipped bundle (`pnpm build`; committed; CI checks it is current)
hooks/hooks.json    plugin hook registration
tests/              process tests, bench, live report, fixtures
```

Tests and bench use `tests/fixtures/`, never your live settings.
`SNIP_WRAPPER_SETTINGS=<file>` makes the hook read only that file.
