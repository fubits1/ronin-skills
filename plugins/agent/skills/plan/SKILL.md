---
name: plan
description: 'Planning and problem-solving discipline: enter plan mode first, write plans in the plan file (not chat), structured research, validation, implementation. Auto-invoke when the user says "plan", "make a plan", or when fixing issues or implementing features.'
user-invocable: true
---

# Plan

- **HARD RULE: call `EnterPlanMode` as your FIRST tool call** on "plan", "plan this", "make a plan", or any variant: no `Read`, `Grep`, `Glob`, `Bash`, `Edit`, or `Write` before it. The `agent` plugin's `force-plan-mode.sh` UserPromptSubmit hook injects this directive; it is non-negotiable.
- On "plan", "plan this", "make a plan", or any variant: ENTER PLAN MODE. Write the plan in the plan file. NOT in chat. NOT in a table. NOT in a code block. Plans in chat are worthless; the plan file is the only place plans belong.
- NEVER skip plan mode because "it's simple enough". If the user said plan, they mean plan.
- **Self-trigger** (plan without being asked) when: a CI failure has multiple root causes, the first fix attempt failed, or you're about to touch 3+ files.
- **A plan is NOT a list of edits.** A plan MUST run in order:
  1. **Research**: what do I need to verify before touching anything? What docs to check? What commands to run? What assumptions need proof?
  2. **Validation**: how will I verify each step worked? What does success look like? What are the failure modes?
  3. **Implementation**: only AFTER research and validation strategy are defined.
- **NEVER jump to implementation.** Research first, define validation criteria, then plan the changes.
- Every assumption in the plan must have a verification step. "I think X works" is not a plan; "verify X by running Y, then proceed" is.
- **Plans must contain survival context** (test URLs, route paths, IDs, exact verification steps) because conversation context doesn't survive resets.
- **When incorporating a sub-plan, INCLUDE by reference:** add `**Full detail:** plan-name.md` and keep the sub-plan file intact. NEVER rewrite as a lossy summary. The sub-plan IS the detail.
- **When told to "update the plan," UPDATE THE PLAN FILE.** Not a chat summary. Not a mental note. Open the plan file and edit it.
- **Before giving a multi-step procedure, compare each step against failures already hit this conversation;** if a step repeats one, stop and redesign.
- **If new evidence shows an approved-plan assumption is wrong, STOP**; update the plan file first, then continue referencing it.
- **NEVER include commit or push steps in a plan**; git operations are the user's business.

## Problem-Solving Approach

- **Read the mechanism BEFORE the first fix, not after it fails.** When something errors (permission denied, failing import, broken resolver, version mismatch that "looks like a downgrade"), do NOT pattern-match symptom-to-fix (chmod, downgrade, re-enable a service, blind-edit the line); open what produces the behavior (source, the config it reads, the error message, the man page) and act only once you can name the *cause*. The mechanism is almost always readable on disk or in the docs; reading it is step one. A fix applied without reading the mechanism masks the symptom while the real cause ships. (The failed-fix ladder once a guess does fail lives in `do-your-job`.) Simplest fix first means the simplest fix for the *understood* cause; don't hallucinate root causes.
- Don't over-engineer; use framework standard solutions.
- Follow the approved plan; don't silently deviate during implementation.
- Stop chaining fixes on a broken foundation; reassess the whole approach.
- NEVER park a bug or step past a visible issue as "out of scope" / "for later"; that's how it ships unnoticed. Fix it now, or ask "want me to look into this too?".
- **An approved plan that names the next item, plus a standing "don't stop" order, is a standing order to start that item**: approval gates the WRITE, not the WORK. Finish a planned item, begin the next, surface review-worthy diffs as you go; don't end your turn with "want me to continue?" / "shall I do the next one?". That's stopping dressed as diligence.
- **When research proves a spot is look-wrong-but-correct, leave an inline comment citing why**: if correct code reads like a bug (and especially if a prior reviewer already flagged it), the next reviewer (or the next you) re-investigates from scratch; an un-annotated trap is a parked bug wearing a clean diff. (Comment placement/style: `frontend:editing`.)
- Before editing any file, verify the full chain of assumptions (command, port, env vars, all referencing files) and change them in one pass; partial assumptions are how a "fix" breaks a second thing.
- **When splitting a config value from global to per-item,** preserve the original value for items that weren't asked to change.
- **When changing a wrapper/shared default that affects ALL consumers,** test EVERY consumer pattern, not just one edge case.

## Systematic Debugging

For any bug, test failure, or unexpected behavior, invoke `superpowers:systematic-debugging` before proposing a fix: that skill owns the general method (reproduce, read all output, trace the path, one hypothesis and one change at a time). Frontend/test specifics it doesn't cover:

- **Trace into children, not just the parent**: grep the child components for the pattern too; the bug often lives in an import a layer down.
- **Debug in the real environment first.** Mocked tests that pass prove nothing about real-app behavior: reproduce in the browser (Playwright), then write tests matching what it showed.
- **Wrappers swallow errors.** A wrapper between you and the bug (CardWrapper, ErrorBoundary) is hiding the root cause, not being it: debug in the browser with Playwright, not vitest output.
