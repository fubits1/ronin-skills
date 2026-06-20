# hooks

Optional enforcement hooks for the [`agent`](../agent/) plugin. Installing this plugin opts
you into enforcement; installing `agent` alone gives the skills with no global side effects.

Part of the [ronin-skills](https://github.com/fubits1/ronin-skills) marketplace.

> **Global once installed.** These hooks fire in every project on the machine (user scope),
> not just one repo. A bug in a Bash hook affects every project at once. Install only if you
> want that enforcement everywhere.

> **Mixed runtimes.** `no-bash.mjs` and `no-honest.mjs` are zero-dependency Node scripts that run
> cross-OS (native Windows included) — they need only `node` on `PATH`, present wherever Claude
> Code runs, and no `jq` at runtime. The remaining hooks (`force-plan-mode.sh`,
> `no-absolute-paths.sh`, `fix-formatting.sh`) are Bash scripts using `sed`/`awk`/`jq`: they run on
> macOS and Linux, and on Windows need WSL or Git Bash / MSYS with `jq` on `PATH` (not native
> `cmd.exe` or PowerShell). `jq` is required for those Bash hooks and for the test harness (which
> fails fast without it).

## Hooks

| Hook | Trigger | What it does |
| --- | --- | --- |
| `no-bash.mjs` | PreToolUse (Bash) | Hard-blocks Bash file-read/search tools (`grep`/`cat`/`find`/`head`/`tail`/`awk`/`wc`/`rg`) and their shell-out bypass vectors, checking each segment of compound commands so nothing rides along. Also blocks gratuitous command chaining (`&&`/`\|\|`/`;`), forcing one command per call. Routes the agent to dedicated tools (fff MCP, Grep / Read / Glob / Write, jq). Zero-dependency cross-OS Node (Windows included). Rationale + sources: [hooks/no-bash.md](hooks/no-bash.md). |
| `force-plan-mode.sh` | UserPromptSubmit | Detects `/plan`, "make a plan", etc. and injects a directive forcing `EnterPlanMode` as the next tool call. |
| `no-absolute-paths.sh` | PreToolUse (Bash) | Blocks Bash calls that prepend the project-root absolute path (or `~`-form / `$HOME`-form) to commands. Keeps `permissions.allow` clean. |
| `fix-formatting.sh` | PostToolUse (Write\|Edit) | Auto-formats edited files via Prettier (non-Markdown) or markdownlint (`.md`). Silent on success. |
| `no-honest.mjs` | Stop | Non-blocking nudge: if any message this turn says `honest` or `honestly` (the agent vouching for its own truthfulness instead of showing proof), injects `additionalContext` to show evidence next time. Advisory — the enforceable rule lives in `agent:discipline`; `decision:block` is avoided (it crashes Opus 4.x thinking sessions → 400). Zero-dependency Node; bounded read, flat ~28 ms; loop-guarded. Rationale + research: [hooks/no-honest.md](hooks/no-honest.md). |

A `SessionStart` hook also injects a directive to invoke the `agent:discipline` skill at the
start of every session.

## Requires the `agent` plugin

These hooks reference `agent` skills: the SessionStart directive invokes `agent:discipline`,
`force-plan-mode.sh` drives the `agent:plan` flow, and `no-bash.mjs`'s block messages point at
the `agent:no-bash` skill. Install `agent` first. Without it the hooks still block correctly,
but the directives reference skills you won't have.

## Installation

```
/plugin install agent
/plugin install hooks
/reload-plugins
```

## Tests

```
node plugins/hooks/hooks/tests/run-no-bash-tests.mjs    # CI: no-bash.mjs functional contract
node plugins/hooks/hooks/tests/redteam-no-bash.mjs      # CI: no-bash.mjs adversarial / edge-case battery
node plugins/hooks/hooks/tests/mock-install-no-bash.mjs # CI: no-bash.mjs install-wiring proof
bash plugins/hooks/hooks/tests/run-no-honest-tests.sh  # CI: the no-honest Stop hook
```
