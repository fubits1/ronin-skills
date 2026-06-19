# hooks

Optional enforcement hooks for the [`agent`](../agent/) plugin. Installing this plugin opts
you into enforcement; installing `agent` alone gives the skills with no global side effects.

Part of the [ronin-skills](https://github.com/fubits1/ronin-skills) marketplace.

> **Global once installed.** These hooks fire in every project on the machine (user scope),
> not just one repo. A bug in a Bash hook affects every project at once. Install only if you
> want that enforcement everywhere.

> **Bash required — not native Windows.** The hooks are Bash scripts using `sed`/`awk`/`jq`.
> They run on macOS and Linux. On Windows, use WSL or Git Bash / MSYS with `jq` on `PATH`;
> they will not run under native `cmd.exe` or PowerShell. `jq` must be installed
> (the test harness fails fast without it). The one exception is `no-honest.mjs`, a
> zero-dependency Node script that runs cross-OS (native Windows included) and needs
> `node` on `PATH` — present wherever Claude Code runs.

## Hooks

| Hook | Trigger | What it does |
| --- | --- | --- |
| `nogrep.sh` | PreToolUse (Bash) | Hard-blocks Bash file-read/search tools (`grep`/`cat`/`find`/`head`/`tail`/`awk`/`wc`/`rg`) and their shell-out bypass vectors, checking each segment of compound commands so nothing rides along. Also blocks gratuitous command chaining (`&&`/`\|\|`/`;`), forcing one command per call. Routes the agent to dedicated tools (fff MCP, Grep / Read / Glob / Write, jq). Rationale + sources: [hooks/nogrep.md](hooks/nogrep.md). |
| `force-plan-mode.sh` | UserPromptSubmit | Detects `/plan`, "make a plan", etc. and injects a directive forcing `EnterPlanMode` as the next tool call. |
| `no-absolute-paths.sh` | PreToolUse (Bash) | Blocks Bash calls that prepend the project-root absolute path (or `~`-form / `$HOME`-form) to commands. Keeps `permissions.allow` clean. |
| `fix-formatting.sh` | PostToolUse (Write\|Edit) | Auto-formats edited files via Prettier (non-Markdown) or markdownlint (`.md`). Silent on success. |
| `no-honest.mjs` | Stop | Non-blocking nudge: if any message this turn says `honest` or `honestly` (the agent vouching for its own truthfulness instead of showing proof), injects `additionalContext` to show evidence next time. Advisory — the enforceable rule lives in `agent:discipline`; `decision:block` is avoided (it crashes Opus 4.x thinking sessions → 400). Zero-dependency Node; bounded read, flat ~28 ms; loop-guarded. Rationale + research: [hooks/no-honest.md](hooks/no-honest.md). |

A `SessionStart` hook also injects a directive to invoke the `agent:discipline` skill at the
start of every session.

## Requires the `agent` plugin

These hooks reference `agent` skills: the SessionStart directive invokes `agent:discipline`,
`force-plan-mode.sh` drives the `agent:plan` flow, and `nogrep.sh`'s block messages point at
the `agent:nogrep` skill. Install `agent` first. Without it the hooks still block correctly,
but the directives reference skills you won't have.

## Installation

```
/plugin install agent
/plugin install hooks
/reload-plugins
```

## Tests

```
bash plugins/hooks/hooks/tests/run-nogrep-tests.sh    # CI happy-path contract
bash plugins/hooks/hooks/tests/redteam-nogrep.sh      # adversarial / edge-case battery
bash plugins/hooks/hooks/tests/run-no-honest-tests.sh # CI: the no-honest Stop hook
```
