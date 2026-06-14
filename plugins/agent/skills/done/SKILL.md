---
name: done
description: Final checklist before declaring any task complete. Auto-invoke before saying "done", "ready", "complete", or asking to commit/push.
user-invocable: true
---

# Definition of Done

Complete every gate below, in order, before declaring done — skipping a gate is how silent regressions ship. Show proof (exit codes, screenshots, measurements), not summaries.

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

- Flaky suites (browser/e2e/MSW) vary between runs. Kill the test server's port (e.g. `lsof -ti :<port>` then `kill -9`), clear stale caches (e.g. `rm -rf node_modules/.vite node_modules/.cache/storybook`), then run the affected command 3x consecutively.
- Compare: test counts must match exactly (±0) and setup time within ~±30%. Any divergence means NOT done — investigate the flake.
- A green run is only evidence for the exact machine and connection it ran on. If the user's run is red while yours is green, theirs wins — get their log and conditions and reproduce their failure before claiming anything.

## 4. Run framework autofixers

- If the stack has them (Svelte `mcp__svelte__svelte-autofixer` for `.svelte` / `.svelte.ts` / `.svelte.js`; ruff/black for Python; rustfmt for Rust), run the matching one on every file you touched.

## 5. Lint edited CI workflows

- If any `.yml` workflow file was edited, run `pnpx node-actionlint <file>` to exit 0.

## 6. Report with proof

- State what was verified with evidence — exit codes, screenshots, measurements. Not summaries. Proof.
