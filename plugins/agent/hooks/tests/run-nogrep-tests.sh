#!/bin/bash
# Test harness for nogrep.sh — plain bash, no bats dependency.
# Builds a PreToolUse JSON payload per fixture, pipes it to ../nogrep.sh,
# and asserts the result.
#
#   run_case BLOCK fixtures expect exit 2 (hook hard-blocks the Bash call).
#   run_case ALLOW fixtures expect exit 0 (hook lets the Bash call through).
#   run_msg  fixtures expect exit 2 AND a given substring in stderr, so a block
#            that fires with the wrong/garbled message (e.g. the cat arm saying
#            "Read" where it should say "Write") is caught, not just the exit code.
#
# JSON is built with jq (the repo's sanctioned JSON tool) so command strings —
# including the multi-line fixture with an embedded real newline — are encoded
# safely. Run from anywhere; paths are resolved relative to this script.

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/../nogrep.sh"

if [ ! -x "$HOOK" ]; then
  echo "FATAL: hook not found or not executable: $HOOK" >&2
  exit 1
fi

# jq builds every payload AND the hook reads the command with jq. Without it the
# hook fails open (empty command -> exit 0), so ALLOW cases spuriously PASS and
# BLOCK cases FAIL — a misleading mix. Fail fast instead.
if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq required (test builds JSON payloads with jq)" >&2
  exit 1
fi

PASS=0
FAIL=0

# run_case <expected_exit> <label> <command>
run_case() {
  local expected="$1" label="$2" cmd="$3"
  local payload actual
  payload=$(jq -n --arg cmd "$cmd" '{"tool_input":{"command":$cmd}}')
  printf '%s' "$payload" | "$HOOK" >/dev/null 2>&1
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    printf 'PASS  [%s exit=%s]  %s\n' "$label" "$actual" "$cmd"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  [%s expected=%s got=%s]  %s\n' "$label" "$expected" "$actual" "$cmd"
    FAIL=$((FAIL + 1))
  fi
}

# run_msg <expected_substring> <label> <command>
# Asserts the hook BLOCKS (exit 2) AND its stderr contains <expected_substring>.
# Exit-code-only checks can't catch a block firing with the wrong/garbled message
# (e.g. a refactor typo, or the cat arm saying "Read" where it should say "Write").
run_msg() {
  local want="$1" label="$2" cmd="$3"
  local payload err actual
  payload=$(jq -n --arg cmd "$cmd" '{"tool_input":{"command":$cmd}}')
  err=$(printf '%s' "$payload" | "$HOOK" 2>&1 >/dev/null)
  actual=$?
  if [ "$actual" -eq 2 ] && printf '%s' "$err" | grep -qF "$want"; then
    printf 'PASS  [%s msg~%s]  %s\n' "$label" "$want" "$cmd"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  [%s want-msg=%s exit=%s]  %s\n    got: %s\n' "$label" "$want" "$actual" "$cmd" "$err"
    FAIL=$((FAIL + 1))
  fi
}

# Multi-line command: real newline embedded between the two segments.
MULTILINE=$'echo a\ngrep b'

echo "=== BLOCK fixtures (expect exit 2) ==="
run_case 2 BLOCK 'cat x'
run_case 2 BLOCK 'ls; cat x'
run_case 2 BLOCK 'echo a && grep b'
# Pipe ride-along: approved `echo` segment, banned `grep` riding along after `|`.
run_case 2 BLOCK 'echo ok | grep x'
# Compound-command ride-along holes: background &, subshell (), brace group {;},
# process substitution <(). Each rides a banned tool past an approved-looking line.
run_case 2 BLOCK 'echo a & cat secret'
run_case 2 BLOCK '(cat secret)'
run_case 2 BLOCK '{ cat secret; }'
run_case 2 BLOCK 'diff <(cat a) <(cat b)'
run_case 2 BLOCK "$MULTILINE"
run_case 2 BLOCK '\grep x'
run_case 2 BLOCK '/usr/bin/find .'
run_case 2 BLOCK 'bash -c "cat x"'
# Wrapper-unwrap: normalize_first strips `timeout` + its numeric arg, exposing
# the inner banned `grep`. (The old `command grep x` fixture blocked on the
# `command`-builtin arm, never reaching the inner tool — a false unwrap test.)
run_case 2 BLOCK 'timeout 5 grep x f'
# `command`-builtin arm itself — `cat` here so it is distinct from the grep arm.
run_case 2 BLOCK 'command cat x'
# sed used as a reader (-n range, and bare Np print-address) — must block.
run_case 2 BLOCK 'sed -n 1,5p f'
run_case 2 BLOCK 'sed 5p f'
# Mutating git — must block (existing suite only covered the `git mv` allow).
run_case 2 BLOCK 'git commit -m x'
# Command chaining of two NON-banned commands — the gratuitous bash-one-liner the
# agent keeps reflexively producing. Each must be a separate Bash call. These
# previously slipped (both segments non-banned); the no-chaining check blocks them.
run_case 2 BLOCK 'pnpm build && pnpm test'
run_case 2 BLOCK 'echo a ; echo b'
run_case 2 BLOCK 'true || echo fallback'
run_case 2 BLOCK 'npx markdownlint-cli2 README.md ; echo done'
run_case 2 BLOCK 'cd src && pnpm test'

echo
echo "=== ALLOW fixtures (expect exit 0) ==="
run_case 0 ALLOW 'ls'
run_case 0 ALLOW 'jq . x'
run_case 0 ALLOW 'git mv a b'
run_case 0 ALLOW 'echo hi'
run_case 0 ALLOW 'pnpm test'
run_case 0 ALLOW 'echo "the word grep in a string"'
# sed substitution is a legitimate edit — the read-vs-edit split must let it through.
run_case 0 ALLOW 'sed s/a/b/ f'
# Read-only git stays allowed (only mutating git is blocked).
run_case 0 ALLOW 'git status'
# Group-opener strip must not over-block: a subshell around an allowed cmd passes.
run_case 0 ALLOW '(ls)'
# Chaining allowlist: a pipe into jq (blessed JSON pattern) and redirections are
# NOT chaining — they must stay allowed alongside plain single commands.
run_case 0 ALLOW 'gh pr view --json title | jq .title'
run_case 0 ALLOW 'pnpm build 2>&1'
run_case 0 ALLOW 'echo hi > /tmp/x'
# A `;` / `&&` INSIDE a quoted string or program is not chaining — quoted spans
# are blanked before the segment count, so these single commands must pass.
run_case 0 ALLOW 'echo "a && b"'
run_case 0 ALLOW 'node -e "let x=1; console.log(x)"'
run_case 0 ALLOW 'sed "s/;/,/g" file'

echo
echo "=== Message-content fixtures (block fires with the RIGHT message) ==="
# Every block self-labels as a deterministic hook block, not a user rejection.
run_msg 'NOT a user rejection' MSG 'cat x'
# Structured reason= tag is present.
run_msg 'reason=cat-read'      MSG 'cat x'
# The cat arm routes write/heredoc to Write, plain reads to Read — the branch
# with the most logic, and the one a refactor could most easily cross-wire.
run_msg 'Write tool'           MSG 'cat > f'
run_msg 'reason=cat-write'     MSG 'cat > f'
run_msg 'Read tool'            MSG 'cat f'
# Chaining block names the right reason and the separate-call fix.
run_msg 'reason=chaining'      MSG 'pnpm build && pnpm test'
run_msg 'SEPARATE Bash call'   MSG 'pnpm build && pnpm test'
# Per-tool arms point at the right dedicated tool.
run_msg 'Grep tool'            MSG 'grep x f'
run_msg 'Glob tool'            MSG 'find .'

echo
echo "=== Summary: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
