# nogrep.sh — rationale

Why this hook exists and why it is built this way. Every claim is sourced. The one-line
header in `nogrep.sh` is too short to hold this, so the reasoning lives here next to the
code.

## Why the hook exists

Claude Code's system prompt already tells the model to prefer the dedicated `Read`, `Grep`,
`Glob`, and `Write` tools over Bash `cat`/`grep`/`find`/`sed`. The model ignores that in
roughly 40% of sessions, and more often after context compaction (the preference compresses
away) and inside subagents (weaker prompt adherence).

Anthropic was asked to fix this and declined. Issue
[#39979](https://github.com/anthropics/claude-code/issues/39979) ("uses Bash cat/grep/head
despite system-prompt prohibition") is closed as not-planned. The origin report
[#19649](https://github.com/anthropics/claude-code/issues/19649) catalogued ~217 cases
across three patterns; the heaviest (127 of them) is `cat > file <<EOF …` for file creation.

A PreToolUse hook is the enforcement layer left once the model won't self-correct and
Anthropic won't enforce it. This is the established community pattern, not something novel:
the widely-shared "Bash addiction" hook does the same thing. `nogrep.sh` is a more complete
version of it.

## What the hook actually buys

It does not save a permission click per call. Claude Code runs `grep cat head tail find wc`
(and read-only `git`) as a built-in read-only set with no prompt in any mode
([permissions docs](https://code.claude.com/docs/en/permissions)). An earlier version of
the hook header claimed otherwise; that claim was wrong and is gone.

The real reasons:

1. Structured output. `Grep`/`Read` return clean, paginated, line-numbered results instead
   of raw terminal dumps the model then re-parses.
2. Approval caching. Built-in tool approvals cache. Unique Bash content, especially
   `cat > file` heredocs, never caches, so a human re-reviews it on every run
   ([#19649](https://github.com/anthropics/claude-code/issues/19649)). This is the biggest
   efficiency drain the hook removes.
3. Coverage where the prompt fails. The hook fires in subagents and after compaction, where
   the model's own adherence collapses ([#39979](https://github.com/anthropics/claude-code/issues/39979)).

## Why a hook and not `permissions.deny` rules

`deny` rules are Claude Code's robust, AST-matched enforcement, but a plugin cannot ship
them. A plugin's `settings.json` supports only the `agent` and `subagentStatusLine` keys;
every other key, `permissions` included, is silently ignored
([plugins docs](https://code.claude.com/docs/en/plugins)). Deny rules apply only when written
into a user's or project's own `.claude/settings.json`, which a distributable plugin can't
write for its installers.

So the hook is the only enforcement a plugin can carry. It also does two things a deny rule
can't: it returns a teaching message naming the right tool and its parameters, and it
encodes nuance a flat rule can't, such as allowing `sed 's///'` substitution while blocking
`sed -n`/`sed Np` reads.

## Threat model

The hook steers a well-meaning agent toward the right tools. It is not an adversarial
sandbox. A determined bypass (quoting tricks like `p''erl`, base64-decode piped to a shell)
will beat a regex matcher, and the hook doesn't try to win that fight. Claude Code's own
guidance is to use the permission system or sandbox for hard boundaries and treat hooks as
best-effort policy that fails open on unparseable input
([hooks docs](https://code.claude.com/docs/en/hooks)). For a nudge, a regex matcher with no
dependency beyond `jq` is the right trade.

## How it works

1. Read input via `jq -r '.tool_input.command // empty'`; empty means exit 0 (fail open).
2. Pre-extraction scans catch banned tools the segment splitter can't see: `bash -c "…"`,
   `$(…)` and backtick command substitution, `<(…)`/`>(…)` process substitution, and
   `node -e`/`python -c` shelling out via subprocess APIs.
3. Segment split on `&&`, `||`, `;`, `|`, and background `&`, with `&&` matched before bare
   `&` so a logical-AND isn't mis-split. Each segment is checked on its own, so a banned
   tool can't ride along after an approved-looking first command.
4. `normalize_first` reduces a segment to its effective first word, mirroring Claude Code's
   own matcher: it strips `VAR=value` prefixes, leading group-openers (`(` / `{`), leading
   backslash, path qualification, and process wrappers (`timeout`, `nice`, `env`, `exec`,
   `xargs`).
5. Per-tool arms block the banned first word with a message naming the right tool. Special
   cases: `cat > file`/heredoc routes to `Write` (not Read); `sed -n`/`Np` reads block while
   `sed 's///'` substitution passes; mutating `git` blocks while read-only `git` and
   `git mv` pass.
6. No-chaining check (runs after the per-tool arms, so a banned-tool message wins). If the
   command joins two real commands with `&&`, `||`, or `;`, it blocks with a message telling
   Claude to run each as a separate Bash call. Chaining is a documented permission-bypass
   class (claude-code #13371/#4956/#28784/#16180/#20085): the native matcher can validate
   only the first segment of a chain. It's also the agent's bash-one-liner reflex, not a
   need; Claude Code persists the Bash working dir across calls, so even `cd dir && cmd` is
   unnecessary. Pipes into `jq` and redirections (`>`, `2>&1`) are not chaining and pass.

A bypass that slips a banned tool through is a bug to fix here, not a loophole to use.

## Block-message design

Every block goes through one `block()` helper, because how the rejection reads back to the
model matters as much as the block itself. The model has repeatedly mislabeled hook /
permission blocks as "the user rejected me" and narrated past its own mistake, so each block
is prefixed `[deterministic hook block from nogrep.sh — NOT a user rejection]` followed by a
structured `BLOCKED | reason=…` line. The paired skill rule (`nogrep/SKILL.md` → "When the
hook blocks a command") tells the model to read the `reason=` and switch to the dedicated
tool rather than re-issue the same command.

## Limits

- regex, not a parser. A real bash AST parser
  ([oryband/claude-code-auto-approve](https://github.com/oryband/claude-code-auto-approve),
  shfmt + jq) is more robust per-segment but needs `shfmt` installed. This hook stays
  regex-only to avoid any dependency beyond `jq`, which fits the nudge threat model
- depends on `jq` for input parsing (the test harness fails fast if `jq` is absent)
- adversarial evasion is out of scope by design (see threat model)

## Sources

- [claude-code#19649](https://github.com/anthropics/claude-code/issues/19649): origin
  report; the `cat`-heredoc 127× pattern; caching argument
- [claude-code#39979](https://github.com/anthropics/claude-code/issues/39979): closed
  not-planned; ~40% session rate; subagent/compaction weakness
- [Permissions docs](https://code.claude.com/docs/en/permissions): read-only command set;
  deny rules; compound-command separators; wrapper stripping
- [Hooks docs](https://code.claude.com/docs/en/hooks): exit-2 blocking; fail-open; use the
  permission system for hard enforcement
- [Plugins docs](https://code.claude.com/docs/en/plugins): plugin `settings.json` supports
  only `agent` / `subagentStatusLine`; other keys silently ignored
- chaining as a permission-bypass class:
  [#13371](https://github.com/anthropics/claude-code/issues/13371),
  [#4956](https://github.com/anthropics/claude-code/issues/4956),
  [#28784](https://github.com/anthropics/claude-code/issues/28784),
  [#16180](https://github.com/anthropics/claude-code/issues/16180),
  [#20085](https://github.com/anthropics/claude-code/issues/20085)
- [oryband/claude-code-auto-approve](https://github.com/oryband/claude-code-auto-approve):
  the AST-based alternative
