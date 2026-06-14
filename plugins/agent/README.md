# agent

Claude Code plugin for framework-agnostic AI coding agent discipline. Fifteen skills + four enforcement hooks covering research rigor, pre-action safety checks, structured planning, completion verification, day-to-day execution discipline (git safety, dev-server lifecycle, command obedience, supply-chain checks, CI workflow), communication discipline, and a meta-skill for syncing skill collections.

Not frontend-specific, not Svelte-specific. Works with any codebase.

Part of the [ronin-skills](https://github.com/fubits1/ronin-skills) marketplace.

## Skills

| Skill | Purpose |
| --- | --- |
| `research` | Investigation discipline — mandatory research channels (local, docs, online, synthesis), evidence requirements, bullshit gate |
| `before-you-act` | Five-gate self-check: unauthorized action, irreversibility, unverified claims, premature completion, unread output |
| `plan` | Planning and problem-solving — research-first plans, systematic debugging, survival context for long tasks |
| `done` | Final checklist — browser verification, lint, full validation, flake detection, evidence-based reporting |
| `asshole` | Never dismiss failures as "not my problem" when reporting test/build output |
| `ci` | CI/CD workflow — validating GitHub Actions, Playwright in CI, CI-script entry points, full-log reading on failure |
| `dev-server` | Background-process lifecycle — never start the user's server, kill cleanups, port safety |
| `discipline` | Communication and scope discipline — interaction rules, rejection handling, scope-stays-fixed |
| `git` | Git safety — `git mv` for renames, no `stash`, no destructive resets, no deletion of dirty files |
| `nogrep` | Use fff MCP / Grep / Read / Glob instead of Bash for file search/read (paired with the `nogrep.sh` enforcement hook) |
| `obey` | Run user-given commands verbatim — no decomposition, no "equivalent" substitutions |
| `pnpm` | Always pnpm (never npm/npx), socket checks before install, official migration CLIs |
| `socket` | Supply-chain checks via Socket.dev — score evaluation before installing, project scans |
| `tea` | "Coffee or tea? YES." — triggers when Claude offers an X-or-Y choice instead of just doing the work |
| `update-skills` | Reconcile two skill collections — backport from a source dir into a marketplace, with proprietary-reference scrubbing |

## Hooks

| Hook | Trigger | What it does |
| --- | --- | --- |
| `nogrep.sh` | PreToolUse (Bash) | Hard-blocks Bash file-read/search tools (`grep`/`cat`/`find`/…) and their bypass vectors, checking each segment of compound commands so nothing rides along. Also blocks gratuitous command chaining (`&&`/`\|\|`/`;`), forcing one command per call. Routes the agent to dedicated tools (fff MCP, Grep / Read / Glob / Write, jq). Rationale + sources: [hooks/nogrep.md](hooks/nogrep.md). |
| `force-plan-mode.sh` | UserPromptSubmit | Detects `/plan`, "make a plan", etc. — injects a directive forcing `EnterPlanMode` as the next tool call. |
| `no-absolute-paths.sh` | PreToolUse (Bash) | Blocks Bash calls that prepend the project-root absolute path (or `~`-form / `$HOME`-form) to commands. Keeps `permissions.allow` clean. |
| `fix-formatting.sh` | PostToolUse (Write\|Edit) | Auto-formats edited files via Prettier (non-Markdown) or markdownlint (`.md`). Silent on success. |

Also: a `SessionStart` hook injects a mandatory directive to invoke the `discipline` skill at session start.

## Prerequisites

The `superpowers` plugin must be installed. The `plan` skill references `superpowers:systematic-debugging` for complex bug investigations.

## Installation

See the [ronin-skills marketplace README](https://github.com/fubits1/ronin-skills) for installation and setup instructions.
