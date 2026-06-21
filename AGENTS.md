# AGENTS.md

Guidance for AI agents working **on this repository**. The binding behavioral rules already live in the `agent:discipline` skill and the `agent:before-you-act` five gates (`plugins/agent/skills/discipline/SKILL.md`, `plugins/agent/skills/before-you-act/SKILL.md`) — read them; they apply here in full. This file adds only what is specific to *this* repo, where generic discipline kept failing.

## What this repo is

`ronin-skills` is a marketplace of **discipline skills + optional enforcement hooks for AI coding agents**. The product *is* agent discipline. The hooks (`plugins/hooks/hooks/`) are **DISCIPLINE NUDGES, not a firewall** — verbatim from `no-bash.md`: *"it is not a firewall or an adversarial sandbox."* Their threat model is a **well-meaning agent producing plain commands; there is NO adversary** (`no-bash.mjs`: *"the model produces these commands plainly and has no reason to obfuscate them to evade its own discipline hook"*).

## Prime directive: ground every change in the documented purpose

Before editing any hook or skill, read its rationale (the file header, plus `no-bash.md` / `no-honest.md`). **A change is valid only if you can cite the line of documented purpose it serves.** If you can't, don't make it. The threat model is the spec — not your intuition about what *could* go wrong.

## The trap this repo exists to teach (do not fall in it)

1. **Discipline tool ≠ security boundary.** Do NOT add firewall / RCE / ReDoS / injection / path-traversal hardening to these hooks. The threat model has no adversary and the inputs come from the agent's *own* tool calls. Security hardening here is **theater**: it defends inputs that cannot occur, and it grows a lean discipline nudge into a fortress. The hooks *deliberately* do not chase evasion, obfuscation, encoding, or pathological input — that is a documented design choice, not a gap to fix.

2. **A scanner / linter / security-review finding is NOT the task.** `agent:discipline` already says: *"A linter/typechecker complaint is not a license to rewrite working code… The check is not the task."* An **automated security review flagging a discipline hook is the same category.** Acknowledge it, decide against the *documented threat model*, do the narrowest correct thing — often nothing. **Never auto-comply with a scanner**, and never re-add code the user reverted just because a tool re-flags it (`agent:discipline`: *"When the user rejects an edit: STOP"*).

3. **Review must challenge the frame, not perform a ritual.** Before "fixing" anything, challenge it against the docs (grill it): *does the documented purpose even want this defended?* Verifying that a fix works, or that it doesn't regress, is **not** verifying that the fix should exist. A fan-out of agents that all assume the wrong frame is motion, not review.

4. **Lean: net-smaller or net-neutral.** `agent:discipline` says a revise pass *"defaults net-smaller or net-neutral"* — adding defensive code to a discipline nudge is the opposite of the design. If a change grows a hook, show the net line delta and justify it against the documented purpose.

## Worked example — the failure that prompted this file

Commit `b3975e6` added an option-injection "RCE" guard, ReDoS regex bounds, and a FIFO-hang guard to the hooks under the banner of "max adversarial review." All three defended inputs that **cannot occur** given the no-adversary threat model (`file_path` comes from the model's own Write/Edit; commands are written plainly; `transcript_path` is always a regular `.jsonl`). They were reverted after a docs-grounded grill, then an automated security scanner **re-flagged the reverted guard as HIGH RCE**. The correct response — and the rule for next time — is: **keep it reverted, cite the threat model, do not auto-comply.** Genuine engineering in the same commit (the Windows `.cmd` formatter fix, the run-guard, the conformance/fail-open tests) was kept; only the security theater was removed.

## The one contract that IS load-bearing: fail-open

Every hook must **fail open**: any malformed/absent/unexpected input or internal throw → `exit 0` (a block is `exit 2`), **never** crash, hang, or break the session. This is the real reliability property — test it, never regress it. `conformance-hooks.mjs` is the harness that enforces it across all six hooks: no-bash, no-absolute-paths, force-plan-mode, fix-formatting, no-honest, and session-start.

## Build / test / validate

Hooks are zero-dependency Node ESM. From the repo root:

```sh
# full hook test suite
node plugins/hooks/hooks/tests/run-no-bash-tests.mjs
node plugins/hooks/hooks/tests/redteam-no-bash.mjs
node plugins/hooks/hooks/tests/mock-install-no-bash.mjs
node plugins/hooks/hooks/tests/validate-no-bash.mjs
node plugins/hooks/hooks/tests/bench-no-bash.mjs
node plugins/hooks/hooks/tests/run-hook-tests.mjs
node plugins/hooks/hooks/tests/conformance-hooks.mjs   # fail-open + protocol contract, all hooks
node plugins/hooks/hooks/tests/run-no-honest-tests.mjs

node --check plugins/hooks/hooks/<edited>.mjs           # syntax
pnpx oxlint .                                            # code-style (curly, naming)
claude plugin validate .                                # + each plugins/*/
```

Every hook change carries a reproducing test. Match the surrounding code's style; run `oxlint`.

## Changes & releases

- Conventional Commits, scope `agent` or `hooks`. See `RELEASING.md`.
- **No version bump unbidden** — the release script owns versioning. **No commits / push / PRs unless explicitly asked.**
- When you remove content, your next message names what and why. Cite commit hashes, never tool/model names (`agent:discipline`).
