---
name: plan
description: Planning and problem-solving discipline — enter plan mode first, write plans in the plan file (not chat), structured research → validation → implementation. Auto-invoke when the user says "plan", "make a plan", or when fixing issues or implementing features.
user-invocable: true
---

# Plan

- **HARD RULE: call `EnterPlanMode` as your FIRST tool call.** No `Read`, `Grep`, `Glob`, `Bash`, `Edit`, or `Write` before it. The `agent` plugin's `force-plan-mode.sh` UserPromptSubmit hook injects this directive on `/plan`, "plan this", "make a plan", etc. — it is non-negotiable.
- When the user says "plan", "plan this", "make a plan", or any variant — ENTER PLAN MODE. Write the plan in the plan file. NOT in chat. NOT in a table. NOT in a code block.
- Plans in chat are worthless. The plan file is the only place plans belong.
- NEVER skip plan mode because "it's simple enough". If the user said plan, they mean plan.
- **Self-trigger:** also plan WITHOUT being asked when: (1) a CI failure has multiple root causes, (2) the first fix attempt failed, (3) you're about to touch 3+ files.
- **A plan is NOT a list of edits.** A plan MUST include:
  1. **Research** — what do I need to verify before touching anything? What docs to check? What commands to run? What assumptions need proof?
  2. **Validation** — how will I verify each step worked? What does success look like? What are the failure modes?
  3. **Implementation** — only AFTER research and validation strategy are defined.
- NEVER jump to implementation. Research first, define validation criteria, then plan the changes.
- Every assumption in the plan must have a verification step. "I think X works" is not a plan — "verify X by running Y, then proceed" is.
- **Plans must contain survival context.** Save test URLs, route paths, IDs, and exact verification steps in the plan file — conversation context doesn't survive resets.
- **When incorporating a sub-plan, INCLUDE by reference.** Add `**Full detail:** plan-name.md` and keep the sub-plan file intact. NEVER rewrite as a lossy summary. The sub-plan IS the detail.
- **When told to "update the plan," UPDATE THE PLAN FILE.** Not a chat summary. Not a mental note. Open the plan file and edit it.
- **Before giving the user a multi-step procedure, compare each step against failures already encountered in the current conversation.** If a step repeats one, stop and redesign.
- **If new evidence shows an assumption in the approved plan is wrong, STOP.** Update the plan file first; only then continue, referencing the updated plan.
- **NEVER include commit or push steps in a plan.** Git operations are the user's business, not yours.

## Problem-Solving Approach

- Simplest fix first. Don't hallucinate root causes.
- **Read the mechanism BEFORE the first fix, not after it fails.** When something errors (permission denied, a failing import, a broken resolver, a version mismatch that "looks like it needs a downgrade"), do NOT pattern-match symptom→fix (chmod, downgrade, re-enable a service, blind-edit the line). Open the thing that produces the behavior — the source, the config it reads, the error's own message, the man page — and read how it works first. A fix applied without reading the mechanism is a guess wearing a fix's clothes: it can mask the symptom while the real cause ships. The mechanism is almost always readable on disk or in the docs; reading it is step one, and you act only once you can name the cause, not just the symptom. ("Simplest fix first" means the simplest fix for the *understood* cause — not the first patch that silences the symptom.)
- Don't over-engineer. Use framework standard solutions.
- Follow the approved plan. Don't silently deviate during implementation.
- Stop chaining fixes on a broken foundation. Reassess the whole approach.
- NEVER park a bug or "move on" past a visible issue, and don't dismiss it as "out of scope" / "for later". Fix it now, or ask "want me to look into this too?" — quietly stepping past a known problem is how it ships unnoticed.
- **An approved plan that names the next item, plus a standing "don't stop" order, is a standing order to start that next item — not to pause for permission.** Approval gates the WRITE, not the WORK. When you finish a planned item, begin the next one and surface review-worthy diffs as you go; do not end your turn with "want me to continue?" / "shall I do the next one?" after each item. Finishing an item and idling for a go-ahead, when the plan already names what's next, is stopping dressed as diligence.
- **When research proves a spot is look-wrong-but-correct, leave an inline comment citing why before moving on.** If correct code reads like a bug (and especially if a prior reviewer already flagged it), the next reviewer — or the next you — will re-investigate it from scratch. Annotate the line with the reason it's correct; an un-annotated trap is a parked bug wearing a clean diff. (Comment placement and style: `frontend:editing`.)
- Before editing any file, verify the full chain of assumptions (command, port, env vars, all referencing files) and make the changes in one pass, not iteratively — partial assumptions are how a "fix" breaks a second thing.
- **When splitting a config value from global to per-item**, preserve the original value for items that weren't asked to change.
- **When changing a wrapper/shared default that affects ALL consumers**, test EVERY consumer pattern — not just one edge case.

## Systematic Debugging

For any bug, test failure, or unexpected behavior, invoke `superpowers:systematic-debugging` before proposing a fix — that skill owns the general method (reproduce, read all output, trace the path, one hypothesis at a time, change one thing at a time).

A few frontend/test specifics that general method doesn't cover:

- **Trace into children, not just the parent.** When following a code path, grep the child components for the pattern too — the bug often lives in an import a layer down.
- **Debug in the real environment first.** Mocked tests that pass prove nothing about real-app behavior. Reproduce in the browser (Playwright) first, then write tests that match what the browser actually showed.
- **Wrappers swallow errors.** When a wrapper (CardWrapper, ErrorBoundary, etc.) sits between you and the bug, the wrapper is not the root cause — it's hiding it. Debug in the browser with Playwright, not in vitest output.
