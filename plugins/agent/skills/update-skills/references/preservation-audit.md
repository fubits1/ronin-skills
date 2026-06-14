# Preservation Audit

The gate that makes information loss impossible to certify away. Run it for every skill file
touched, in every operation (`backport`, `promote`, `edit-in-place`), before declaring done.
Phase summary is in SKILL.md, "Phase 5: Preservation Audit". This is the template, a worked
example, and the rationalizations to refuse.

## The rule

Diff the "before" against the "after", enumerate every atomic item in the before, classify
each. A `LOST` item, or a `DELETED` item whose justification can't quote the covering line,
blocks completion. State preservation only by showing the table, never by asserting it.

"Before" is `git show HEAD:<path>` for tracked files, else the pre-edit `cp -r` snapshot taken
before the first Write. Never reconstruct the original from memory; that is how loss hides.

## Atomic items to enumerate

Every one of these is a row. Do not bundle several into one row, or loss slips between them:

- each rule / directive (including every MUST / NEVER / "always")
- each numbered step and each checklist item
- each worked example (input/output pair)
- each numeric criterion or threshold (`±30%`, `3x`, `head -100`, `< 500 lines`, char budgets)
- each cross-reference (`agent:x`, "see Y", a URL)
- each named section whose removal changes what the skill covers

## Classification table (template)

| # | Item (quote it) | State | Where / justification |
| --- | --- | --- | --- |
| 1 | "8-point data-flow trace checklist" | `PRESERVED` | unchanged |
| 2 | "verify in browser first, then write tests" | `MOVED to ## Debugging` | same text, new section |
| 3 | "±30% setup-time flake criterion" | `LOST` | **BLOCKER, restore** |
| 4 | "never use bare /skill paths" | `MERGED into Reference style rule` | folded; text shown below |
| 5 | "old dated incident 2026-04-08 …" | `DELETED` | anonymized to "A common failure shape: …"; lesson kept (rule #6) |

States: `PRESERVED`, `MOVED to <loc>`, `MERGED into <loc>`, `DELETED` (quote the covering
line), `LOST` (a blocker). Anything you cannot place is `LOST` by default. The burden is on the
edit to prove preservation, not on the reader to prove loss.

## Rationalizations to refuse

Each of these has lost real content before. When you catch yourself thinking one, stop and
diff.

| Rationalization | Reality |
| --- | --- |
| "It's just a style/clarity edit, no need to diff" | Style edits are precisely how content vanishes. Diff it. |
| "I merged it as a duplicate" | Quote BOTH lines. Near-duplicates are not duplicates; a rule with one extra clause carries that clause's information. |
| "Another skill already covers this" | Quote the covering line in that skill. Can't quote it, not covered. (This is the `plan` / "covered by `asshole`" lie that lost "never park a bug".) |
| "Prose reads better than the checklist" | The authoring guidance forbids flattening a checklist/numbered procedure to prose. Cite it or keep the checklist. |
| "Strong language is aggressive, I softened the MUST" | The guidance endorses MUST where a rule gets skipped. Don't soften without evidence the rule is over-firing. |
| "I tightened it / removed yak-shaving" | Removing words is fine; removing rules, steps, thresholds, or examples is loss. The audit tells them apart. |
| "The verification passed" (lint / cross-refs green) | Those are surface checks. They never prove content survived. Only the diff does. |
