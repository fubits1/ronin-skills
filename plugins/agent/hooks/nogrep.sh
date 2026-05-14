#!/bin/bash
# Block Bash calls that should use dedicated tools (Grep, Read, Glob).
# Dedicated tools are auto-allowed — zero permission clicks in the IDE.
# This hook hard-blocks (exit 2) the Bash call and tells Claude which tool to use.
# See: https://github.com/anthropics/claude-code/issues/19649
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
  echo "BLOCKED: node/deno/bun -e invoking subprocess APIs. Use the dedicated tool (Grep/Read/Glob) instead of shelling out from inside an embedded JS script." >&2
  exit 2
fi
RE_PY_SHELLOUT="(^|[[:space:]])(python|python3)[[:space:]]+(-c)[[:space:]]+[\"'].*subprocess"
if [[ "$COMMAND" =~ $RE_PY_SHELLOUT ]]; then
  echo "BLOCKED: python -c invoking subprocess. Use the dedicated tool (Grep/Read/Glob) instead of shelling out from inside an embedded Python script." >&2
  exit 2
fi

# bash/sh/zsh/dash -c "<banned>..." — banned tool inside a wrapped shell-out.
RE_BASHC_BANNED="(^|[[:space:]])(bash|sh|zsh|dash)[[:space:]]+-c[[:space:]]+[\"'][[:space:]]*(\\\\?[A-Za-z0-9_./-]*/)?(${BANNED})([^A-Za-z0-9_]|$)"
if [[ "$COMMAND" =~ $RE_BASHC_BANNED ]]; then
  echo "BLOCKED: Banned tool invoked via 'bash -c' / 'sh -c'. Use the dedicated tool (Grep/Read/Glob) at the top level instead." >&2
  exit 2
fi

# bash/sh/zsh/dash -c "sed -n …" / "sed … Np …" — sed used as a reader inside a wrapped shell-out.
# Substitution forms (`sed 's/x/y/' file`) are still allowed; only -n or bare Np/N,Mp/$p triggers.
# NOTE: char class is [\"'] not [\"\x27] — POSIX ERE does not honor \x escapes.
RE_BASHC_SED_N="(^|[[:space:]])(bash|sh|zsh|dash)[[:space:]]+-c[[:space:]]+[\"'][^\"']*sed[[:space:]]+([^[:space:]]+[[:space:]]+)*-n([[:space:]]|\$)"
if [[ "$COMMAND" =~ $RE_BASHC_SED_N ]]; then
  echo "BLOCKED: 'sed -n' inside bash -c / sh -c is a read. Use the Read tool (offset/limit) instead." >&2
  exit 2
fi
RE_BASHC_SED_NP="(^|[[:space:]])(bash|sh|zsh|dash)[[:space:]]+-c[[:space:]]+[\"'][^\"']*sed[[:space:]]+([^[:space:]]+[[:space:]]+)*(-e[[:space:]]+|--expression[[:space:]=])?[\"']?(\\\$|[0-9]+)(,(\\\$|[0-9]+))?p[\"']?([[:space:]]|\$)"
if [[ "$COMMAND" =~ $RE_BASHC_SED_NP ]]; then
  echo "BLOCKED: 'sed … Np/N,Mp/\$p' inside bash -c / sh -c is a read. Use the Read tool (offset/limit) instead." >&2
  exit 2
fi

# Command substitution: `$(grep ...)` or backtick-wrapped. Catches absolute-path /
# backslash-escaped variants of the banned tool name inside the substitution.
# Also catches wrapper invocations (`$(command grep ...)`, `$(timeout 5 grep ...)`)
# and env-assignment prefixes (`$(FOO=1 grep ...)`, `$(env FOO=1 rg ...)`).
# Wrapper list mirrors normalize_first() below.
WRAP_PREFIX='((timeout|time|nice|nohup|stdbuf|env|exec|eval|builtin|xargs|command)[[:space:]]+(-[^[:space:]]+[[:space:]]+|[0-9]+[[:space:]]+)*)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*'
RE_DOLLAR_SUB="\\\$\\([[:space:]]*${WRAP_PREFIX}(\\\\?[A-Za-z0-9_./-]*/)?(${BANNED})([^A-Za-z0-9_]|$)"
if [[ "$COMMAND" =~ $RE_DOLLAR_SUB ]]; then
  echo "BLOCKED: Banned tool inside command substitution \$(...). Use the dedicated tool (Grep/Read/Glob)." >&2
  exit 2
fi
RE_BACKTICK_SUB="\`[[:space:]]*${WRAP_PREFIX}(\\\\?[A-Za-z0-9_./-]*/)?(${BANNED})([^A-Za-z0-9_]|$)"
if [[ "$COMMAND" =~ $RE_BACKTICK_SUB ]]; then
  echo "BLOCKED: Banned tool inside backtick command substitution. Use the dedicated tool (Grep/Read/Glob)." >&2
  exit 2
fi

# --- Helper: normalise a single command segment to its effective first word ---
# Strips VAR=value prefixes, process wrappers, leading backslash, and path
# qualifications. Matches Claude Code's own permission-rule stripping for
# wrappers (timeout, time, nice, nohup, stdbuf, xargs without flags) and extends
# with known bypass-vector wrappers (env, exec, eval, builtin).
normalize_first() {
  local cmd="$1"
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"  # ltrim
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

# Split on `&&`, `||`, `;`, `|` so chained subcommands are individually checked.
# Conservative: treat the splitters as plain text — quoted strings containing
# `&&`/`;` may false-positive but the case-arm-default exit 0 keeps the hook
# from blocking unrelated commands.
SUBCMDS=$(printf '%s' "$COMMAND" | sed -E 's/(&&|\|\||;|\|)/\n/g')

while IFS= read -r SUB; do
  [ -z "${SUB// /}" ] && continue
  FIRST_WORD=$(normalize_first "$SUB")
  case "$FIRST_WORD" in
    ls)
      # ls is always allowed — explicit whitelist so future regex tweaks can't accidentally block it.
      ;;
    command)
      echo "BLOCKED: The 'command' builtin is banned (bypass vector for this hook). For 'command -v foo' existence checks, use 'which foo'. For everything else, use the dedicated tool (Grep/Read/Glob)." >&2
      exit 2
      ;;
    git)
      # Block mutating git commands; allow read-only inspection and git mv.
      RE_GIT_MUT='(^|[[:space:]])git[[:space:]]+(add|commit|push|pull|fetch|merge|rebase|reset|restore|checkout|switch|clean|stash|tag|cherry-pick|revert|am|apply|rm|clone|init|config|remote[[:space:]]+(add|remove|rename|set-url))([^A-Za-z0-9_]|$)'
      if [[ "$SUB" =~ $RE_GIT_MUT ]]; then
        echo "BLOCKED: Mutating git command. Use gh (auto-allowed) for remote state, or suggest the user run ! git <command> locally." >&2
        exit 2
      fi
      ;;
    grep|egrep|fgrep|rg)
      echo "BLOCKED: Use the Grep tool instead of Bash $FIRST_WORD. Grep supports: multiline: true, output_mode (content/files_with_matches/count), -A/-B/-C context, -i case-insensitive, glob/type filtering, head_limit, offset. Zero permission clicks." >&2
      exit 2
      ;;
    cat)
      echo "BLOCKED: Use the Read tool instead of Bash cat. Read supports: offset, limit (for head/tail behavior). Line numbers included by default. Zero permission clicks." >&2
      exit 2
      ;;
    head|tail)
      echo "BLOCKED: Use the Read tool instead of Bash $FIRST_WORD. Read supports: offset (start line), limit (number of lines). Zero permission clicks." >&2
      exit 2
      ;;
    find)
      echo "BLOCKED: Use the Glob tool instead of Bash find. Glob supports: pattern (e.g. '**/*.ts', '**/*test*'). Zero permission clicks." >&2
      exit 2
      ;;
    sed)
      # Block sed used for reading. Two signals:
      #   1. `-n` flag — sed reading mode (default-print suppressed; almost always a Read use).
      #   2. Bare print-address script: 'Np', "N,Mp", $p, 5p, 1,5p — quoted or unquoted, with/without -e/--expression.
      # Substitution (sed 's/x/y/' file, sed -i 's/x/y/') is NOT matched and remains legitimate Bash use.
      RE_SED_N='sed[[:space:]]+([^[:space:]]+[[:space:]]+)*-n([[:space:]]|$)'
      if [[ "$SUB" =~ $RE_SED_N ]]; then
        echo "BLOCKED: Use the Read tool instead of Bash 'sed -n' for reading file ranges. Read supports: offset, limit. Zero permission clicks." >&2
        exit 2
      fi
      RE_SED_NP="sed[[:space:]]+([^[:space:]]+[[:space:]]+)*(-e[[:space:]]+|--expression[[:space:]=])?[\"']?(\\\$|[0-9]+)(,(\\\$|[0-9]+))?p[\"']?([[:space:]]|$)"
      if [[ "$SUB" =~ $RE_SED_NP ]]; then
        echo "BLOCKED: Use the Read tool instead of Bash sed for reading file ranges (Np / N,Mp / \$p). Read supports: offset, limit. Zero permission clicks." >&2
        exit 2
      fi
      # sed for substitution is a legitimate Bash use — allow it
      ;;
    awk)
      echo "BLOCKED: Use the Grep tool (for searching) or Read tool (for reading) instead of Bash awk. Zero permission clicks." >&2
      exit 2
      ;;
    wc)
      echo "BLOCKED: Use the Grep tool with output_mode: 'count' instead of Bash wc. Zero permission clicks." >&2
      exit 2
      ;;
  esac
done <<EOF
$SUBCMDS
EOF

exit 0
