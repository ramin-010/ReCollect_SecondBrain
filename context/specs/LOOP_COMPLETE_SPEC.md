# The loop complete: build contracts for stages 1 to 3

_2026-11-14 (late night), written by Fable for the builder (Opus 5.5), after reviewing the sync spine as built and after Ramin's ruling: **"I can't wait a week. Keep building everything we planned; the deploy and the real-life testing come after."** The order of all stages is in [ECOSYSTEM_PLAN](ECOSYSTEM_PLAN.md) §5. This file is the contract for stages 1 to 3; stage 4 (the manager) and the doc backend and sharing parts of stage 5 are in [MANAGER_AND_DOCS_PLAN](MANAGER_AND_DOCS_PLAN.md); the editor of stage 5 is [DOCS_EDITOR_V2_PLAN](DOCS_EDITOR_V2_PLAN.md); stages 6 and 7 get their own short spec when they start._

**Status: built (2026-11-14 night), stages 1 to 3; "As built" says where the build differs and what waits (the VS Code hook check, the Recall test set on real notes).**

**How to work through it**
- In order: S1 (all of it), then 1.6, 1.7, 4.1, 4.2, search, then S3. The same rules as [SYNC_SPINE_SPEC](SYNC_SPINE_SPEC.md): names below are the contract; what is not stated is the builder's call, held to ECOSYSTEM_PLAN §2 (six rules) and §8 (gates); a contract that turns out wrong in the code is changed, with the reason in "As built".
- **Each item ends with the full suites run after the last change** (backend typecheck, unit, integration from PowerShell; MCP; frontend tsc), `npm run build` in `mcp/`, the backend restarted, README and skills updated, STATE.md §6 and §7 updated. Report the numbers of that run, never an earlier one (the spine's stop report quoted the 1.2 numbers and missed one failing test).
- **Stop points do not block the build** unless marked **blocking**. For taste-critical UI: put numbered screenshots in `screens/` (root, git-ignored), tell Ramin, and go on with the next item. Blocking: anything that changes his machine, spends real AI money beyond cents, touches his real data, or needs his login.
- Migrations: next timestamps after `20261114210000_agent_profile`.
- **Tool budget:** 33 tools are about 36,000 of the 40,000 characters allowed, and this spec adds 10. Before adding any: say the canvas language once (one tool carries the reference, the other diagram tools point to it). If the catalogue still ends over 40,000, shorten descriptions; if that is not enough, tell Ramin the number instead of raising it.

---

## S1. Close the spine (S)

### S1.1 Fixes from the review

| # | What is wrong today | Fix |
|---|---|---|
| 1 | **A swept session loses the rest of its work.** When a Claude Code window sits idle over 30 minutes and another session starts, the sweep closes and deletes its file; later prompts in the old window find no file and record nothing (`hook.ts`: `prompt`, `stop`, `end` do nothing without a file). Ramin keeps windows open for hours | `prompt` in an allowed folder with no open file opens one again, with the key `cc_<id>:r<time>` (the same form a resume uses). Unit test: start, prompts, sweep by another start, more prompts, end → two sessions, no minutes lost |
| 2 | **Build sessions have no real title.** Without a commit the title is "Worked on second_brain" for every session, and Ramin commits rarely | The hook keeps the first prompt of the session (first line, at most 120 characters; `UserPromptSubmit` input has `prompt`: check the hooks reference again) and sends it as `titleIfNew`. New input `titleIfNew` on the PUT: used only when the row has no title from a chat. Order for a hook-made row: first commit subject, else the first prompt, else "Worked on <project>" |
| 3 | **A chat that checkpoints in a coding session makes a `study` row.** A new row without a kind is `study`, and the hook's `kindIfNew: build` comes too late | A new row without a kind is `practice` when it has an outcome or a problem; `study` when it names a topic, a subject, a score or weak spots; else `build` when it names a project; else `study` |
| 4 | **The project's "next" never fills in a coding session** (only a checkpoint writes it, and the hook's header tells the model the hook does the logging) | The header line becomes: coding sessions are logged by the hook; when a piece of work is finished, one `checkpoint` with this key, a `title` and a `nextStep` keeps the project's next step current. Check with one real run that a coding session does it without being asked |
| 5 | **Study minutes are wall-clock time since the brief** (up to 300): a chat left open over lunch logs hours | A checkpoint without `minutes` adds the time since the row's last write, at most 30 minutes (first write: since the key's start, at most 45). Stored in `minutes` as before; a hook's active minutes still replace it for `cc_` keys |
| 6 | **A subfolder is its own project** (`second_brain/backend` → "backend") | The project is the first folder under the matching allow root (`E:/PERSONAL_PROJECTS/second_brain/backend` → `second_brain`); the folder's own name when it is the root itself |
| 7 | `url` on a session takes any text | Only `http://` or `https://`, else 400 |
| 8 | **A hole in doc sharing:** `POST /api/save/:slug` lets any logged-in person with a share link join the doc at the link's role, with no approval. The app no longer calls it ([MANAGER_AND_DOCS_PLAN](MANAGER_AND_DOCS_PLAN.md) §2) | Remove the route and its client code. The rest of sharing is rebuilt in stage 5 |

### S1.2 His data and test data must part (blocking for the clean-up only)

His study chat already writes real goals into the dev account, next to the seed sample and the leftovers of our test runs ("Leader election" on his path came from a QA script).

1. **A QA account** `qa@recollect.local`, holding the seed sample. `npm run db:seed` writes only there, and refuses any other account without `--email`.
2. Every QA script (`scratchpad/scripts/login.js` and the rest), every real Claude Code test run (a QA token passed with `--mcp-config`, and `RECOLLECT_HOOKS=off`) and every hook test uses the QA account from now on.
3. `backend/scripts/whose-data.ts`: a dry run that lists what is on `dev@recollect.local`, grouped by where it came from (the seed, QA scripts and test runs, an agent, by hand). **Blocking:** Ramin says what stays; `--apply` removes the rest. Nothing of his is touched before that.
4. **A daily local dump:** `start-recollect.ps1` runs `pg_dump` once a day into `backend/.devdb/dumps/` (keeps 14); `npm run db:dump` does it by hand. His real data now lives on this disk only.

### S1.3 Install and verify (blocking: his machine)

Ramin runs `npm run autostart`, makes the hook token, runs `npm run install:hooks` (STATE §7). Then the builder checks the thing the spine could not: **hooks in the VS Code extension**, his main surface. A new chat there must leave a file in `~/.recollect/open/`, and closing it must log a session (at once, or by the next start's sweep). If they do not fire there, stop and report: the capture design has a hole to close before more is built on it.

### S1.4 One real Recall call (blocking: about a cent)

The questions schema gained a required `weakSpotId` and no real model call has run since. With Ramin's yes: one on-demand Recall set on a QA topic that has an open weak spot; check the id comes back and a strong answer clears it.

---

## 1.6 The week and suggestions (M)

Designed without a week of real data (Ramin's ruling), so: small, every number worked out at read time, nothing that punishes an empty week.

### Data
```
WeekTarget   id · userId · weekStart (Date: the Monday, his zone) · text (≤ 140) · sortOrder
             status: open | done | dropped · doneAt?
             at most one link:   topicId? · milestoneId? · todoId?
             or a count:         measure?: practice | minutes | topics · amount? (Int)
                                 subjectId? or projectId? (what is counted)
             createdBy · agentName? · createdAt · updatedAt

Suggestion   id · userId · kind: week_target | focus_line | profile_edit | action
             text (≤ 200: what the card says) · reason? (≤ 200) · payload Json (what accepting does)
             proposedBy: app | coach | agent | ask_ai · agentName?
             batch? (≤ 40, e.g. "week:2026-11-16") · status: pending | accepted | dismissed
             expiresDay? · decidedAt? · createdAt
```
- **Done is worked out, never typed twice:** a target is done when its status is `done`, or its topic is done, its milestone is done, its task is complete, or its count is reached (practice sessions, session minutes or topics done, in that week, in that subject or project). The API answers `done` and `progress { done, total }`.
- At most 5 targets that are not dropped per week (409 `WEEK_FULL`). No minimum, and no error for an empty week.
- A new suggestion kind is one handler (what accepting does) and one line of card text. Later kinds (`topic_next`, `date_change`) are added the same way.
- **`action` and `ask_ai` are in the enums now and get their handler in stage 4** ([MANAGER_AND_DOCS_PLAN](MANAGER_AND_DOCS_PLAN.md) §3.2: an action that needs Ramin's tap is a pending suggestion). Build the accept path so a handler can be added without touching the card.

### API
| Route | Who | Does |
|---|---|---|
| `GET /api/week?start=` | `read` | `{ weekStart, weekEnd, targets[], lastWeek: { targets: {done,total}, minutes per kind, topicsDone, revisionsDone }, review: { due, suggestions[] } }` |
| `POST /api/week/targets` · `PATCH /api/week/targets/:id` | `learning:write` or cookie | Add; change text, status, order. Agent kinds `week_target_create` (Undo removes it) and `week_target_update` (Undo puts the old fields back). `status: dropped` is the remove |
| `GET /api/suggestions?status=pending` | `read` | The pending ones, newest batch first |
| `POST /api/suggestions` | `learning:write` | An agent proposes. In `SELF_LOGGED`: a pending suggestion is its own visible, dismissable record. At most 10 pending per agent (409) |
| `POST /api/suggestions/:id/accept` · `/dismiss` · `POST /api/suggestions/decide { accept: id[], dismiss: id[] }` | **cookie only** | Accepting is Ramin's tap, never an agent's |

### The Sunday review, worked out by code (no model call)
- `review.due` is true from Sunday (his zone) for the week that starts the next day, and on any later day while the running week has no targets, until that week's batch is decided or skipped.
- When due and the batch does not exist yet, `proposeWeek` writes it (once; safe to call twice): for each path linked to an active goal, the next topics at the pace the deadline needs (remaining topics ÷ weeks left, rounded up, at most 2 per path); for a path with no goal but a session in the last 14 days, its next topic; last week's open targets ("keep?"); the next milestone due within 14 days; the newest coach suggestion when there is one. At most 5 in all, goal-linked first.
- A direct write stays direct (rule 5): when Ramin plans the week in a chat and says yes, the agent uses `add_week_target`.

### MCP and the brief
- `get_week { week? }`, `add_week_target { text, topicId?, milestoneId?, taskId?, measure?, amount?, subject?, project? }`, `update_week_target { targetId, text?, status? }`, `suggest { kind, text, reason?, … }`.
- `brief.week`: `{ weekStart, targets: [{ text, done, progress }], reviewDue }`. Printed as one line: `Week: 2/4 · [x] Finish 7. Message queues · [ ] 10 graph problems (3/10)`.
- The study skill: propose today's piece from the week's targets first; when the week is empty and he wants to plan, propose 3 to 5 and write them on his yes.

### Home (taste-critical: screens, then go on)
Home must still answer "what now?" without scrolling. So this item also fixes Home's order:
1. **Suggested** (new, the one place for every proposal): shown only when something is pending; the Sunday card says last week in one line, then the proposals with Accept / Dismiss and "Accept all"; other days it is one quiet line that opens.
2. **This week:** at most five rows (tick, text, "3 of 10"), next to Focus; one action pulls a target into today's focus.
3. **"From your agent" moves below the day's work** and folds to one line when it has more than three entries. Today it sits above Focus and Next up and pushes them off the first screen.

---

## 1.7 The mirror (M)

One honest picture per goal and per subject. No more dashboards than that.

- **`services/learning/pace.ts` (pure, unit-tested):** per path: topics done and total, pace (topics done in the last 28 days ÷ 4), required pace (remaining ÷ weeks to the goal's deadline), the day the last topic lands at this pace, status in `goalForecast`'s words. Hours: minutes per week per kind for the last 6 weeks; minutes per finished topic (only with 3 or more finished topics that have sessions; otherwise "not enough yet", never a guess). The smallest fix as numbers: one more topic a week, or the date it would take.
- **`GET /api/mirror`** (`read`) → `{ goals: [{ …forecast, paths[], hoursPerWeek[] }], subjects: [{ quiz: scores over time, weakSpots: { open, clearedIn30 }, practice: { alone, hints, after_answer } }], weeks: [{ weekStart, minutes per kind, targets: {done,total} }] }`. Tool `get_mirror { goal?, subject? }`. The brief's goal line gains the path pace.
- **A page "Where you stand"**, opened from the goal card (taste-critical: screens, then go on). Inline SVG, no chart package: hours per week by kind, quiz scores, the practice split. Load the dataviz skill first.
- **The coach moves onto this:** its evidence gains sessions, weak spots, practice outcomes and week targets, read through these services. **Number check:** every number in the model's note must be one the evidence holds; a note that fails is replaced by a plain one written by code from the same facts (no second call). Its three focus lines become `Suggestion` rows (`proposedBy: coach`).
- **Recall test set:** `backend/scripts/recall-eval.ts`: a fixed list of about 20 real notes, questions written by the current prompt, mechanical checks (count, length, a valid `weakSpotId`, no repeats), and a sheet Ramin can read. It needs real notes (S3) and about a dollar of AI spend: **blocking, ask first.** No prompt tuning before it exists.

---

## 4.1 Tasks, light (M), and one AI system

- New scope `tasks:write`. Token routes for **personal** tasks only (no workspace tasks): `GET /api/todos` (`read`), `POST`, `PATCH`. Kinds `task_create` (Undo deletes it) and `task_update` (Undo restores). No delete tool.
- Tools: `list_tasks { due?: today | week | overdue | all }`, `add_task { title, due?, priority? }`, `update_task { taskId, title?, due?, status? }`. The brief gains `tasks: { dueToday, overdue, titles[≤ 3] }`, printed only when there are any. A week target may point at a task.
- **The `@ai` task line moves to the Claude client** on Haiku 5.5 (load the claude-api skill first): a structured output checked by zod, metered as a new `AiFeature`, under the same cap; when the call fails the line is kept as a plain task. Then delete `services/ai/` (Groq, Gemini, Cohere) and their keys from `.env.example`. The old "Ask AI to write" route answers 410; its node and view go with the old editor (3.5).

## 4.2 The decision journal (S–M)

```
Decision   id · userId · title (≤ 160: what was decided) · why (≤ 600) · expect? (≤ 400)
           lookAgainDay (Date) · status: open | reviewed
           verdict?: right | wrong | mixed · verdictNote? (≤ 400) · reviewedAt?
           subjectId? · projectId? · createdBy · agentName? · createdAt · updatedAt
```
- `POST` / `GET` / `PATCH /api/decisions` (`learning:write` to write, `read` to read). Kinds `decision_create`, `decision_update`, each with an Undo.
- Tools: `log_decision { title, why, expect?, lookAgain, project?, subject? }` (`lookAgain` is a day or "30d"), `list_decisions { status?, project? }`.
- On its day it shows in Today as one row, "Was this right?": Right · Mixed · Wrong, an optional line, or "look again in 30 days". Never a red count.
- The brief: `decisions.due` when any are due; with `?project=`, that project's last two decisions (so a coding session opens knowing what was decided and why).

## Search on Postgres full-text (S)

`search_docs` and the library's search read a `tsvector` over each doc's title and plain text, kept current where docs are saved, with a GIN index; ranked, with a short snippet. No new package. The builder designs it from the save path as it is; the 1000-doc scan goes.

---

## S3. Real notes in (M)

- **Revise import** (ECOSYSTEM_PLAN 4.4). Revise stays read-only. `backend/scripts/import-revise.ts`: dry run by default, prints what it would bring (subjects, topics, notes, the revision history) and what it can't map. **Blocking:** ask Ramin the parked question first (which approach; STATE §7), show him the dry run, import into his account on his yes. It must be safe to run again, so a second run at the deploy brings only what is new.
- Then the Recall test set of 1.7 runs on his real notes, and the editor rebuild has real docs to migrate and test against.

## Things the builder must not do

As SYNC_SPINE_SPEC §9: nothing GPL, AGPL or paid, exact versions at least two weeks old; no patches to the old editor; no AI spend beyond small checks without asking, and tests never call the API; no git push, commits only when Ramin asks; nothing that makes Ramin log by hand. And from S1.2 on: **no test or QA run writes to his account.**

## As built

- **S1.1 ✅** (2026-11-14 night)
  - Hook (`mcp/src/hook.ts`): a `prompt` with no open file opens one with a `cc_<id>:r<time>` key (a swept window, or a session older than the hooks); the first real prompt (`promptTitle`: first line, ≥ 12 characters, not a slash command, ≤ 120) and `session_title` (the hooks reference lists it) are kept and sent as `titleIfNew`; `projectRoot`/`projectOf(cwd, allow)` (the first folder under the allow root; commits come from that folder's repo and its child repos); the start header names the key and the project and asks for one `checkpoint` with `project`, `title`, `nextStep` when a piece of work is done.
  - Sessions (`sessions.service.ts`): `titleIfNew` (order for a row without a title: first commit, `titleIfNew`, "Worked on <project>", the topic; a placeholder "Session" / "Worked on <project>" gives way to a real one; a chat's title is never replaced); `inferKind` as the contract (a `cc_` key counts as a project); `estimateMinutes` (first write ≤ 45 from the key's start, later writes add the gap since the last write ≤ 30); the project's next step follows a no-topic session whenever the **row** has a project (not only when this write names it); `url` must be http(s).
  - `POST /api/save/:slug` removed (route, controller, `joinDocViaShareLink`); the integration test now checks it is gone. The frontend never called it.
  - **#4 checked with a real run** (`scratchpad/qa/run-fix4.jsonl`, QA account, hooks from a throwaway settings file): asked only to add and commit a function, the model read the hook's header and called `checkpoint { key, project: "hook-demo", kind: "build", title, nextStep }` on its own; the project's next step was set; the hook closed the row with the commit and kept the chat's title.
  - Tests: unit `sessions.test.ts` (+2), `hook.test.ts` (+4: project roots, prompt titles, the swept window, the header); integration `sessions.test.ts` (+4: titles, kinds, minutes, url), `doc-sharing.test.ts` (the route is gone).
- **S1.2 ✅ except the clean-up's `--apply` (blocking: Ramin says what stays)**
  - `prisma/seed.ts`: the QA login `qa@recollect.local` / `qapass123` with the sample; any other account needs `--email <e> --reset-learning` (it replaces that account's learning data) and keeps its login. The sample's quick notes got generated ids (they had fixed ids, so a second account could never be seeded).
  - QA scripts (`scratchpad/scripts/login.js` and the 7 others) log in as QA. `scratchpad/scripts/qa-run.js setup|revoke` makes the files for real Claude Code runs against QA: `qa/mcp.json` (`--mcp-config … --strict-mcp-config`), `qa/home` (`RECOLLECT_HOOKS_HOME`), `qa/settings.json` (the hooks, `--settings`), `qa/projects/` (the allowed folder).
  - `backend/scripts/whose-data.ts` (dry run; `--apply --remove <groups> [--keep <ids>]`): groups seed (matched against a seed run on a throwaway user, rolled back), test (test tokens, `--windows` time ranges, docs a test token edited within 15 minutes of their making), agent, app. The windows for this machine: `scratchpad/whose-data-windows.json`. Dry run on dev: seed 125, test 67, agent 1 (his goal), app 1 (a Recall set: unknown).
  - `backend/scripts/db-dump.mjs` (`npm run db:dump`; `--daily` from `start-recollect.ps1`, in the background): pg_dump custom format into `backend/.devdb/dumps/`, newest 14 kept. **Differs:** the embedded Postgres has no pg_dump, so the script finds one (PG_DUMP, PATH, pgAdmin 4's `runtime\pg_dump.exe` (17.6 here), a PostgreSQL install) and otherwise writes every table as gzipped JSON (`DB_DUMP_JSON=1` forces it; tested). The archive lists 48 tables (`pg_restore --list`); a full restore was not tried.
- **S1.3 ⏸ blocking:** Ramin has not installed yet (no `~/.recollect`, no Startup shortcut). The hooks reference says IDE extensions fire the same hooks and settings edits are picked up by a file watcher (so open sessions start logging from their next prompt, through the new re-open path).
- **S1.4 ✅ half** (Ramin's yes 11-14 night; `scratchpad/scripts/ai-check.js`, QA account): one real Recall set on a QA topic with one open weak spot (a 1,500-character Kafka note): 5 questions, and the stored set's q1 (what triggers a rebalance) carries that weak spot's `weakSpotId` (the app's payload doesn't send the id to the browser, so it is checked in the stored set). Cost $0.0272, more than the cent estimated. **Not run for real:** a strong answer clearing the weak spot (one more grading call, about a cent; covered by the integration tests with a fake model).
- Full suites after S1: backend 934 unit + 465 integration, MCP 157.
- **1.6 ✅**
  - Migration `20261114220000_week_targets_suggestions` (`WeekTarget`, `Suggestion`, their enums, agent kinds `week_target_create` / `week_target_update`). **Process note:** `prisma migrate dev` named it with today's UTC time, which sorts before the hand-named migrations of 14 Nov, and applied it; renamed after the fact (folder and `_prisma_migrations` row). The way to make migrations here is now in `backend/docs/MIGRATION_CONVENTIONS.md`.
  - `services/learningDb/week.service.ts` (weeks from Monday in his zone; `countProgress`; `serializeTarget` works out `done`; `addWeekTarget` under an advisory lock so two adds can't both take the 5th place; `reviewDue`; `getWeek` with `lastWeek` = the week before the one the review plans) and `suggestions.service.ts` (`listSuggestions` writes the review's batch when due; `proposeSuggestion`; accept handlers per kind in one table (`action` has none); `decideSuggestions`; the pure `weekProposals` + `proposeWeek` under an advisory lock, batch `week:<Monday>`, expiring at that Sunday). Reasons say days as "Fri 20 Nov"; a milestone proposal is named by the milestone's title.
  - Routes as the contract, plus `POST /api/suggestions/decide`. Tokens: GET week, POST/PATCH targets (logged, undoable), GET/POST suggestions (`SELF_LOGGED`); accept/dismiss/decide are not on the token list.
  - Brief: `week { weekStart, targets[{ _id, text, done, progress }], reviewDue }`, printed as one `Week:` line (or "no targets yet" when the review waits).
  - MCP `get_week`, `add_week_target`, `update_week_target`, `suggest` (`src/tools/week.ts`; 37 tools); instructions and the study skill mention the week. **The canvas language is now said once** (create_doc's Markdown guide; add_canvas points to it): the catalogue went from 36,841 to under the budget with the four new tools.
  - Home (DESIGN.md log 2026-11-14 "The week and Suggested"): `Suggested.tsx`, `ThisWeek.tsx`, `FromAgent` folds over three, the new order. Tested like a person on the QA account (`scratchpad/scripts/week-qa.js`, light and dark): the review card with an agent's suggestion, "Add to week" by mouse, a target typed key by key, "Add to today" from the row's hover action, a tick, the agent's focus line accepted, From your agent folded and opened; no page errors; detector clean. Screens `screens/13`–`17`. **Not done:** the phone width; a failed-load state was not shown on screen.
  - Tests: unit `week.test.ts` (4); integration `week.test.ts` (5: targets ticking themselves and counting, the limit, links checked, agents logged and undone, suggestions of each kind, decide, the per-agent limit, the Sunday review once and due until decided, an empty weekday). MCP `week.test.ts` (3).
- **1.7 ✅ except the Recall test set's run (blocking: real notes from S3 and about $1)**
  - `services/learning/pace.ts` (pure, unit-tested: `pathPace` with status and the smallest fix `{ extraPerWeek, orLandsOn }`, `weeklyMinutes`, `minutesPerTopic`, `mondayOf`). `services/mirror/mirror.service.ts` + `GET /api/mirror` (token `read`): goals with their linked paths' pace and hours per week in their subjects; subjects with path, quiz scores (sessions' scores, last 12), weak spots open / cleared in 30 days, practice outcomes (90 days), minutes per finished topic; six weeks with minutes per kind and week targets. The brief's goals carry `paths` (printed as one line per path under the goal).
  - MCP `get_mirror { goal?, subject? }` (38 tools). **Tool budget:** 38 tools came to 40,166 characters; two cuts that change nothing for the model brought it to 37,328: id fields are checked with `refine` instead of `regex` (no `pattern` in every id field), and the tool list drops the SDK's `"$schema"` line from every tool (`leanToolList` in `server.ts` wraps the SDK's own handler).
  - The coach: evidence gains `record` (minutes per kind, sessions, practice outcomes, weak spots open and cleared in the window, the week's targets; sessions count as active days and as evidence). **Number check** (`coach/check.ts`): every number written with digits must appear in the evidence JSON (titles and days count; 7 always passes); otherwise the note is replaced by `plainCoachNote` (code, same facts, no second call; the stored model reads `plain (checked): <model>`). Its three focus lines become `Suggestion` rows (`proposedBy: coach`, batch `coach:<note id>`, a week to live); a quiet week writes none. The tests' sample coach note now uses only numbers from the test week.
  - Page `/mirror` "Where you stand" (`components/learning/mirror/MirrorPage.tsx`; rail link under "Your week"; top-bar title): goal cards with path pace and the fix, hours per week (stacked columns, kinds in the dataviz reference slots 1–4 validated on both surfaces, legend, hover tooltip, "Show the numbers" table), by subject (numbers in words, a quiz dot strip). Tested like a person on QA with a seeded record (`scratchpad/scripts/mirror-qa.js`, light and dark): the rail link by mouse, a slow hover over a column, the numbers opened; no page errors; detector clean after moving the axis labels onto the type ramp. Screens `screens/18`–`21`. **Not done:** the phone width.
  - `backend/scripts/recall-eval.ts` (`--pick 20` writes the fixed list `backend/evals/recall-notes.json`; a dry run by default; `--run` spends): checks per note (3–5 questions, fields filled, `weakSpotId` empty or an open weak spot, no repeats, the source quote in the note) and a Markdown sheet. **Not run:** it needs his real notes (S3) and his yes.
  - Tests: unit `pace.test.ts` (4), `coach/check.test.ts` (3); integration `mirror.test.ts` (1), `coach.test.ts` (+2: a plain note on unsupported numbers with its suggestions; a checked note kept). Full suites after 1.7: backend 945 unit + 473 integration, MCP 161, frontend tsc 0.
- **4.1 ✅** (migration `20261114230000_tasks_for_agents`: agent kinds `task_create` / `task_update`, `AiFeature.task_parse`, and `tasks:write` added to every token that had `learning:write`)
  - **Differs:** the token routes are a new, narrow `/api/tasks` (GET `?due=today|week|overdue|all`, POST, PATCH; `services/tasks/tasks.service.ts`), not the app's `/api/todos`: those serve the task screens (workspace tasks, attachments, multipart uploads), and a token must never reach any of that. Personal tasks only (`workspaceId` null), no delete; a due day means 18:00 his time. Logged and undone like every agent write.
  - Scope `tasks:write` ("Add and change your tasks" in Settings → Agents, on by default for a new token; checked by mouse, screen `screens/22`). MCP `list_tasks`, `add_task`, `update_task` (41 tools; the catalogue still fits the 40,000 budget). The brief: `tasks { dueToday, overdue, titles }`, a `Tasks:` line when any.
  - **One AI system:** `POST /api/todos/ai/generate` runs on the Claude client, `claude-haiku-5-5` (`TASK_AI_MODEL` overrides), a JSON-schema answer checked by zod, metered as `task_parse` under the cap; no key, the cap, an API error or an answer that doesn't fit all give 200 with the line kept as a plain task (`provider: "plain"`). The response keeps its shape, so the task input is untouched. `POST /api/docs/ai/generate` answers 410. `services/ai/` (Groq, Gemini, Cohere orchestrator, prompts) deleted; packages `groq-sdk`, `cohere-ai`, `@google/generative-ai` uninstalled. **Not done:** their keys are still in `backend/.env` (there is no `.env.example`; I don't edit the secrets file unasked). **Verified 11-14 night** with one real call (QA, $0.00013): "review the kafka rebalancing note tomorrow evening, high priority, tag kafka" → `provider: claude`, priority high, due tomorrow, tag kafka; the title kept "tomorrow evening" (the prompt could ask to drop date words from the title).
  - Tests: integration `tasks.test.ts` (2), `taskAi.test.ts` (rewritten, 5, fake Claude). Full suites after 4.1: backend 945 unit + 475 integration, MCP 162, frontend tsc 0.
- **4.2 ✅** (migration `20261114240000_decisions`)
  - `Decision` as the contract; `services/learningDb/decisions.service.ts`: `lookAgain` is a day after today or a span (`30d`, `6w`, `3m`); a verdict makes it reviewed; "look again later" reopens it on a new day; `GET /api/decisions?status=&project=&due=1`. A project named by key or name is found or made (like a session's). Agent kinds `decision_create` / `decision_update`, each undone.
  - MCP `log_decision`, `list_decisions` (43 tools; descriptions of the stage-2 tools shortened to stay under the 40,000 budget). The brief: `decisions { due[≤3], project[last 2 with why] }`, printed as "Look again today" and "Decided <day>: … because …" (a coding session opens knowing what was decided there).
  - Home **Look again** (`components/learning/home/LookAgain.tsx`, after the slip): a due decision's title, "Decided 14 Nov in second_brain because … · you expected: …", "Was this right?" with Right · Mixed · Wrong (outlined) and a quiet "Look again in 30 days"; a verdict opens one optional line (Enter saves, Skip). Hidden when none is due. Tested like a person on QA (`scratchpad/scripts/decision-qa.js`, light and dark: Right by mouse, a line typed key by key, Enter; the other sent back 30 days; both stored as expected; no page errors; detector clean). Screens `screens/23`–`24`.
  - Tests: integration `decisions.test.ts` (3). Full suites after 4.2: backend 945 unit + 478 integration, MCP 162, frontend tsc 0.
- **S3 Revise import ✅** (migration `20261114260000_imported_rows`; Ramin's answers 11-14 night: read **the live Revise database**; **Revise's topics are not imported**, "not needed")
  - `src/services/import/reviseImport.ts` (pure plan: notes and links → captures with their revisions, tasks → personal todos, quick notes, subjects matched by name or made once; days read with `dayFromReviseLabel`, a task due at its time or 18:00; files keep their links but lose their Cloudinary ids, so deleting a copy here never deletes Revise's file; reminders not brought; empty quick notes and anything that looks like a key, token or password left out unless `--keep-secrets`), `applyReviseImport.ts` (one transaction, every row remembered in `ImportedRow`), `scripts/import-revise.ts` (Revise read in one `BEGIN READ ONLY` transaction, SELECTs only, Revise's `timestamp` columns read as UTC; a dry run unless `--apply`; lists Revise's users when more than one has data).
  - **Differs:** Revise has three users; his data is under "Admin" (`dev-user-local-001`; "ramin" is empty, "Manik" is someone else and was never read beyond counts). His captures hold their text in the title (content empty).
  - Dry run shown, then imported on his yes into `dev@recollect.local` (a dump taken first, `recollect_dev-2026-11-14-2131.dump`): 2 subjects (TypeScript, Server), 9 notes, 3 links (uploaded `.md` files, as links), 32 revisions (24 done, 8 pending, all overdue), 22 quick notes. Left in Revise: 10 topics and their 8 revisions, 6 time blocks, 500 daily slots, 140 block logs, 38 debriefs and the rest; left out: 2 empty quick notes, 2 that hold API keys. A second dry run brings nothing. His Today reads fine through the service (no login used).
  - **Found:** two of his Revise quick notes hold what look like API keys (an `sk-ant-…` one and a `curl` with an `x-api-key` header); the format check printed the start of one into this session's log. Told Ramin to rotate them.
  - **The Recall test set can't run on real notes yet:** the import brought no docs (topics stayed in Revise), and his account has no real docs of its own; it waits for real notes (stage 8).
  - Tests: unit `reviseImport.test.ts` (7), integration `revise-import.test.ts` (1: the write path and a second run). `npm run typecheck` now covers `scripts/*.ts` too. Full suites after S3: backend typecheck 0, 958 unit + 484 integration.
- **Search ✅** (migration `20261114250000_doc_search`)
  - `Doc.searchText` (a doc's words: each block on its line, canvas boards' words, embed links) and `Doc.searchVector` (title weight A, words weight B, each as English stems **and** plain words, so "caches" finds "cache" and "lim" finds "limiter"), GIN-indexed. **Differs:** no save path writes the words. A trigger sets them to NULL whenever the content changes without them (so no path, today's or a future one, can leave old words), each search first writes the words of the searcher's docs that have none (the few edited since; raw SQL, so `updatedAt` stays; a doc changed between read and write is left for the next pass, checked by an md5 of the state), and the server's start writes the rest. That replaced the planned one-time backfill (`npm run search:reindex [-- --all]` exists for after an import or a change to how words are read). **Differs:** the vector is kept by the same trigger, not a generated column: Prisma reads a generated column's expression as a default and would put `DROP DEFAULT` in every later diff (checked: the diff is empty now). `searchText` is in the client's global `omit`.
  - `services/docs/docSearch.service.ts`: every word must match (its stem or a word's start); the whole query inside a title also matches (for what words drop: "C++"); order: a title holding the query, then `ts_rank`, then newest; own and shared docs (banned and archived out). The snippet is `ts_headline` (English, else plain words when English marked nothing), cut in code to the first block with a match plus the blocks after it while they fit (" · "), a block repeating the title skipped, at most 160 characters, marks as offsets. The 1000-doc scan and its text cache are gone from `agentDocs.service.ts`.
  - `GET /api/agent/docs?query=` (MCP `search_docs`, description updated; the catalogue is now 39,987 of 40,000 characters) and `GET /api/docs/search?q=&limit=` (the library; not on the token list).
  - Library: titles and subjects still filter at once; from 3 characters the text search answers after 180 ms and the list becomes best match first; a doc found by its text shows the matched block under its title with the words in ink 1 at 600 (DESIGN.md log). Tested like a person on QA (`scratchpad/scripts/search-qa.js`, light and dark: typed key by key, a body word, a plural, a word's start, nothing, a title word, a hit opened by mouse; no page errors; detector clean). Screens `screens/25`–`26`. **Not done:** phone width; the Ctrl K "Find" still searches quick notes only.
  - Tests: unit `docSearch.test.ts` (6); integration `doc-search.test.ts` (5: words written by search with `updatedAt` kept, dropped by a live save, a title change found at once, the start-up pass; stems, word starts, every word, "C++", the snippet's marks; who sees what; the library endpoint), `agent-docs.test.ts` (search order now best match first). Full suites after search: backend typecheck 0, 951 unit + 483 integration, MCP 162, frontend tsc 0.
