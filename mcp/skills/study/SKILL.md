---
name: study
description: Mark this chat as study in Recollect (learning: a course, a topic, practice), from now on. Only when the user types /study.
disable-model-invocation: true
---

# This chat is study

The user says this chat is study (learning: a course, a topic, practice), whatever its folder is. In Recollect it counts as their study, counted as progress.

1. Call Recollect's `set_chat` with `kind: "study"` and `by: "user"` (and this chat's session key, if you have one). If they typed something after the command, like "/study all" or "the whole chat", pass `from: "start"`; else it holds from now.
2. Confirm it in one short line ("Logged as study from now on.") and go on with what you were doing.

If Recollect's tools are not here, say in one line that Recollect isn't connected in this app.

<!-- installed by re-collect -->
