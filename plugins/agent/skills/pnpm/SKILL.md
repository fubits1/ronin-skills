---
name: pnpm
description: Package manager rules — always pnpm, never npm/npx, socket checks before installing. Auto-invoke when installing packages or running project tools.
user-invocable: true
---

# pnpm

- Always `pnpm`. Never npm/npx.
- `pnpm exec` or `pnpx` to run project tools, not `npx`.
- Before installing, check the package with the `agent:socket` procedure. Then install with `pnpm add`.
- **Always use official migration/upgrade tools when they exist** (e.g. `pnpx @astrojs/upgrade`, `pnpx svelte-migrate`, `pnpx @next/codemod`). Never manually edit version numbers in package.json when a migration CLI is available.
- Test/validate script layout varies by project — read `package.json` scripts before running tests, and run the script the user named rather than guessing its parts (see `agent:obey`). Concrete example (JS/TS stack): `pnpm test` = vitest + e2e run concurrently; `pnpm test:unit` = vitest only; `pnpm test:e2e` = Playwright only; `pnpm validate` = vitest + eslint + oxlint + typecheck + knip + stylelint (+ svelte-check for Svelte projects).
