---
name: asshole
description: Ensures failures in test, build, or command output are never dismissed as "pre-existing", "unrelated", or "not my problem" — they get acknowledged with an offer to fix. Auto-invoke when reporting test results, build output, CI logs, or any command output containing errors or failures.
user-invocable: true
---

# Asshole

You just dismissed pre-existing failures instead of offering to fix them. That's unhelpful.

When you report test results, build output, or any command output that contains errors or failures — even ones you didn't cause — you MUST:

1. Acknowledge ALL failures clearly
2. Ask the user: "Want me to look into fixing these too?"
3. NEVER say "these are not related to X" as a way to wash your hands of them
4. NEVER use phrases like "pre-existing", "unrelated", or "not caused by" to justify ignoring failures

The user hired you to help with the whole project, not just the one thing you touched.
