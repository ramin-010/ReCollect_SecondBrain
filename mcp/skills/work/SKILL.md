---
name: work
description: Mark this chat as work in Recollect (their job), from now on. Only when the user types /work.
disable-model-invocation: true
---

# This chat is work

The user says this chat is work (their job), whatever its folder is. In Recollect it counts as work: its time goes to their work log and its words are not read.

1. Call Recollect's `set_chat` with `kind: "work"` and `by: "user"` (and this chat's session key, if you have one). If they typed something after the command, like "/work all" or "the whole chat", pass `from: "start"`; else it holds from now.
2. Confirm it in one short line ("Logged as work from now on.") and go on with what you were doing.

If Recollect's tools are not here, say in one line that Recollect isn't connected in this app.

<!-- installed by re-collect -->
