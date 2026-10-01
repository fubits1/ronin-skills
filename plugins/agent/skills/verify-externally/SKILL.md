---
name: verify-externally
description: Use when about to report a check you wrote passed, a green result feels obviously correct, handing others a document to act on, or asked "review it again", "are you sure", "prove it". Not for pre-commit self-checks, one reversible edit, throwaways.
---

# Verify Externally

Re-reading your own work does not catch errors that flow from the assumption which produced it.
It does catch truncation, dead links and wrong filenames; the effort is aimed at the wrong
target, not wasted. Errors get fixed reliably once pointed at and go unnoticed otherwise
([TACL survey, Kamoi et al.](https://arxiv.org/html/2406.01297v3): "the bottleneck is in the
feedback generation"). Spend the effort on signals that do not inherit your assumption.

## Quick start

1. Restate each claim as a command that exits non-zero when the claim is false. For claims that
   cannot become commands, see [REFERENCE.md](REFERENCE.md).
2. **See the check fail.** Copy the artifact to scratch, break the specific thing the claim
   asserts, run, observe red, discard the copy. Never mutate the real artifact.
3. Record the red output next to the check. A check nobody watched fail is untested.
4. Dispatch readers with no shared context; prompt template and lenses in
   [REFERENCE.md](REFERENCE.md).
5. Adjudicate each finding against the artifact and cite the line that confirms or refutes it.
6. Fix, then return to 2. Stop when a full round produces nothing you act on.

## Why writing the rule down does not make you follow it

Six frontier models given process instructions of exactly this kind complied **0%** of the time:
they agree to the procedure, then bypass it. Two things moved that number, and neither was trying
harder: removing the shortcut took it to **75%**, and requiring an audit trail took it to **97%**.

That is why step 3 is not bookkeeping. Recording the red output is the intervention with the
strongest measured effect on whether a procedure actually happens, including when the one meant to
follow it is you. Evidence and citations: [REFERENCE.md](REFERENCE.md).

## The two rules that carry it

**The mutation must target the structure the claim names.** Arbitrary breakage proves nothing. If
the claim is "every finding has a row with a file:line", delete the file:line *from a row*, not a
random character. This is where checks that look rigorous get exposed.

**Reasoning that a check would go red is not seeing it go red.** That substitution is the exact
failure this skill exists to catch, so the evidence requirement in step 3 is not ceremony.

## Three checks that passed while measuring nothing

All three written in one session by an agent trying to be careful:

- **Substring anywhere.** Asserting a filename appears somewhere in a document scored a finding as
  "documented" when the file was named in an unrelated aside. Key on the structure that matters
  (the row, the function, the assertion), not on a string.
- **Self-reference.** The list of required markers lived inside the document being checked, so
  every marker matched its own copy in the code fence. It could not fail. Keep expectations outside
  the artifact, or exclude the region holding them.
- **Scope capture.** In `jq`, `select(contains(.))` tests each item for containing *itself*,
  always true. The fix is not "bind `.`"; `. as $x | select(contains($x))` is equally trivial. The
  needle must come from an outer scope. Worked example in [REFERENCE.md](REFERENCE.md).

The shape is common to all three: each was surface pattern-matching wearing the costume of rigour.

## What a cold reader is and is not

A reader with a fresh context loses your commitment to what you wrote, which is most of the value
and was worth thirteen findings against two from repeated self-review on the same document. It does
**not** remove blind spots belonging to the model itself: for that, one reader must run on a
different model, which the Agent tool supports via its `model` parameter. Reader output also varies
between runs; agreement across readers is weak evidence, not proof.

Treat every finding as a claim. Some are wrong. One accepted without checking is the same failure
in new costume.

## Rationalizations, and what is actually true

Every one of these was used by an agent to skip a step, in the session that produced this skill.

| Excuse | Reality |
| --- | --- |
| "I can see it would go red" | Seeing is the step. Three checks that "would obviously" fail printed PASS. |
| "The check is simple enough to trust" | All four false-passes were simple. Simplicity is what hid them. |
| "I already read it carefully" | Careful reading is the thing measured at near-zero yield. |
| "A reader costs tokens for a document I know is fine" | The feeling of fine is uncorrelated with fine. That is the finding. |
| "I'll verify after I finish the next part" | Verification deferred is verification skipped; the artifact ships in between. |
| "The reader's finding is pedantic" | Adjudicate against the text and cite the line. If you cannot cite one, it is not pedantic, it is unexamined. |
| "One reader agreed, so it is fine" | A single reader is the weak baseline. Agreement across two is weak evidence, not proof. |
| "I wrote the rule, so I will follow it" | Measured compliance with self-authored process rules is near zero. Record it instead. |

## Red flags: stop and run the check

- about to type "PASS", "verified", "all green", or "confirmed" about your own artifact
- about to describe what a check *would* report
- a check you wrote has never once been observed failing
- you are choosing between running a reader and explaining why a reader is unnecessary
- you notice you are the only party who has read the thing

## When to skip

A single reversible edit, a throwaway, or anything answered faster by running the thing. Readers
cost real tokens and each re-reads the whole artifact. Spend it where another party must act on the
output and being wrong is expensive.

## Related

`agent:done` and `superpowers:verification-before-completion` are pre-commit checklists for your
own work; this skill is for artifacts someone else must act on.
`superpowers:test-driven-development` owns red-first for code. A handoff-writing skill produces
the document; this one establishes that it works.
