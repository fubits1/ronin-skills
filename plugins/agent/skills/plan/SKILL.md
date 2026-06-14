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
- Don't over-engineer. Use framework standard solutions.
- Follow the approved plan. Don't silently deviate during implementation.
- Stop chaining fixes on a broken foundation. Reassess the whole approach.
- NEVER park a bug or "move on" past a visible issue, and don't dismiss it as "out of scope" / "for later". Fix it now, or ask "want me to look into this too?" — quietly stepping past a known problem is how it ships unnoticed.
- Before editing any file, verify the full chain of assumptions (command, port, env vars, all referencing files) and make the changes in one pass, not iteratively — partial assumptions are how a "fix" breaks a second thing.
- **When splitting a config value from global to per-item**, preserve the original value for items that weren't asked to change.
- **When changing a wrapper/shared default that affects ALL consumers**, test EVERY consumer pattern — not just one edge case.

## Systematic Debugging

For any bug, test failure, or unexpected behavior, invoke `superpowers:systematic-debugging` before proposing a fix — that skill owns the general method (reproduce, read all output, trace the path, one hypothesis at a time, change one thing at a time).

A few frontend/test specifics that general method doesn't cover:

- **Trace into children, not just the parent.** When following a code path, grep the child components for the pattern too — the bug often lives in an import a layer down.
- **Debug in the real environment first.** Mocked tests that pass prove nothing about real-app behavior. Reproduce in the browser (Playwright) first, then write tests that match what the browser actually showed.
- **Wrappers swallow errors.** When a wrapper (CardWrapper, ErrorBoundary, etc.) sits between you and the bug, the wrapper is not the root cause — it's hiding it. Debug in the browser with Playwright, not in vitest output.
