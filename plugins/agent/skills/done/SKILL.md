---
name: done
description: Final checklist before declaring any task complete. Auto-invoke before saying "done", "ready", "complete", or asking to commit/push.
user-invocable: true
---

# Definition of Done

Complete every gate below, in order, before declaring done. Skipping a gate is how silent regressions ship. Show proof (exit codes, screenshots, measurements), not summaries.

## 0. Aim the check at the failure mode, not a proxy

- Name the exact property the task must prove and the symptom of failure, then pick a check that observes THAT symptom directly. A check that would still pass with the failure present proves nothing.
- A green lint, valid-markdown parse, passing build, autofixer run, row/file count, or mid-flight `ls` measure a different property than content correctness, "on latest version", "bug fixed", or "data landed". Instead observe the real outcome: query the installed version vs upstream; diff actual output against expected; reproduce the user's reported symptom and watch it disappear. Done only if the check would have gone RED on the failure you were asked to prevent.
- **Verify in the SETTLED state, never a transient.** A mid-HMR/hydration/extraction/recompile snapshot or a frozen output is not a verdict. Never declare broken OR done from an in-flight snapshot. Wait for the process to finish, then read THAT; if a read looks wrong right after a rebuild-triggering change, wait and read once more before concluding.

## 1. Run validation

- Run the project's full validation chain to exit 0. If the stack ships a validation or browser-verification skill, invoke it and follow every rule.
- Otherwise run lint + tests + typecheck + build (concurrently if supported), fixing every new error in files you touched, test files included.
- Use any per-file lint command (e.g. `lint:file` chaining eslint + typecheck + dead-code) on touched files, not only the full lint.
- Never skip because "the change was small". Small changes break things too.
- CSS-only exception: verify visually in the browser instead of building, but still run lint + typecheck.

## 2. Verify UI in the browser (your job, never the user's)

- Navigate to every affected page via Playwright MCP.
- For behavior changes, reproduce the exact user flow via Playwright; automate multi-step flows: no ad-hoc evaluate with unreliable timeouts.
- For CSS/layout, take BEFORE and AFTER screenshots to `/tmp/`; visually confirm. Report screenshot paths (Gate 7).

## 3. Re-run flaky suites

- Flaky suites (browser/e2e/MSW) vary between runs. Prefer project cleanup scripts (e.g. `pnpm run test:kill-ports`); otherwise free the test-server port: `lsof -ti :<port>`, then confirm it's the test server (`ps -p <pid> -o comm=`), then `kill <pid>` (SIGTERM), using `kill -9` only if it stays bound after a short wait. Clear stale caches (e.g. `rm -rf node_modules/.vite node_modules/.cache/storybook`), then run the affected command 3x consecutively.
- Test counts must match exactly (±0) and setup time within ~±30%; any divergence is NOT done. Investigate the flake.
- A green run is evidence only for the exact machine and connection it ran on. If the user's run is red while yours is green, theirs wins. Get their log and conditions and reproduce their failure before claiming anything.

## 4. Run framework autofixers

- If the stack has them (Svelte `mcp__svelte__svelte-autofixer` for `.svelte` / `.svelte.ts` / `.svelte.js`; ruff/black for Python; rustfmt for Rust), run the matching one on every file you touched.

## 5. Remove your own debug instrumentation

- Any debugging instrumentation you added (`console.log`, `dbg!`, `print(...)`, temp constants, commented-out experiments) must be gone. Grep touched files for the markers you added and confirm zero remain. Don't trust memory.
- Delete scratch files you created too. (Background servers: `agent:dev-server`. Screenshots belong in `/tmp/`: `frontend:playwright`.)

## 6. Lint edited CI workflows

- If any `.yml` workflow file was edited, run `pnpx node-actionlint <file>` to exit 0.

## 7. Report with proof

- State what was verified with evidence (exit codes, screenshots, measurements). Not summaries. Proof.
