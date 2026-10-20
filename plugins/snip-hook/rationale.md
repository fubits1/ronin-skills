# snip-hook — rationale

Why this hook exists and how it decides. Every design claim is sourced.

## Why it exists

[snip](https://github.com/edouard-claude/snip) installs a `PreToolUse(Bash)`
hook that rewrites every registry command `<cmd>` into
`"…/snip" run -- <cmd>` for token filtering, and auto-allows it. Claude Code
matches `permissions.allow` / `permissions.ask` / `permissions.deny` rules
against the command string **after** that rewrite, so:

1. **Deny rules stop firing.** `Bash(gh repo delete *)` does not match
   `"…/snip" run -- gh repo delete …`. Verified: with `Bash(ls *)` denied,
   `ls` (snip-rewritten) ran, while `Bash(whoami *)` blocked `whoami` (not in
   snip's registry, not rewritten) in the same session.
2. **Ask rules stop firing.** Verified: with `Bash(ssh *)` in
   `permissions.ask`, `ssh -V` ran without a prompt.
3. **Allow rules stop firing on compound commands**, so an allowed but piped
   workflow prompts.
4. **Commands no rule covers run without the prompt Claude Code would show.**
   snip's `"allow"` covers every command whose segments it supports.
   Verified with `snip hook` v0.25.2: `npx cowsay hi`, `curl -sS …`,
   `git push --force`, `pnpm add left-pad`, `find / -name x -delete`.

Tracked upstream:
[anthropics/claude-code#89448](https://github.com/anthropics/claude-code/issues/89448)
(open) asks for deny rules to match the command before or after a hook
rewrite; [#65393](https://github.com/anthropics/claude-code/issues/65393)
(evaluate permissions against the original input) was closed as not planned.
[RTK](https://github.com/rtk-ai/rtk), a similar rewriter, had the same bypass
([rtk-ai/rtk#886](https://github.com/rtk-ai/rtk/issues/886)) and now
re-checks permission rules itself; its model (deny/ask match every reading of
a command, allow only the command as written) is the one used here, except
that allow also looks past the wrappers Claude Code strips itself.

The hook has **no policy of its own**. It re-applies the rules from your
Claude Code settings, and where none matches it restores what Claude Code
would do without snip.

## How it decides

The hook runs in parallel with snip's hook and receives the **original**
command: a parallel `PreToolUse` hook is fed the original `tool_input`
(verified: a hook that blocks bare `grep` does not see `"…/snip" run -- grep`).

**Parsing** (`src/command.js` on the shared `shared/shell.js`). [unbash](https://github.com/webpro-nl/unbash)
parses the command into every simple command it would run: across pipelines,
`&&`/`||`/`;`/`&` lists and newlines, and nested inside `$(…)`, backticks,
`<(…)`, subshells, loops and functions. Redirects (`2>&1`, `&>`) are not
commands. Heredoc bodies are data, except when a shell reads them
(`sh <<EOF`, `bash <<< '…'`); a shell's `-c` script is parsed too. Each command
is read several ways, outermost first: as written, then past each leading
assignment or wrapper — `timeout`, `time`, `nice`, `nohup`, `stdbuf`,
`command` (not `command -v`), `builtin`, `noglob`, bare `xargs` (the wrappers
Claude Code's permissions docs list), plus `env`, `exec` and a snip wrapper.
The last reading is the effective command.

**Settings** (`src/rules.js`). Only `Bash(...)` rules are used, from:

- the user `settings.json` (`$CLAUDE_CONFIG_DIR` honoured)
- the project `.claude/settings.json` in the folder the session started in
  (`$CLAUDE_PROJECT_DIR`; the hook input's `cwd` "follows Claude" through
  every `cd`)
- the project `.claude/settings.local.json`, where "Yes, and don't ask again"
  saves rules, "at the root of the git repository, resolved through worktrees
  to the main checkout" (outside a repository: the start folder)

Deny and ask rules only restrict, so all of them apply. Allow rules apply
exactly when Claude Code applies them (permissions docs, "Project allow rules
and workspace trust"):

- user `settings.json`: always
- project `.claude/settings.json`: once the trust dialog was accepted for the
  repository root (the main checkout for a worktree; the folder itself outside
  a repository). Claude Code records that as
  `projects["<path>"].hasTrustDialogAccepted` in `~/.claude.json`, which the
  docs name as the way to "trust it by hand". "Trusting a parent folder
  doesn't count for these rules"
- `.claude/settings.local.json`: "without the trust step" only in your
  configuration home (`~`); elsewhere once the folder is trusted (outside a
  repository a trusted parent counts, never for a nested repository), and
  only while it is your own file — not when "the file is tracked in git, or
  `.claude` is a symlink" (checked with `git ls-files` and `lstat`)

**Outcome** (`src/decide.js`), precedence **deny > ask > allow**, Claude
Code's own order:

1. **Deny.** Any reading of any command matches a deny rule → `exit 2`. A rule
   on a wrapper itself (`Bash(nohup *)`) still fires, and nested commands are
   denied like Claude Code denies them natively.
2. **Ask.** Any reading of any command matches an ask rule → emit
   `permissionDecision: "ask"`. It beats a matching allow rule and snip's
   parallel `"allow"`: "When multiple PreToolUse hooks return different
   decisions, precedence is `deny` > `defer` > `ask` > `allow`" (hooks docs;
   also measured on Claude Code 2.1.302).
3. **Allow.** **Every** command is covered by an allow rule → emit
   `permissionDecision: "allow"`, so allowed workflows don't prompt, even
   piped.
   - **The reading matched** is the one Claude Code matches: the command past
     the wrappers Claude Code strips itself, in the forms its matcher strips
     them (Claude Code 2.1.302: `timeout` with its flags and a duration,
     `time`, `nice -n N` or `-N`, `stdbuf -oL`, `nohup`, `command`, `builtin`,
     `noglob`, bare `xargs`, each named without a path), up to the first env
     assignment or wrapper it doesn't strip, which stays as written. So
     `Bash(git log *)` covers `timeout 30 git log` but not `env git log` or
     `nice -n10 git log`, and `Bash(xargs *)` covers `xargs -n1 …`, as in
     Claude Code. The docs say "An allow rule won't match past an assignment
     of any other variable" than a known-safe set they don't list, so the
     hook treats every assignment that way.
   - **Never for the whole script** when it contains a substitution,
     subshell, brace group, loop, conditional, function, a shell `-c` /
     heredoc script, a parse error or over 10,000 characters:
     `git log $(gh repo delete x)` would otherwise auto-run the inner command
     because the visible prefix matches `Bash(git log:*)`.
   - **Never where Claude Code's path checks ask**, which they do before any
     allow rule ("A rule such as `Bash(git commit *)` allows the command, not
     the target"): a file the command writes (`> file`, `>> file`, a `tee`
     target), a path that may lie outside the working directories (absolute,
     `~`, `..`, `$VAR`) as an argument of a command whose paths Claude Code
     checks (`rm`, `cp`, `cat`, `grep`, `git`, `jq`, …) or as an input
     redirect (`< file`), `cp`/`mv` with any flag, and a file write or input
     redirect after a `cd`. The hook doesn't re-apply your Edit/Read rules or
     resolve the working directories, so it approximates on the safe side:
     one prompt too many at worst (an absolute path inside the project, an
     Edit rule, `acceptEdits`).
   - **Never for an exec wrapper** (`watch`, `setsid`, `ionice`, `flock`) or
     `find` with `-exec`/`-delete`/`-fprint`/`-files0-from`: "A prefix rule
     like `Bash(watch *)` or `Bash(find *)` can't auto-approve" them.
4. **Restore.** Emit `permissionDecision: "ask"` (reason: "without snip
   Claude Code would ask") when all three hold:
   - some command is neither covered by an allow rule nor one of Claude
     Code's built-in read-only commands, or the script is one Claude Code
     can't analyse ("Commands longer than 10,000 characters always prompt",
     and so does an unparseable one such as `npm test &&`)
   - the permission mode is one in which Claude Code would prompt
   - snip's own hook would auto-allow the command

   Without snip, Claude Code decides such a command by mode:

   - `default`, `acceptEdits`, `plan`: Claude Code prompts → hook asks
   - `dontAsk`: Claude Code "auto-denies every tool call that would otherwise
     prompt" → hook asks, which `dontAsk` turns into the same denial
   - `auto`: the classifier decides, and snip's hook `"allow"` doesn't skip it
     ([anthropics/claude-code#94740](https://github.com/anthropics/claude-code/issues/94740))
     → hook silent, because a hook ask "forces a permission prompt in auto
     mode"
   - `bypassPermissions`: Claude Code runs it → hook silent

   Whether snip would auto-allow is asked of snip itself: the hook runs the
   `snip hook` handler registered in your settings (else `snip hook` on
   `PATH`) with the same payload, only for a restore candidate, and treats any
   failure as "no". The read-only set is the members the permissions docs
   name — "The set includes `ls`, `cat`, `echo`, `pwd`, `head`, `tail`,
   `grep`, `find`, `wc`, `which`, `diff`, `stat`, `du`, `cd`, and read-only
   forms of `git`" — judged conservatively: not past an assignment or a
   wrapper form Claude Code doesn't strip, not with an unquoted glob or
   anything the path checks above ask about, not `git … --output`, not for an
   unparseable or over-10,000-character command, not `git` together with
   `cd`.

Otherwise: silent `exit 0`.

**`gh api` writes are also read with an explicit method** (`src/gh.js`), for
deny and ask only. A write — explicit `-X POST|PUT|PATCH|DELETE`, an implicit
POST (`-f`/`-F`/`--field`/`--raw-field`/`--input` without a method:
`gh api --help`, "adding request parameters will automatically switch the
request method to POST"), or a `graphql` mutation — is matched as
`gh api -X <METHOD> …`, `gh api -X<METHOD> …` and
`gh api --method <METHOD> …` too. So a rule `Bash(gh api -X POST *)` also
covers `gh api repos/x/issues -f title=bug`, the same request spelled
differently. Spaced and fused flag forms (`-XDELETE`, `-ftitle=bug`,
`--field=…`) are decoded.

**Rule → matcher.** A `Bash(...)` body becomes a RegExp. A trailing `*` or
`:*` means space-then-anything, a word boundary: `Bash(ls *)` matches `ls -la`
but not `lsof`. It also matches the bare command (`ls`), but only when that
trailing star is the rule's only wildcard: `Bash(* --help *)` matches
`npm --help x`, not `npm --help` (permissions docs). `*` elsewhere → `.*`; no
wildcard → exact.

## Threat model

A **discipline layer for a well-meaning agent's plain reflexes, not a
firewall** — same stance as
[no-bash.md](../hooks/hooks/no-bash.md):
it does not chase deliberate evasion (encoding, a command built at run time)
"because the model has no reason to obfuscate its own command to slip past
its own discipline hook". Quoting that bash itself removes resolves anyway,
because the command is parsed the way bash parses it. It restores your rules
for the commands an agent plainly writes and snip's rewrite hid.

Deny and ask failing toward a prompt is harmless; allow is the only outcome
that can auto-run something, so it is the strictest: every command must
match, in the reading Claude Code matches, only allow rules Claude Code
itself would apply, any doubt → silent.

## Distribution

The hook ships as a plugin of the ronin-skills marketplace
(`./plugins/snip-hook`). Claude Code copies the plugin into its
cache and runs `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js` (`hooks/hooks.json`,
exec form so the path is one argument). Claude Code installs a plugin's npm
dependencies only from an npm or bun lockfile, and not for a plugin loaded in
place from a local marketplace, so `dist/index.js` is a committed
[rolldown](https://rolldown.rs) bundle with unbash inside (the repository's
`rolldown.config.js`, which also builds no-bash; unbash's ISC notice
appended). CI rebuilds it and fails when the committed copy differs. Plugin
hooks "merge with your user and project hooks" and "all matching hooks run in
parallel", so the plugin runs beside snip's user-settings hook.

## Limits

- **Matcher drift.** The hook reimplements only a slice of Claude Code's
  Bash-rule matching; it can diverge as Claude Code evolves. If Claude Code
  ever exposes its matcher, replace this.
- **Settings it can't see.** Managed settings, `--settings <file>`, CLI
  `--allowedTools` and session-scoped "always allow" approvals are not
  re-applied. Trust Claude Code holds only in memory (a session started in
  `~`, a `-p` run) is not visible, so project and local allow rules may keep
  prompting through snip there. With `CLAUDE_CONFIG_DIR` set, trust is read
  from `$CLAUDE_CONFIG_DIR/.claude.json`; the docs say "all settings … are
  stored under this path" but don't name that file, so this is inferred.
- **Interpreters defeat deny.** Shell scripts (`sh`/`bash`/`zsh`/`dash` with
  `-c`, a heredoc or a herestring) and `xargs` are seen through. Other
  interpreters (`python -c`, `node -e`, `eval`) hide the real command, which
  then matches no allow rule either and falls through to a normal prompt. A
  wrapper flag and its word value (`xargs -n1 …`, `timeout -s KILL 5 …`,
  `env -u FOO …`) are skipped, so deny and ask see the wrapped command; allow
  looks past a wrapper only in a form Claude Code strips.
- **Rules are matched without shell quoting.** A rule is matched against the
  command as bash sees it, quotes removed, so a rule that contains quotes
  (`Bash(git commit -m "wip")`) never matches; write it without them.
- **`gh api graphql` mentioning `Mutation`.** The mutation check scans every
  `-f` value, so a read that introspects the `Mutation` type is read as a
  write.
- **Bash grammar, zsh shell.** unbash parses GNU Bash; Claude Code runs the
  Bash tool in the user's shell (zsh on macOS). zsh-only syntax may parse
  differently or fail to parse, which keeps allow silent.
- **Read-only set is the documented subset.** The docs' list "includes" the
  members above and isn't exhaustive. A read-only command missing from it, or
  one with an unquoted glob, gets one prompt Claude Code alone wouldn't show,
  never a silent run.
- **Plan mode with auto mode available.** Claude Code then sends non-read-only
  commands to the classifier; the hook can't see that and asks.
- **Hook-forced prompts.** Whether a prompt forced by a hook's `"ask"` offers
  "Yes, and don't ask again" isn't documented. To stop a restore prompt, add
  an allow rule.
- **An ask drops snip's filtering for that call.** Approving the prompt runs
  the ORIGINAL command
  ([anthropics/claude-code#75915](https://github.com/anthropics/claude-code/issues/75915)).
- **Fail-open.** Missing/corrupt settings, unparseable stdin, or any throw →
  `exit 0`: a hook bug must never break the session. Without `node` on
  `PATH` the hook can't start, which Claude Code reports as a non-blocking
  hook error on every Bash call.

## Sources

- snip rewrite and auto-allow: `edouard-claude/snip` v0.25.2
  `internal/hook/{hook,rewrite}.go`, `internal/cli/cli.go`; `snip hook` run
  on the commands named above
- Claude Code permission-modes docs: per-mode behaviour, auto mode decision
  order
- Claude Code hooks docs: "All matching hooks run in parallel"; decision
  precedence; exit code 2; `CLAUDE_PROJECT_DIR`, `cwd`
- Claude Code permissions docs: rule matching, stripped wrappers,
  env-assignment semantics, separators, deny/ask inside substitutions,
  settings scopes, local settings file location, workspace trust
- Claude Code plugin docs: manifest, marketplace, `${CLAUDE_PLUGIN_ROOT}`,
  versions and updates, dependency installs for copied plugins
- `gh api --help`: implicit POST
- RTK permission model: `rtk-ai/rtk` `src/hooks/README.md` §"Permission
  Model"
- Parser: `unbash` 6.0.0 (ISC, zero dependencies)
