# hooks

Optional enforcement hooks for the [`agent`](../agent/) plugin. Installing this plugin opts
you into enforcement; installing `agent` alone gives the skills with no global side effects.

Part of the [ronin-skills](https://github.com/fubits1/ronin-skills) marketplace.

> **Global once installed.** These hooks fire in every project on the machine (user scope),
> not just one repo. A bug in a Bash hook affects every project at once. Install only if you
> want that enforcement everywhere.

> **All Node, cross-OS.** Every hook runs on Node and works on every OS Claude Code supports (native
> Windows included) — they need only `node` on `PATH`, no `jq`/`bash`. All but one use only the Node
> standard library; the auto-formatter (`fix-formatting.mjs`) shells out to `npx prettier` /
> `markdownlint-cli2` — `npx` ships with Node and fetches those formatters on demand (they are NOT
> bundled). A plugin **shell** hook can't run on native Windows
> ([#18610](https://github.com/anthropics/claude-code/issues/18610)), which is why none remain.

## Hooks

| Hook | Trigger | What it does |
| --- | --- | --- |
| `no-bash.mjs` | PreToolUse (Bash) | Hard-blocks Bash file-read/search tools (`grep`/`cat`/`find`/`head`/`tail`/`awk`/`wc`/`rg`) and their shell-out bypass vectors, checking each segment of compound commands so nothing rides along. Also blocks gratuitous command chaining (`&&`/`\|\|`/`;`), forcing one command per call. Routes the agent to dedicated tools (fff MCP, Grep / Read / Glob / Write, jq). Zero-dependency cross-OS Node (Windows included). Rationale + sources: [hooks/no-bash.md](hooks/no-bash.md). |
| `force-plan-mode.mjs` | UserPromptSubmit | Detects `/plan`, "make a plan", etc. and injects a directive forcing `EnterPlanMode` as the next tool call. |
| `no-absolute-paths.mjs` | PreToolUse (Bash) | Blocks Bash calls that prepend the project-root absolute path (or `~`-form / `$HOME`-form) to commands. Keeps `permissions.allow` clean. |
| `fix-formatting.mjs` | PostToolUse (Write\|Edit) | Auto-formats edited files via Prettier (non-Markdown) or markdownlint (`.md`). Silent on success. |
| `no-honest.mjs` | Stop | Non-blocking nudge: if any message this turn says `honest` or `honestly` (the agent vouching for its own truthfulness instead of showing proof), injects `additionalContext` to show evidence next time. Advisory — the enforceable rule lives in `agent:discipline`; `decision:block` is avoided (it crashes Opus 4.x thinking sessions → 400). Zero-dependency Node; bounded read, flat ~28 ms; loop-guarded. Rationale + research: [hooks/no-honest.md](hooks/no-honest.md). |

A `SessionStart` hook also injects a directive to invoke the `agent:discipline` skill at the
start of every session.

## Requires the `agent` plugin

These hooks reference `agent` skills: the SessionStart directive invokes `agent:discipline`,
`force-plan-mode.mjs` drives the `agent:plan` flow, and `no-bash.mjs`'s block messages point at
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
node plugins/hooks/hooks/tests/validate-no-bash.mjs     # CI: shlex-oracle differential + seeded fuzz (needs python3)
node plugins/hooks/hooks/tests/bench-no-bash.mjs        # CI: perf / no-ReDoS gate
node plugins/hooks/hooks/tests/replay-transcript-no-bash.mjs <dir>  # ad-hoc: replay real session commands for false positives
node plugins/hooks/hooks/tests/run-hook-tests.mjs       # CI: force-plan-mode / no-absolute-paths / fix-formatting / session-start
bash plugins/hooks/hooks/tests/run-no-honest-tests.sh  # CI: the no-honest Stop hook
```
