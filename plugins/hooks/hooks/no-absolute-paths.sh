#!/bin/bash
# Block Bash calls that prepend project-root absolute paths to commands.
# cwd is already the project root — use relative paths.
# Pattern bloats permissions.allow with single-use entries (e.g.
# `Bash(grep -l "..." /Users/you/projects/myrepo/src/...)`)
# because Claude Code's permission matcher treats relative and absolute paths
# as unrelated strings — see anthropics/claude-code#18200.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$COMMAND" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -z "$ROOT" ] && exit 0

# Resolve user home robustly — HOME may be missing/empty in some hook envs.
# `eval echo ~` falls back to shell-resolved tilde expansion.
HOME_DIR="${HOME:-}"
[ -z "$HOME_DIR" ] && HOME_DIR=$(eval echo ~ 2>/dev/null)

# Compute tilde-form and $HOME-form equivalents of ROOT so
# `cd ~/path/to/project` and `cd $HOME/path/to/project` are caught alongside
# the absolute form `cd /Users/you/path/to/project`.
TILDE_ROOT=""
DOLLAR_HOME_ROOT=""
if [ -n "$HOME_DIR" ]; then
  if [ "$ROOT" = "$HOME_DIR" ]; then
    # shellcheck disable=SC2088  # literal `~` intended
    TILDE_ROOT="~"
    DOLLAR_HOME_ROOT="\$HOME"
  elif [ "${ROOT#"$HOME_DIR"/}" != "$ROOT" ]; then
    # shellcheck disable=SC2088
    TILDE_ROOT="~/${ROOT#"$HOME_DIR"/}"
    DOLLAR_HOME_ROOT="\$HOME/${ROOT#"$HOME_DIR"/}"
  fi
fi

# Block if the command references the project root in any form:
# absolute (`/Users/you/foo`), tilde (`~/foo`), or $HOME-prefixed (`$HOME/foo`).
# `grep -F` for literal substring — no regex surprises with slashes / `$`.
if echo "$COMMAND" | grep -qF "$ROOT"; then
  echo "BLOCKED: command contains absolute path \"$ROOT\". cwd IS already that path. Use relative paths from cwd (e.g. 'src/lib/foo.ts' not '$ROOT/src/lib/foo.ts', 'git diff' not 'git -C $ROOT diff'). Prepending project-root absolute paths bloats permissions.allow with single-use entries — see anthropics/claude-code#18200." >&2
  exit 2
fi
if [ -n "$TILDE_ROOT" ] && echo "$COMMAND" | grep -qF "$TILDE_ROOT"; then
  echo "BLOCKED: command contains tilde-form project root \"$TILDE_ROOT\". cwd IS already that path. Use relative paths from cwd. Prepending project-root paths (tilde-form or absolute) bloats permissions.allow with single-use entries — see anthropics/claude-code#18200." >&2
  exit 2
fi
if [ -n "$DOLLAR_HOME_ROOT" ] && echo "$COMMAND" | grep -qF "$DOLLAR_HOME_ROOT"; then
  echo "BLOCKED: command contains \$HOME-form project root \"$DOLLAR_HOME_ROOT\". cwd IS already that path. Use relative paths from cwd. Prepending project-root paths bloats permissions.allow with single-use entries — see anthropics/claude-code#18200." >&2
  exit 2
fi

exit 0
