#!/bin/bash
# Block Bash calls that should use dedicated tools (Grep, Read, Glob, Write).
# This hook hard-blocks (exit 2) the Bash call and tells Claude which tool to use.
#
# Why this exists (see nogrep.md for the full rationale + sources):
#   The model reaches for bash grep/cat/find ~40% of sessions despite its own system
#   prompt forbidding it — worse after context compaction and in subagents. Anthropic
#   closed this as not-planned (claude-code#39979), so a hook is the fix. Origin report:
#   claude-code#19649.
#   The win is NOT "every call costs a permission click" — most of these (grep/cat/head/
#   tail/find/wc) are native read-only commands Claude Code runs without a prompt. The
#   real win is: dedicated tools return structured output, their approvals CACHE (bash
#   heredocs / unique content never cache and are re-reviewed every time), and they work
#   in subagents / post-compaction where prompt-adherence collapses.
#
# Preferred tools (NOT blocked — use these freely):
#   - fff MCP (`mcp__fff__grep`, `mcp__fff__find_files`, `mcp__fff__multi_grep`) — file search/read.
#   - Built-in Grep / Read / Glob — fallback when fff unavailable.
#   - jq — JSON parsing/shaping. This hook itself depends on jq (line below).
#         Prefer jq over `node -e` / `python -c` for JSON: shorter, no quoting hell,
#         no subprocess-bypass surface. Auto-allowed in settings via `Bash(jq:*)`.
#
# Polish strategy (regex-only, no external deps beyond jq):
#   - Mirror Claude Code's internal stripping of process wrappers (timeout, time, nice,
#     nohup, stdbuf, xargs) and VAR=value prefixes before first-word extraction.
#   - Catch known bypass vectors: absolute paths, backslash escape, `command` builtin,
#     `exec`/`eval`/`env` wrappers, `bash -c "<banned>"`, command substitution `$(...)`,
#     chained subcommands after `&&` / `||` / `;` / `|`, `node -e` / `python -c`
#     shelling out to subprocess APIs, sed used as a reader (`-n`, Np/N,Mp/$p).
#   - For a proper bash AST parser, see oryband/claude-code-auto-approve (shfmt + jq).

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$COMMAND" ] && exit 0

# block <reason-tag> <message>
# Centralised exit-2 path. Self-labels the block so the model can't mislabel a
# deterministic hook rejection as "the user rejected" — a real, repeated misread —
# and emits a structured `reason=` line alongside the human-readable guidance.
block() {
  local tag="$1" msg="$2"
  echo "[deterministic hook block from nogrep.sh — NOT a user rejection] BLOCKED | reason=$tag" >&2
  echo "$msg" >&2
  exit 2
}

# BANNED: tools the hook hard-blocks. Note: `jq` and `fff` are deliberately NOT here —
# they are preferred tools. `sed` is also absent at this level; sed READS are caught
# in a dedicated sed case-arm below so substitution stays allowed.
BANNED='grep|egrep|fgrep|rg|cat|head|tail|find|awk|wc'

# --- Pre-extraction scans (catch wrapped invocations) -------------------------

# node/deno/bun -e "...<subprocess API>..." shelling out to a banned tool.
# Regex uses bracket-charclass form (`child[_]process`) so the literal banned-API
# substring is not present in this file — avoids editor/source-scanner false positives.
RE_NODE_SHELLOUT="(^|[[:space:]])(node|deno|bun)[[:space:]]+(-e|--eval)[[:space:]]+[\"'].*(child[_]process|exec[S]ync|spawn[S]ync)"
if [[ "$COMMAND" =~ $RE_NODE_SHELLOUT ]]; then
  block node-shellout "Use the dedicated tool (Grep/Read/Glob) instead of shelling out to a subprocess API from inside an embedded JS script."
fi
RE_PY_SHELLOUT="(^|[[:space:]])(python|python3)[[:space:]]+(-c)[[:space:]]+[\"'].*subprocess"
if [[ "$COMMAND" =~ $RE_PY_SHELLOUT ]]; then
  block python-shellout "Use the dedicated tool (Grep/Read/Glob) instead of shelling out to subprocess from inside an embedded Python script."
fi

# bash/sh/zsh/dash -c "<banned>..." — banned tool inside a wrapped shell-out.
RE_BASHC_BANNED="(^|[[:space:]])(bash|sh|zsh|dash)[[:space:]]+-c[[:space:]]+[\"'][[:space:]]*(\\\\?[A-Za-z0-9_./-]*/)?(${BANNED})([^A-Za-z0-9_]|$)"
if [[ "$COMMAND" =~ $RE_BASHC_BANNED ]]; then
  block bashc-banned "Banned tool invoked via 'bash -c' / 'sh -c'. Use the dedicated tool (Grep/Read/Glob) at the top level instead."
fi

# bash/sh/zsh/dash -c "sed -n …" / "sed … Np …" — sed used as a reader inside a wrapped shell-out.
# Substitution forms (`sed 's/x/y/' file`) are still allowed; only -n or bare Np/N,Mp/$p triggers.
# NOTE: char class is [\"'] not [\"\x27] — POSIX ERE does not honor \x escapes.
RE_BASHC_SED_N="(^|[[:space:]])(bash|sh|zsh|dash)[[:space:]]+-c[[:space:]]+[\"'][^\"']*sed[[:space:]]+([^[:space:]]+[[:space:]]+)*-n([[:space:]]|\$)"
if [[ "$COMMAND" =~ $RE_BASHC_SED_N ]]; then
  block bashc-sed-read "'sed -n' inside bash -c / sh -c is a read. Use the Read tool (offset/limit) instead."
fi
RE_BASHC_SED_NP="(^|[[:space:]])(bash|sh|zsh|dash)[[:space:]]+-c[[:space:]]+[\"'][^\"']*sed[[:space:]]+([^[:space:]]+[[:space:]]+)*(-e[[:space:]]+|--expression[[:space:]=])?[\"']?(\\\$|[0-9]+)(,(\\\$|[0-9]+))?p[\"']?([[:space:]]|\$)"
if [[ "$COMMAND" =~ $RE_BASHC_SED_NP ]]; then
  block bashc-sed-read "'sed … Np/N,Mp/\$p' inside bash -c / sh -c is a read. Use the Read tool (offset/limit) instead."
fi

# Command substitution: `$(grep ...)` or backtick-wrapped. Catches absolute-path /
# backslash-escaped variants of the banned tool name inside the substitution.
# Also catches wrapper invocations (`$(command grep ...)`, `$(timeout 5 grep ...)`)
# and env-assignment prefixes (`$(FOO=1 grep ...)`, `$(env FOO=1 rg ...)`).
# Wrapper list mirrors normalize_first() below.
WRAP_PREFIX='((timeout|time|nice|nohup|stdbuf|env|exec|eval|builtin|xargs|command)[[:space:]]+(-[^[:space:]]+[[:space:]]+|[0-9]+[[:space:]]+)*)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*'
RE_DOLLAR_SUB="\\\$\\([[:space:]]*${WRAP_PREFIX}(\\\\?[A-Za-z0-9_./-]*/)?(${BANNED})([^A-Za-z0-9_]|$)"
if [[ "$COMMAND" =~ $RE_DOLLAR_SUB ]]; then
  block dollar-sub "Banned tool inside command substitution \$(...). Use the dedicated tool (Grep/Read/Glob)."
fi
RE_BACKTICK_SUB="\`[[:space:]]*${WRAP_PREFIX}(\\\\?[A-Za-z0-9_./-]*/)?(${BANNED})([^A-Za-z0-9_]|$)"
if [[ "$COMMAND" =~ $RE_BACKTICK_SUB ]]; then
  block backtick-sub "Banned tool inside backtick command substitution. Use the dedicated tool (Grep/Read/Glob)."
fi

# Process substitution: `<(grep ...)` / `>(cat ...)`. The segment splitter never
# breaks on these (no shell operator between `diff` and `<(...)`), so a banned
# tool here would ride along undetected. Mirrors the $()/backtick scans above.
RE_PROCSUB="[<>]\\([[:space:]]*${WRAP_PREFIX}(\\\\?[A-Za-z0-9_./-]*/)?(${BANNED})([^A-Za-z0-9_]|$)"
if [[ "$COMMAND" =~ $RE_PROCSUB ]]; then
  block procsub "Banned tool inside process substitution <(...)/>(...). Use the dedicated tool (Grep/Read/Glob)."
fi

# --- Helper: normalise a single command segment to its effective first word ---
# Strips VAR=value prefixes, process wrappers, leading backslash, and path
# qualifications. Matches Claude Code's own permission-rule stripping for
# wrappers (timeout, time, nice, nohup, stdbuf, xargs without flags) and extends
# with known bypass-vector wrappers (env, exec, eval, builtin).
normalize_first() {
  local cmd="$1"
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"  # ltrim
  # Strip leading group-openers so `(cat x)` / `{ cat x; }` resolve to the inner
  # tool instead of `(cat` / `{`. Repeats for nested/stacked openers like `({`.
  # Use a `case` glob (not a regex bracket class) — matching only `(` and `{`,
  # never a leading backslash, so `\grep` can't trigger a non-progressing loop.
  while :; do
    case "$cmd" in
      '('*|'{'*) cmd="${cmd#?}"; cmd="${cmd#"${cmd%%[![:space:]]*}"}" ;;  # drop opener + ltrim
      *) break ;;
    esac
  done
  # Strip leading VAR=value assignments
  while [[ "$cmd" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    cmd=$(printf '%s' "$cmd" | sed -E 's/^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]*//')
  done
  local first
  first=$(printf '%s' "$cmd" | awk '{print $1}')
  first="${first#\\}"
  case "$first" in */*) first=$(basename "$first") ;; esac
  # Unwrap process wrappers, repeating for chained wrappers like `timeout 5 nice -n 10 grep`.
  # Iteration cap guards against pathological input.
  local _i=0
  while [ "$_i" -lt 8 ]; do
    case "$first" in
      timeout|time|nice|nohup|stdbuf|env|exec|eval|builtin|xargs) ;;
      *) break ;;
    esac
    local rest
    rest=$(printf '%s' "$cmd" | sed -E "s/^[[:space:]]*$first([[:space:]]+|$)//")
    # Skip leading flag tokens AND positional-number tokens (e.g. `timeout 30`, `nice -n 10`)
    # before the wrapped command. Each iteration drops one token starting with `-` or digit.
    while [[ "$rest" =~ ^[[:space:]]*(-|[0-9]) ]]; do
      rest=$(printf '%s' "$rest" | sed -E 's/^[[:space:]]*[^[:space:]]+[[:space:]]*//')
    done
    # Also strip any VAR=value assignments that a wrapper like `env` left behind.
    while [[ "$rest" =~ ^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*= ]]; do
      rest=$(printf '%s' "$rest" | sed -E 's/^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]*//')
    done
    cmd="$rest"
    first=$(printf '%s' "$rest" | awk '{print $1}')
    first="${first#\\}"
    case "$first" in */*) first=$(basename "$first") ;; esac
    _i=$((_i + 1))
  done
  printf '%s' "$first"
}

# --- Main: split command on subcommand boundaries and check each ------------

# Split on `&&`, `||`, `;`, `|`, and background `&` so chained subcommands are
# individually checked. `&&` is matched before bare `&` in the alternation, so a
# logical-AND is never mis-split into two empty-ish halves.
# Conservative: treat the splitters as plain text — quoted strings containing
# `&&`/`;` may false-positive but the case-arm-default exit 0 keeps the hook
# from blocking unrelated commands.
SUBCMDS=$(printf '%s' "$COMMAND" | sed -E 's/(&&|\|\||;|\||&)/\n/g')

while IFS= read -r SUB; do
  [ -z "${SUB// /}" ] && continue
  FIRST_WORD=$(normalize_first "$SUB")
  case "$FIRST_WORD" in
    ls)
      # ls is always allowed — explicit whitelist so future regex tweaks can't accidentally block it.
      ;;
    command)
      block command-builtin "The 'command' builtin is banned (bypass vector for this hook). For 'command -v foo' existence checks, use 'which foo'. For everything else, use the dedicated tool (Grep/Read/Glob)."
      ;;
    git)
      # Block mutating git commands; allow read-only inspection and git mv.
      RE_GIT_MUT='(^|[[:space:]])git[[:space:]]+(add|commit|push|pull|fetch|merge|rebase|reset|restore|checkout|switch|clean|stash|tag|cherry-pick|revert|am|apply|rm|clone|init|config|remote[[:space:]]+(add|remove|rename|set-url))([^A-Za-z0-9_]|$)'
      if [[ "$SUB" =~ $RE_GIT_MUT ]]; then
        block git-mutation "Mutating git command. Use gh for remote state, or suggest the user run ! git <command> locally."
      fi
      ;;
    grep|egrep|fgrep|rg)
      block "bash-$FIRST_WORD" "Use the Grep tool instead of Bash $FIRST_WORD. Grep supports: multiline: true, output_mode (content/files_with_matches/count), -A/-B/-C context, -i case-insensitive, glob/type filtering, head_limit, offset."
      ;;
    cat)
      # `cat > file` / `cat >> file` / `cat <<EOF` is file CREATION, not reading — route
      # to Write, not Read. This is claude-code#19649's heaviest pattern: heredoc content
      # is unique, so its approval never caches and a human re-reviews it every time.
      case "$SUB" in
        *'>'*|*'<<'*)
          block cat-write "Use the Write tool to create files, not 'cat > file' / heredocs. Write shows a diff and its approval caches; heredoc content is unique and re-reviewed every time. See claude-code#19649."
          ;;
        *)
          block cat-read "Use the Read tool instead of Bash cat. Read supports: offset, limit (for head/tail behavior). Line numbers included by default."
          ;;
      esac
      ;;
    head|tail)
      block "bash-$FIRST_WORD" "Use the Read tool instead of Bash $FIRST_WORD. Read supports: offset (start line), limit (number of lines)."
      ;;
    find)
      block bash-find "Use the Glob tool instead of Bash find. Glob supports: pattern (e.g. '**/*.ts', '**/*test*')."
      ;;
    sed)
      # Block sed used for reading. Two signals:
      #   1. `-n` flag — sed reading mode (default-print suppressed; almost always a Read use).
      #   2. Bare print-address script: 'Np', "N,Mp", $p, 5p, 1,5p — quoted or unquoted, with/without -e/--expression.
      # Substitution (sed 's/x/y/' file, sed -i 's/x/y/') is NOT matched and remains legitimate Bash use.
      RE_SED_N='sed[[:space:]]+([^[:space:]]+[[:space:]]+)*-n([[:space:]]|$)'
      if [[ "$SUB" =~ $RE_SED_N ]]; then
        block sed-read "Use the Read tool instead of Bash 'sed -n' for reading file ranges. Read supports: offset, limit."
      fi
      RE_SED_NP="sed[[:space:]]+([^[:space:]]+[[:space:]]+)*(-e[[:space:]]+|--expression[[:space:]=])?[\"']?(\\\$|[0-9]+)(,(\\\$|[0-9]+))?p[\"']?([[:space:]]|$)"
      if [[ "$SUB" =~ $RE_SED_NP ]]; then
        block sed-read "Use the Read tool instead of Bash sed for reading file ranges (Np / N,Mp / \$p). Read supports: offset, limit."
      fi
      # sed for substitution is a legitimate Bash use — allow it
      ;;
    awk)
      block bash-awk "Use the Grep tool (for searching) or Read tool (for reading) instead of Bash awk."
      ;;
    wc)
      block bash-wc "Use the Grep tool with output_mode: 'count' instead of Bash wc."
      ;;
  esac
done <<EOF
$SUBCMDS
EOF

# --- No-chaining check -------------------------------------------------------
# If we reach here, no banned tool fired. Now block GRATUITOUS COMMAND CHAINING:
# the agent joining two real commands with `&&`, `||`, or `;` in one Bash call.
# Why: chaining is a documented permission-bypass class (the native matcher can
# validate only the first segment of a chain — claude-code#13371/#4956/#28784/
# #16180/#20085), it splits one approval across segments, and it is the agent's
# bash-one-liner reflex, not a need. Claude Code persists the Bash working dir
# across calls, so even `cd dir && cmd` is unnecessary — run the two as separate
# Bash calls.
#
# Deliberately NOT flagged here:
#   - pipes `|` (a pipe into `jq` is the repo's blessed JSON pattern, and pipes
#     into banned tools are already blocked above) — `|` is not in this split.
#   - redirections (`>`, `>>`, `2>&1`) — not a second command; the splitter never
#     breaks on them.
#   - background `&` — handled as a ride-along splitter above, not chaining here.
#
# Quoted spans are blanked first so a `;`/`&&` INSIDE a string or program is not
# counted as a separator — e.g. `git commit -m "fix: a; b"`, `node -e "x=1; y()"`,
# `sed 's/;/,/g' f` stay single commands. Best-effort (non-nested quotes), which
# matches the rest of this regex-only hook.
CHAIN_STRIPPED=$(printf '%s' "$COMMAND" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")
CHAIN_SEGS=$(printf '%s' "$CHAIN_STRIPPED" | sed -E 's/(&&|\|\||;)/\n/g')
_chain_count=0
while IFS= read -r _seg; do
  [ -z "${_seg// /}" ] && continue
  _chain_count=$((_chain_count + 1))
done <<EOF
$CHAIN_SEGS
EOF
if [ "$_chain_count" -gt 1 ]; then
  block chaining "No command chaining. You joined multiple commands with && / || / ; in one Bash call. Run each as a SEPARATE Bash call instead. Chaining hides later commands from per-command approval and is a documented permission-bypass vector. (The working directory persists across Bash calls, so 'cd dir && cmd' is unnecessary too. Pipes into jq and redirections like 2>&1 are fine.)"
fi

exit 0
