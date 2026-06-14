# Skill-authoring guidance (official, distilled)

Authoring rules for SKILL.md files, distilled from the authoritative sources. Read this
before authoring or editing any skill — structure, voice, and length decisions follow this,
not personal preference.

Sources (verify against these, don't trust memory):

- Best practices: <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>
- Format spec: <https://agentskills.io/specification>
- skill-creator: <https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md>

## Contents

- Frontmatter (name, description) — hard rules
- Body structure — checklists/steps vs prose
- Voice, conciseness, strength of language
- Progressive disclosure & references
- Examples & templates
- Anti-patterns
- Evaluations-first
- Quick checklist

## Frontmatter — hard rules (spec)

- `name`: max 64 chars; lowercase letters, numbers, hyphens only; no leading/trailing or
  consecutive hyphens; **must match the parent directory name**; no XML tags; no reserved
  words ("anthropic", "claude"). Prefer gerund form (`processing-pdfs`) or a noun phrase
  (`pdf-processing`); avoid `helper`/`utils`/`tools`/`data`.
- `description`: max **250 chars**, non-empty, no XML tags. **Write in third person** — "The
  description is injected into the system prompt, and inconsistent point-of-view can cause
  discovery problems." State **what it does AND when to use it**, with specific trigger
  keywords. Good: "Extract text and tables from PDF files… Use when working with PDF files or
  when the user mentions PDFs, forms, or document extraction." Bad: "Helps with documents."

## Body structure — checklists and steps, not prose (best practices)

The body has "no format restrictions" (spec), but the best-practices guidance is explicit on
*how* to structure procedures:

- **"Break complex operations into clear, sequential steps."** Multi-step tasks are
  **numbered steps**, not prose paragraphs.
- **"For particularly complex workflows, provide a checklist that Claude can copy into its
  response and check off as it progresses"** — e.g. a fenced ` - [ ] Step 1… ` block.
- **Feedback loops:** for quality-critical work use "Run validator → fix errors → repeat".
- **Recommended sections (spec):** step-by-step instructions, input/output examples, common
  edge cases.
- **Do NOT flatten a checklist or numbered procedure into running prose.** That is the
  regression this reference exists to prevent.

## Voice, conciseness, strength of language

- **Concise is key** — "once Claude loads it, every token competes with conversation history
  and other context." Challenge each line: "Does Claude really need this explanation? Can I
  assume Claude knows this? Does this paragraph justify its token cost?" Default assumption:
  **Claude is already very smart** — only add what it doesn't already have. (The bad example
  is a paragraph explaining what a PDF is.)
- **Degrees of freedom** — match specificity to the task's fragility:
  - High freedom (multiple valid approaches) → short text instructions / numbered heuristics.
  - Low freedom (fragile, destructive, must-be-exact) → exact script + "Do not modify the
    command." Analogy: open field = general direction; narrow bridge with cliffs = exact
    guardrails.
- **Strong language is a targeted remedy, not a blanket ban.** The docs endorse "using
  stronger language like 'MUST filter' instead of 'always filter'" **when observation shows
  Claude actually misses the rule.** skill-creator's "ALL-CAPS is a yellow flag" applies to
  *gratuitous, unexplained* caps — not to a deliberately strong rule that exists because the
  rule was being violated. Resolution: prefer an imperative that states the action and, where
  the reason changes behavior, gives the why in a clause (not a paragraph); keep MUST/NEVER
  where evidence shows the rule gets skipped.

## Progressive disclosure & references

- Keep the SKILL.md **body under 500 lines** (and < ~5000 tokens of instructions).
- Split detail into `references/`, `scripts/`, `assets/`. **Keep references exactly one level
  deep** from SKILL.md — nested reference chains cause partial reads (`head -100`) and missed
  content.
- **Reference files longer than 100 lines need a table of contents** at the top.
- Make execution intent explicit for scripts: "Run X" (execute) vs "See X for the algorithm"
  (read).

## Examples & templates

- Provide concrete **input/output example pairs** where output quality depends on style —
  "Examples help Claude understand the desired style… more clearly than descriptions alone."
- Templates: match strictness to need — "ALWAYS use this exact template" for strict formats;
  "a sensible default, use your best judgment" for flexible ones.

## Anti-patterns (avoid)

- Verbosity / explaining what Claude already knows (the headline anti-pattern).
- Offering too many options — give one default with a single escape hatch.
- Time-sensitive info ("before August 2025…") — put deprecated material in a collapsed "Old
  patterns" section.
- Inconsistent terminology — pick one term (endpoint/field/extract) and keep it.
- Deeply nested references; Windows-style backslash paths; magic numbers ("TIMEOUT = 47");
  punting errors to Claude in scripts; assuming packages are installed; unqualified MCP tool
  names (use `Server:tool`).

## Evaluations-first

- "Create evaluations BEFORE writing extensive documentation." Run Claude on real tasks
  *without* the skill, document the actual failures, write *just enough* to fix them. Build at
  least three evals; test across Haiku/Sonnet/Opus.

## Quick checklist (before editing/sharing a skill)

- [ ] `description` third-person, what + when, specific keywords, ≤1024 chars, no XML/reserved words
- [ ] `name` lowercase-hyphen, matches directory
- [ ] Multi-step procedures are **numbered steps / checklists**, not prose
- [ ] Concise — every line justifies its token cost; no explaining what Claude knows
- [ ] Strength of rules matches fragility / observed failure (MUST where rules get skipped, with reason)
- [ ] Body < 500 lines; detail split to references; references one level deep; ToC if >100 lines
- [ ] Consistent terminology; concrete examples; no time-sensitive info; forward-slash paths
- [ ] No information dropped vs the prior version (diff it)
