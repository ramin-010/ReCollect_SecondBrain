---
name: personal
description: Mark this chat as personal in Recollect (their own project), from now on. Only when the user types /personal.
disable-model-invocation: true
---

# This chat is personal

The user says this chat is personal (their own project), whatever its folder is. In Recollect it counts as their own work, counted as progress.

1. Call Recollect's `set_chat` with `kind: "personal"` and `by: "user"` (and this chat's session key, if you have one). If they typed something after the command, like "/personal all" or "the whole chat", pass `from: "start"`; else it holds from now.
2. Confirm it in one short line ("Logged as personal from now on.") and go on with what you were doing.

If Recollect's tools are not here, say in one line that Recollect isn't connected in this app.

<!-- installed by re-collect -->
