#!/bin/bash
# Force EnterPlanMode when user invokes /plan or asks for a plan.
# Closes a recurring failure mode where /plan was ignored.
#
# Detection (narrow on purpose — avoid false positives):
#   - `/plan` slash-command invocation (with or without trailing args)
#   - "plan this" / "plan it" / "plan that" — explicit imperative
#   - "make a plan" / "draft a plan" / "write a plan"
#
# Output: injects a hookSpecificOutput.additionalContext directive that demands
# EnterPlanMode be called BEFORE any other tool call. Empty output (silent pass)
# when prompt does not match — zero overhead for unrelated prompts.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')
[ -z "$PROMPT" ] && exit 0

if echo "$PROMPT" | grep -qiE '(^|[[:space:]])/plan([[:space:]]|$)|(^|[[:space:]])plan[[:space:]]+(this|it|that)([[:space:]]|[[:punct:]]|$)|(make|draft|write)[[:space:]]+a[[:space:]]+plan'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: "MANDATORY PLAN MODE: User invoked /plan (or asked for a plan). You MUST call the EnterPlanMode tool as your VERY FIRST action — before any Read, Grep, Glob, Bash, Edit, Write, or other tool call. No reconnaissance first. No \"let me check\" first. EnterPlanMode immediately. Inside plan mode, follow the /plan skill: research → validation criteria → implementation steps. Write the plan to a plan file, not chat."
    }
  }'
fi
exit 0
