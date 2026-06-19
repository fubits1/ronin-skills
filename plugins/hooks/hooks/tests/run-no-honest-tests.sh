#!/bin/bash
# Test harness for no-honest.mjs (Stop hook) — plain bash, no bats.
# Builds a transcript JSONL + a Stop-hook stdin payload, runs the Node hook, and asserts whether it
# emits a non-blocking nudge. "BLOCK" below means the hook produced `hookSpecificOutput.additionalContext`;
# "ALLOW" means it stayed silent. (The hook never emits decision:block — see no-honest.mjs header.)
#
# Run from anywhere: bash plugins/hooks/hooks/tests/run-no-honest-tests.sh

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/../no-honest.mjs"

[ -f "$HOOK" ] || { echo "FATAL: hook not found: $HOOK" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq required (builds JSON payloads)" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FATAL: node required (hook is a Node ESM script)" >&2; exit 1; }

PASS=0
FAIL=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# run_case <BLOCK|ALLOW> <stop_hook_active:true|false> <label> <assistant-message-text>
run_case() {
  local expect="$1" active="$2" label="$3" msg="$4"
  local tx="$TMP/t.jsonl" out got
  jq -nc --arg t "$msg" '{type:"assistant",message:{role:"assistant",content:[{type:"text",text:$t}]}}' > "$tx"
  out=$(jq -n --argjson a "$active" --arg p "$tx" '{stop_hook_active:$a,transcript_path:$p,hook_event_name:"Stop"}' | node "$HOOK")
  if printf '%s' "$out" | jq -e '(.hookSpecificOutput.additionalContext // "") != ""' >/dev/null 2>&1; then got=BLOCK; else got=ALLOW; fi
  if [ "$got" = "$expect" ]; then
    printf 'PASS  [%s -> %s]  %s\n' "$label" "$got" "$msg"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  [%s expected=%s got=%s]  %s\n' "$label" "$expect" "$got" "$msg"
    FAIL=$((FAIL + 1))
  fi
}

echo '=== BLOCK: "honest" or "honestly" (incl. openers) ==='
run_case BLOCK false tobehonest 'To be honest, I did not run it.'
run_case BLOCK false theanswer  'I will give you the honest answer.'
run_case BLOCK false beinghon   'Being honest, I skipped that step.'
run_case BLOCK false lethonest  'Let me be honest about the risk.'
run_case BLOCK false opener     'Honestly, the tests pass.'

echo
echo '=== ALLOW: noun "honesty", "dishonest", code, false-positive guards ==='
run_case ALLOW false honesty   'In all honesty, this is incomplete.'
run_case ALLOW false dishonest 'That would be a dishonest summary, so I avoided it.'
run_case ALLOW false honnoun   'The honesty policy doc is unrelated to code.'
run_case ALLOW false clean     'The tests pass: 12 of 12. Output is above.'
run_case ALLOW false fenced    $'Here is the code:\n```\n# honest flag\nhonest=1\n```\nDone.'
run_case ALLOW false inline    'The variable `honest` is set in the config.'
run_case ALLOW false phone     'I called the phone state API and it returned ok.'

echo
echo "=== Loop guard: stop_hook_active=true never blocks ==="
run_case ALLOW true  loopguard 'Be honest, this must still be allowed (loop guard).'

# run_turn <BLOCK|ALLOW> <label> <assistant-msg...> — multi-message turn: a user prompt, then each
# assistant message interleaved with a tool_result, proving the scan covers the WHOLE turn.
run_turn() {
  local expect="$1" label="$2"; shift 2
  local tx="$TMP/turn.jsonl" out got
  jq -nc '{type:"user",message:{role:"user",content:"go"}}' > "$tx"
  for m in "$@"; do
    jq -nc --arg t "$m" '{type:"assistant",message:{role:"assistant",content:[{type:"text",text:$t}]}}' >> "$tx"
    jq -nc '{type:"user",message:{role:"user",content:[{type:"tool_result",content:"ok"}]}}' >> "$tx"
  done
  out=$(jq -n --arg p "$tx" '{stop_hook_active:false,transcript_path:$p}' | node "$HOOK")
  if printf '%s' "$out" | jq -e '(.hookSpecificOutput.additionalContext // "") != ""' >/dev/null 2>&1; then got=BLOCK; else got=ALLOW; fi
  if [ "$got" = "$expect" ]; then
    printf 'PASS  [%s -> %s]  turn(%d msgs)\n' "$label" "$got" "$#"; PASS=$((PASS + 1))
  else
    printf 'FAIL  [%s expected=%s got=%s]  turn(%d msgs)\n' "$label" "$expect" "$got" "$#"; FAIL=$((FAIL + 1))
  fi
}

echo
echo '=== Whole-turn scan: the word in ANY message this turn, not just the last ==='
run_turn BLOCK earlyhit  'To be honest I am not sure about this.' 'The output above shows 12 of 12.'
run_turn ALLOW cleanturn 'First I ran the suite.' 'It passes: 12 of 12. Output above.'

echo
echo "=== Summary: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
