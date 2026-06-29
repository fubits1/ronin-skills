# no-bash — rationale

Why this hook exists and why it is built this way. Every claim is sourced. The one-line
header in the hook is too short to hold this, so the reasoning lives here next to the
code.

## Runtime: `no-bash.mjs` (Node, cross-OS)

The hook is **`no-bash.mjs`**, a zero-dependency Node ESM script wired in `hooks.json` as
`node ${CLAUDE_PLUGIN_ROOT}/hooks/no-bash.mjs`. It runs on every OS because Claude Code ships Node
everywhere — a shell plugin hook cannot run on native Windows (`/bin/bash` can't resolve Windows
plugin paths in any format; [#18610](https://github.com/anthropics/claude-code/issues/18610), closed
not-planned).

Block mechanism: `exit 2` + a stderr message
([#24327](https://github.com/anthropics/claude-code/issues/24327) is a model-side stop-vs-adapt quirk
— not a reason to switch to JSON `permissionDecision`). Stdin is parsed in-process, no subprocess.
`tests/run-no-bash-tests.mjs` and `tests/redteam-no-bash.mjs` hold the contract as fixed expectations
(every block arm plus the false-positive guards pinned). `scan()` is exported so harnesses can call it
in-process; the hook still runs as a script when executed directly (a realpath-compared guard, with a
fail-safe toward *running*, so a symlinked install path can't silently disable it).

Beyond fixed fixtures, `tests/validate-no-bash.mjs` is the full-scale gate: it cross-checks the hook
against an **independent POSIX parsing oracle** (`oracle.py`, python3 `shlex`) and ~6k seeded-fuzz
cases, so a quote/escape/segmentation bug the author never thought to write a fixture for still fails
the build (it catches, e.g., the single-quote `echo 'a\' ; cat …` regression that hand-picked fixtures
missed). `tests/replay-transcript-no-bash.mjs` is an ad-hoc gate that replays the real Bash commands
from session transcripts to surface false positives on commands actually issued in practice.

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
the widely-shared "Bash addiction" hook does the same thing. `no-bash.mjs` is a more complete
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

The hook disciplines a well-meaning agent's habits toward the right tools — it is **not a firewall**
or an adversarial sandbox. It catches the model's plain reflexes: a banned tool as the command, a
`cat > file` heredoc, mutating git, gratuitous chaining, and a banned tool wrapped in `bash -c "…"`,
`$(…)`, backticks, `<(…)`, or a simple process wrapper (`timeout`, `nice`, `env`, `xargs`). It does
NOT chase deliberate evasion — quote/escape mutation (`'grep'`, mid-name backslash, ANSI-C `$'…'`),
encoding, expansion, or a tool hidden inside an arbitrary construct — because the model has no reason
to obfuscate its own command to slip past its own discipline hook. Claude Code's own
guidance is to use the permission system or sandbox for hard boundaries and treat hooks as
best-effort policy that fails open on unparseable input
([hooks docs](https://code.claude.com/docs/en/hooks)). For a nudge, a regex matcher with zero
runtime dependencies is the right trade.

## How it works

1. Read input by parsing stdin JSON for `.tool_input.command`; empty means exit 0 (fail open).
2. Pre-extraction scans catch banned tools the segment splitter can't see: `bash -c "…"`,
   `$(…)` and backtick command substitution, `<(…)`/`>(…)` process substitution, and
   `node -e`/`python -c` shelling out via subprocess APIs.
3. Segment split on `&&`, `||`, `;`, `|`, and background `&`, with `&&` matched before bare
   `&` so a logical-AND isn't mis-split. Each segment is checked on its own, so a banned
   tool can't ride along after an approved-looking first command.
4. `normalize_first` reduces a segment to its effective first word, mirroring Claude Code's
   own matcher: it strips `VAR=value` prefixes, leading group-openers (`(` / `{`), leading
   backslash, path qualification, and process wrappers (`timeout`, `nice`, `env`, `exec`,
   `xargs` — including the `-I {}` replstr of the `xargs -I {} grep …` idiom).
5. Per-tool arms block the banned first word with a message naming the right tool. Special
   cases discriminate read from write, so the hook does not false-positive on a legit read:
   - `cat` routes to `Write` only for a real stdout file-write (`cat … > f`, `>>`) or a
     heredoc (`<<EOF`); a stderr redirect (`2>/dev/null`, `2>&1`, `1>&2`) or a `<<<`
     here-string is still a read and routes to `Read`.
   - `sed -n`/`Np` reads block while `sed 's///'` substitution passes.
   - `command -v foo` (POSIX existence check) passes; `command grep …` (execution bypass)
     blocks.
   - `git` is mutation-vs-read discriminated by subcommand (`gitMutates`): a write form
     blocks (`commit`, `push`, `reset`, `stash`/`stash pop`, `clean -fd`, `apply`, `branch
     -D`, `worktree add`, `submodule update`, `git -C <path> commit`, …) while the read /
     inspection form of the same subcommand passes (`git stash list`, `git tag -l`,
     `git config --get`, `git clean -n`, `git apply --check`, `git fetch --dry-run`,
     `git remote -v`, `git mv`). Global options before the subcommand (`git -C`, `-c k=v`,
     `--no-pager`) are stripped first so they can't hide a mutation. `git grep` routes to
     `Grep`. `git config` and `git tag` are **not** blocked at all (including their write
     forms `git config user.name …` / `git tag v1`): they are local, non-destructive, and
     have no `gh` equivalent, so the read-only `--get`/`-l` forms — the common reflex — must
     pass and blocking the write forms buys nothing.
6. No-chaining check (runs after the per-tool arms, so a banned-tool message wins). It counts
   the top-level commands quote/heredoc/continuation aware: a real `&&`, `||`, `;`, or a bare
   newline BETWEEN commands counts as chaining and blocks with a message telling Claude to run
   each as a separate Bash call. A newline INSIDE a quoted argument (a multi-line `--body`/`-m`
   value), a `\`-newline line-continuation, and a heredoc body are one logical command and do
   NOT count. Chaining is a documented permission-bypass class (claude-code
   #13371/#4956/#28784/#16180/#20085): the native matcher can validate only the first segment
   of a chain. It's also the agent's bash-one-liner reflex, not a need; Claude Code persists
   the Bash working dir across calls, so even `cd dir && cmd` is unnecessary. Pipes into `jq`
   and redirections (`>`, `2>&1`) are not chaining and pass.

A bypass that slips a banned tool through is a bug to fix here, not a loophole to use.

## Block-message design

Every block goes through one `block()` helper, because how the rejection reads back to the
model matters as much as the block itself. The model has repeatedly mislabeled hook /
permission blocks as "the user rejected me" and narrated past its own mistake, so each block
is prefixed `[deterministic hook block from no-bash.mjs — NOT a user rejection]` followed by a
structured `BLOCKED | reason=…` line. The paired skill rule (`no-bash/SKILL.md` → "When the
hook blocks a command") tells the model to read the `reason=` and switch to the dedicated
tool rather than re-issue the same command.

## The Grep/Glob tools can be missing on native builds (2.1.117)

Claude Code 2.1.117 **replaced** the `Grep` and `Glob` tools on **native macOS/Linux builds**
with embedded `ugrep`/`bfs` run through the Bash tool; **Windows and npm-installed builds keep
them unchanged** (SDK [#301](https://github.com/anthropics/claude-agent-sdk-typescript/issues/301)).
The release notes say "replaced", and reports differ on whether `Grep`/`Glob` remain callable as
tools on a native build or drop out entirely. With tool search (on by default, except behind a
non-first-party `ANTHROPIC_BASE_URL`) deferring tool definitions behind `ToolSearch`, native-build
sessions have been observed with `Grep`/`Glob` absent from both the palette and `ToolSearch`
([#52121](https://github.com/anthropics/claude-code/issues/52121)).

This breaks the assumption behind the teaching messages. They named "the Grep tool" / "the Glob
tool" unconditionally; on a native build that tool may not be there, and Anthropic's replacement,
Bash `ugrep`/`bfs`, is the raw-dump search this hook routes away from (it fails both reasons in
"What the hook actually buys": a raw terminal dump, and an approval that does not cache). So the
messages now name the structured alternatives: the `Grep`/`Glob` tool where the build still has
it, the fff MCP on native builds, and `Read` (present on every build) for reads.

The message is static, not branched by build, because the hook cannot tell which build it runs on:
its stdin carries no tool list, there is no tool-availability API
([#301](https://github.com/anthropics/claude-agent-sdk-typescript/issues/301)), and
`process.platform` does not separate a native macOS build from an npm macOS install.
`CLAUDE_DEGRADED_NATIVE_TOOLS=Grep,Glob` is Anthropic's opt-in to let Bash `grep`/`find` fall
through when the native tools are gone; this hook does not rely on it. The performance trade-offs
of the ugrep/bfs swap (slower literal search, a regex-backtracking OOM) are in the Sources below;
they are not the hook's concern, only the tool-availability change is.

## Limits

- regex, not a parser. A real bash AST parser
  ([oryband/claude-code-auto-approve](https://github.com/oryband/claude-code-auto-approve),
  shfmt + jq) is more robust per-segment but needs `shfmt` installed. This hook stays
  regex-only with zero runtime dependencies (stdin parsed with `JSON.parse`), which fits the nudge threat model
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
- [claude-agent-sdk#301](https://github.com/anthropics/claude-agent-sdk-typescript/issues/301):
  Grep/Glob replaced by ugrep/bfs on native macOS/Linux builds in 2.1.117; no tool-availability
  detection API
- [claude-code#54394](https://github.com/anthropics/claude-code/issues/54394): a report of a
  regex-backtracking OOM on the native ugrep path
- [Genivia/ugrep#517](https://github.com/Genivia/ugrep/issues/517),
  [ripgrep#2597](https://github.com/BurntSushi/ripgrep/discussions/2597): ugrep vs ripgrep
  benchmark discussion (ugrep slower on some literal searches; regex performance cliffs)
- [claude-code#52121](https://github.com/anthropics/claude-code/issues/52121),
  [#52004](https://github.com/anthropics/claude-code/issues/52004),
  [#51921](https://github.com/anthropics/claude-code/issues/51921): Grep/Glob missing under
  default tool search
