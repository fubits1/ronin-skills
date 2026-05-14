# Releasing

The marketplace ships as **one version**. The single `agent` plugin bumps in sync with the marketplace top-level version. One tag per release. One GitHub Release per release.

## Quick start (manual)

From a clean `main` that's up to date with `origin`:

```bash
# 1. edit .claude-plugin/marketplace.json — bump top-level `version` AND the agent plugin's `version`
# 2. validate marketplace + plugin
claude plugin validate . || exit 1
claude plugin validate plugins/agent || exit 1
# 3. commit + tag + push
git commit -am "chore(release): v0.1.0"
git tag v0.1.0
git push --follow-tags origin main
```

A `release.sh` script (mirroring the svelte-skills layout) can be added once needed.

## Versioning

Semver, pre-1.0.

- `0.MINOR.x` — breaking change in any skill rule, hook contract, or required dependency.
- `0.x.PATCH` — additive or non-breaking change.
- Promote to `1.0.0` when the marketplace is considered stable.

## Commit convention

Conventional Commits. Plugin scope is always `agent` while the marketplace has a single plugin:

```
feat(agent): new self-check skill
fix(agent): nogrep hook handles xargs wrapper
chore(release): v0.1.1
docs: clarify install order
```

## Hotfix

Fix-forward on `main`:

```bash
git commit -am "fix(agent): X"
git push origin main
# bump to next patch, validate, commit, tag, push
```

No release branches.

## Rollback

A bad release stays in users' caches for ~7 days per Claude Code's orphan policy. Fix forward: ship the next patch.

To remove an erroneous Release before any user has pulled it:

```bash
gh release delete v0.1.0 --yes --cleanup-tag   # deletes the Release AND the tag
git revert <release-commit-sha>                 # then re-release with a new patch
```
