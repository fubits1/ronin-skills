---
name: done
description: Final checklist before declaring any task complete. Auto-invoke before saying "done", "ready", "complete", or asking to commit/push.
user-invocable: true
---

# Definition of Done

Complete every gate below, in order, before declaring done — skipping a gate is how silent regressions ship. Show proof (exit codes, screenshots, measurements), not summaries.

## 0. Aim the check at the failure mode, not a proxy

- Before running any verification, name the exact property the task must prove and the symptom that would mean it failed — then pick the check that observes THAT symptom directly.
- A green lint, a valid-markdown parse, a passing build, an autofixer run, a row/file count, or a mid-flight `ls` are NOT evidence for content correctness, "on latest version", "the bug is fixed", or "the data landed" — they measure a different property. If your check would still pass when the actual failure is present, it proves nothing.
- Replace a proxy check with one that observes the real outcome: query the installed version and compare to upstream; diff the rendered/actual output against expected; reproduce the user's exact reported symptom and watch it disappear. "I ran a check and it was green" is not done unless that check would have gone RED on the specific failure you were asked to prevent.
- **Verify in the SETTLED state, never a transient.** A mid-HMR reload, a mid-hydration paint, a mid-extraction install, a frozen output, or a mid-recompile screenshot is not a verdict. Wait for the process to finish (build settled, dev server done recompiling, hydration complete), then read THAT. Never declare broken OR done from an in-flight snapshot; if a read looks wrong right after a change that triggers a rebuild, wait and read once more before concluding.

## 1. Run validation

- Run the project's full validation chain to exit 0. If the stack ships a validation or browser-verification skill, invoke it and follow every rule.
- Otherwise run lint + tests + typecheck + build (concurrently if supported), fixing every new error in files you touched, test files included.
- If the project has a per-file lint command (e.g. `lint:file` chaining eslint + typecheck + dead-code), use it on the touched files, not only the full lint.
- Don't skip because "the change was small" — small changes break things too.
- CSS-only exception: verify visually in the browser instead of building, but still run lint + typecheck.

## 2. Verify UI in the browser (your job, never the user's)

- Navigate to every affected page via Playwright MCP.
- For behavior changes, reproduce the exact user flow via Playwright; automate multi-step flows — no ad-hoc evaluate with unreliable timeouts.
- For CSS/layout, take BEFORE and AFTER screenshots to `/tmp/`; visually confirm.
- Report exact exit codes and screenshot paths.

## 3. Re-run flaky suites

- Flaky suites (browser/e2e/MSW) vary between runs. Prefer project cleanup scripts when they exist (e.g. `pnpm run test:kill-ports`). Otherwise free the test-server port: `lsof -ti :<port>` → confirm the PID is the test server (`ps -p <pid> -o comm=`) → `kill <pid>` (SIGTERM) first; use `kill -9` only if the port stays bound after a short wait. Clear stale caches (e.g. `rm -rf node_modules/.vite node_modules/.cache/storybook`), then run the affected command 3x consecutively.
- Compare: test counts must match exactly (±0) and setup time within ~±30%. Any divergence means NOT done — investigate the flake.
- A green run is only evidence for the exact machine and connection it ran on. If the user's run is red while yours is green, theirs wins — get their log and conditions and reproduce their failure before claiming anything.

## 4. Run framework autofixers

- If the stack has them (Svelte `mcp__svelte__svelte-autofixer` for `.svelte` / `.svelte.ts` / `.svelte.js`; ruff/black for Python; rustfmt for Rust), run the matching one on every file you touched.

## 5. Remove your own debug instrumentation

- Any logging, print, or temporary instrumentation you added while debugging (`console.log`, `dbg!`, `print(...)`, a temp constant, commented-out experiments) must be gone before done. Grep the files you touched for the markers you added and confirm zero remain — don't trust memory.
- Scratch files you created for the task get deleted too. (Background servers: `agent:dev-server`. Screenshots belong in `/tmp/`: `frontend:playwright`.)

## 6. Lint edited CI workflows

- If any `.yml` workflow file was edited, run `pnpx node-actionlint <file>` to exit 0.

## 7. Report with proof

- State what was verified with evidence — exit codes, screenshots, measurements. Not summaries. Proof.
