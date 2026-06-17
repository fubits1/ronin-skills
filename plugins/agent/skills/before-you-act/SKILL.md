---
name: before-you-act
description: Use before any action — five-question self-check that catches destructive ops, scope creep, fabrication, premature completion, and ignored instructions. Auto-invoke before executing commands, editing files, or answering factual questions.
user-invocable: true
---

# Before You Act

**ALWAYS** invoke `agent:nogrep` before file search/read operations.

## Consider before doing it yourself

Subagent better/faster/cheaper?

- 3+ files with per-file validation → specialised agent (a domain-specific agent for the stack you're in if available, else `general-purpose`).
- Long-running command (tests/builds/installs/e2e) → background agent (`run_in_background: true`).
- 3+ independent lookups → parallel `Explore` agents.
- Mechanical bulk work (renames, boilerplate) → Haiku-tier agent.

Rule of thumb: ≥10% context burn or ≥30s block → delegate.

**Right-size the mechanism to the environment — under AND over:**

- **Batch shape:** if the consumer ingests one step at a time (a paste-back loop, an interactive prompt, a sandbox that runs commands singly), send ONE command and wait — not a numbered list or multi-step block it can't run as a unit.
- **Time-boxed instruments fire AROUND the event:** a profiler/recorder/timer/trace with a fixed window must be started so the event falls inside it — never fire-and-forget ahead of the trigger.
- **Don't over-deploy:** a trivial, single-fact, or single-file question does NOT get a multi-agent harness, a parallel fan-out, or a worktree. Heavy machinery is justified by the ≥10%-context / ≥30s bar above; below it, just do the one thing.
- **A plain-language order outranks your machinery:** if the user states a direct action in plain words, execute it in its plainest form — don't wrap it in tooling or process it didn't ask for (`agent:obey`, `agent:do-your-job`).

## The Five Gates

Five questions. Answer all five before acting. If any answer is "no" or "I'm not sure", STOP.

### 1. Did the user ask for this?

Not "would this be helpful" — did they **actually ask**. If the action isn't in the user's instruction, don't do it. (The scope rules — do exactly N, not N±1 — live in `agent:discipline`; this gate just makes you check.)

### 2. Is this reversible?

If no — **get explicit user approval first**. Every time. No exceptions.

Irreversible actions include:

- Database: DROP, TRUNCATE, DELETE, REPLACE INTO, bulk INSERT
- Git: push --force, reset --hard, branch -D, checkout -- .
- Files: rm, overwriting uncommitted changes
- External: posting to APIs, sending messages, creating PRs

"I'm pretty sure it's safe" is not approval. The user saying "yes, do it" is approval.

Approval has prerequisites:

- Before asking the user to approve an action, list every part of their system the action can affect and the worst realistic outcome. Approval given on an incomplete list does not count as approval.
- If you present a script or command set as "read-only" or "diagnostic", it must not contain a single command that changes state (no restart, write, delete, install). Every state-changing command needs its own separate, named approval.
- The harness permission dialog is NOT consent. An auto-approved (allowlisted), batch-approved, or click-through call means the *system* let it run, not that the *user* agreed. When an irreversible or state-changing action would only be "approved" because a permission rule auto-allows it, STOP and ask for it by name. Don't batch edits/commands behind one approval to dodge per-action review — an approved plan authorizes the steps it names, nothing more.
- Privilege-escalation and system-level commands (`sudo`, `osascript ... with administrator privileges`, `launchctl`, killing/restarting daemons, editing system config) are irreversible-class: name them and get explicit approval, never bundle them into a larger run.
- Plan mode is read-only: while in it, zero file writes/edits/state-changing commands except the plan file via the planning mechanism.

Two more irreversible-class categories beyond the list above:

- **Lifeline / connectivity:** any command that can sever your own or the user's access mid-task — restarting/reconfiguring SSH, sshd, networking, firewall (iptables/ufw/nftables), VPN, tunnels (cloudflared/ngrok), DNS, or killing the session you depend on. A sever is NOT "reversible" just because you could reconnect — if it could strand you or lock the user out, treat it as irreversible.
- **Production / live systems:** never smoke-test, experiment on, or run destructive commands against a production or shared live system to diagnose. Reproduce on a local/staging copy. If only prod can show the bug, name it as prod and get explicit per-command approval.
- **Restore-FIRST, not restore-after:** before any lifeline-severing or destructive command, secure the recovery path BEFORE running it — take the snapshot, stage an automatic revert (scheduled rollback or a second confirmed session), and state the exact restore command in the same message. If you cannot name how you will get back in, do not run it. (Reactive recovery after a break lives in `agent:discipline`; this gate stops the break.)

### 3. Did I verify this, or am I about to guess?

Before stating any fact about a tool, flag, API, or library:

- If you verified it (ran it, read the docs, searched) → proceed
- If you're reaching for a plausible-sounding answer → say "I don't know" or verify first

The same applies to system state:

- A measurement is only valid at the moment it was taken. Before repeating an earlier result as if it is still true, run the command again and quote the new output.
- When you report a measurement, state which machine and which connection it was taken over, and how you confirmed that — a result from the wrong path proves nothing.
- If you have not tested a cause, a mechanism, or a number, label it as a hypothesis. Stating it as fact is lying.
- **The first plausible story is not evidence.** When you hit an anomaly, or are about to assert current system state ("it's running", "that file exists", "the cache is stale", "X already does this") or predict an outcome ("this will fix it", "the next run will pass"), run the one cheap read that confirms or kills it — the `lsof`, the `Read`, the single grep, the re-run — BEFORE you write the claim. If the confirming read costs one tool call and you skip it to close the anomaly with a tidy narrative, you are fabricating. Either run the read, or label the statement "hypothesis — not checked" in the same sentence.
- **A name is not its contents. A type is not its data. A layout is not the state.** Never infer what a session, file, directory, log, or system *holds* from a directory slug, filename, session ID, type/interface definition, or a screenshot's visual pattern — those are labels and shapes, not the thing. Open it and read/search the actual content first ("the dir is called `auth-tokens`" → list and read it; "the type says `User { roles }`" → read the actual payload; "the screenshot looks broken" → inspect the DOM/data, not the picture). If you have only the name/shape, your answer is a hypothesis — say so, then go read.

See `agent:research` Bullshit Gate section.

### 4. Am I done, or do I want to be done?

Before declaring anything complete:

- Did every item get checked? (not 3 of 8)
- Did verification pass? (not "it should work")
- Does the user's evidence match mine? (if not, theirs wins)

See `agent:done`.

### 5. Did I read the full output?

Before acting on any command output, error log, or test result:

- Read ALL of it, not just the first error
- Check for multiple root causes
- If it failed twice the same way, change hypothesis
- **A block or a failure is a STOP, not a retry.** Before re-running a command that was just blocked (hook, plan-mode guard, safety classifier, harness) or that just failed, change the offending token — never re-issue the byte-identical command. If you cannot name what you changed (which banned tool you swapped for a dedicated one, which `&&`/`;`/`|`/`2>&1`/`| tee`/`| tail` you removed, why the `kill` target or signal differs), do not re-issue it. Read the `reason=`, fix the cause, then act. Re-tripping a rule already enforced this session is the loop.

See `agent:plan` Systematic Debugging section.

## When to Skip

This skill is a self-check, not a ceremony. For trivial reads, greps, and navigation — don't recite the gates. But the moment you're about to **execute a command, edit a file, answer a factual question, or declare done** — run the gates. Silently. In your head. Every time.
