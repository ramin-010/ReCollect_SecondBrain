---
name: study
description: Mark this chat as learning in Recollect (a course, a topic, practice, their plans or career), from now on. Only when the user types /study.
disable-model-invocation: true
---

# This chat is learning

The user says this chat is learning (a course, a topic, practice, their plans or career), whatever its folder is. In Recollect it counts as their learning, counted as progress.

1. Call Recollect's `set_chat` with `kind: "study"` and `by: "user"` (and this chat's session key, if you have one). If they typed something after the command, like "/study all" or "the whole chat", pass `from: "start"`; else it holds from now.
2. Confirm it in one short line ("Logged as learning from now on.") and go on with what you were doing.

If Recollect's tools are not here, say in one line that Recollect isn't connected in this app.

<!-- installed by re-collect -->
