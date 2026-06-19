# no-honest.mjs

`Stop` hook. A **non-blocking, advisory** nudge: when an assistant message this turn contains the word `honest` (or `honestly`), it injects `additionalContext` reminding the agent to show evidence instead of vouching for its own truthfulness. It does **not** enforce — the enforceable rule lives in `agent:discipline`; this hook only reinforces it where `Stop` fires.

## Why a nudge, not a block

Hard-enforcing assistant output is impossible in Claude Code by design, and `decision:block` on `Stop` is actively harmful:

- **It crashes the model.** `decision:block` on `Stop` during an Opus 4.6/4.7/4.8 extended-thinking session corrupts the finished message's thinking blocks on re-entry → API 400 ([#63287](https://github.com/anthropics/claude-code/issues/63287), open). `additionalContext`-only never re-enters or modifies the message, so it sidesteps this.
- **Blocking is won't-fix.** [#3656](https://github.com/anthropics/claude-code/issues/3656) (closed, not_planned) — some builds ignore `decision:block` entirely.
- **Output enforcement doesn't exist.** Only `MessageDisplay` (display-only) and `Stop` (after the fact, `additionalContext` only) touch the model's text; the "rewrite the assistant message" request ([#61152](https://github.com/anthropics/claude-code/issues/61152)) is closed/duplicate. The docs' position: output hooks are persuasion, not enforcement.
- **The model evades banned-word hooks** by splitting the word mid-stream ([#29691](https://github.com/anthropics/claude-code/issues/29691)).

So the reliable layer is the `agent:discipline` rule ("never self-certify with `honest`/`honestly` — show the evidence"), carried into every session by the `SessionStart` directive. This hook is opportunistic reinforcement.

## Mechanism

- On a match it prints `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"…"}}` and exits 0. The turn ends normally; the model reads the nudge on the next turn. No `decision:block`, no 400, no loop.
- Loop guard (`stop_hook_active`), and a bounded **256 KB** tail read of the transcript (flat latency, no full-file slurp). Scans every assistant text block in the current turn — from the last genuine user prompt onward — strips fenced and inline code, lowercases, matches `\bhonest(ly)?\b`.

## Scope

`honest` and `honestly` (`\bhonest(ly)?\b`) — the opener forms the agent reaches for ("Honestly, …", "To be honest, …"). NOT the noun `honesty` ("honesty policy"), not `dishonest`, not multi-word phrases. Edit `WORD_RE` to change it.

## Effectiveness + impact (measured)

| Metric | Result |
| --- | --- |
| Detection — messages with `honest`/`honestly` | 8/8 nudged |
| False positives — messages without the word | 0/7 (noun `honesty`, `dishonest`, inline/fenced `honest` all silent) |
| Obfuscation — "h o n e s t", "hon-est" | 0/2 (known bypass) |
| Latency | ~28 ms per Stop, flat (27 KB → 14 MB transcripts) |

The bounded read keeps latency flat; an unbounded full-file slurp was O(session size) and hit ~5500 ms at a 14 MB transcript.

## Limitations — best-effort

- **Advisory only** — the model can ignore `additionalContext`. The `agent:discipline` rule is the real backstop.
- **Plugin `Stop` hooks are unreliable**: `$CLAUDE_PLUGIN_ROOT` may not be injected ([#66557](https://github.com/anthropics/claude-code/issues/66557)), `node` may be missing from the hook's PATH ([#64064](https://github.com/anthropics/claude-code/issues/64064)), and `Stop` fires unreliably on Windows/VSCode ([#40029](https://github.com/anthropics/claude-code/issues/40029)). When the hook doesn't fire, the skill rule still applies.
- Can't distinguish using the word from discussing it; needs `node` on `PATH`.

Tested by `tests/run-no-honest-tests.sh` (run in CI). Sources: the Claude Code hooks docs, deslop's "False Vulnerability" trope, and the issues above.
