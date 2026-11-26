# kaaga-setup: Kaaga for your AI coding tools

Kaaga keeps what you learn and what you work on: notes with real diagrams, study paths and spaced revision, goals, a work log, and a buddy that remembers what you tell it across chats. This package connects your AI coding tools to it: the Kaaga MCP server (the tools an agent calls), Claude Code's hooks (chats log their own time), and the skills.

## Set up (one command)

Needs Node.js 22 or newer and an account on [kaaga.in](https://kaaga.in).

```sh
npx kaaga-setup
```

1. It shows a code and opens kaaga.in: check that the page shows the same code and press **Approve** (no token to copy).
2. It installs the app in `~/.kaaga/app` and adds Kaaga to every AI tool it finds on this computer:
   - **Claude Code:** the tools (user scope), four hooks (each chat logs its own time; your words reach your buddy where the folder allows it), and the skills `/log-work`, `/kaaga-study`, `/kaaga-notes`, `/study`, `/build`, `/work`.
   - **Antigravity:** the tools and the skills. It has no hooks for this, so its chats log themselves through the tools (`checkpoint`).
   - **Cursor:** the tools; its chats log themselves through the tools.
3. Start a new chat. The first chat in a new folder asks you once what the folder is: for **building** something of your own, for **learning**, or for your **work** (work time is logged for your work log, its words aren't read, and it doesn't count as progress), or to ignore it. Change any folder later in Kaaga › Settings › Tracking, where you also pick what is logged (everything, the time only, nothing) and what new folders do.
4. A chat can differ from its folder: type `/study`, `/build` or `/work` (or just say so), and the agent may mark one itself, saying so in one line. A change in the middle of a chat splits its time there.

```sh
npx kaaga-setup status    # what is set up, who it is signed in as
npx kaaga-setup@latest update    # the newest version, set up again (@latest: npx may keep an older copy)
npx kaaga-setup remove    # take it all out (the sign-in ends itself)
```

Options: `--url <server>` (default `https://api.kaaga.in`), `--login` (sign in again), `--tools claude,antigravity,cursor`, `--no-open` (print the link only). Every file it changes gets a backup beside it first, and only Kaaga's own entries are touched. The token lives in `~/.kaaga/config.json` only.

**Set up with `recollect-setup` before?** `npx kaaga-setup` moves it over in one run, and nothing changes until the new app is in place: the sign-in and everything in `~/.recollect` (folder rules, open chats, the day's clock) go to `~/.kaaga`; the `recollect` MCP server, its hooks and the skills `/recollect-study` and `/recollect-notes` give way to Kaaga's, each only when the older setup made it; and the old address becomes `https://api.kaaga.in` once that answers (the old one works until 22 Jan 2027). Until it runs, the new app still finds `~/.recollect`.

## Set up by hand (developers)

1. Build (Node 22 or newer):

   ```sh
   cd mcp
   npm install
   npm run build
   ```

2. Make a token in Kaaga: **Settings → Agents**. Give it the scopes the tools need (below); all of them for full use. The token (`rcl_…`) is shown once.

3. Add the server to Claude Code:

   ```sh
   claude mcp add kaaga -s user -e KAAGA_URL=http://localhost:8002 -e KAAGA_TOKEN=rcl_… -- node /path/to/mcp/dist/index.js
   ```

   Check it with `claude mcp list`, or `/mcp` inside Claude Code. In Windows PowerShell, type `claude.cmd` instead of `claude` (here and for `npm`, `npm.cmd`): the `.ps1` shims drop the `--`, and the command then fails. Without `KAAGA_TOKEN` the server reads `~/.kaaga/config.json` (what `npx kaaga-setup` writes).

| Variable | Default | |
|---|---|---|
| `KAAGA_TOKEN` | `~/.kaaga/config.json` | The `rcl_…` token. Without it (and no setup) the server still starts, and every tool says how to fix it. |
| `KAAGA_URL` | `http://localhost:8002` | The API origin. A trailing `/` or `/api` is fine. |
| `KAAGA_AGENT_NAME` (or `KAAGA_AGENT`) | `Claude Code` | Sent as `X-Agent-Name`; Home shows it on "From your agent". Give each connection its own, e.g. `KAAGA_AGENT=study-chat`. |
| `KAAGA_TIMEOUT_MS` | `30000` | Per request. |
| `KAAGA_FOLDERS` | on | `off`: assume no folder (a tool that doesn't start its servers in the project folder: Antigravity, Cursor). |
| `KAAGA_DEBUG` | off | `1`: one stderr line per API call (method, path, status, time). |

Each variable is still read by its older `RECOLLECT_*` name when the `KAAGA_*` one isn't set.

### Over HTTP (remote MCP, stage 6)
The backend serves the same catalogue at `POST <api origin>/mcp` (MCP Streamable HTTP, stateless): `claude mcp add --transport http kaaga http://localhost:8002/mcp --header "Authorization: Bearer rcl_…"`. The token's scopes and the edit log apply as for the stdio server; it lists the `web` set and reaches every other tool through `find_tools`, `use_read_tool` and `use_tool` (each request is a fresh server, so nothing is turned on). Without a token it answers 401 pointing at `/.well-known/oauth-protected-resource/mcp`, and **an app can sign in instead of using a pasted token** (OAuth 2.1, 2026-11-15): `claude mcp add --transport http kaaga http://localhost:8002/mcp` with no header opens Kaaga's consent page in the browser ("Allow Claude Code to use Kaaga?"), and claude.ai's custom connector does the same once the API has a public HTTPS address. The connection shows in Settings → Agents ("Signed in from the app"); its token lasts an hour and renews itself; Revoke ends it. Details: ALWAYS_ON_SPEC 6.5.

### claude.ai and ChatGPT (no hooks)
A chat with no hooks (claude.ai or ChatGPT, on the web or the phone) is heard only through its tool calls. Set it up once:
1. Add the connector (claude.ai: Settings → Connectors; ChatGPT: its apps and connectors settings), sign in, then set its tools to **Always allow**, so a save never waits for a tap.
2. Nothing else is required: the connector's instructions and the small brief `get_brief` returns tell the assistant to pass on what you say about your own life (`remember` for something new, `update_memory` for progress, a change or an end on something your buddy knows) and to leave the rest of the chat out.
3. The **`catch_up`** prompt (where the app shows prompts) passes on, at the end of a chat, what you said about yourself (at most 3 things, never work details) and logs the session.

Every save is kept at once with when it was said, the app and whether you said it or the assistant inferred it; an inference never changes anything. Your own words heard by Kaaga (its chat, Claude Code's hooks) and what you said through an assistant weigh the same: the newest by the time said wins.

## Scopes

| Scope | Lets the agent |
|---|---|
| `read` | Every read tool, and the lookups the write tools make first (subjects, a doc's topic). |
| `docs:write` | `create_doc`, `update_doc`, `append_to_doc`, `replace_section`, `add_canvas`, `update_canvas`, `trash_doc`, `restore_doc`, `move_doc`, `insert_blocks`, `update_block`, `move_blocks`, `delete_blocks`. |
| `sessions:write` | `checkpoint`, `update_project`, `remember`, `update_memory`, `forget` (a Claude Code hook's token needs only this and `read`). |
| `tasks:write` | `add_task`, `update_task` (personal tasks only). Tokens that had `learning:write` got it with the migration. |
| `learning:write` | `complete_revision`, `move_revision`, `update_settings`, `empty_trash`, `publish_doc`, `share_doc` (these three ask), `create_subject`, `schedule_revision`, `create_goal`, `update_goal`, `add_milestone`, `complete_milestone`, `update_milestone`, `remove_milestone`, `add_focus`, `update_focus`, `remove_focus`, `plan_topics`, `update_topic`, `add_pocket_note`, `add_week_target`, `update_week_target`, `suggest_to_user`, `log_decision`, and `create_subject_if_missing` on `create_doc`. |

A call without the scope it needs fails with the scope named, e.g. `The Kaaga token lacks the "docs:write" scope this tool needs. Make a token with "docs:write" in Settings → Agents.` A revoked or unknown token: `The Kaaga token is invalid or revoked: make a new one in Settings → Agents…`

## Tools

94 tools (some rows below hold two or more), plus the `study`, `build`, `work`, `catch_up` and `note_recipe` prompts (and, on the web, `log_my_work`) and the skills (`npm run install:skill`, or `npx kaaga-setup`).

**A tool set per door** (MCP_MEMORY_PLAN §4.1, `createKaagaServer({ set })`):
**Finding the rest** (TOOL_ACCESS_PLAN §3-§5): every tool has a card (`src/cards.ts`: when to use it, what it is not for, its inputs, an example, what it answers, the words people say); `find_tools` searches them by the job in plain words (deterministic word matching, no network) and answers the cards, plus the steps of a job with steps: `study_session`, `quiz_me`, `write_lesson`, `plan_week`, `plan_course`, `log_day`, `start_day`, `tidy_docs` (`src/playbooks.ts`; also MCP prompts on the web and code doors). The web's instructions open with three rules in 512 characters (ChatGPT reads only those as standing alone). Inputs that don't fit answer what to fix with the tool's inputs and an example; the tools list leaves out annotation hints MCP assumes anyway.

**Listed and reachable are two things** (TOOL_ACCESS_PLAN §2, `doorPolicy` in `src/server.ts`): every door can run every tool its policy allows, by its own name or through a runner, and lists a short set.
- **`code`, Claude Code (stdio):** the groups **core, docs, plan and record** are listed from the start (at most 42,000 characters), with `find_tools` and `use_tool`; every tool runs by its name, and `find_tools` adds what it finds to the chat's list (the client is told the list changed). `KAAGA_TOOLS=all` (or a list such as `core,docs,manage`) lists more from the start.
- **`web`, claude.ai and ChatGPT (the remote `/mcp`):** 32 tools listed (`WEB_TOOLS`: the buddy, tasks and reminders, the lock screen, quick capture, the plan to read, studying, docs, the work log) and the three runners, at most 24,000 characters; every other tool but `set_folder` is reached with `find_tools` (the tools for a job, each with its inputs and an example) and run with `use_read_tool` (it only reads) or `use_tool`. Each request is a fresh server, so nothing has to be turned on. Connect the connector and set its tools to "Always allow"; nothing else is needed.
- **`office`, a work folder (`brief: false`):** the seven saving tools, `set_folder` and `set_chat`; answers carry no "Related" or "In motion".
- **`excluded`, a folder whose rule is `off`:** no tools.
- **`all`, Ask AI inside the app:** every tool but `set_folder` and `set_chat` (it runs in no folder).

A tool a door can't reach answers one line saying so (with the closest names and `find_tools`), never "disabled"; inputs that don't fit answer what to fix, with the tool's inputs and an example. Each tool has a level (MANAGER_AND_DOCS_PLAN §3.2, `TOOL_LEVELS` in `src/server.ts`): 1 reads, 2 changes at once with an Undo, 3 only asks, and the user's tap on Home does it:

| Tool | What it does | API |
|---|---|---|
| `get_brief` | Where the user stands, in one call: their profile (Settings → Agents), goals and pace, today, each path's next topic with its last session and open weak spots, recent sessions, Recall's weak topics, a project's next step (`project`), what the buddy follows, and a session key. It only reads (its `about` went; the API still takes it from older builds) | `GET /api/brief` |
| `checkpoint` | Write this chat's session under its key, again and again (the same key updates the same session): title, kind, topic, score, outcome, weak spots found or cleared, the topic's status, the next step; minutes are counted from the key. What the user says about their life goes to `remember` or `update_memory` (`learned` and `said` went; the API still takes them from older builds) | `PUT /api/sessions/by-key/:key` |
| **manage:** `list_sessions` | Sessions day by day with minutes per kind | `GET /api/sessions` |
| `get_week` | The week (Monday to Sunday): its targets, what is done (worked out: a target ticks itself when its topic, milestone or task is done, or its count is reached), last week in numbers, whether the weekly review waits | `GET /api/week` |
| `add_week_target`, `update_week_target` | Add a target (at most 5 a week; a link to a topic, milestone or task, or a count: practice, minutes or topics finished, in a subject or project); change its text, tick it, drop it | `POST /api/week/targets`, `PATCH /api/week/targets/:id` |
| `suggest_to_user` | Propose a week target, a focus line or a profile change: it waits on Home under Suggested until the user accepts or dismisses it (agents can't accept) | `POST /api/suggestions` |
| **manage:** `get_standing` | Where the user stands, worked out by the app: per goal each path's pace against the deadline (and the smallest fix) and hours per week; per subject quiz scores, weak spots, practice outcomes, minutes per topic | `GET /api/mirror` |
| `list_tasks`, `add_task`, `update_task` | The user's personal tasks (never workspace tasks, no delete): list by due window (today, week, overdue, all), add one with a due day and priority, change or tick one | `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id` |
| `log_decision`, **manage:** `list_decisions` | The decision journal: what was decided, why, what they expect, a day to look again (a day or 30d / 6w / 3m; Home asks "Was this right?" then); list open, reviewed or one project's | `POST /api/decisions`, `GET /api/decisions` |
| `get_today` | Today's plan (due revisions with doc ids), focus lines, the next topic of up to 3 paths (goal-linked first), active goals with deadline, days left, progress, forecast and next milestone | `GET /api/today` |
| **manage:** `get_learning_overview` | Per subject: topics due / waiting / mastered / unscheduled, plus the daily budget. With `subject`: that subject's topics with next review dates | `GET /api/subjects`, `/api/topics/statuses`, `/api/learning/settings` |
| `search_docs` | Docs by words in title or text on Postgres full-text (each word as a stem or a word's start; best match first), or the most recent; id, subject, date and snippet | `GET /api/agent/docs` |
| `read_doc` | A doc as Markdown, after a one-line header | `GET /api/agent/docs/:id` |
| `create_doc` | A new doc from Markdown; optional `subject` (by name), `topicId` (the doc becomes that planned topic's note: in progress, or done with `revise`), `revise`, `create_subject_if_missing`. `guide: true` alone answers the whole Markdown and diagram guide and creates nothing | `POST /api/agent/docs` |
| `update_doc` | Rename a doc (live), file it under a subject, or make it a planned topic's note; undoable | `PATCH /api/agent/docs/:id` |
| `append_to_doc` | Markdown at the end of a doc, live; **with `heading` (stage 14) a note inside that section**, after the paragraph whose words `after` quotes, else at the section's end, on the user's yes: the server adds the day and the app under it and refuses a note the section already holds (no cap on how many a day since STUDY_FLOW_PLAN; at most 6,000 characters a note). `read_doc`'s answer for a doc they can edit ends with the rule for offering one | `POST /api/agent/docs/:id/append` |
| `replace_section` | Rewrite the section under a heading; an unknown heading lists the doc's headings | `POST /api/agent/docs/:id/replace-section` |
| `add_canvas` | A diagram of boxes and arrows (a system-design sketch, a flow) at the end of a doc: `diagram` (Mermaid flowchart text, which the API lays out), `height` (optional); answers with a line per canvas (size, zoom in a doc, problems to fix) | `POST /api/agent/docs/:id/append` (a ` ```canvas ` fence) |
| `update_canvas` | Change one board in place by its id (`%% id: cv_…` in read_doc): `diagram` (the whole edited text) or `add` / `remove` / `rename`; boxes the user placed keep their places, new ones are laid out beside what they connect to; undoable | `POST /api/agent/docs/:id/canvas/:canvasId` |
| `preview_diagram` | A PNG of a doc's board as laid out (the first canvas when no `canvasId`), with its report; `theme` light or dark. Mermaid blocks are not drawn on the server | `GET /api/agent/docs/:id/preview` |
| `list_subjects` | Subjects with topic counts and ids | `GET /api/subjects` |
| `create_subject` | A new subject (an existing name is returned, not duplicated) | `POST /api/subjects` |
| `get_path` / `plan_topics` / `update_topic` | A subject's path: its topics in order (✓ done, ▶ in progress, ○ planned, – skipped) and what comes next; plan topics (a whole course, or one after another), move a topic along (status, next step, place); writes undoable | `GET` / `POST /api/subjects/:id/path`, `PATCH /api/topics/:id/path` |
| `schedule_revision` | Put a doc on the 1 / 3 / 7 / 21-day schedule (files it under `subject` first if needed) | `GET /api/topics/by-doc/:docId`, then `POST /api/topics` or `POST /api/revisions/start` |
| `list_due` | Every due or overdue revision: today's plan first, then the ones waiting | `GET /api/today` |
| `list_goals` | Goals with deadline, progress, forecast, why, subjects and milestones (with ids) | `GET /api/goals` |
| `create_goal` | A goal with a deadline, optional why, subjects (names) and dated milestones | `POST /api/goals` |
| **manage:** `update_goal` | Change title, why, deadline, status or subjects (manage group since 2026-11-16, to make room for `remember`) | `PATCH /api/goals/:id` |
| **manage:** `add_milestone` | Add a milestone to a goal | `POST /api/goals/:id/milestones` |
| **manage:** `complete_milestone` | Mark a milestone done | `PATCH /api/goal-milestones/:id` |
| **manage:** `update_milestone` / `remove_milestone` | Change a milestone (title, due day, `done: false` reopens it) or remove it; both undoable | `PATCH` / `DELETE /api/goal-milestones/:id` |
| `add_focus` | A focus line for today (≤ 140 characters, up to 3 a day) | `POST /api/focus` |
| **manage:** `update_focus` / `remove_focus` | Change a focus line (text, done) or remove it; both undoable | `PATCH` / `DELETE /api/focus/:id` |
| `add_pocket_note` | A pocket (quick) note, optionally pinned. Agents can add them, never read them | `PUT /api/quick-notes/:newUuid` |
| **manage:** `recent_agent_edits` | What agents wrote lately, and whether the user kept or undid it | `GET /api/agent/edits` |
| `remember` | Their buddy's memory (what Kaaga learns about them across chats): one new thing they said about their own life (text, a kind: fact, preference, value, aim, idea, decision, pattern, state, thread, win; `said_on` when it was said earlier; `inferred` when the assistant concludes it; private for health, money, people, fears…). Code keeps it true: a repeat is "seen again", one marked wrong (or close to it) is not saved, a closed one comes back only when they say it on a later day, an inference is a working memory marked inferred; nothing is kept while the buddy is paused; every text passes a secret scrub. The answer lists what is related (with a hint when it looks like an old version) and what is in motion. Not an edit-log row: /you shows each memory with the app that saved it | `POST /api/buddy/remember` |
| `update_memory` | Progress on, a change to or the end of something known, by its id (`on`: a memory, or a thread): `update` progress, done, skipped, changed, paused, resumed, dropped, finished or said. Progress strengthens the one memory; a said change replaces the old version (kept as history, Undo); an older statement arriving late joins the history; two versions of one day in an unknown order are never guessed (the current one stays, marked check); an inference only adds a note | `POST /api/buddy/update` |
| `recall_memory` | Search what their buddy knows (words or word starts), or list it by kind and status; each line says when it was said, the app it came from, and what replaced it; private ones are marked; a query also finds what is going on (threads) and their months (the buddy's chapters) | `GET /api/buddy/memories`, `GET /api/buddy/threads`, `GET /api/buddy/chapters` |
| **manage:** `get_work_log` | Their work as one picture (stage 12): per project and day, each thing once at its newest (an open problem later fixed says so; a changed decision shows the newest), from every chat and app, with each line's app and id; `view` done, decided (with the decision it changed) or open; search words or pick days; in a work folder, that project only; a work folder's lines reach connected chats only while the person shares them. Listed on the web | `GET /api/buddy/work` |
| `log_work` | Claude Code: the day's work on their word ("log today's work", `/log-work`; B10): without lines it answers the day's turn times in this folder from the hooks' clock and what other chats already logged (ids); with 3–6 lines (did, decided, stuck, next, each with its time span, `on` the id of a line it is news on) it writes them; a second call in the same chat rewrites its lines and keeps their ids. **On the web (stage 12):** one outcome a call (stage 13: up to two more results of the same message in `more`), unasked (a result they confirm, a decision, a problem left open: `kind` did, decided, open), `on` for news on a line it was shown; written at once unless that day already has it or they removed it; the answer shows what is open and the day's other lines, a close one first. No model call on our side | `POST /api/buddy/work`, `POST /api/buddy/work/line`, `GET /api/buddy/work/picture` |
| **manage:** `update_work_line` | Stage 12: an app changes only a line it logged: `same_as` folds it into a line that says the same (listed once, kept), `text` rewords it today, `on` makes it news on a known line, `remove` takes it out when the user asks. Listed on the web | `PATCH /api/buddy/work/line/:id` |
| `forget` | Close a memory that was a misunderstanding, undoable (a change goes to `update_memory`); memories the user wrote or changed are theirs (403) | `POST /api/buddy/memories/:id/close` |
| `find_tools` | TOOL_ACCESS_PLAN §3: the tools for a job in plain words ("delete a doc"), each as a card (when to use it, what it is not for, its inputs, an example, what it answers), and the steps of a job with steps; no query: the catalogue by area. On the code door it adds what it found to the chat's list | none |
| `use_read_tool`, `use_tool` | Run a tool by name with its inputs (`args`, an object or a JSON string), through the same checks as a direct call; `use_read_tool` runs only tools that read (read-only, so ChatGPT asks no approval) | none |
| `set_folder` | The user's answer to what a folder is (a new folder asks once): build (their own project; `personal` still works), study, work, or ignore it (nothing logged); it holds for every chat and PC, and this PC's hooks follow it at once | `PUT /api/projects/by-key/:key` |
| `set_chat` | What this chat is when it isn't what its folder says: `by` "user" (their words, `/study`) or "agent" (its judgement, said in one line); `from` "start" or now. With the hooks the chat's time splits there; without them its next checkpoint carries it. Their own word outweighs the agent's, and the app's switch outweighs both. In a work folder their own word that the chat is theirs turns on the full tool set (and the full brief); `work` on their word turns it back | `PATCH /api/sessions/by-key/:key/kind` (or the hook's split) |
| **manage:** `set_revision_card` | STUDY_FLOW_PLAN: when a lesson is complete, its revision card (key points, the one diagram, check-yourself toggles) as the doc's last section under its own heading; called again it replaces the card's content (the heading, its name and place stay). Each review on Home opens the card first ("Done" opens the doc). It never starts reviews: the chat asks, then `schedule_revision`. Undoable | `PUT /api/agent/docs/:id/card` |
| **manage:** `add_note`, `list_notes`, `update_note`, `remove_note` | STUDY_FLOW_PLAN: the notes and links on a lesson (`docId`) or a subject (`subject`): the app's own notes (Ctrl K's Note and Link), shown in the doc's right sidebar and on the subject's page. Add one (a repeat in the same place is not added twice), read a lesson's, a subject's (`lessons: true` adds its lessons'), or some by id with their full text, change or move one, remove one (`into`: the note it was merged into). Their own notes included; a note attached to nothing (Home's Inbox) is never read or changed by an agent. Each write undoable | `POST` / `GET /api/agent/notes`, `PATCH /api/agent/notes/:id`, `POST /api/agent/notes/:id/remove` |
| **manage:** `attach_file`, `remove_file`, `read_note_file` | TOOL_ACCESS_PLAN §11: files on a note (one on a lesson or a subject): any file but a video, at most 10 MB, 20 a note. A coding tool attaches a file from the user's computer by `path` (this process reads it and posts it as multipart); a web chat sends the file's `text` or `base64` (at most 1 MB) with its `name`. `read_note_file` answers a text file's text (60,000 characters at most) or another file's link; `list_notes` shows each note's files with their numbers. Each attach and removal undoable | `POST /api/agent/notes/:id/files`, `POST /api/agent/notes/:id/files/remove`, `GET /api/agent/notes/:id/files/:n` |
| **manage:** `list_pocket_notes`, `update_pocket_note`, `delete_pocket_note` | TOOL_ACCESS_PLAN §4.7: their pocket (quick private notes on Home), read (pinned first, each cut at 300 characters; one in full by id), changed (text, pin) and deleted, each undoable, **only while they allow chats at their pocket** (Settings › Agents, off by default; until then each answers that the pocket is private and changes nothing; an agent can't turn it on) | `GET /api/agent/pocket`, `PATCH /api/agent/pocket/:id`, `POST /api/agent/pocket/:id/delete` |
| **manage:** `update_subject`, `delete_subject` | A subject renamed or described (a name they have is refused), undoable; deleted at once when it holds nothing (Undo brings it back), else only asked: a card on Home, and their tap deletes it with everything in it (the app keeps it a week to bring back) | `PATCH /api/agent/subjects/:id`, `POST /api/agent/subjects/:id/delete` |
| **manage:** `trash_doc`, `restore_doc` | Move a doc of theirs to the trash (30 days, then gone) or take it out, with the pages inside it (a page restored while the doc it was in is still in the trash comes back at the top level); both undoable | `POST /api/agent/docs/:id/trash`, `…/restore` |
| **manage:** `get_doc_tree`, `move_doc` | DOC_PAGES_PLAN: docs inside docs ("pages", to any depth). The pages inside a doc as an indented tree (id, title, size, last update, lessons marked), with every page's Markdown on request (60,000 characters at most; the rest named), or the top-level docs; and moving a doc inside another (`parentId`, or `"top"`), or to a new place among its sibling pages (`after`: a sibling's id or `"start"`); everything inside it moves with it, a lesson can't go inside another lesson, undoable. `create_doc` takes `parentId`; `read_doc` and `search_docs` say where a doc sits | `GET /api/agent/docs/tree`, `PATCH /api/agent/docs/:id` |
| **manage:** `empty_trash` (level 3) | Ask to delete the trash for good: a card under Suggested on Home with "Do it"; nothing happens until they tap it | `POST /api/actions` (`empty_trash`) |
| **manage:** `complete_revision`, `move_revision` | Mark a due review done (when they just reviewed it with you) or move a pending one to another day; both undoable | `POST /api/revisions/:id/complete`, `…/reschedule` |
| **manage:** `get_settings`, `update_settings` | Their daily budget, busy-until day, the morning email and the profile agents read; agents can't change the time zone or the old routine | `GET` / `PATCH /api/learning/settings` |
| **manage:** `update_project` | A coding project's name, next step, goal, archive or kind (by key or name); undoable | `GET /api/projects`, `PATCH /api/projects/:id` |
| **manage:** `list_suggestions` | What waits under Suggested on their Home, actions that need their tap marked | `GET /api/suggestions` |
| `set_reminder`, **manage:** `list_reminders`, `cancel_reminder` | A reminder on a task, or with a title that makes the task: silent (it shows on their phone's home screen, no sound, no email) unless they ask for an alarm or a ring (`ring: true`: the phone app rings at the time; an email only for one no phone holds); `repeat` daily, on weekdays or weekly until cancelled (cancelling ends the series); list the ones to come; cancel one (the task stays). Set and cancel are undoable | `POST /api/reminders`, `GET /api/reminders`, `POST /api/reminders/:id/cancel` |
| **manage:** `show_on_lock_screen`, `clear_lock_line` | Their own words on their phone's lock screen for a window ("until 6", weekdays, a last day; today only by default): in it they are the lock line, over the buddy's words; clear the one showing, one by id, or all | `POST /api/lock-pins`, `POST /api/lock-pins/clear` |
| **manage:** `get_quiz_results` | A topic's last Recall sessions: grades, the questions they missed with the grader's words, open weak spots (by topic or doc) | `GET /api/topics/:id/recall` |
| **manage:** `get_sharing` | Who can see a doc of theirs: published to the web or not (its read-only link), the people added with their roles, who asks to edit | `GET /api/agent/docs/:id/sharing` |
| **manage:** `publish_doc`, `share_doc` (level 3) | Ask to publish or unpublish a doc (a read-only link, stable until switched off), or to give someone with an account "can view" / "can edit" (or take it away): a card under Suggested on Home with "Do it"; nothing happens until they tap it | `POST /api/actions` (`publish_doc`, `share_doc`) |
| **manage:** `spread_backlog` | Spread every overdue review over the next days by their daily budget, undoable; more than 20 at once only asks ("Do it" on Home) | `POST /api/revisions/spread` |
| `get_outline` | A doc's blocks, one line each (id · kind · first words, children indented): the ids the block tools take. Every doc is on the new editor since the switch (2026-11-15); a doc with old content and no blocks would answer 409 | `GET /api/agent/docs/:id/outline` |
| `insert_blocks`, `update_block`, `delete_blocks`; **manage:** `move_blocks` | Change the new editor's blocks by id, live: insert Markdown after / before / under a block or at the start or end; change one block (one block of Markdown, or props: a heading's level, a to-do's tick, a callout's kind; its children stay); move blocks with their children; delete them. Each is one change the user can undo (`doc_blocks`) | `POST /api/agent/docs/:id/blocks`, `PATCH …/blocks/:blockId`, `POST …/blocks/move`, `POST …/blocks/delete` |

There are no tools that delete for good: a doc goes to the trash, and emptying it waits for the user's tap. Every write is logged; the user can undo it from **Home → From your agent**, and every write answer ends with that line. Agents can't undo or "keep" their own edits (those endpoints are cookie-only).

### The Markdown agents can write

GitHub Markdown, with headings `#` to `######` (a toggle heading folds its section: `<details><summary>## Title</summary>…</details>`); callouts `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`; toggles `<details><summary>Q</summary>\n\nA\n\n</details>` (good for self-test questions); fenced code with a language; ` ```mermaid ` fences render as diagrams (sequence, ER, state, class, timeline, mind map); ` ```canvas ` fences hold a board the user can rearrange, written as Mermaid flowchart text (`flowchart LR`, `a[Box] -->|label| b[(Database)]`, `subgraph id [Title] … end` zones, `:::blue` colours, `id@{ kind: cache }` icons, `note for box: text`), which the API lays out with ELK (a fence that starts with `{` is still the old JSON board); task lists `- [ ]`; `==highlight==`. GFM tables become real tables. The full guide is in `create_doc`'s description, so the agent sees it.

`read_doc` prints a canvas in that text form, its id first (`%% id: cv_…`); positions are not printed. A fence without that id makes a new board. To change a board in place, keeping what the user arranged, use `update_canvas`, or send the fence back with its `%% id` line through `replace_section`; `relayout: true` lays the whole board out again. Undo brings the old board back. Every write that makes a canvas answers with a line per canvas: boxes, arrows, zones, the laid-out size, the zoom it shows at in a doc, and lint (arrows that cross, an arrow through a box, a box with no arrows, too wide). The parser and layout: `backend/src/services/docs/diagram/`.

## Claude Code hooks (coding sessions log themselves)

`npx kaaga-setup` adds four hooks to `~/.claude/settings.json` (a backup is saved beside it first); the url and token are in `~/.kaaga/config.json`. By hand: `npm run install:hooks` (after `npm run build`) writes `~/.kaaga/hooks.json` (`url`, `token`, `allow`, `brief`) instead; make that token in Settings → Agents with **read** and **sessions:write**. `npm run install:hooks -- --remove` takes the hooks out again.

- **Folder rules (EASY_SETUP_PLAN, 11-23):** without an `allow` list the rules are the server's: what each folder is and what is logged there (Settings › Tracking), read at each session's start and kept 10 minutes in `~/.kaaga/rules.json` (a prompt never waits for the network). A folder is known by its project folder: the outermost git repo it is in, below the home folder, else its own name; a project nobody decided on its own, inside a folder decided as work, is part of that work folder (`D:/erp-workspace/beta/app` → `erp-workspace` when `erp-workspace` is no repo itself; a personal or study folder doesn't take in what is inside it). A folder the server has never seen follows the account's default; by default it asks once: the start hook tells the agent to ask, `set_folder` saves the answer, and until then nothing is read and the session waits on the PC (14 days at most). An `allow` list in `hooks.json` is an override for that PC: a folder it doesn't name is not heard, and for one the server knows, the stricter of the two decides what is read.
- **What a chat is:** `set_chat`, or a typed `/study`, `/build`, `/work` (`all` after it: from the chat's start), adds a line to `~/.kaaga/open/<session>.kind.jsonl`. The session's time splits where it changed (`cc_<session>`, then `cc_<session>:k1`, …), each part sent with what it is and who said so. Their own word that a chat in a work folder is theirs reads its words from then on; an agent's guess never reads more, and a chat marked work reads no words.

- **SessionStart:** in a folder the hooks act in, prints the brief into the session (with the key `cc_<session>` and the project), and opens the session in `~/.kaaga/open/`. The header asks the model to `checkpoint` once with that key, the project, a title and the `nextStep` when it finishes a piece of work, so the project's next step stays current (a real run did it unasked).
- **UserPromptSubmit, Stop:** one timestamp each, no network: active minutes are the gaps between them, none over 5 minutes. The first real prompt (first line, not a slash command or a one-word reply) is kept as the session's title.
- **SessionEnd:** logs a `build` session: the project is the first folder under the allowed root, or the outermost repo (`app/backend` → `app`), active minutes, the branch and the subjects of commits made during it (that folder's repo and the repos directly inside it). Its title: the first commit, else the session's own title or first prompt; a chat's title is never replaced. Under 2 active minutes or fewer than 2 prompts: nothing is logged.
- A window closed without SessionEnd is logged by the next session start (the sweep: last activity over 30 minutes ago). A swept window used again logs the rest as a session of its own (`cc_<id>:r<time>`), as does a session that began before the hooks were installed.
- Never blocks Claude Code: 3 s per call, failures go to `~/.kaaga/hook.log`. Other folders, subagents and `KAAGA_HOOKS=off` do nothing. The transcript is never read. A study chat in an allowed folder checkpoints under the same key, so there is one entry, not two.
- **The day's clock (B10):** in every folder the hooks act in, each prompt and each reply's end is stamped in `~/.kaaga/times/<project>/<day>.jsonl` (the prompt's first 60 characters with it). It stays on the PC; `log_work` reads it for the turn times, and files older than two weeks are deleted.
- **Folder kinds (PERSONAL_OFFICE_PLAN, 11-23):** an entry may say what the folder is, `{ path, kind: "personal" | "study" | "work" }`. The kind gives the defaults (personal and study: `full`, briefed; work: `light`, no brief, the nudge, no commit subjects); the knobs below still override, and `brief: false` without a kind still means work. The session tells the server the kind as a first guess for a folder it has never seen; after that the app's choice (Settings › Tracking) wins on every PC: a folder the server knows as work gets the work brief and its words and lines are office work whatever the PC says. Work time counts as progress only when the person says so. `npm run install:hooks -- --token rcl_… --personal "~/projects/" --work "~/job/"` writes such entries (repeatable; `--study` too); a folder none of them names is not heard.
- **Folder entries** in `allow` are `{ path, mode, brief, nudge, commits }`: `mode` `full` (their typed words are read for their buddy), `light` (hours only: nothing leaves the PC until the session closes) or `off`; `brief: false` (a work folder) never shows their brief and titles its sessions by the project, never their words; `nudge: true` adds to each prompt a one-line reminder, with the time, to save quietly what they would want later, and once a day to offer to log the work (after 17:30 with an hour of work, or the next morning); `commits: false` sends no branch or commit subjects. A work folder's MCP lists only `get_brief`, `remember`, `add_task`, `set_reminder`, `add_pocket_note`, `log_work`, `get_work_log`, `set_folder` and `set_chat`, with instructions of its own (save quietly, never company code or data).

## How it behaves

- **Small answers.** Compact text, one line per item, with the ids the next call needs. No raw JSON.
- **Retry-safe writes.** Every POST / PUT / PATCH sends a fresh uuid `Idempotency-Key`. A network error or a 5xx is retried once with the same key, so a retry can't write twice: the API replays the first answer (`Idempotent-Replayed: true`). If that retry finds the first attempt still running (409), the server waits 1.5 s and asks once more. Business 409s (a 4th focus line, a 4th active goal) are passed through as they are.
- **Errors** come back as `isError` results with the API's message: a missing heading lists the real headings, "Not found" becomes "No goal with id …", and so on.
- **stdout is the MCP channel.** Logs go to stderr, and never contain the token.

## Development

```sh
npm test              # unit tests (vitest, mocked fetch): every tool, request shape, headers, retries, error mapping
npm run typecheck     # src and tests
npm run test:smoke    # builds, then drives dist/index.js over stdio against the running API
```

`test:smoke` needs the API on `KAAGA_URL` (default `http://localhost:8002`). It logs in as the dev user (`KAAGA_SMOKE_EMAIL` / `KAAGA_SMOKE_PASSWORD` override it), makes its own tokens, creates one doc titled "MCP smoke test …", appends to it, adds a canvas and rewrites a section, checks that a read-only token is refused writes, then cleans up: it undoes the doc-create (the doc is archived), marks its other edits seen and revokes its tokens. It writes no focus lines, pocket notes or goals. `SMOKE_TRANSCRIPT=<file>` saves the transcript.

Layout: `src/index.ts` (stdio entry), `src/server.ts` (tool list and instructions), `src/api.ts` (HTTP client: auth, idempotency, retries), `src/errors.ts` (agent-facing messages), `src/format.ts` (compact text), `src/subjects.ts` (subjects by name), `src/tools/*` (one file per area).

Notes:

- `@modelcontextprotocol/sdk` is pinned to 1.32.2. That is the v1.x line, which the SDK now calls maintenance (fixes for at least six months from 2026-07-27); v2 ships as separate `@modelcontextprotocol/server` / `client` packages. Moving later means `registerTool` and the transports from the v2 packages.
- `.npmrc` sets `legacy-peer-deps=true`, as in `recollect/`: npm 11.1 crashes ("Cannot read properties of null (reading 'edgesOut')") while resolving vitest's optional peers. `vite` is listed explicitly for the same reason.
