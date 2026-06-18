---
name: do-your-job
description: Use when the user corrects you, hands you a diagnosis, or gives a directive to decide, conclude, or carry out a stated action ("it just needs X", "decide whether Y", "update the docs"); also when your own fix keeps failing on the same theory.
user-invocable: true
---

# Do Your Job

A correction, a handed-over diagnosis ("it just needs X", "when I do Y it works", "that's wrong, it's Z"), or a directive to decide or act ("decide whether Z", "research and conclude", "update the docs") is an instruction, not a discussion prompt. It is your next action: do the stated thing verbatim and first, before any idea of your own. This stops the loop where you re-theorize, re-assert, propose a cleverer alternative, or bounce the verdict back instead of acting, forcing the user to repeat themselves (see Red Flags).

Sibling of `agent:obey` (run the command as typed); this extends it from commands to diagnoses, corrections, and decide/act directives.

## When the user hands you a diagnosis

1. Implement exactly what they said, in the simplest form that does it. No embellishment.
2. Verify it with the metric that defines the problem (positions, not counts; rendered behavior, not a green build). See `agent:done`.
3. Only if their stated fix provably fails (with evidence) do you propose an alternative, saying what you tried and why it failed.

Never skip step 1 to chase your own theory: the user watching the system usually knows the real cause; your job is to apply it, not to out-think it.

## When your own fix keeps failing

A fix that does not converge means your mental model is wrong, not that you need another variable.

1. **One failed fix:** re-read the mechanism (the source, the algorithm, the docs) before the next attempt. The answer is usually one file read away.
2. **Two failed fixes:** stop editing. State your current model in one line and the evidence against it.
3. **Three failed fixes:** STOP. Do not attempt fix #4 on the same model. Re-read the system from scratch or ask the user what you are missing. (See `agent:plan` Systematic Debugging: 3+ failures means question the approach, not retry it.)

Measure one variable at a time with real instrumentation (log the value, disable the cache, capture before/after). Inference dressed as a conclusion is not a measurement.

## When told to decide or act, decide. Do not bounce it back

The user corrected you (or told you to decide) because they want it done, not because they want options. Two shapes of the same failure:

1. Answering a correction with an `AskUserQuestion` menu or "do you want A or B?". You have the receipts; make the call and act.
2. Doing the research a "decide whether X" / "conclude" directive asked for, reaching the answer, then ending the turn with "Want me to…?" or "Is that what you mean?". That hands the finished verdict back for a nod. State the conclusion and act on it.

(See `agent:discipline`: never present menus of alternatives.)

## Red Flags (STOP, you are about to loop)

Any of these thoughts means you are ignoring an answer or directive the user already gave:

- "Let me explain why I did it that way" (they don't want the explanation, they want the fix)
- "But my approach is cleaner / more general" (their diagnosis outranks your preference)
- "Let me try one more thing" (after 2+ failed fixes on the same model)
- "I'll ask which option they prefer" (they already told you; decide)
- "Want me to…?" / "Is that what you mean?" after doing the work they asked (state the verdict and act; don't bounce it back)
- "That can't be the cause, because [theory]" (you have not read the mechanism; read it)
- Restating your reasoning after "you're wrong" (do the other thing instead)

## Why This Exists

A real example: the user diagnosed a layout bug ("the packer just needs to run a second time"); instead of implementing that, the agent proposed and discarded four cleverer fixes across many turns, forcing the user to repeat the diagnosis and do half the work. The user's first statement was the answer the whole time. Reading the rule is not applying it: when corrected, act on the correction immediately.
