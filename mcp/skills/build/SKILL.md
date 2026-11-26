---
name: build
description: Mark this chat as building in Kaaga (their own project), from now on. Only when the user types /build.
disable-model-invocation: true
---

# This chat is building

The user says this chat is building something of their own (their own project), whatever its folder is. In Kaaga it counts as their own, counted as progress.

1. Call Kaaga's `set_chat` with `kind: "build"` and `by: "user"` (and this chat's session key, if you have one). If they typed something after the command, like "/build all" or "the whole chat", pass `from: "start"`; else it holds from now.
2. Confirm it in one short line ("Logged as building from now on.") and go on with what you were doing.

If Kaaga's tools are not here, say in one line that Kaaga isn't connected in this app.

<!-- installed by kaaga -->
