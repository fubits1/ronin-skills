#!/bin/bash
# PostToolUse formatter: Prettier for non-Markdown, markdownlint for .md.
# Silent on success — never blocks the tool call.
#
# `npx` (not `pnpx`) is intentional here: this hook runs inside Claude Code's
# environment, not the user's project. `pnpm` may not be installed on every
# machine; `npx` ships with Node and is the safe cross-environment choice.
# The plugin's own `pnpm` skill targets project-level usage by the agent, not
# plugin-internal tooling.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0

# Run prettier on all supported files (skip .md/.mdx — Prettier pads markdown tables)
if [[ "$FILE_PATH" != *.md && "$FILE_PATH" != *.mdx ]]; then
  npx -y prettier --write "$FILE_PATH" >/dev/null 2>&1
fi

# Additionally run markdownlint on .md files
if [[ "$FILE_PATH" == *.md ]]; then
  npx -y markdownlint-cli2 --fix "$FILE_PATH" >/dev/null 2>&1
fi

exit 0
