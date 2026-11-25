---
name: socket
description: Socket.dev security scanning — check packages before installing, scan repos for supply chain risks. Auto-invoke when evaluating package safety, checking dependencies, or before installing new packages.
argument-hint: <npm/package-name | scan>
---

# Socket

Use Socket to verify package safety before installing and to scan projects for supply chain risks.

## MCP tool (alternative)

The `socket-mcp` server is also available. Use its `depscore` tool for quick lookups when you only need the score without CLI output formatting. It returns the same package-only scores as `socket package shallow`, without dependencies, and does not use the CLI's API units.

## Check a package before installing

```bash
socket npm/<package-name> --markdown
```

- Always check BEFORE `pnpm add`.
- Supports: npm, pypi, nuget, gem, golang, maven.
- Pin a version: `socket npm/<package>@<version> --markdown`
- Use `--json` for raw data, `--markdown` for formatted output.
- For npm, `socket npm/<pkg>` is shorthand for `socket package score npm <pkg>` (the CLI prints "Invoking `socket package score`"). It scores the package and all its dependencies, and costs 100 of the free plan's 500 API units per hour. Check the remaining units with `socket organization quota --json`.

## Check several packages at once

```bash
socket package shallow npm <pkg>@<version> <pkg2>@<version> --markdown
```

- 100 units per call, however many packages it names.
- Scores each package only, not its dependencies. Use the single-package check when a package's dependencies matter.
- A `shallow` result has no transitive score and no dependency count (items 2 and 5 of "Evaluate the result"). Tell the user both are missing; don't fill them in.

## Evaluate the result

Report these to the user:

1. **Self score** — the package itself (overall, vulnerability, license, supply chain, maintenance, quality)
2. **Transitive score** — worst scores across all dependencies
3. **Capabilities** — flags like `fs`, `net`, `shell`, `eval`, `unsafe` (benign in build tools, suspicious in utility libs)
4. **Alerts** — count and nature of alerts
5. **Dependency count** — high counts (200+) increase supply chain risk surface

Decision guidance:

- Vulnerability < 80 or supplyChain < 60 → warn the user
- Capabilities like `shell`, `eval`, `unsafe` on a non-build-tool → flag it
- Alert count > 5 → suggest `--json` for details

## Scan the current project

```bash
socket scan create --report
```

Creates a full scan of the project's dependencies and waits for the report.

- Use `--markdown` for formatted output.
- Use `--json` for CI-friendly output.
