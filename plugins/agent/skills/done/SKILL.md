---
name: done?
description: Final checklist before declaring any task complete. Auto-invoke before saying "done", "ready", "complete", or asking to commit/push.
user-invocable: true
---

# Definition of Done

BEFORE declaring done, you MUST complete ALL of the following steps IN ORDER. No skipping. No summarizing. Show proof for each.

## 1. Run project validation skills

Before declaring done, check what your stack ships:

- If your project has a validation skill, invoke it and follow every rule.
- If your project has a browser-verification skill, invoke it and follow every rule.

If no such skills exist for your stack: at minimum run lint + tests + build to exit 0, verify any UI change in the browser yourself, and report exact exit codes / screenshots — not summaries.

## 2. Browser verification

- Navigate to ALL affected page(s) via Playwright MCP.
- For CSS/layout changes: screenshot BEFORE and AFTER.
- For behavior changes: reproduce the exact user flow via Playwright. Automate multi-step flows — no ad-hoc evaluate with unreliable timeouts.
- Take screenshots to `/tmp/` paths. Visually confirm. State what you checked and whether it passed.
- NEVER ask the user to check their browser — that is YOUR job.

## 3. Lint

- Run your project's full lint command and fix any new errors in files you touched.
- If your project supports per-file linting (e.g. `lint:file` chaining eslint + typecheck + dead-code), use it for the files you touched.
- This includes test files. Whatever lint command runs against tests must exit 0.

## 4. Full validation

- Run your project's full validation chain (typically: tests + lint + typecheck + build, run concurrently). Must exit 0.
- This is the highest-coverage gate before declaring done. Don't skip because "the change was small" — small changes break things too.
- **Exception:** pure CSS-only changes — verify visually in the browser instead, still run lint + typecheck.

## 4b. Multiple-run verification for flaky suites

If the work touches storybook tests, vitest browser mode, MSW, or e2e:

- Kill the test server port (`lsof -ti :<port>` → `kill -9`).
- `rm -rf node_modules/.vite node_modules/.cache/storybook`
- Run the affected test command 3x consecutively.
- Compare: counts must match ±0 tests, setup time ±30%.
- If any run differs: NOT done. The suite is flaky. Investigate the flake itself before any "done" claim.
- If my run goes green but the user's run is failing, my run is NOT authoritative. Ask for the user's log/conditions and reproduce their failure before claiming anything.

A single green run on a flaky suite is not verification — it is one possible execution order. The user pays for every false "done" claim in tokens and in time.

## 5. Framework-specific autofixers

- If your stack has framework-specific autofixers (e.g. Svelte's `mcp__svelte__svelte-autofixer` for `.svelte` / `.svelte.ts` / `.svelte.js` files; ruff/black for Python; rustfmt for Rust), run the matching one on every file you touched.

## 6. CI workflows

- If any `.yml` workflow file was edited: run `pnpx node-actionlint <file>`. Must exit 0.

## 7. Report

State what was verified with evidence (exit codes, screenshots, measurements). Not summaries. Proof.
