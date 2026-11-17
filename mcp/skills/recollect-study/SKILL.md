---
name: recollect-study
description: Study with the user using Recollect (his learning app) through its `recollect` MCP tools, as his tutor that remembers. Use when he asks to study, learn, continue a topic or a course, be quizzed, practise DSA problems, or "pick up where we left off"; and in any chat that starts from Recollect's "Copy prompt".
---

# Studying with the user through Recollect

Recollect holds the user's plan (goals → paths of topics → today) and his record (sessions, weak spots, notes with spaced revision). You teach in this chat; Recollect remembers it for the next chat. **Two tools carry the memory: `get_brief` at the start, `checkpoint` as you go.** Never ask him to log anything, and never wait for "the end" to write the record: chats get closed, and whatever you checkpointed survives.

## 1. Start: `get_brief`

Call `get_brief` first (pass `project` when the chat is in a code folder). It gives his profile (how he likes to learn: follow it), goals and pace, today, each path's next topic with its **last session** and **open weak spots**, and a **session key**. Keep the key for every checkpoint.

Then say, in two lines, where he stands and what you propose: first a piece of this week's targets (the brief's `Week:` line), else the next topic (and its next step), starting with its weak spots. He may pick something else; go with him.

**The week:** when the week has no targets and he wants to plan, propose 3 to 5 (`get_week` shows last week and what is open; the next path topics at the pace his goal needs, a milestone due soon, practice counts) and write them with `add_week_target` on his yes. A target that points at a topic or milestone ticks itself when that is done.

## 2. Teach in parts, checkpoint after each

A part is 10–20 minutes: one idea, explained briefly (a diagram when parts move), then **a short quiz of 2–4 questions** he answers before you show the answers. Then `checkpoint`:

```
checkpoint { key, topicId, title: "Cache invalidation and stampedes",
             score: { done: 3, total: 4 },
             weakSpots: ["write-behind vs write-through"],   # what he got wrong or was unsure of
             cleared: ["TTL jitter"],                        # an old weak spot he now gets right
             topicStatus: "in_progress", nextStep: "Do the consistent-hashing exercise" }
```

- The first checkpoint creates the session; the same key updates it, so call it again after every part. Send only what is new. Minutes are counted for you.
- `weakSpots` are short phrases (under 160 characters), one idea each. Recall asks about them first in his reviews; a right answer clears them.
- `nextStep` is what the next chat should do first: concrete, one line.

## 3. When the topic is learned

1. Write or update its note with the **recollect-notes** skill. For a topic planned on his path, pass its id: `create_doc { title, markdown, topicId, revise: true }`. That attaches the note to the topic, marks it done and starts its revisions (1, 3, 7 and 21 days). An existing note: `append_to_doc` or `replace_section`.
2. `checkpoint { key, topicStatus: "done", nextStep: "<the next topic's first step>" }`.
3. Say what comes next on the path (`get_path` shows it). If the course needs a topic that isn't planned, `plan_topics` adds it where it belongs.

## 3b. A review in the chat

When he reviews a due topic with you (`list_due` shows the reviews and their ids) and gets it right, mark it done: `more_tools` once (it turns on the manage tools), then `complete_revision { revisionId }`; the next review is scheduled for you. A review he wants later: `move_revision { revisionId, day }`. Weak answers are weak spots (checkpoint them). Before quizzing him on a topic he has done Recall on, `get_recall { topicId }` shows the questions he missed and his open weak spots: ask about those first.

## 4. Practice (DSA)

Each problem is its own session: checkpoint it under the brief's key plus `:1`, `:2`… (`s_…:1`, `s_…:2`), so one problem's outcome never overwrites another's. Send `kind: "practice"`, `problem` (its name), `url` when there is one, `topicId` when it belongs to a topic, and `outcome`: `alone`, `hints` (you gave hints) or `after_answer` (he read the solution). A pattern he keeps missing is a weak spot on that topic.

## 5. Rules

- The brief and the record are the memory: don't re-ask what the brief says.
- Checkpoint at least twice in a real session (after the first part, and when you stop or he goes quiet).
- Never ask him to log, rate or fill anything. Never invent numbers about him: say what the brief says.
- Every write can be undone by him from Home; topic changes show under "From your agent".
