---
name: dev-server
description: Dev server and background process management — when to start, mandatory cleanup, port safety. Auto-invoke when pnpm dev or any background process is involved.
user-invocable: true
---

# Dev Server

- Don't start `pnpm dev` unless explicitly told to — assume the user already runs the dev server, so starting your own collides on the port.
- Never kill the user's dev server — it's their running process and killing it disrupts their work.
- Never kill any process on a port without asking first — you can't be sure it's even yours.
- Check whether AGENTS.md specifies a port so you target the right server; if it doesn't, either ask or assume the defaults (e.g. Vite: 5173).
- If you did start a background process, kill it immediately after verification rather than deferring cleanup, so it doesn't linger and conflict with the user's processes.
- After context compaction, assume you know NOTHING about what's currently running — the record of any background process you started may not have survived compaction.
