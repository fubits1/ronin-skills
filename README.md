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

## Plugin

One plugin. Standalone. No dependencies on other marketplaces' plugins.

| Plugin | Skills/Hooks | What it does |
| --- | --- | --- |
| [agent](plugins/agent/) | 15 skills, 4 hooks | Research, planning, self-checks, completion verification, git/CI workflow, package-manager and security rules, plus 4 enforcement hooks (nogrep, plan-mode, no-absolute-paths, auto-formatter). |

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

### 3. Install the plugin

```
/plugin install agent
```

## Updating

To get the latest version:

```
/plugin marketplace update ronin-skills
/reload-plugins
```

This re-fetches the catalog and updates the installed `agent` plugin to the latest release, then `/reload-plugins` applies it without a restart.

To update automatically at startup instead, enable auto-update once: open `/plugin`, go to the **Marketplaces** tab, select `ronin-skills`, and choose **Enable auto-update** (off by default for third-party marketplaces). Claude Code then prompts you to run `/reload-plugins` whenever it pulls a new version.

## Skill behavior

Skills in this marketplace have auto-invocation triggers defined in their descriptions. Claude Code may invoke them automatically when it detects relevant context (e.g. starting research, declaring a task done, running git commands). You can also invoke any skill manually via `/skill-name` or its fully qualified form `/agent:skill-name`. To disable auto-invocation for a specific skill, add `disable-model-invocation: true` to that skill's SKILL.md frontmatter.

## Hooks

The `agent` plugin ships 4 enforcement hooks that live next to the skills they enforce:

| Hook | Trigger | What it does |
| --- | --- | --- |
| `nogrep.sh` | PreToolUse (Bash) | Hard-blocks Bash file-read/search tools (`grep`/`cat`/`find`/`head`/`tail`/`awk`/`wc`/`rg`) and their shell-out bypass vectors, checking each segment of compound commands so nothing rides along. Also blocks gratuitous command chaining (`&&`/`\|\|`/`;`), forcing one command per call. Routes the agent to dedicated tools (fff MCP, Grep / Read / Glob / Write, jq). Rationale + sources: [nogrep.md](plugins/agent/hooks/nogrep.md). |
| `force-plan-mode.sh` | UserPromptSubmit | Detects `/plan`, "make a plan", etc. — injects a directive forcing `EnterPlanMode` as the next tool call. |
| `no-absolute-paths.sh` | PreToolUse (Bash) | Blocks Bash calls that prepend the project-root absolute path (or `~`-form / `$HOME`-form) to commands. Keeps `permissions.allow` clean. |
| `fix-formatting.sh` | PostToolUse (Write\|Edit) | Auto-formats edited files via Prettier (non-Markdown) or markdownlint (`.md`). Silent on success. |

A `SessionStart` hook also injects a mandatory directive to invoke the `discipline` skill at the start of every session.

## Namespace and how it relates to other marketplaces

Claude Code's plugin namespaces are **global** — `agent:research` resolves to whichever installed plugin is named `agent`, regardless of which marketplace provided it. This marketplace ships the canonical `agent` plugin.

If you also install [fubits1/svelte-skills](https://github.com/fubits1/svelte-skills), its `frontend:*` and `svelte-5:*` skills reference `agent:research`, `agent:done`, `agent:before-you-act`, etc. — those references resolve against `agent@ronin-skills` installed here. No additional configuration needed.

If you don't install svelte-skills, the `agent` plugin still works fully — every cross-reference in its skills is either intra-plugin (e.g. `agent:plan` references `agent:research`) or uses generic wording (e.g. "your project's validate skill") with no hard dependency on other marketplaces.

## Context budget

Claude Code allocates 1% of context window (fallback: 8,000 chars) for skill descriptions. Each description is capped at 250 chars. This marketplace adds ~15 skill descriptions on top of whatever else is installed.

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
