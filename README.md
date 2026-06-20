# ronin-skills

Claude Code plugin marketplace for framework-agnostic AI coding agent discipline. Standalone, usable in most projects.

> **Why "ronin"?** The natural name `agent-skills` is reserved by Anthropic for official marketplaces from the `anthropics` GitHub organization. **[Rōnin](https://en.wikipedia.org/wiki/R%C5%8Dnin)** — a masterless samurai of feudal Japan, skilled, code-bound, self-directed — fits the spirit: a disciplined agent that arrives in any project, brings its own skills + ethics, and works without a fixed master.
>
> Extracted from [fubits1/svelte-skills](https://github.com/fubits1/svelte-skills) v0.3.1.
>
> Biased towards:
>
> - fff instead of grep/bash/cat/find/head/tail/awk/wc
> - jq for JSON parsing/shaping
> - Socket.dev for supply-chain checks
> - pnpm

## Plugins

Two plugins. The skills (`agent`) and the enforcement hooks (`hooks`) install separately, so enforcement is opt-in.

| Plugin | Contents | What it does |
| --- | --- | --- |
| [agent](plugins/agent/) | 16 skills | Research, planning, self-checks, completion verification, git/CI workflow, package-manager and security rules. Skills/guidance only, no global side effects. Requires the `superpowers` plugin. |
| [hooks](plugins/hooks/) | 5 hooks | Optional enforcement: nogrep (route Bash file-read/search to dedicated tools), no-absolute-paths, force-plan-mode, auto-formatter, no-honest (stop the agent vouching with `honest` instead of showing evidence), plus a SessionStart `discipline` directive. Install to opt into enforcement. Requires `agent`. |

## Installation

### 1. Add the marketplace

```
/plugin marketplace add fubits1/ronin-skills
```

For local development/testing:

```
/plugin marketplace add /path/to/ronin-skills
```

### 2. Install prerequisites

**Superpowers plugin** (required by `agent`):

```
/plugin install superpowers
```

### 3. Install the plugin(s)

The skills:

```
/plugin install agent
```

Optional — the enforcement hooks (Bash-tool blocking, plan-mode forcing, auto-format, discipline directive). **These are global**: once installed they fire in every project on the machine. They are a mix of runtimes: `nogrep.mjs` and `no-honest.mjs` are zero-dependency cross-OS Node (native Windows included); the rest (`force-plan-mode`, `no-absolute-paths`, auto-format) are **Bash/`jq` scripts — macOS and Linux, or WSL / Git Bash with `jq` on Windows**. Install only if you want enforcement:

```
/plugin install hooks
```

## Updating

To get the latest version:

```
/plugin marketplace update ronin-skills
/reload-plugins
```

This re-fetches the catalog and updates **all installed plugins** from this marketplace (e.g. `agent`, `hooks`) to the latest release. Run `/reload-plugins` afterward to apply changes without a restart.

To update automatically at startup instead, enable auto-update once: open `/plugin`, go to the **Marketplaces** tab, select `ronin-skills`, and choose **Enable auto-update** (off by default for third-party marketplaces). Claude Code then prompts you to run `/reload-plugins` whenever it pulls a new version.

## Skill behavior

Skills in this marketplace have auto-invocation triggers defined in their descriptions. Claude Code may invoke them automatically when it detects relevant context (e.g. starting research, declaring a task done, running git commands). You can also invoke any skill manually via `/skill-name` or its fully qualified form `/agent:skill-name`. To disable auto-invocation for a specific skill, add `disable-model-invocation: true` to that skill's SKILL.md frontmatter.

## Hooks

The optional **`hooks`** plugin (`/plugin install hooks`) ships 5 enforcement hooks (plus a SessionStart directive) that back the `agent` skills. They are global once installed, and require the `agent` plugin (the SessionStart and plan-mode hooks reference `agent` skills):

| Hook | Trigger | What it does |
| --- | --- | --- |
| `nogrep.mjs` | PreToolUse (Bash) | Hard-blocks Bash file-read/search tools (`grep`/`cat`/`find`/`head`/`tail`/`awk`/`wc`/`rg`) and their shell-out bypass vectors, checking each segment of compound commands so nothing rides along. Also blocks gratuitous command chaining (`&&`/`\|\|`/`;`), forcing one command per call. Routes the agent to dedicated tools (fff MCP, Grep / Read / Glob / Write, jq). Zero-dependency cross-OS Node (Windows included — see [#18610](https://github.com/anthropics/claude-code/issues/18610)). Rationale + sources: [nogrep.md](plugins/hooks/hooks/nogrep.md). |
| `force-plan-mode.sh` | UserPromptSubmit | Detects `/plan`, "make a plan", etc. — injects a directive forcing `EnterPlanMode` as the next tool call. |
| `no-absolute-paths.sh` | PreToolUse (Bash) | Blocks Bash calls that prepend the project-root absolute path (or `~`-form / `$HOME`-form) to commands. Keeps `permissions.allow` clean. |
| `fix-formatting.sh` | PostToolUse (Write\|Edit) | Auto-formats edited files via Prettier (non-Markdown) or markdownlint (`.md`). Silent on success. |
| `no-honest.mjs` | Stop | Non-blocking nudge: if any message this turn says `honest` or `honestly` (the agent vouching for its own truthfulness instead of showing proof), injects `additionalContext` to show evidence next time. Advisory — the enforceable rule lives in `agent:discipline`; `decision:block` is avoided (it crashes Opus 4.x thinking sessions → 400). Zero-dependency Node; bounded read, flat ~28 ms; loop-guarded. Rationale + research: [no-honest.md](plugins/hooks/hooks/no-honest.md). |

A `SessionStart` hook also injects a mandatory directive to invoke the `discipline` skill at the start of every session.

## Migration (0.4.x): `nogrep` moved from bash to Node

The `nogrep` PreToolUse hook now ships as **`nogrep.mjs`** (Node), replacing the old `nogrep.sh` (bash). Plugin **shell** hooks do not run on native Windows ([#18610](https://github.com/anthropics/claude-code/issues/18610)), so `nogrep` was ported to a zero-dependency Node ESM script for cross-OS support. **Behavior is unchanged** — same blocks, same `reason=` tags — and it no longer needs `jq` at runtime. The Bash hooks (`force-plan-mode`, `no-absolute-paths`, auto-format) remain Bash/`jq` (macOS and Linux, or WSL / Git Bash on Windows); `no-honest.mjs` is also Node. Update with `/plugin marketplace update ronin-skills` + `/reload-plugins`. Design rationale: [hooks/nogrep.md](plugins/hooks/hooks/nogrep.md).

## Migration (0.2.x to 0.3.0)

**Breaking change: the hooks moved out of the `agent` plugin into a new `hooks` plugin.**

Before 0.3.0, installing `agent` also installed the 4 enforcement hooks. As of 0.3.0, `agent` is **skills only** and the hooks ship in a separate, optional `hooks` plugin.

If you had enforcement via `agent`, then after `/plugin marketplace update ronin-skills` the hooks **stop firing** — `nogrep`, `no-absolute-paths`, `force-plan-mode`, the auto-formatter, and the SessionStart `discipline` directive all go silent. To keep enforcement, install the new plugin:

```
/plugin marketplace update ronin-skills
/plugin install hooks
/reload-plugins
```

If you preferred the hooks NOT firing globally, do nothing: updating `agent` alone now gives you the skills with no global side effects, which is the new default.

## Namespace and how it relates to other marketplaces

Claude Code's plugin namespaces are **global** — `agent:research` resolves to whichever installed plugin is named `agent`, regardless of which marketplace provided it. This marketplace ships the canonical `agent` plugin.

If you also install [fubits1/svelte-skills](https://github.com/fubits1/svelte-skills), its `frontend:*` and `svelte-5:*` skills reference `agent:research`, `agent:done`, `agent:before-you-act`, etc. — those references resolve against `agent@ronin-skills` installed here. No additional configuration needed.

If you don't install svelte-skills, the `agent` plugin still works fully — every cross-reference in its skills is either intra-plugin (e.g. `agent:plan` references `agent:research`) or uses generic wording (e.g. "your project's validate skill") with no hard dependency on other marketplaces.

## Context budget

Claude Code allocates 1% of context window (fallback: 8,000 chars) for skill descriptions. Each description is capped at 250 chars. This marketplace adds ~16 skill descriptions on top of whatever else is installed.

Run `/context` to check for budget warnings. Override with `SLASH_COMMAND_TOOL_CHAR_BUDGET=<chars>`.

Source: [Claude Code skills docs](https://code.claude.com/docs/en/skills)

## Complementary resources

- [fubits1/svelte-skills](https://github.com/fubits1/svelte-skills) — frontend + Svelte 5 + Svelte 5 migration plugins. Soft-depends on `agent@ronin-skills`.
- [spences10/claude-code-toolkit](https://github.com/spences10/claude-code-toolkit) — domain-split alternative (mcp / analytics / workflow / devops / dev-practices / dev-environment / secrets plugins).
- [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — ultra-compressed communication mode for terser agent output.

## Skill development / Ops

- use [agent:update-skills](plugins/agent/skills/update-skills/) to backport skills between a local dir and this marketplace.

## Releases

Browse release history at [Releases](https://github.com/fubits1/ronin-skills/releases). Maintainer release process: see [RELEASING.md](RELEASING.md).

## License

MIT
