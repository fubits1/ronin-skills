#!/usr/bin/env python3
# Independent POSIX-shell parsing oracle for the no-bash validation harness. Uses the stdlib `shlex`
# (a second, independent implementation of POSIX word-splitting) so the hook's quote/escape/segment
# handling is checked against ground truth that does NOT come from the hook author's enumeration.
#
# Reads one command per line on stdin; writes one JSON object per line on stdout:
#   {"cmd": "...", "toks": [...], "segsep": 2, "error": null}
# - toks:   the SINGLE consistent token stream from shlex's POSIX lexer with punctuation_chars, with
#           whitespace_split on. Quotes/escapes are resolved (a banned word inside quotes is glued into
#           one token, not a bare token) AND operators are emitted as their own tokens EVEN WITHOUT
#           surrounding spaces (`true|grep` -> ["true","|","grep"]). The caller derives BOTH the
#           per-segment first word and the separator count from this one stream, so the two can't
#           disagree (the old `words`/`segsep` split mixed shlex.split with the punctuation lexer and
#           was blind to space-less operators).
# - segsep: 1 + count of top-level `;` / `&&` / `||` tokens (pipe `|` and single `&` are NOT chaining
#           per the hook's policy). Bare newlines are NOT countable by shlex (treated as whitespace) —
#           the caller handles those itself.
# - error:  a shlex ValueError message (e.g. unbalanced quote) -> the caller excludes the case.
import shlex
import sys
import json


def analyze(command):
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError as e:
        return {"cmd": command, "toks": None, "segsep": None, "error": str(e)}
    segment_separator = 1 + sum(1 for t in tokens if t in (";", "&&", "||"))
    return {"cmd": command, "toks": tokens, "segsep": segment_separator, "error": None}


def main():
    for line in sys.stdin:
        line = line.rstrip("\n")
        if line == "":
            continue
        sys.stdout.write(json.dumps(analyze(line)) + "\n")


if __name__ == "__main__":
    main()
