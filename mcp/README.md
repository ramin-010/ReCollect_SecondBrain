# Recollect MCP server

"Recollect for agents": a small local MCP server on stdio. A coding agent (Claude Code, on Ramin's subscription) uses it to read and write his Recollect docs and learning data (subjects, revisions, goals, focus lines, pocket notes) through the Recollect REST API, with a personal access token.

Plan: `context/specs/HOME_DOCS_AGENT_PLAN.md` §3. The API side: `backend/src/routers/agent.routes.ts` and `backend/src/services/apiTokens/tokenRoutes.ts` (the endpoints a token may call).

## Set up

1. Build (Node 22 or newer):

   ```sh
   cd E:/PERSONAL_PROJECTS/second_brain/mcp
   npm install
   npm run build
   ```

2. Make a token in Recollect: **Settings → Agents**. Give it the scopes the tools need (below); all three for full use. The token (`rcl_…`) is shown once.

3. Add the server to Claude Code:

   ```sh
   claude mcp add recollect -e RECOLLECT_URL=http://localhost:8002 -e RECOLLECT_TOKEN=rcl_… -- node E:/PERSONAL_PROJECTS/second_brain/mcp/dist/index.js
   ```

   Add `-s user` (before `--`) to have it in every project; the default scope is the current folder only. Check it with `claude mcp list`, or `/mcp` inside Claude Code.

| Variable | Default | |
|---|---|---|
| `RECOLLECT_TOKEN` | (required) | The `rcl_…` token. Without it the server still starts, and every tool says how to fix it. |
| `RECOLLECT_URL` | `http://localhost:8002` | The API origin. A trailing `/` or `/api` is fine. |
| `RECOLLECT_AGENT_NAME` (or `RECOLLECT_AGENT`) | `Claude Code` | Sent as `X-Agent-Name`; Home shows it on "From your agent". Give each connection its own, e.g. `RECOLLECT_AGENT=study-chat`. |
| `RECOLLECT_TIMEOUT_MS` | `30000` | Per request. |
| `RECOLLECT_DEBUG` | off | `1`: one stderr line per API call (method, path, status, time). |

### Over HTTP (remote MCP, stage 6)
The backend serves the same catalogue at `POST <api origin>/mcp` (MCP Streamable HTTP, stateless): `claude mcp add --transport http recollect http://localhost:8002/mcp --header "Authorization: Bearer rcl_…"`. The token's scopes and the edit log apply as for the stdio server; the default groups are listed, the rest through `more_tools`. Without a token it answers 401 pointing at `/.well-known/oauth-protected-resource/mcp`, and **an app can sign in instead of using a pasted token** (OAuth 2.1, 2026-11-15): `claude mcp add --transport http recollect http://localhost:8002/mcp` with no header opens Recollect's consent page in the browser ("Allow Claude Code to use Recollect?"), and claude.ai's custom connector does the same once the API has a public HTTPS address. The connection shows in Settings → Agents ("Signed in from the app"); its token lasts an hour and renews itself; Revoke ends it. Details: ALWAYS_ON_SPEC 6.5.

## Scopes

| Scope | Lets the agent |
|---|---|
| `read` | Every read tool, and the lookups the write tools make first (subjects, a doc's topic). |
| `docs:write` | `create_doc`, `update_doc`, `append_to_doc`, `replace_section`, `add_canvas`, `update_canvas`, `trash_doc`, `restore_doc`, `insert_blocks`, `update_block`, `move_blocks`, `delete_blocks`. |
| `sessions:write` | `checkpoint`, `update_project`, `remember`, `forget` (a Claude Code hook's token needs only this and `read`). |
| `tasks:write` | `add_task`, `update_task` (personal tasks only). Tokens that had `learning:write` got it with the migration. |
| `learning:write` | `complete_revision`, `move_revision`, `update_settings`, `empty_trash`, `publish_doc`, `share_doc` (these three ask), `create_subject`, `schedule_revision`, `create_goal`, `update_goal`, `add_milestone`, `complete_milestone`, `update_milestone`, `remove_milestone`, `add_focus`, `update_focus`, `remove_focus`, `plan_topics`, `update_topic`, `add_pocket_note`, `add_week_target`, `update_week_target`, `suggest`, `log_decision`, and `create_subject_if_missing` on `create_doc`. |

A call without the scope it needs fails with the scope named, e.g. `The Recollect token lacks the "docs:write" scope this tool needs. Make a token with "docs:write" in Settings → Agents.` A revoked or unknown token: `The Recollect token is invalid or revoked: make a new one in Settings → Agents…`

## Tools

71 tools (some rows below hold two or more), plus the `note_recipe` prompt and the `recollect-notes` skill (`npm run install:skill`). They come in groups: a chat lists **core, docs, plan and record** from the start (the 40,000-character budget holds for these) and the **manage** group when it calls `more_tools` or the server runs with `RECOLLECT_TOOLS=all` (or a list such as `core,docs,manage`); the in-app manager has them all. Each tool has a level (MANAGER_AND_DOCS_PLAN §3.2, `TOOL_LEVELS` in `src/server.ts`): 1 reads, 2 changes at once with an Undo, 3 only asks, and Ramin's tap on Home does it:

| Tool | What it does | API |
|---|---|---|
| `get_brief` | Where Ramin stands, in one call: his profile (Settings → Agents), goals and pace, today, each path's next topic with its last session and open weak spots, recent sessions, Recall's weak topics, a project's next step (`project`), and a session key | `GET /api/brief` |
| `checkpoint` | Write this chat's session under its key, again and again (the same key updates the same session): title, kind, topic, score, outcome, weak spots found or cleared, the topic's status, the next step, and up to 3 things it `learned` about Ramin (as `remember` takes them, tagged with the session's project and subject); minutes are counted from the key | `PUT /api/sessions/by-key/:key` |
| `list_sessions` | Sessions day by day with minutes per kind | `GET /api/sessions` |
| `get_week` | The week (Monday to Sunday): its targets, what is done (worked out: a target ticks itself when its topic, milestone or task is done, or its count is reached), last week in numbers, whether the weekly review waits | `GET /api/week` |
| `add_week_target`, `update_week_target` | Add a target (at most 5 a week; a link to a topic, milestone or task, or a count: practice, minutes or topics finished, in a subject or project); change its text, tick it, drop it | `POST /api/week/targets`, `PATCH /api/week/targets/:id` |
| `suggest` | Propose a week target, a focus line or a profile change: it waits on Home under Suggested until Ramin accepts or dismisses it (agents can't accept) | `POST /api/suggestions` |
| **manage:** `get_mirror` | Where Ramin stands, worked out by the app: per goal each path's pace against the deadline (and the smallest fix) and hours per week; per subject quiz scores, weak spots, practice outcomes, minutes per topic | `GET /api/mirror` |
| `list_tasks`, `add_task`, `update_task` | Ramin's personal tasks (never workspace tasks, no delete): list by due window (today, week, overdue, all), add one with a due day and priority, change or tick one | `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id` |
| `log_decision`, **manage:** `list_decisions` | The decision journal: what was decided, why, what he expects, a day to look again (a day or 30d / 6w / 3m; Home asks "Was this right?" then); list open, reviewed or one project's | `POST /api/decisions`, `GET /api/decisions` |
| `get_today` | Today's plan (due revisions with doc ids), focus lines, the next topic of up to 3 paths (goal-linked first), active goals with deadline, days left, progress, forecast and next milestone | `GET /api/today` |
| `get_learning_overview` | Per subject: topics due / waiting / mastered / unscheduled, plus the daily budget. With `subject`: that subject's topics with next review dates | `GET /api/subjects`, `/api/topics/statuses`, `/api/learning/settings` |
| `search_docs` | Docs by words in title or text on Postgres full-text (each word as a stem or a word's start; best match first), or the most recent; id, subject, date and snippet | `GET /api/agent/docs` |
| `read_doc` | A doc as Markdown, after a one-line header | `GET /api/agent/docs/:id` |
| `create_doc` | A new doc from Markdown; optional `subject` (by name), `topicId` (the doc becomes that planned topic's note: in progress, or done with `revise`), `revise`, `create_subject_if_missing` | `POST /api/agent/docs` |
| `update_doc` | Rename a doc (live), file it under a subject, or make it a planned topic's note; undoable | `PATCH /api/agent/docs/:id` |
| `append_to_doc` | Markdown at the end of a doc, live | `POST /api/agent/docs/:id/append` |
| `replace_section` | Rewrite the section under a heading; an unknown heading lists the doc's headings | `POST /api/agent/docs/:id/replace-section` |
| `add_canvas` | A diagram of boxes and arrows (a system-design sketch, a flow) at the end of a doc: `diagram` (Mermaid flowchart text, which the API lays out), `height` (optional); answers with a line per canvas (size, zoom in a doc, problems to fix) | `POST /api/agent/docs/:id/append` (a ` ```canvas ` fence) |
| `update_canvas` | Change one board in place by its id (`%% id: cv_…` in read_doc): `diagram` (the whole edited text) or `add` / `remove` / `rename`; boxes Ramin placed keep their places, new ones are laid out beside what they connect to; undoable | `POST /api/agent/docs/:id/canvas/:canvasId` |
| `preview_diagram` | A PNG of a doc's board as laid out (the first canvas when no `canvasId`), with its report; `theme` light or dark. Mermaid blocks are not drawn on the server | `GET /api/agent/docs/:id/preview` |
| `list_subjects` | Subjects with topic counts and ids | `GET /api/subjects` |
| `create_subject` | A new subject (an existing name is returned, not duplicated) | `POST /api/subjects` |
| `get_path` / `plan_topics` / `update_topic` | A subject's path: its topics in order (✓ done, ▶ in progress, ○ planned, – skipped) and what comes next; plan topics (a whole course, or one after another), move a topic along (status, next step, place); writes undoable | `GET` / `POST /api/subjects/:id/path`, `PATCH /api/topics/:id/path` |
| `schedule_revision` | Put a doc on the 1 / 3 / 7 / 21-day schedule (files it under `subject` first if needed) | `GET /api/topics/by-doc/:docId`, then `POST /api/topics` or `POST /api/revisions/start` |
| `list_due` | Every due or overdue revision: today's plan first, then the ones waiting | `GET /api/today` |
| `list_goals` | Goals with deadline, progress, forecast, why, subjects and milestones (with ids) | `GET /api/goals` |
| `create_goal` | A goal with a deadline, optional why, subjects (names) and dated milestones | `POST /api/goals` |
| **manage:** `update_goal` | Change title, why, deadline, status or subjects (on `more_tools` since 2026-11-16, to make room for `remember`) | `PATCH /api/goals/:id` |
| **manage:** `add_milestone` | Add a milestone to a goal | `POST /api/goals/:id/milestones` |
| **manage:** `complete_milestone` | Mark a milestone done | `PATCH /api/goal-milestones/:id` |
| **manage:** `update_milestone` / `remove_milestone` | Change a milestone (title, due day, `done: false` reopens it) or remove it; both undoable | `PATCH` / `DELETE /api/goal-milestones/:id` |
| `add_focus` | A focus line for today (≤ 140 characters, up to 3 a day) | `POST /api/focus` |
| **manage:** `update_focus` / `remove_focus` | Change a focus line (text, done) or remove it; both undoable | `PATCH` / `DELETE /api/focus/:id` |
| `add_pocket_note` | A pocket (quick) note, optionally pinned. Agents can add them, never read them | `PUT /api/quick-notes/:newUuid` |
| **manage:** `recent_agent_edits` | What agents wrote lately, and whether Ramin kept or undid it | `GET /api/agent/edits` |
| `remember` | His buddy's memory (what Recollect learns about him across chats): one lasting thing he said about himself (text, a kind: fact, preference, value, aim, idea, decision, pattern, state, thread, win; private for health, money, people, fears…; a state is private by default). A repeat is "seen again", one he marked wrong is not saved, nothing is kept while he has paused the buddy; every text passes a secret scrub. Not an edit-log row: /you shows each memory with the agent that saved it | `POST /api/buddy/remember` |
| **manage:** `recall_memory` | Search what his buddy knows (words or word starts), or list it by kind and status; private ones are marked; a query also finds his months (the buddy's chapters, by a month's name or words in it) | `GET /api/buddy/memories`, `GET /api/buddy/chapters` |
| **manage:** `get_work_log` | His work log: what he did per project and day (lines from his chats, or logged by an agent with their time spans; the time and commits of his sessions); search words or pick days; in a work folder, that project only | `GET /api/buddy/work` |
| `log_work` | The day's work on his word ("log today's work", `/log-work`; B10): without lines it answers the day's turn times in this folder from the hooks' clock; with 3–6 lines (did, decided, stuck, next, each with its time span) it writes them; a second call in the same chat replaces its lines; a line he removed is never written again | `POST /api/buddy/work` |
| **manage:** `forget` | Close a memory that is no longer true, undoable; memories he wrote or changed himself are his (403) | `POST /api/buddy/memories/:id/close` |
| `more_tools` | Turns the manage group on for this chat (the client is told the tool list changed) | none |
| **manage:** `trash_doc`, `restore_doc` | Move a doc of his to the trash (30 days, then gone) or take it out; both undoable | `POST /api/agent/docs/:id/trash`, `…/restore` |
| **manage:** `empty_trash` (level 3) | Ask to delete the trash for good: a card under Suggested on Home with "Do it"; nothing happens until he taps it | `POST /api/actions` (`empty_trash`) |
| **manage:** `complete_revision`, `move_revision` | Mark a due review done (when he just reviewed it with you) or move a pending one to another day; both undoable | `POST /api/revisions/:id/complete`, `…/reschedule` |
| **manage:** `get_settings`, `update_settings` | His daily budget, busy-until day, the morning email and the profile agents read; agents can't change the time zone or the old routine | `GET` / `PATCH /api/learning/settings` |
| **manage:** `update_project` | A coding project's name, next step, goal or archive (by key or name); undoable | `GET /api/projects`, `PATCH /api/projects/:id` |
| **manage:** `list_suggestions` | What waits under Suggested on his Home, actions that need his tap marked | `GET /api/suggestions` |
| `set_reminder`, **manage:** `list_reminders`, `cancel_reminder` | A reminder (an email at the time) on a task, or with a title that makes the task; list the ones to come; cancel one (the task stays). Set and cancel are undoable | `POST /api/reminders`, `GET /api/reminders`, `POST /api/reminders/:id/cancel` |
| **manage:** `get_recall` | A topic's last Recall sessions: grades, the questions he missed with the grader's words, open weak spots (by topic or doc) | `GET /api/topics/:id/recall` |
| **manage:** `get_sharing` | Who can see a doc of his: published to the web or not (its read-only link), the people added with their roles, who asks to edit | `GET /api/agent/docs/:id/sharing` |
| **manage:** `publish_doc`, `share_doc` (level 3) | Ask to publish or unpublish a doc (a read-only link, stable until switched off), or to give someone with an account "can view" / "can edit" (or take it away): a card under Suggested on Home with "Do it"; nothing happens until he taps it | `POST /api/actions` (`publish_doc`, `share_doc`) |
| **manage:** `spread_backlog` | Spread every overdue review over the next days by his daily budget, undoable; more than 20 at once only asks ("Do it" on Home) | `POST /api/revisions/spread` |
| `get_outline` | A doc's blocks, one line each (id · kind · first words, children indented): the ids the block tools take. Every doc is on the new editor since the switch (2026-11-15); a doc with old content and no blocks would answer 409 | `GET /api/agent/docs/:id/outline` |
| `insert_blocks`, `update_block`, `delete_blocks`; **manage:** `move_blocks` | Change the new editor's blocks by id, live: insert Markdown after / before / under a block or at the start or end; change one block (one block of Markdown, or props: a heading's level, a to-do's tick, a callout's kind; its children stay); move blocks with their children; delete them. Each is one change Ramin can undo (`doc_blocks`) | `POST /api/agent/docs/:id/blocks`, `PATCH …/blocks/:blockId`, `POST …/blocks/move`, `POST …/blocks/delete` |

There are no tools that delete for good: a doc goes to the trash, and emptying it waits for Ramin's tap. Every write is logged; Ramin can undo it from **Home → From your agent**, and every write answer ends with that line. Agents can't undo or "keep" their own edits (those endpoints are cookie-only).

### The Markdown agents can write

GitHub Markdown, with headings `#` to `######` (a toggle heading folds its section: `<details><summary>## Title</summary>…</details>`); callouts `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`; toggles `<details><summary>Q</summary>\n\nA\n\n</details>` (good for self-test questions); fenced code with a language; ` ```mermaid ` fences render as diagrams (sequence, ER, state, class, timeline, mind map); ` ```canvas ` fences hold a board Ramin can rearrange, written as Mermaid flowchart text (`flowchart LR`, `a[Box] -->|label| b[(Database)]`, `subgraph id [Title] … end` zones, `:::blue` colours, `id@{ kind: cache }` icons, `note for box: text`), which the API lays out with ELK (a fence that starts with `{` is still the old JSON board); task lists `- [ ]`; `==highlight==`. GFM tables become real tables. The full guide is in `create_doc`'s description, so the agent sees it.

`read_doc` prints a canvas in that text form, its id first (`%% id: cv_…`); positions are not printed. A fence without that id makes a new board. To change a board in place, keeping what Ramin arranged, use `update_canvas`, or send the fence back with its `%% id` line through `replace_section`; `relayout: true` lays the whole board out again. Undo brings the old board back. Every write that makes a canvas answers with a line per canvas: boxes, arrows, zones, the laid-out size, the zoom it shows at in a doc, and lint (arrows that cross, an arrow through a box, a box with no arrows, too wide). The parser and layout: `backend/src/services/docs/diagram/`.

## Claude Code hooks (coding sessions log themselves)

`npm run install:hooks` (after `npm run build`) adds four hooks to `~/.claude/settings.json` (a backup is saved beside it first) and writes `~/.recollect/hooks.json` (`url`, `token`, `allow`, `brief`). Make the token in Settings → Agents with **read** and **sessions:write** only. `npm run install:hooks -- --remove` takes the hooks out again.

- **SessionStart:** in an allowed folder (default `E:/PERSONAL_PROJECTS/`), prints the brief into the session (with the key `cc_<session>` and the project), and opens the session in `~/.recollect/open/`. The header asks the model to `checkpoint` once with that key, the project, a title and the `nextStep` when it finishes a piece of work, so the project's next step stays current (a real run did it unasked).
- **UserPromptSubmit, Stop:** one timestamp each, no network: active minutes are the gaps between them, none over 5 minutes. The first real prompt (first line, not a slash command or a one-word reply) is kept as the session's title.
- **SessionEnd:** logs a `build` session: the project is the first folder under the allowed root (`second_brain/backend` → `second_brain`), active minutes, the branch and the subjects of commits made during it (that folder's repo and the repos directly inside it). Its title: the first commit, else the session's own title or first prompt; a chat's title is never replaced. Under 2 active minutes or fewer than 2 prompts: nothing is logged.
- A window closed without SessionEnd is logged by the next session start (the sweep: last activity over 30 minutes ago). A swept window used again logs the rest as a session of its own (`cc_<id>:r<time>`), as does a session that began before the hooks were installed.
- Never blocks Claude Code: 3 s per call, failures go to `~/.recollect/hook.log`. Other folders, subagents and `RECOLLECT_HOOKS=off` do nothing. The transcript is never read. A study chat in an allowed folder checkpoints under the same key, so there is one entry, not two.
- **The day's clock (B10):** in every folder the hooks act in, each prompt and each reply's end is stamped in `~/.recollect/times/<project>/<day>.jsonl` (the prompt's first 60 characters with it). It stays on the PC; `log_work` reads it for the turn times, and files older than two weeks are deleted.
- **Folder entries** in `allow` are `{ path, mode, brief, nudge, commits }`: `mode` `full` (his typed words are read for his buddy), `light` (hours only: nothing leaves the PC until the session closes) or `off`; `brief: false` (a work folder) never shows his brief and titles its sessions by the project, never his words; `nudge: true` adds to each prompt a one-line reminder, with the time, to save quietly what he would want later, and once a day to offer to log the work (after 17:30 with an hour of work, or the next morning); `commits: false` sends no branch or commit subjects. A work folder's MCP lists only `get_brief`, `remember`, `add_task`, `set_reminder`, `add_pocket_note`, `log_work` and `get_work_log`, with instructions of its own (save quietly, never company code or data).

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

`test:smoke` needs the API on `RECOLLECT_URL` (default `http://localhost:8002`). It logs in as the dev user (`RECOLLECT_SMOKE_EMAIL` / `RECOLLECT_SMOKE_PASSWORD` override it), makes its own tokens, creates one doc titled "MCP smoke test …", appends to it, adds a canvas and rewrites a section, checks that a read-only token is refused writes, then cleans up: it undoes the doc-create (the doc is archived), marks its other edits seen and revokes its tokens. It writes no focus lines, pocket notes or goals. `SMOKE_TRANSCRIPT=<file>` saves the transcript.

Layout: `src/index.ts` (stdio entry), `src/server.ts` (tool list and instructions), `src/api.ts` (HTTP client: auth, idempotency, retries), `src/errors.ts` (agent-facing messages), `src/format.ts` (compact text), `src/subjects.ts` (subjects by name), `src/tools/*` (one file per area).

Notes:

- `@modelcontextprotocol/sdk` is pinned to 1.32.2. That is the v1.x line, which the SDK now calls maintenance (fixes for at least six months from 2026-07-27); v2 ships as separate `@modelcontextprotocol/server` / `client` packages. Moving later means `registerTool` and the transports from the v2 packages.
- `.npmrc` sets `legacy-peer-deps=true`, as in `recollect/`: npm 11.1 crashes ("Cannot read properties of null (reading 'edgesOut')") while resolving vitest's optional peers. `vite` is listed explicitly for the same reason.
