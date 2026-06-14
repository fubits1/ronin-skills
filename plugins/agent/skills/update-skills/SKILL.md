---
name: update-skills
description: Reconcile skill collections, backport from ~/.claude/skills into a marketplace plugins tree, scrubbing proprietary refs. Use when local has diverged from upstream, or when promoting local-only skills to a marketplace.
user-invocable: true
---

# Update Skills

Edit Claude Code skills with **zero information loss**. Covers three operations:

- **`backport`**: reconcile two collections. Pull missing content from a source dir (typically `~/.claude/skills/`) into a public marketplace (typically `plugins/<plugin>/skills/`), or the reverse, scrubbing proprietary references.
- **`promote`**: publish a source-only skill into a marketplace plugin.
- **`edit-in-place`**: improve, clean, restructure, or "de-yak" an existing skill **without dropping any of its content**. This operation has no other owner, and it is where silent information loss happens. A "tighten this skill" request quietly deletes a checklist, a numeric threshold, or a rule, and the edit gets certified "lossless" without anyone diffing it. The Preservation Audit (gate, below) exists to make that impossible.

Whatever the operation, the **Preservation Audit is the mandatory gate before any edit is done**. See the phase below. Surface checks (lint, cross-refs, proprietary scan) come after, and never substitute for it.

## When to use

- A user's local global skills have diverged from a public plugin marketplace.
- A new local-only skill should be promoted to a marketplace plugin.
- A marketplace plugin needs its READMEs / skill counts updated after promotions.
- An existing skill needs editing, tightening, restructuring, or "yak-shaving removed" in place, without losing content.

## Inputs

- **Source dir**: usually `~/.claude/skills/<skill>/` (one dir per skill, may include `references/`, `scripts/`, sibling docs). Skip symlinked skills; they come from other repos and are out of scope.
- **Target marketplace**: usually `<repo>/plugins/<plugin>/skills/<skill>/`. Plugin split by domain (e.g. `agent` for cross-cutting agent discipline; `frontend` for web/CSS/tests; `svelte-5` for Svelte components). Enforcement hooks may live in a dedicated hooks plugin for optional install (e.g. `plugins/hooks/hooks/nogrep.sh` paired with the `agent:nogrep` skill), kept in the same marketplace.
- **Generalization patterns**: what to strip. Project names, internal URLs, absolute home paths, dated personal incidents.

## Hard rules

- **The Preservation Audit is mandatory.** No skill edit (backport, promote, or in-place) is "done" until the per-item Preservation Audit (gate phase below) is complete and clean. This is the primary check, not an optional final step.
- **Point verification at the failure mode.** The failure mode of a skill edit is *information loss*. Markdown lint, cross-reference resolution, the proprietary-string scan, and char-count are **secondary surface checks: necessary, never sufficient**. A green lint is not evidence that content survived; only the diff is. A check aimed away from the failure mode is theater that produces a false green light.
- **No self-certified quality.** Never write "verified", "no information dropped", "lossless", "clean", or "EQUIVALENT" without the completed audit table in hand. The claim *is* the table. Asserting the property you were supposed to prove, from memory, is the exact fraud this skill exists to stop.
- **Cite provenance for structural/voice/strength changes.** Any change to structure (prose, checklist, or numbered steps), voice, or rule strength (MUST/NEVER vs "always"/"try to") MUST quote the licensing line in [references/skill-authoring-guidance.md](references/skill-authoring-guidance.md). "Follows the guidance" or "the research says" with no quotable source is forbidden; fabricating the provenance of a decision is the same lie as fabricating a fact. The guidance *forbids* flattening checklists to prose and *endorses* MUST where a rule gets skipped; do not invent the opposite.
- **Invoke the `deslop` and `frontend:editing` skills in the final review pass, when the edit is done.** Once the content is settled, before declaring done, invoke them through the Skill tool and apply what they return to the prose and markdown. Not after each individual edit, and not paraphrased from memory: a single review pass over the finished files. They are the enforced standard; the inline summary in the guidance ("Prose style and markdown editing") is only a fallback for when those skills are not installed. Checked in Phase 6.
- **Conform to the official authoring guidance.** Before authoring or editing ANY skill, read [references/skill-authoring-guidance.md](references/skill-authoring-guidance.md). Structure (prose vs bullets vs **checklist**), description shape, voice, and length are governed by that guidance (sourced from Anthropic's official docs), NOT by personal preference. Multi-step procedures are numbered steps or checklists, never flattened into prose; explain a rule's "why" in a clause, not a paragraph; keep MUST/NEVER where evidence shows the rule gets skipped.
- **Research before edit.** Read BOTH SKILL.md files fully on both sides, and every sibling file (`references/*`, `scripts/*`). Partial reads cause partial backports.
- **Ask before every Write, one skill at a time.** Promotions and large backports go through user review; present the proposed content (or just the generalization diff if it's small) and wait for approval before writing. Batched Writes feel aggressive when the user wants to evaluate each.
- **Reference style.** Use the marketplace's `plugin:skill` namespacing (e.g. `frontend:editing`, `agent:before-you-act`). NEVER bare `/skill` paths. NEVER `<root-prefix>:<plugin>:<skill>` doubled.
- **Strip dated personal incidents.** Replace `On 2026-04-08 ...` with anonymous `A common failure shape: ...` framing. Keep the lesson, drop the date.
- **Strip proprietary references.** Project names, internal repos, absolute home paths (`/Users/<name>/...`), internal dashboards / URLs (Grafana, Linear, private Slack). When in doubt, anonymize to a generic placeholder.
- **Skills + hooks pair together.** When a skill has an enforcement hook (e.g. `agent:nogrep` paired with `plugins/hooks/hooks/nogrep.sh`), check the hook before promoting or moving the skill. Keep the pair in the same marketplace so the enforcement contract isn't split across marketplaces. The skill and its hook may live in different plugins within that marketplace when the hooks are packaged separately for optional install (the `hooks` plugin), but they must not land in different marketplaces.

## Workflow

### Phase 1: Discovery

1. List source dir contents; skip symlinks.
2. List target marketplace skills (per plugin).
3. Classify each source skill as **overlapping** (exists in both) or **source-only** (candidate for promotion).
4. **Tracking (optional).** For large syncs, track with dex (an epic plus one child task per skill); for a one- or two-skill sync, skip the ceremony. When using dex, whitelist its permissions before starting (saves dozens of prompts):

   ```json
   "Bash(dex create:*)",
   "Bash(dex complete:*)",
   "Bash(dex list:*)",
   "Bash(dex show:*)",
   "Bash(dex edit:*)",
   "Bash(dex delete:*)"
   ```

   Each dex task records: source path, target path, preliminary verdict, generalization items, validation criteria.

### Phase 2: Per-skill reconcile (overlapping)

For each overlapping skill, **read both files fully**, then assign one verdict:

| Verdict | Meaning | Action |
| --- | --- | --- |
| `EQUIVALENT` | Substantively identical | No-op; close dex task |
| `REPO_WINS` | Target has improvements source lacks (cleaner namespacing, broader file-type coverage, generalized already) | No backport |
| `BACKPORT` | Source has rules/examples/sections target lacks | Backport the missing content, generalized |
| `MERGE` | Both have unique value | Combine; document which came from which |

Sibling files (`references/*.md`, `scripts/*`) need the same diff. The SKILL.md may say EQUIVALENT while a reference file has divergent content.

**Description budget:** keep frontmatter `description` at or under 250 chars where possible. Existing marketplace skills sometimes exceed this (`vitest`, `storybook-vitest`). Don't trim below source unless source is itself bloated.

### Phase 3: Promotions (source-only)

Per source-only skill:

1. **Check for redundancy first.** Grep the marketplace for skills covering the same ground (e.g. a renamed `discipline` skill in one plugin may already cover a local `communication` skill; verify line-by-line, don't just claim "redundant"). If redundant, SKIP with a clear justification.
2. **Pick the plugin.** Match the skill's domain: cross-cutting goes to `agent`, Svelte-specific to `svelte-5`, etc. If the skill has a paired enforcement hook, keep the pair in the same marketplace. The hook may live in the dedicated `hooks` plugin when enforcement is packaged separately for optional install.
3. **Generalize content.** Strip dated incidents, project names, absolute paths. Replace bare `/skill` references with `plugin:skill`.
4. **Frontmatter name field** must match the directory name. If source has `name: skills` but the dir is `skills-reference`, fix it on write.

Writes follow the ask-first, one-skill-at-a-time rule above.

### Phase 4: README updates

After promotions:

- **Plugin README** (`plugins/<plugin>/README.md`): update the skill count in the intro, append new rows to the skills table.
- **Root README** (`README.md`): update the plugin table's skill-count column; update the context-budget calculation (each new skill adds ~250 chars; bump the "~N skills" number).

### Phase 5: Preservation Audit (the gate)

**Run this for every skill file you touched, in every operation, before declaring anything done.** This is where information loss is caught. Full table template, worked example, and the anti-rationalization list are in [references/preservation-audit.md](references/preservation-audit.md). Read it before your first audit.

1. **Establish the "before".** For a tracked file: `git show HEAD:<path>`. For an untracked edit or a backport source: the pre-edit `cp -r` snapshot you took *before the first Write*. Never reconstruct the original from memory.
2. **Enumerate every atomic item** in the "before": each rule, numbered step, checklist item, worked example, numeric criterion or threshold (e.g. `±30%`, `3x`, "head -100"), MUST/NEVER directive, and cross-reference. One row per item.
3. **Classify each item** against the "after":

   | State | Meaning |
   | --- | --- |
   | `PRESERVED` | Same item, still present (rewording is fine) |
   | `MOVED to <loc>` | Same content, relocated; name the new location |
   | `MERGED into <loc>` | Folded into another item; show the merged text |
   | `DELETED` | Removed on purpose; **justification must quote the covering line** (in this skill or a named other skill) that makes it redundant |
   | `LOST` | **BLOCKER.** Content that vanished with no home and no justification |

4. **Resolve blockers.** Any `LOST`, or any `DELETED` whose justification can't quote the covering line, blocks completion. Restore the content, or produce the quote. "Another skill covers it" without the quote is not a justification (this is the exact `plan` / "covered by `asshole`" lie that lost the "never park a bug" rule).
5. Only once the table has zero unresolved `LOST` may you state preservation. State it by showing the table, never by asserting it.

### Phase 6: Surface validation (secondary: necessary, not sufficient)

Run these **after** the Preservation Audit passes. They catch different bugs; none of them proves content survived.

- **Style + markdown pass via the skills.** Confirm you invoked the `deslop` and `frontend:editing` skills and applied their output to every changed file; `markdownlint` returns 0 new errors. Invoking them is the check, not eyeballing the prose yourself.
- **Proprietary-string scan** across all changed files. Multi-grep patterns (adjust to the user's environment):

  ```text
  <corp> | <product> | <project-names> | /Users/<name> | grafana.internal | <internal-tools>
  ```

  Must return 0 matches.

- **Cross-reference check.** Any `agent:<skill>` / `frontend:<skill>` / `svelte-5:<skill>` references must point to skills that actually exist after the changes. Common breakage: a backported "see X" line pointing to a skill that was SKIPPED rather than ADDED.

- **Description char count.** Spot-check that no description is wildly over the budget set in Phase 2.

- **Markdown lint.** Pre-existing warnings (MD041 first-line-h1, MD060 table-column-style) are fine; don't try to fix repo-wide style issues that predate the work. Only fix warnings introduced by the current edits.

## What NOT to do

- Don't print proposed file contents in chat when the user said write; chat dumps are zero-value, just edit the file.
- Don't claim "fully redundant" / "matches verbatim" without an actual line-by-line comparison.
- Don't batch many Write calls when the user wants per-skill review.
- Don't add features, helpers, or new conventions outside what the source had. Generalization removes specificity; it doesn't invent abstractions.
- Don't keep dated personal incidents in the public version even if the lesson is good. Anonymize the example, keep the rule.
- Don't downgrade the marketplace's existing namespacing to bare `/skill` paths, even if source uses bare paths.

## Triggers

- User says "update skills", "sync skills", "backport skills".
- Marketplace + local skill collection has diverged.
- New skill in local that's worth publishing.
- After an upstream marketplace change, pull improvements down to local with the same workflow, reversed direction.
