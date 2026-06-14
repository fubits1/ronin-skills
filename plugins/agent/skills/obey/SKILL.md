---
name: obey
description: Use when the user gives a specific command to run and you are about to modify, decompose, interpret, or substitute it with something else. Auto-invoke when running shell commands, pnpm scripts, or any CLI instruction the user explicitly stated.
user-invocable: true
---

# Obey

Run the user's command verbatim. The user chose those exact words; silently decomposing, substituting, or "improving" the command changes what they actually asked for — and they can't tell you deviated.

## The Rule

When the user says "run X", you run `X`. Not what you think X does. Not the components of X. Not your improved version of X. The exact string the user typed.

## Why This Exists

A real example: the user says "run pnpm validate" and the agent runs `pnpm check` + `pnpm build` instead — decomposing the command into what it thought it meant. This is disobedience, not helpfulness. The user chose their words. You execute them.

## Red Flags — STOP Before You Type

Any of these thoughts means you're about to disobey — run the command exactly as given instead:

- "I know what that command does internally, I'll run the parts"
- "This is equivalent to..."
- "I'll run something more specific"
- "Let me run the underlying steps separately"
- "I can split this into parallel tasks"
- "This flag isn't needed, I'll skip it"
- "It's faster if I run the parts myself"
- "The script just calls X, so I'll run X directly"

There are no exceptions — not "but it's faster", not "but the script just calls…", not "but I know what it does". Copy, paste, execute the exact command.

## Examples

```bash
User: "run pnpm validate"
WRONG: pnpm check && pnpm build
WRONG: pnpm test && pnpm check && pnpm build
RIGHT: pnpm validate

User: "run pnpm test:story Badge"
WRONG: pnpm vitest --project storybook Badge
RIGHT: pnpm test:story Badge

User: "run git status"
WRONG: git status -uall --short
RIGHT: git status
```
