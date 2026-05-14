#!/usr/bin/env bash
# Thin wrapper: ./scripts/release-dry.sh <semver>
# Equivalent to: ./scripts/release.sh --dry-run <semver>
exec "$(dirname "$0")/release.sh" --dry-run "$@"
