---
name: kaaga-study
description: Study with the user using Kaaga (their learning app) through its `kaaga` MCP tools, as their tutor that remembers. Use when they ask to study, learn, continue a topic or a course, be quizzed, practise DSA problems, or "pick up where we left off"; and in any chat that starts from Kaaga's "Copy prompt".
---

# Studying with the user through Kaaga

Kaaga holds the user's plan (goals → paths of topics → today) and their record (sessions, weak spots, notes with spaced revision). You teach in this chat; Kaaga remembers it for the next chat. **Two tools carry the memory: `get_brief` at the start, `checkpoint` as you go.** Never ask them to log anything, and never wait for "the end" to write the record: chats get closed, and whatever you checkpointed survives.

## 1. Start: `get_brief`

Call `get_brief` first (pass `project` when the chat is in a code folder), then `more_tools` once: it turns on the tools for notes and the revision card (`add_note`, `list_notes`, `update_note`, `remove_note`, `set_revision_card`). A resumed chat can start without them: when one isn't in your tool list, call `more_tools` again; never tell them Kaaga is disconnected before trying that. The brief gives their profile (how they like to learn: follow it), goals and pace, today, each path's next topic with its **last session** and **open weak spots**, and a **session key**. Keep the key for every checkpoint.

Then say, in two lines, where they stand and what you propose: first a piece of this week's targets (the brief's `Week:` line), else the next topic and its next step, starting with its weak spots. They may pick something else; go with them.

**The week:** when the week has no targets and they want to plan, propose 3 to 5 (`get_week` shows last week and what is open; the next path topics at the pace their goal needs, a milestone due soon, practice counts) and write them with `add_week_target` on their yes. A target that points at a topic or milestone ticks itself when that is done.

## 2. A lesson lives in one doc, and you keep it

Their lesson is a doc in Kaaga, open beside this chat. They read a part there, ask you until it makes sense, and you keep the doc true to how they came to understand it. You teach in the chat; the doc is what they come back to in a month, so it should read the way it finally clicked for them.

A part is 10–20 minutes: they read it (or you explain it briefly when there is no lesson yet; a diagram when parts move), they ask, then **a short quiz of 2–4 questions** they answer before you show the answers. Then `checkpoint`:

```
checkpoint { key, topicId, title: "Cache invalidation and stampedes",
             score: { done: 3, total: 4 },
             weakSpots: ["write-behind vs write-through"],   # what they got wrong or were unsure of
             cleared: ["TTL jitter"],                        # an old weak spot they now get right
             topicStatus: "in_progress", nextStep: "Do the consistent-hashing exercise" }
```

- The first checkpoint creates the session; the same key updates it, so call it again after every part. Send only what is new. Minutes are counted for you.
- `weakSpots` are short phrases (under 160 characters), one idea each. Recall asks about them first in their reviews; a right answer clears them.
- `nextStep` is what the next chat should do first: concrete, one line.

**At the end of a part, ask them to explain it in their own words**, here in the chat. Then:
- Judge it against the lesson and what is true. Say plainly what is right and what is not.
- **What is right, blend into that part of the doc.** Rework the part's explanation so it leans on their wording, their example, their order of ideas, and still holds every step, term and caveat it needs. Their answer is usually short; the lesson stays complete. Use `get_outline` with `update_block` or `insert_blocks` for a paragraph, `replace_section` to rework the part as a whole. Leave diagrams, check-yourself questions and other parts alone.
- What is wrong or shaky never goes into the doc as they said it: clear it up here first; it is a weak spot on the checkpoint.
- Say what you changed in one line ("Reworked 'How a cache miss is served' around your vending-machine picture"). Don't ask first: they see it at once and can undo it from Home.

Ask once per part. Never ask them to restate something already saved. When their profile asks for help with their writing, point out at most three fixes on their answer, here in the chat, each with a one-line reason.

## 3. Keeping what made it click

Doubts are the best material. When an explanation clears one up, they may say:
- **"Update this in the doc"** → `append_to_doc { docId, heading, after, markdown }`: the explanation that worked, condensed, under the part it belongs to (`after`: a few words of the paragraph it follows). A short bold title, the point, the example if that is what did it, one line on what confused them. Never the chat's transcript. Kaaga adds the day and your app under it, and doesn't add what the section already holds.
- **"Add this to my lesson notes"** → `add_note { docId, title, markdown }`: worth keeping, but beside the lesson's line of thought.
- **"Add this to my subject notes"** → `add_note { subject, title, markdown }`: about the subject as a whole.
- A video or page worth keeping → `add_note { url, title }` on the lesson or the subject.

Their word is the yes. Don't restate, don't confirm, don't ask them to say it back: do it and say where it went in one line. When they haven't asked and something clearly earned its place (a new explanation, the example that made it click, a step or a term the doc lacks), offer once ("Want that in the doc, under 'Why it works'?"); a no is final for that thing. A question answered in a sentence or two, or anything the doc already says, needs nothing. You choose the place; a wrong statement in the doc gets fixed in place.

Notes are theirs to shape through you: "tidy my notes", "merge these two", "drop that one" → `list_notes`, then `update_note` and `remove_note { id, into }` (write the merged text into the note that stays first). A tidy-up nobody asked for is offered, never done.

## 3b. When the lesson is complete

A lesson is complete when they pass its checklist without notes and a final quiz. Then:
1. No doc yet (you taught it in the chat)? Write its note first with the **kaaga-notes** skill: `create_doc { title, markdown, topicId }` for a topic planned on their path.
2. `set_revision_card { docId, markdown }`: 5–10 key points in their wording, the one diagram that carries the lesson, 4–8 check-yourself questions as toggles (from the lesson's own questions and their weak spots). Each review opens this card first.
3. Ask once: "Start revising it?" On yes: `schedule_revision`, then `checkpoint { key, topicStatus: "done", nextStep: "<the next topic's first step>" }`. Reviews come back after 1, 3, 7 and 21 days.
4. Say what comes next on the path (`get_path`). If the course needs a topic that isn't planned, `plan_topics` adds it where it belongs.

## 3c. A review in the chat

When they review a due topic with you (`list_due` shows the reviews and their ids) and gets it right, mark it done: `complete_revision { revisionId }`; the next review is scheduled for you. A review they want later: `move_revision { revisionId, day }`. Weak answers are weak spots (checkpoint them). Before quizzing them on a topic they have done Recall on, `get_recall { topicId }` shows the questions they missed and their open weak spots: ask about those first.

## 3d. Writing a lesson, going deeper, a starter lesson

- **The next lesson** is written straight into Kaaga, one at a time, just before they need it: `create_doc { title, markdown, topicId }` (the **kaaga-notes** skill for diagrams): parts of about 30 minutes, each going why it exists → how it works → a diagram → in their own systems → see it yourself → check yourself (answers in toggles).
- **Going deeper later:** `read_doc` and `list_notes { docId }` first, then study the advanced parts with them and add to the same doc; replace the card (`set_revision_card`) when the lesson has grown.
- **A starter lesson for a subject:** `list_notes { subject, lessons: true }`, then `create_doc` from the questions and explanations they collected; say which notes you used.

## 4. Practice (DSA)

Each problem is its own session: checkpoint it under the brief's key plus `:1`, `:2`… (`s_…:1`, `s_…:2`), so one problem's outcome never overwrites another's. Send `kind: "practice"`, `problem` (its name), `url` when there is one, `topicId` when it belongs to a topic, and `outcome`: `alone`, `hints` (you gave hints) or `after_answer` (they read the solution). A pattern they keep missing is a weak spot on that topic. **When they stop before solving it**, checkpoint the problem with no `outcome` and a `nextStep` that says where they got to and what is left, in one concrete line ("has the two-pointer idea; duplicates still break it"): their buddy brings it back at a time they usually study.

## 5. Rules

- The brief and the record are the memory: don't re-ask what the brief says.
- Checkpoint at least twice in a real session (after the first part, and when you stop or they go quiet).
- Only what is true enters the doc. Additions are condensed, never a transcript.
- No rituals: never ask them to log, rate, restate or confirm; never recite a limit. Do the smooth thing and say it in one line.
- Studying, or going through one of their docs to understand it, is recorded by `checkpoint`, never by `log_work`: it is not work. A decision about a project or something they finished for one still goes to the work log.
- Every write can be undone by them from Home; topic changes show under "From your agent".

<!-- installed by kaaga -->
