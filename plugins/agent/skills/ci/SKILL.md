---
name: ci
description: CI/CD workflow rules — GitHub Actions patterns, validation, Playwright in CI. Auto-invoke when editing .github/workflows files or discussing CI pipelines.
user-invocable: true
---

# CI

- **ALWAYS validate workflow files** with `pnpx node-actionlint <file>` after any edit. Exit code 0 or it's not valid.
- **Playwright in CI:** No official setup action (deprecated). Use `pnpm exec playwright install --with-deps chromium` to install browser + OS-level system dependencies. Only install the browsers you actually need.
- **Simulate CI locally before pushing:** Run commands with `CI=true GITHUB_ACTIONS=true` to catch tools that auto-detect CI and change behavior.
- **Single validation entry point for CI.** Define one script (e.g. `validate`) that chains lint + typecheck + unit tests + framework-check. CI calls only that.
- **Tag-filtered CI test command.** For test suites where some cases require a live backend or recorded fixtures unsuitable for CI, define a CI-specific script that filters those out (e.g. via tag filter `--tags-filter='!ci-skip'`). Keeps CI deterministic.
- **Separate concerns by script.** `test:unit` (unit only), `test:e2e` (browser/e2e only), `test` (everything concurrently for local), `test:ci` (the filtered subset). Don't overload one script with multiple modes.
- **Check the exact commit SHA** that triggered a CI run. Don't carry stale assumptions about what code is running.
- **Read ALL errors in CI logs.** Download the full log with `gh api repos/.../actions/jobs/<id>/logs`, then grep for FAIL, Error, unhandled, ECONNREFUSED. CI failures often have MULTIPLE root causes — fix all of them, not just the first one.
- **`pnpm test -- --flag` does NOT work** for passing flags through pnpm to the underlying test runner. The `--` makes the runner treat flags as positional args. Define a dedicated script (e.g. `test:ci`) instead of trying to pass flags through.
- **`continue-on-error`** pattern: use when you want to collect results from multiple steps and report them together (e.g. PR comment tables) instead of failing fast.
- **Adding a build step is NOT free.** Estimate build time vs time saved before adding one. A 3min build for marginally faster page serving = net loss.
