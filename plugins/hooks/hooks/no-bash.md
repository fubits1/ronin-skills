# no-bash — rationale

Why this hook exists and why it is built this way. Every claim is sourced. The one-line
header in the hook is too short to hold this, so the reasoning lives here next to the
code.

## Runtime: `no-bash.mjs` (Node, cross-OS)

The hook is **`no-bash.mjs`**, a Node ESM script with no runtime dependencies wired in `hooks.json`
as `node "${CLAUDE_PLUGIN_ROOT}/hooks/no-bash.mjs"` (quoted: the shell would split a plugin root
that contains a space). The hook runs on every OS because Claude Code ships Node everywhere — a
shell plugin hook cannot run on native Windows (`/bin/bash` can't resolve Windows plugin paths in
any format; [#18610](https://github.com/anthropics/claude-code/issues/18610), closed not-planned).

The file is generated: `pnpm build` (rolldown, repository root) bundles `src/no-bash.js` with the
shared shell parser `shared/shell.js` and unbash into it, and CI fails when the committed copy
differs from its sources. Edit the sources, never the generated file. `shared/shell.js` is also
the snip-hook plugin's parser, so a change there rebuilds and changes both hooks; `pnpm test` runs
its tests and snip-hook's.

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
NOT chase deliberate evasion — encoding, a command built at run time (`eval "$x"`, a script
written then run) — because the model has no reason
to obfuscate its own command to slip past its own discipline hook. Claude Code's own
guidance is to use the permission system or sandbox for hard boundaries and treat hooks as
best-effort policy that fails open on unparseable input
([hooks docs](https://code.claude.com/docs/en/hooks)). The command is parsed the way bash parses
it (unbash, see "How it works"), so quoting that bash itself removes (`'grep'`, `'g''rep'`,
`$'\x67rep'`) resolves to the real command as a side effect; no code chases it.

## How it works

1. Read input by parsing stdin JSON for `.tool_input.command`; empty means exit 0 (fail open).
2. Parse: [unbash](https://github.com/webpro-nl/unbash) (a bash parser in pure JS, through
   `shared/shell.js`) turns the command into every simple command bash would run, each with
   where it runs: the command line itself (pipelines, `&&`/`||`/`;`/`&` lists, subshells,
   groups, loops), `$(…)`, backticks, `<(…)`/`>(…)`, or a script handed to a shell
   (`bash -c "…"`, `bash -euo pipefail -c "…"`, `sh <<EOF`, `bash <<< '…'`, `bash -s arg <<EOF`; a
   shell's stdin is a script only with `-s` or when it has no `-c` and names no script file, so
   the stdin of `bash setup.sh <<EOF` is data). A redirect on
   a subshell or group applies to the commands inside it (`(cat a) > out` writes a file).
   Quotes, escapes, `\`-continuations and heredoc
   bodies resolve as bash resolves them, so a banned word inside a quoted argument stays an
   argument. A command that runs on another machine or in a container (`ssh host 'echo $(cat f)'`,
   `docker exec c sh -c "grep …"`) is an argument to `ssh`/`docker` and passes: `Read` and
   `Grep` can't reach those files. `node -e`/`python -c` bodies aren't shell; two regexes catch
   them shelling out via subprocess APIs.
3. Each command is checked on its own, so a banned tool can't ride along after an
   approved-looking first command. Nested commands are checked first (shell scripts, then
   `$(…)`, backticks, process substitution), and a banned file-read/search tool there reports
   with that construct's tag (`bashc-banned`, `dollar-sub`, `backtick-sub`, `procsub`). A sed
   read in a shell script is `bashc-sed-read`; mutating git, `command <tool>` and a sed read in
   a substitution keep their own tag.
4. `readCommand` reduces each command to its effective command, mirroring Claude Code's own
   matcher: it strips `VAR=value` prefixes and process wrappers (`timeout`, `time`, `nice`,
   `nohup`, `stdbuf`, `env`, `exec`, `eval`, `builtin`, `xargs`), with their flags and the
   values of flags that take one (`xargs -I % grep`, `xargs -d '\n' grep`, `timeout -s KILL 5
   grep`, `env -u FOO grep`). The
   parser has already removed quoting and a leading backslash; the path qualification is
   dropped from the name.
5. Per-tool arms block the banned command with a message naming the right tool. Special
   cases discriminate read from write, so the hook does not false-positive on a legit read:
   - `cat` routes to `Write` only for a real stdout file-write (`cat … > f`, `>>`, `&>`) or
     a heredoc (`<<EOF`); a stderr redirect (`2>/dev/null`, `2>&1`, `1>&2`) or a `<<<`
     here-string is still a read and routes to `Read`.
   - `sed -n`/`Np` reads block while `sed 's///'` substitution passes.
   - `perl` gets no such split: it blocks in every form (`reason=bash-perl`), in-place `-pi`
     included, because `sed -i 's///'` covers in-place editing. `ruby` is not banned.
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
6. No-chaining check (runs after the per-tool arms, so a banned-tool message wins). From the
   parse: a real `&&`, `||`, `;`, or a bare newline BETWEEN commands, or a loop, `if`, `case`
   or function definition, counts as chaining and blocks with a message telling Claude to run
   each as a separate Bash call. A newline INSIDE a quoted argument (a multi-line `--body`/`-m`
   value), a `\`-newline line-continuation, a heredoc body, and a script inside `bash -c "…"`
   are one logical command and do NOT count. One command sent to the background
   (`npm run dev &`) doesn't count; `a & b` and `a &⏎b` do. Chaining is
   a documented permission-bypass class (claude-code #13371/#4956/#28784/#16180/#20085): the
   native matcher can validate only the first segment
   of a chain. It's also the agent's bash-one-liner reflex, not a need; Claude Code persists
   the Bash working dir across calls, so even `cd dir && cmd` is unnecessary. Pipes into `jq`
   and redirections (`>`, `2>&1`) are not chaining and pass.

A bypass that slips a banned tool through is a bug to fix here, not a loophole to use.

## Coverage, as a fraction

The reflex this hook targets is "reach for a Bash reader instead of the dedicated tool", and that
reflex is not tied to the names the arms block — it moves to whatever binary is left. The table
is the current score, so the next gap is visible rather than discovered mid-session. `GUARDED`
names the arm that catches the shape; `GAP` is a deliberate non-goal under the threat model above.

| Shape | Verdict | Where |
| --- | --- | --- |
| `grep` / `rg` / `cat` / `head` / `tail` / `find` / `awk` / `wc` | GUARDED | per-tool arms |
| `sed -n` / `sed Np` read | GUARDED | `sed` arm: a `-n` token or a `SED_PRINT_RANGE` script |
| `sed 's///'` edit | passes by design | `sed` arm falls through |
| `perl`, every form | GUARDED | its own arm, `reason=bash-perl` |
| `sed -i 's///'` (GNU), `sed -i '' 's///'` (macOS) | passes by design | the sanctioned in-place edit, and what replaces `perl -pi`; BSD sed reads the argument after `-i` as the backup suffix |
| `ruby`, `lua`, `php`, `busybox`, `xxd` | GAP | zero observed use here; add one only when a replay shows the reflex, never on symmetry |
| banned tool via wrapper, `$(…)`, backticks, `<(…)`, `bash -c`, `sh <<EOF` | GUARDED | the parse finds nested commands; the arms check them like top-level ones |
| `/usr/bin/grep`, `\grep`, `VAR=x grep` | GUARDED | the parse + `readCommand` |
| `bash -c "perl …"`, `$(perl …)`, `` `perl …` ``, `<(perl …)` | GUARDED | nested commands go through the same arms |
| banned tool on another host or in a container (`ssh h 'cat f'`, `docker exec c sh -c "grep …"`) | passes by design | an argument to `ssh`/`docker`, not a local command; `Read`/`Grep` can't reach those files |
| `python -c "open(f).read()"`, `node -e "fs.readFileSync"` | GAP | both have real non-reader uses here (`jq` fallback, scripts); no reader-shaped instance in the replay. Revisit from evidence, not symmetry |
| `ugrep`, `bfs` | pass, unrecommended | they pass (no arm) and stay that way — no observed reflex to block. They are also not recommended: "the raw-dump search this hook routes away from", below |
| `grep` / `find` on a native build | GUARDED, unless the user opts in | on native macOS/Linux these names ARE the embedded ugrep/bfs (the shell snapshot shadows them). Blocked by default; `NO_BASH_SEARCH_FALLBACK=1` lets them through — see below |
| `tee`, `dd of=`, heredoc into a non-`cat` command | GAP | write-side routing beyond `cat > file` is out of scope — `tee … <<EOF` is an explicit ALLOW in `redteam-no-bash.mjs` |
| write a script, then run it | GAP | one indirection defeats any string-level analysis; that belongs to sandboxing, not to a nudge |
| quoting: `'grep'`, `'g''rep'`, `$'\x67rep'` | GUARDED, as a side effect | the parser removes quoting like bash does; nothing chases it |
| obfuscation: encoded payloads, `eval "$(…)"` built at run time | GAP | documented non-goal, see the threat model |

The `perl` row exists because the gap was observed, not imagined. In one session the hook blocked
`grep`, `head` and `tail` as designed, and the agent read files with `perl -ne 'print if /…/'` for
the rest of the session; replaying that transcript through `replay-transcript-no-bash.mjs` surfaced
22 distinct such commands. Upstream reports the same reflex against a different guard —
[claude-code#40408](https://github.com/anthropics/claude-code/issues/40408), where a 22-pattern
write-blocklist was defeated by `perl -i -pe`.

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

### `ugrep`/`bfs` are not a separate binary — they shadow `grep`/`find`

On a native build the snapshot Claude Code sources into every Bash call replaces both names with the
Claude binary re-executed under a different `argv[0]`. `type grep` reports "a shell function from
`~/.claude/shell-snapshots/…`", and the body is:

```sh
local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"
[[ -x $_cc_bin ]] || _cc_bin=~/.local/bin/claude
ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git … ${1+"$@"}
```

(`exec -a ugrep` on non-zsh shells; same mechanism, see
[claude-code#78700](https://github.com/anthropics/claude-code/issues/78700).) So `which ugrep`
finds nothing while ugrep is very much in use, and blocking `grep` on such a build blocks
Anthropic's own embedded search, not GNU grep.

### The one sanctioned fallback: `NO_BASH_SEARCH_FALLBACK=1`

Blocking search is correct while a structured alternative exists. It stops being correct when none
does: a native build (no `Grep`/`Glob` tools) with the fff MCP down leaves no compliant way to
search at all, and an agent with no legal path takes an illegal one — that is how the `perl` reflex
started.

Setting `NO_BASH_SEARCH_FALLBACK=1` in `settings.json` → `env` lets `grep`, `egrep`, `fgrep`, `rg`
and `find` through to Claude Code's embedded search (ugrep, ripgrep for `rg`, bfs). Deliberate
properties:

- **Opt-in, default off.** Absent the variable nothing changes. It is global and silent once set,
  so unset it when fff is back.
- **Search names only.** `cat`, `head`, `tail`, `sed -n`, `awk`, `wc` and `perl` stay blocked —
  `Read` is present on every build, so reads never lack an alternative. The setting
  allows command names, not purposes: an allowed `grep`/`find` can still print a whole file
  (`grep '' f`, `find … -exec cat {} \;`). The hook does not try to catch that; an agent does not
  write these to get around the hook (see the threat model).
- **Not self-grantable.** The hook reads its own `process.env`, so a `NO_BASH_SEARCH_FALLBACK=1 grep …`
  prefix on the command does not enable it; `readCommand` strips the assignment and the arm
  blocks as usual. Only the user, via settings, can open it.
- **Direct invocations only.** A search nested in `$(grep …)`, `bash -c "grep …"`, backticks or
  process substitution still blocks. The setting covers the command line only, as it did when
  these were regex scans that could not tell a search tool from a reader.

## Limits

- a parser, bundled. The hook was regex-only because a real bash AST parser
  ([oryband/claude-code-auto-approve](https://github.com/oryband/claude-code-auto-approve),
  shfmt + jq) needs `shfmt` installed. unbash is pure JS, so `pnpm build` bundles it into
  `no-bash.mjs` and the hook still has no runtime dependencies. The switch replaced the
  hand-written splitter, chain counter, wrapper stripper and the `$(…)`/backtick/`<(…)`/`bash -c`
  regexes. Every existing fixture passed unchanged. A replay of 10,781 distinct real Bash
  commands from local transcripts (2026-10-18) through the old and the new hook gave the same
  verdict for 10,759. Of the 22 that changed, 19 now pass because they run on another host or in a container
  (`ssh h '… $(cat …)'`, `ssh h 'bash -s' <<'EOF'`, `docker exec c sh -c "grep …"`). One
  multi-line `node -e '…'` script that the old splitter miscounted as several commands now
  passes. One `node -e "…"` with backticks inside double quotes now blocks as chaining, because
  bash does run those backticks as commands. One `$(… grep …)` reports `dollar-sub` instead of
  `bash-grep`. Cost: Node loads a ~211kB bundle, 1.5–3.8ms more per call in
  `bench-no-bash.mjs` (cold-start medians of 29.4–31.7ms across four runs, vs 27.9ms before);
  the large-input worst case is 97.4–105.4ms across those runs (102.8ms before), about 2% of the
  5000ms hook timeout
- what the parse changes, as classes (each a case in `redteam-no-bash.mjs` or seen in the replay):
  - newly blocked, because bash runs it: a banned tool or mutating git behind a wrapper, a path
    or a wrapper flag's value (`timeout 60 git push`, `/usr/bin/git commit`, `! grep`,
    `xargs -I % grep`, `timeout -s KILL 5 grep`), git behind a quoted or unlisted global option
    (`git -C "/my repo" push`, `git --no-optional-locks commit`), a banned tool anywhere in a
    `bash -c` script, a here-string fed to a shell or a substitution (`bash -c "cd x && grep y"`,
    `bash <<< 'cat f'`, `x=$(sed -n 1p f)`), a `;`/`&&`/`||` inside a substitution
    (`echo "$(cd sub && pwd)"`), and `a & b`
  - newly allowed, because bash doesn't run it: tool names inside quoted text (`` '`cat f`' ``,
    `'$(grep x)'`), heredoc bodies fed to a command that isn't a shell, the stdin of a shell that
    runs `-c` or a script file, `#` comments, `[[ a && b ]]`
  - same block, new tag: `cat … &> file` and `{ cat a; } >> out` are `cat-write` (were
    `cat-read`), a heredoc script fed to a shell is `bashc-banned`, and a loop, `if` or `case`
    around a banned tool reports the tool's tag, not `chaining`
- unbash parses GNU Bash; the Bash tool runs the user's shell (zsh on macOS), so zsh-only
  syntax may parse differently. A parse error never blocks by itself: the commands unbash could
  read are still checked
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
