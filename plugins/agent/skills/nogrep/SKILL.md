---
name: nogrep
description: "Use fff MCP / Grep / Read / Glob — never Bash grep/cat/find/head/tail/sed/awk/rg/wc — for file search and read. Use jq for JSON parsing/shaping (not node -e / python -c). A hook hard-blocks the banned Bash calls, and the dedicated tools return clean, cacheable, line-numbered results. Auto-invoke when searching, reading, or counting in files."
user-invocable: true
---

# Use Dedicated Tools, Not Bash

## Self-Check

Before every Bash call, ask: "Am I reading or searching file contents? Am I running a git command?" If reading/searching files — use fff first, the built-in tool second. If running git commands — route to `gh` / `! git` (exception: `git mv` stays in Bash). Period.

## Why

The reason is not permission clicks: Claude Code runs `grep`/`cat`/`head`/`tail`/`find`/`wc` as native read-only commands with no prompt. Prefer the dedicated tools for three concrete reasons:

- Grep/Read return clean, paginated, line-numbered results instead of raw terminal dumps the model then re-parses.
- Built-in tool approvals cache. Unique Bash content, especially `cat > file` heredocs, never caches, so a human re-reviews it on every run (the heaviest pattern in claude-code#19649).
- The hook fires where the system prompt fails. The model ignores its own "don't use Bash for this" instruction ~40% of sessions, more after context compaction and in subagents. Anthropic closed that as not-planned (claude-code#39979), so enforcement has to live in a hook.

The `agent` plugin ships a hook (`plugins/agent/hooks/nogrep.sh`) that hard-blocks the wrong Bash calls. This skill is the educational mapping; the hook is the enforcement. Full rationale and sources: `plugins/agent/hooks/nogrep.md`.

## Tool Preference Order

### For file search / read

1. **[fff](https://fff.dmtrkovalenko.dev/) MCP** — first choice for any file search or content grep inside a git-indexed directory. Frecency-ranked results (frequent/recent files first, dirty files boosted), git-aware, constraint-aware. See README.md → "fff instead of grep/bash etc.".
2. **Built-in `Grep` / `Read` / `Glob`** — fallback when fff isn't installed or the search target lies outside the git tree.
3. **Bash** — only for the legitimate uses listed at the bottom of this skill.

### For JSON parsing / shaping

1. **`jq`** — first choice for any JSON work: reshaping API output, extracting fields, building hook input fixtures, constructing test payloads. Shorter than `node -e` / `python -c`, no quoting hell, no subprocess-bypass risk. (Add `Bash(jq:*)` to `permissions.allow` to skip the prompt.)
2. **`node -e` / `python -c`** — fallback only when the logic needs language features jq lacks (complex control flow, regex flavors, library calls). NEVER for shelling out — hook blocks subprocess APIs.

## The Rule

**Never use Bash for reading or searching files.** Both fff and the built-in tools cover every case including multiline, context lines, counting, and pagination.

## Mapping Table

| Instead of this Bash | First choice (fff MCP) | Built-in fallback |
| --- | --- | --- |
| `grep "pattern" file` | `mcp__fff__grep` `query: "file pattern"` | **Grep** `pattern`, `path`, `output_mode: "content"` |
| `grep -r "pattern" dir` | `mcp__fff__grep` `query: "dir/ pattern"` | **Grep** `pattern`, `path: "dir"` |
| `grep -rl "pattern"` | `mcp__fff__grep` `output_mode: "files_with_matches"` | **Grep** `output_mode: "files_with_matches"` |
| `grep -c "pattern"` | `mcp__fff__grep` `output_mode: "count"` | **Grep** `output_mode: "count"` |
| `grep --include="*.ts"` | `mcp__fff__grep` `query: "*.ts pattern"` | **Grep** `glob: "*.ts"` |
| `rg -U "multiline"` | n/a (use built-in) | **Grep** `multiline: true` |
| Multiple identifiers (OR) | `mcp__fff__multi_grep` `patterns: [...]` | sequential Grep calls |
| `find . -name "*.ts"` | `mcp__fff__find_files` `query: "name **/*.ts"` | **Glob** `pattern: "**/*.ts"` |
| `find . -name "*test*"` | `mcp__fff__find_files` `query: "test"` | **Glob** `pattern: "**/*test*"` |
| `cat file` / `cat -n file` | n/a (use built-in) | **Read** `file_path` |
| `cat > file <<EOF` (creation) | n/a (use built-in) | **Write** `file_path`, `content` (NOT Read, this writes) |
| `head -100 file` | n/a (use built-in) | **Read** `limit: 100` |
| `tail -n +50 file \| head -30` | n/a (use built-in) | **Read** `offset: 50`, `limit: 30` |
| `sed -n '50,80p' file` | n/a (use built-in) | **Read** `offset: 50`, `limit: 31` |
| `ls dir/` (listing) | `mcp__fff__find_files` `query: "dir/"` | **Glob** `pattern: "dir/*"` |
| `wc -l file` | n/a (use built-in) | **Grep** `pattern: "."`, `output_mode: "count"`, `path: "file"` |

## fff Core Rules

- **Search bare identifiers**, not code syntax or regex. `ActorAuth` (good); `struct ActorAuth` (bad — adding keywords narrows results and misses traits/enums).
- **Use constraints** to prefilter: `*.rs query`, `src/ query`, `name **/src/*.{ts,tsx} !test/`.
- **Stop after 2 greps — READ.** After 2 grep calls you have enough file paths. Read the top result. More greps ≠ better understanding.
- **`multi_grep`** for OR logic across naming conventions (`ActorAuth`, `actor_auth`, `populatedActorAuth`) — one call, not three.

See fff's own server instructions for the full constraint syntax.

## Multiline — Built-in Only

`mcp__fff__grep` matches within single lines. For cross-line patterns use the built-in `Grep` tool with `multiline: true` (equivalent to `rg -U --multiline-dotall`).

```
Grep(pattern: "struct \\{[\\s\\S]*?field", multiline: true, path: "src/")
```

There is NO reason to use `Bash(rg -U ...)`.

## Compound Built-in Calls

`grep -rl --include="*.ts" -A 5 -i "pattern" src/` becomes one Grep call:

```
Grep(pattern: "pattern", path: "src/", glob: "*.ts", -A: 5, -i: true, output_mode: "content")
```

No pipes. No chaining.

## No Command Chaining

Run one command per Bash call. The hook blocks any command that joins two commands with `&&`, `||`, or `;`, because chaining hides the later commands from per-command approval (a documented permission-bypass vector) and is the bash-one-liner reflex, not a need.

- `pnpm build && pnpm test` is two calls: run `pnpm build`, then run `pnpm test`.
- `cd dir && cmd` is unnecessary: the Bash working directory persists across calls, so `cd dir` once (or just use a relative path) and run `cmd` separately.
- Never append a status probe like `; echo "exit=$?"` or `&& echo done`. The tool result already shows exit status and output.

Allowed because the data must flow in one process, or there is no second command:

- a pipe into `jq` for JSON shaping (`gh pr view --json title | jq .title`)
- redirections (`> file`, `>> file`, `2>&1`)

## What Stays in Bash

These are legitimate Bash uses — either they have no dedicated tool equivalent, or they're narrow, read-only commands (like a simple `ls`) where Bash is fine. The blanket rule still applies for file search / read / mutation: use dedicated tools.

- **gh**: `gh pr view`, `gh pr list`, `gh run view`, `gh api`, etc. Prefer `gh` over `git` for reading remote state. (Add `Bash(gh:*)` to your `permissions.allow` to skip the prompt — the plugin can't ship that rule for you.)
- **pnpm/npm**: `pnpm install`, `pnpm build`, `pnpm test`, etc.
- **docker**: `docker exec`, `docker ps`, `docker compose`, etc.
- **build/dev tools**: `mvn`, `npx`, `pnpx`, etc.
- **Process management**: `lsof`, `kill`, `pkill`
- **File mutations**: `mkdir`, `cp`, `git mv`
- **Environment**: `which`, `java -version`
- **`jq`** — first-class JSON tool (see "For JSON parsing / shaping" above). Use it. (Add `Bash(jq:*)` to `permissions.allow` to skip the prompt.)
- **`node -e` / `python -c`** — allowed only for in-process logic (math, control flow). NOT for shelling out to banned tools via Node's subprocess APIs or Python's subprocess module. The hook hard-blocks the shell-out case. For JSON, prefer `jq`.
- **Simple `ls`** — Bash `ls` is permitted for narrow, read-only directory listing, but fff MCP (`mcp__fff__find_files`) is preferred for searching/reading files.

## When the hook blocks a command

A `BLOCKED` line from this hook is a **deterministic environment rejection — NOT the user rejecting you.** The block message says so explicitly. Do not narrate it as "the user rejected my command"; the user did not act. Read the `reason=` field, switch to the dedicated tool, and never re-issue the same blocked command unchanged — it will fail identically.

Switch to the dedicated tool (Grep / Read / Glob / fff / jq) — that is the fix. Don't route around the block with `command`, an absolute path, `\grep`, `xargs`, `bash -c`, or a node/python shell-out — the hook catches those too. It also evaluates each segment of a compound command separately, so hiding a banned tool after `;` `&&` `||` `|` `&`, inside a subshell `(grep …)`, a brace group `{ grep …; }`, a process substitution `<(grep …)`, or a command substitution `$(grep …)` is blocked all the same. And it blocks gratuitous chaining (`&&`/`||`/`;` joining two commands) — run each as a separate Bash call. A bypass is a bug to fix in `plugins/agent/hooks/nogrep.sh`, not a loophole to exploit.

## git Commands (permission routing)

Mutating git commands aren't auto-allowed and prompt every time (the hook blocks them too), so route around the prompt: `gh` for remote state (PRs, branches, CI); the `!` prefix for local reads (`! git log`, `! git fetch`) so the output lands in the conversation; `git mv` is a file mutation, so plain Bash is fine. (For git *safety* — what not to run — see `agent:git`.)
