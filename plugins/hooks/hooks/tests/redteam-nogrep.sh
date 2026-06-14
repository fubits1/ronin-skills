#!/bin/bash
# Red-team contract suite for nogrep.sh — standalone, NOT wired into CI.
# Run manually:  bash plugins/hooks/hooks/tests/redteam-nogrep.sh
#
# Each assertion encodes the INTENDED design (README "forcing one command per
# call"; nogrep.md; claude-code#13371/#4956/#28784/#16180/#20085). A divergence
# between intended and actual is a real finding, not a pass. Exit 0 iff every
# assertion matches intent.
#
# Unlike run-nogrep-tests.sh (the CI happy-path suite), this file is the
# adversarial / edge-case battery: shell control structures, multi-line, line
# continuation, escaped/boundary quotes, and every documented bypass vector.

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/../nogrep.sh"

if [ ! -x "$HOOK" ]; then
  echo "FATAL: hook not found or not executable: $HOOK" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq required" >&2
  exit 1
fi

PASS=0
FAIL=0

# expect <BLOCK|ALLOW> <label> <command>
expect() {
  local want="$1" label="$2" cmd="$3"
  local payload err actual got reason
  payload=$(jq -n --arg cmd "$cmd" '{"tool_input":{"command":$cmd}}')
  err=$(printf '%s' "$payload" | "$HOOK" 2>&1 >/dev/null)
  actual=$?
  if [ "$actual" -eq 2 ]; then got=BLOCK; else got=ALLOW; fi
  reason=$(printf '%s' "$err" | sed -n '1p' | sed -E 's/.*reason=([a-z-]+).*/\1/')
  if [ "$got" = "$want" ]; then
    printf 'PASS  [%s want=%s %s]  %s\n' "$label" "$want" "$reason" "$(printf '%s' "$cmd" | tr '\n' '~')"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  [%s want=%s got=%s %s]  %s\n' "$label" "$want" "$got" "$reason" "$(printf '%s' "$cmd" | tr '\n' '~')"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Banned tools must BLOCK ==="
for t in grep egrep fgrep rg awk; do expect BLOCK "banned:$t" "$t x f"; done
expect BLOCK 'banned:cat'  'cat f'
expect BLOCK 'banned:head' 'head -5 f'
expect BLOCK 'banned:tail' 'tail -5 f'
expect BLOCK 'banned:find' 'find . -name x'
expect BLOCK 'banned:wc'   'wc -l f'

echo
echo "=== Bypass vectors must BLOCK ==="
expect BLOCK 'builtin-command'   'command grep x'
expect BLOCK 'abs-path'          '/usr/bin/find .'
expect BLOCK 'backslash-escape'  '\grep x'
expect BLOCK 'bash-c'            'bash -c "cat x"'
expect BLOCK 'dollar-sub'        'echo $(grep x f)'
expect BLOCK 'backtick-sub'      'echo `grep x f`'
expect BLOCK 'proc-sub'          'diff <(cat a) <(cat b)'
expect BLOCK 'wrapper-timeout'   'timeout 5 grep x f'
expect BLOCK 'sed-read-n'        'sed -n 1,5p f'
expect BLOCK 'sed-read-np'       'sed 5p f'
expect BLOCK 'subshell-group'    '(cat secret)'
expect BLOCK 'brace-group'       '{ cat secret; }'

echo
echo "=== Chaining must BLOCK (one command per call) ==="
expect BLOCK 'chain-and'         'pnpm build && pnpm test'
expect BLOCK 'chain-semi'        'echo done ; echo here'
expect BLOCK 'chain-or'          'true || echo fallback'
expect BLOCK 'chain-trailing-echo' 'npx foo ; echo exit=$?'

echo
echo "=== One command per call: multi-line + control structures BLOCK (intended) ==="
expect BLOCK 'for-loop'          'for x in a b; do echo $x; done'
expect BLOCK 'while-loop'        $'while read l; do echo "$l"; done < f.txt'
expect BLOCK 'if-then'           'if true; then echo yes; fi'
expect BLOCK 'case'              'case $x in a) echo a;; *) echo b;; esac'
expect BLOCK 'multiline-arg'     $'dex create "t" --description "line one\nline two\nline three"'
expect BLOCK 'multiline-echo'    $'echo "a\nb\nc"'
expect BLOCK 'line-continuation' $'pnpm run build \\\n  --verbose'
expect BLOCK 'multiline-block'   $'dex create "a"\ndex create "b"\ndex create "c"'

echo
echo "=== Legit single commands must ALLOW ==="
expect ALLOW 'single-pnpm'       'pnpm test'
expect ALLOW 'single-git-status' 'git status'
expect ALLOW 'single-ls'         'ls'
expect ALLOW 'single-echo'       'echo hi'
expect ALLOW 'single-jq'         'jq . package.json'
expect ALLOW 'sed-substitution'  'sed s/a/b/ f'
expect ALLOW 'git-mv'            'git mv a b'
expect ALLOW 'subshell-allowed'  '(ls)'
expect ALLOW 'pipe-into-jq'      'gh pr view --json title | jq .title'
expect ALLOW 'redirect-stdout'   'echo hi > /tmp/x'
expect ALLOW 'redirect-2to1'     'pnpm build 2>&1'
expect ALLOW 'semi-in-quotes'    'dex create "a; b" --description "s1; s2; s3"'
expect ALLOW 'and-in-quotes'     'echo "a && b"'
expect ALLOW 'semi-in-jq-prog'   'jq ".a; .b" f.json'

echo
echo "=== Edge cases (probe: expected = best-guess intent; divergence = finding) ==="
expect ALLOW 'trailing-semi'        'echo hi;'
expect ALLOW 'escaped-inner-quotes' 'echo "say \"hi; bye\""'
expect ALLOW 'single-quote-semi'    "echo 'a; b; c'"
expect ALLOW 'git-log-readonly'     'git log --oneline'

echo
echo "=== Summary: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
