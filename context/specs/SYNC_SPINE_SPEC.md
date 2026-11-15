# Sync spine: build contracts for Phases 0 and 1

_2026-11-14 (night), written by Fable for the builder (Opus 5.5). It turns [ECOSYSTEM_PLAN](ECOSYSTEM_PLAN.md) §5 items 0.2 to 1.4 into contracts. [BUDDY_PLAN](BUDDY_PLAN.md) holds the reasons and the "B1 build spec" for what is already built. Where this file and BUDDY_PLAN differ, this file wins._

**Status: being built (2026-11-14 night): 0.2–1.4 ✅ (As built at the end). **Stopped at §8: Ramin's week of real use.** Add to "As built" as each item lands, and say where the build differs.**

**How to work through it**
- In order: 0.2, 0.3, 0.4, 1.1, 1.2, 1.3, 1.4. Then stop (§8).
- Names of tables, routes, fields and tools below are the contract. Anything not stated is the builder's call, held to ECOSYSTEM_PLAN §2 (six rules) and §8 (gates). If a contract turns out wrong in the code, change it, and write why in "As built".
- Each item ends with: typecheck, unit and integration tests green (backend from PowerShell), `npm run build` in `mcp/` after tool changes, the backend restarted, the README and the skill updated, STATE.md §6 and §7 updated.
- Migrations: next timestamps after `20261114180000_topic_paths`. Follow `backend/docs/MIGRATION_CONVENTIONS.md`.

---

## 0.2 Auto-start (S)

- `backend/scripts/start-recollect.ps1`: starts, in this order and each only if its port is not already listening: the dev database (:5433, `npm run db:start`), the backend (:8002, without watch), the frontend (:3005). Hidden windows; each writes a log under `backend/.devdb/logs/` (already ignored by git). A second run does nothing.
- `backend/scripts/install-autostart.ps1`: registers a Task Scheduler task "Recollect" that runs the script at the user's logon; `-Remove` deletes it.
- **Stop point:** this changes Ramin's machine. Write and test the scripts, then tell him the one command and let him run it (or run it on his yes).
- The builder's own dev tasks may already hold the ports: the script must leave them alone.

## 0.3 Hide "Ask AI to write" (S)

Remove the `ai` entry from the slash list in `recollect/lib/editor/blockTypes.tsx` (line 76 today). Leave the node, its view and the route for now: stored `inlineAi` nodes must still load. Full removal is Phase 3. Check like a person: type `/ai` in a doc, nothing offers it.

## 0.4 Drift guards (S)

Three tests, so the catalogue can't drift again:
1. **MCP README** (`mcp/test/unit`): every name in `TOOL_NAMES` appears in `mcp/README.md` in backticks, and the README's tool count equals `TOOL_NAMES.length`.
2. **Token budget** (`mcp/test/unit`): the JSON of all tool definitions (as `listTools` returns them) is at most 40,000 characters (31,619 today). When a new tool would break it, shorten descriptions; don't raise the number without Ramin.
3. **Every agent write is accounted for** (`backend/tests/unit`): each `TOKEN_ROUTES` entry that is not a GET is in exactly one of two lists kept beside it: `LOGGED` (route → the `AgentEditKind` it writes; the test also checks `undoEdit` has a case for every kind) or `SELF_LOGGED` (a short list with a reason each: the stateless canvas tools, and the session routes of 1.2, whose own list is their log).

## 1.1 Finish paths (M)

Already built: BUDDY_PLAN "B1 build spec" and its "As built". Left:

1. **`GET /api/today` gains `next`**: up to 3 entries, one per subject that has a path with something in progress or planned; subjects linked to an active goal first, then by the latest activity. Entry: `{ subject: {_id, name}, topic: {_id, title, position, status}, done, total, nextStep }`. `get_today` prints them ("Next up: …").
2. **`create_doc` takes `topicId`**: the note attaches to that planned or in-progress topic instead of making a new one; the topic takes the doc's title; `revise: true` marks it done and starts its revisions, otherwise it becomes in progress. 400 if the topic already has a doc or is in another subject than the one named.
3. **`update_doc`** (new tool) → `PATCH /api/agent/docs/:id` `{ title?, subject?, topicId? }`, scope `docs:write`, kind `doc_update`, Undo puts the old title and filing back. A title change must reach an open editor live, the same way agent writes do.
4. **The subject page shows the path**: an ordered list (done ticks, the current topic, what is ahead), "5 of 16", drag to reorder, a status menu per row, add a planned topic inline. **Home shows Next up**: at most three quiet rows under Today, each with a Start button that copies a ready prompt for a study chat (until 1.3: "Use the recollect tools. Read get_path for <subject>, then continue <topic>: <nextStep>"; from 1.3: "Start with get_brief, then continue <topic>").
5. **`backend/scripts/order-numbered-topics.ts`**: reads "01 · Title" style prefixes of a subject's docs into the path order and strips them from the topic titles; `--dry` prints what would change and is the default; it never touches a doc's own title without `--rename`.

**Stop point:** item 4 is taste-critical. DESIGN_RULES + DESIGN.md, light and dark, tested like a person; then show Ramin screenshots and go on with 1.2 while he looks.

## 1.2 Sessions, projects, weak spots (M)

### Data
```
WorkSession   id · userId · key? (unique per user, ≤ 80; null for a manual entry)
              kind: study | practice | build | review
              day (the user's local day it started) · startedAt · endedAt? · minutes?
              subjectId? · topicId? · projectId?
              title (≤ 200: what was done)
              scoreDone? · scoreTotal?                      (study: quiz 7 of 10)
              outcome?: alone | hints | after_answer        (practice)
              problem? (≤ 200) · url?                       (practice)
              nextStep? (≤ 300)
              details Json?   (build: { branch, commits: string[≤ 10] })
              source: agent | hook | user · agentName? (≤ 60) · createdAt · updatedAt

Project       id · userId · key (unique per user: the folder name, lower case) · name
              goalId? · nextStep? (≤ 300) · isArchived · createdAt · updatedAt

WeakSpot      id · userId · topicId? · subjectId? · text (≤ 160)
              status: open | cleared · source: session | recall · sessionId?
              createdAt · clearedAt?        unique (userId, topicId, lower(text))
```
The old Revise tables (`TimeBlock`, `BlockSessionLog`…) are unrelated: don't reuse them.

### API
| Route | Who | Does |
|---|---|---|
| `PUT /api/sessions/by-key/:key` | token scope **`sessions:write`**, or cookie | **Upsert.** Fields sent replace, fields left out stay; a new row without a kind is `study`; `kindIfNew` sets the kind only on a new row (the hook sends `build` this way, so it never overwrites a chat's kind). `project` (a key or a name) finds or makes the project. `weakSpots: string[≤ 10]` opens them on the topic (or subject); `cleared: string[]` clears them by text or id. `topicStatus` and `nextStep` go through the existing path update (kind `topic_update`, with its Undo) **only when they change something**. Answers the session and, when a topic is named, its path line |
| `POST /api/sessions` | cookie | A manual entry (no key) |
| `GET /api/sessions?days=14&kind=&project=&subject=` | scope `read` | Newest first, with totals per kind per day |
| `PATCH` / `DELETE /api/sessions/:id` | cookie only | Ramin corrects or removes any entry |
| `GET /api/projects` · `PATCH /api/projects/:id` | `read` · cookie | List; rename, link a goal, archive |

- New scope `sessions:write` in `API_SCOPES`, the token dialog in Settings, and the README. The migration adds it to every token that has `learning:write` (so Ramin's study chat keeps working).
- Session writes are **not** `AgentEdit` rows (a chat checkpoints many times; a hook writes every coding session; Home's "From your agent" must not flood). The session list is their log: each row shows who wrote it and Ramin can change or delete it. They go in `SELF_LOGGED` (0.4).
- A session counts as an active day in the rhythm (`services/learning/rhythm.ts`).

### Weak spots, both ways
- **Chat → Recall:** when Recall writes questions for a topic (`services/recall/prompts.ts`, on demand and the night batch), open weak spots of that topic are listed in the prompt with their ids: "ask about these first". A question may carry an optional `weakSpotId` (extend the output schema and its parser). An answer graded strong, or "Knew it", clears that weak spot.
- **Recall → chat:** an answer graded weak opens a weak spot on the topic (text = the question, clipped to 160; source `recall`). The brief shows it (1.3).
- No extra model call for any of this.

### UI (small, quiet)
- Home: one line under Today, "Today so far: 50 min study · 2 h build", opening a plain list of the last 14 days (edit, delete). No charts yet (that is the mirror, 1.7).
- Ctrl K: "log 40m graphs" makes a manual study session (minutes, the rest as title; a subject if a word matches one).
- Topic rows on the subject page show open weak spots as a count with a popover.

## 1.3 The brief, checkpoint, the study skill (M)

### `GET /api/brief?project=<key>` (scope `read`)
One service, `backend/src/services/brief/brief.service.ts`, composing through the existing services (`today.service`, `goals.service`, `path.service`, sessions, weak spots, Recall results). No query logic of its own that another service already has. The coach moves onto it in 1.7.
```
{ now:     { day, weekday, time, timezone },
  profile: string | null,                       // settings: "About me, for my agents" (≤ 600)
  goals:   [ { _id, title, deadline, daysLeft, progress, forecast, nextMilestone } ],
  week:    null,                                // filled by 1.6
  today:   { revisions: { planned, estMinutes, done }, focus: [ { _id, text, done } ] },
  next:    [ /* as /api/today.next, plus: */ { …, lastSession: { day, minutes, title, score } | null,
             weakSpots: [ { _id, text } ] /* open, ≤ 5 */ } ],
  recent:  [ { day, kind, minutes, title, subject?, project? } ],     // last 5 sessions
  recall:  { days: 7, finished, weakTopics: [ { title, weak } ] },    // ≤ 3
  project: { key, name, nextStep, lastSession } | null,               // only with ?project
  session: { key } }                            // a fresh key, "s_" + 12 chars; no row yet
```
- Settings → Agents gains the profile textarea (stored with the learning settings).
- Printed by the tool, the whole brief must stay under about 1,600 characters in the normal case. A unit test holds a full fixture to 2,400.

### MCP tools
- **`get_brief { project?, key? }`**: prints the brief; ends with "Session key: s_… (pass it to checkpoint)". With `key` it reuses that key (a Claude Code session whose start hook already printed one).
- **`checkpoint { key, kind?, title, minutes?, subject?, topicId?, project?, score?, outcome?, problem?, url?, weakSpots?, cleared?, topicStatus?, nextStep? }`** → `PUT /api/sessions/by-key/:key`. The description says plainly: call it after each part of the work, not only at the end; calling it again with the same key updates the same session.
- **`list_sessions { days?, kind?, subject?, project? }`**: for "where did my week go".
- `INSTRUCTIONS` in `mcp/src/server.ts` change to: start a working chat with `get_brief`; checkpoint as you go; writes are undoable. `get_today` and the others stay.
- Mind the 0.4 budget: three new tools, short descriptions.

### The skill `mcp/skills/recollect-study/SKILL.md`
Installed by `npm run install:skill` beside the notes skill (extend the installer to install both). The flow it teaches:
1. `get_brief`. Say in two lines where Ramin stands and propose today's piece from `next` and the weak spots; he may pick something else.
2. Teach in parts. After each part: a short quiz, then `checkpoint` (score, weak spots, what is next).
3. When a topic is finished: write or update its note with the notes skill (`create_doc` with `topicId`, `revise: true`), then `checkpoint` with `topicStatus: done` and the next step.
4. Practice (DSA): one `checkpoint` per problem with `kind: practice`, `problem`, `outcome`.
5. Never ask Ramin to log anything, and never wait for "the end" to write the record.

**Check with real runs** (as the diagrams plan did): at least three `claude -p` study chats on real topics; in each, the brief is the first call, there are two or more checkpoints, and a second chat on the same topic opens knowing what the first did. Our own test runs set `RECOLLECT_HOOKS=off` (1.4).

## 1.4 Claude Code hooks (S–M)

Facts checked against the Claude Code hooks reference on 2026-11-14 (re-read it before building: https://code.claude.com/docs/en/hooks):
- A `SessionStart` hook's plain stdout is added to the session's context (cap 10,000 characters). Its input has `session_id`, `cwd`, `source` (`startup`, `resume`, `clear`, `compact`, `fork`).
- `SessionEnd` fires once when a session ends, **with a default timeout of 1.5 seconds** (set the hook's own `timeout`, in seconds), and it can't block. Whether it fires when a VS Code panel or terminal is simply closed is not documented.
- Hooks run in the terminal, the VS Code extension and `claude -p` alike, and inside subagents (their input then has `agent_id`).
- The transcript file's format is internal and may change: **don't parse it.**
- On Windows hook commands run in Git Bash by default; a hook may name its `shell`.

### Design
One small script, `mcp/src/hook.ts` → `node "<path>/mcp/dist/hook.js" <event>`, no dependencies beyond the API client. Config in `~/.recollect/hooks.json`: `{ url, token, allow: ["E:/PERSONAL_PROJECTS/"], brief: true }`. The token has only `read` and `sessions:write`.

| Hook | Does |
|---|---|
| `SessionStart` | Outside the allow list, inside a subagent (`agent_id`), or with `RECOLLECT_HOOKS=off`: nothing. Else: first **sweep** (below); then note the session locally (`~/.recollect/open/<session_id>.json`: start time, cwd); then, when `brief` is on, print a short brief for this folder's project (`GET /api/brief?project=<folder>`) with the line "Session key: cc_<session_id>". On `resume` and `compact` it prints the brief again and opens nothing new |
| `UserPromptSubmit`, `Stop` | Append one timestamp to the local file. No network, no output. This is how active minutes are measured without reading the transcript |
| `SessionEnd` (timeout 10) | Close the session: `PUT /api/sessions/by-key/cc_<session_id>` with `kindIfNew: build`, `project`, `minutes`, `endedAt`, `details: { branch, commits }` (subjects of the commits made in that folder during the session), then delete the local file |
| The sweep | Any local open file whose last timestamp is over 30 minutes old is closed the same way. This covers a closed window that never fired `SessionEnd` |

- **Active minutes** = the sum of gaps between consecutive timestamps, counting no gap longer than 5 minutes. An estimate, and labelled so.
- **Not logged:** a session with under 2 active minutes or fewer than 2 prompts.
- **Never blocks Claude Code:** every network call has a 3 second limit and every failure is silent (one line in `~/.recollect/hook.log`).
- When the backend is down, the start hook prints nothing and the end data waits in the local file for the next sweep.
- A study chat in an allowed folder already has its key in context, so its `checkpoint` calls update the same row: no double entry.
- **`npm run install:hooks`** (in `mcp/`): writes `~/.recollect/hooks.json` (asks for the token once), merges the four hooks into `~/.claude/settings.json` after saving a backup beside it, and prints what it changed; `--remove` takes them out again.

**Stop point:** installing changes Ramin's Claude Code settings. Build and test with a throwaway settings file first (`claude --settings <file>`), then tell him and install on his yes. He makes the hook token himself in Settings → Agents.

## 8. Then stop: 1.5 is Ramin's week

After 1.4, report: what is built, what was tested and how, what was not, and the three or four things for him to try. He uses it for about a week. Meanwhile the builder may: write the deploy plan with prices for his approval (2.1), and take items from the polish lane (STATE §8). **Not** 1.6 or 1.7: the week and the mirror are designed from what his real sessions show, and each gets its own short spec first.

## 9. Things the builder must not do

- No new package that is GPL, AGPL or paid; pin exact versions at least two weeks old.
- No patches to the old editor beyond 0.3.
- No AI spend beyond small checks without asking; tests never call the API.
- No git push (Ramin pushes); commit only when he asks.
- Nothing that makes Ramin log by hand: if a record can't write itself, leave it out.

## As built

- **0.2 ✅** `backend/scripts/start-recollect.ps1` (`npm run up` in `backend/`; `-Status`, `-Restart <db|backend|frontend>`, `-Stop …`): starts each server only when its ports are free, hidden, appending to `backend/.devdb/logs/<name>.log` (its own actions to `start.log`); stops only processes whose command line is ours (the database with `pg_ctl stop -m fast`); the backend runs `npm run start:local` (ts-node, no watch). **Differs:** `install-autostart.ps1` (`npm run autostart`, `-Remove`) puts a **Startup-folder shortcut** "Recollect" (`conhost --headless powershell … start-recollect.ps1`) instead of a scheduled task: no admin, the servers are never tied to a task's lifetime, and Ramin can switch it off in Task Manager → Startup apps. Tested: status, a run that starts nothing, `-Restart` of all three (the old processes gone, login and `/api/today` answer), the shortcut made in a scratch folder and launched (it ran headless and logged), `-Remove`. **Not installed:** Ramin runs `npm run autostart` himself. The dev servers now run hidden this way (no longer the supervisor's background tasks): restart the backend with `npm run up -- -Restart backend`.
- **0.3 ✅** the slash item removed (`lib/editor/blockTypes.tsx`); `/ai`, `/write`, `/generate`, `/draft`, `/ask` offer nothing (checked in a real doc, typed key by key).
- **0.4 ✅** `mcp/test/unit/catalogue.test.ts` (the README names every tool and its count; tool JSON ≤ 40,000 characters), `backend/tests/unit/agent/agentWrites.test.ts` (`LOGGED` / `SELF_LOGGED` beside `TOKEN_ROUTES`; every kind written by a route). Undo is now a table keyed by `AgentEditKind` (`agentEdits.service.ts`), so a kind without an Undo fails typecheck: that is the "undoEdit has a case" check. The server test's fixed "29" now follows `TOOL_NAMES`.
- **1.1 ✅**
  - `/api/today` `next` (path.service `loadNextUpRows` + pure `nextUpOf`, and `nextUp(userId)` for the brief); "latest activity" = the later of `Subject.lastActiveAt` and the newest topic change; entries also carry `subject.color` (Home's swatch). `get_today` prints "Next up".
  - `create_doc topicId` (path.service `attachDocToTopic` / `detachDocFromTopic`); the answer has `topicStatus`; Undo of the create puts the planned topic back as it was (a revised one keeps the archived doc, like a made topic).
  - `update_doc` → `PATCH /api/agent/docs/:id` with **`subjectId`** (the tool takes a subject name, like `create_doc`); answers `changes` (words) and `editId` (null when nothing changed); kind `doc_update` (migration `20261114190000_doc_update_kind`); a rename goes through the live doc's `metadata` map; Undo restores the title only while the doc still has the agent's title. A doc already on a path can't be attached to another topic (409).
  - **Differs:** there was no subject page, so the path is a **"Path" view in the Docs library** (`components/docs/library/SubjectPath.tsx`; `/docs?subject=<id>`); Home's "Next up" (`components/learning/home/NextUp.tsx`, under Focus) has **"Copy prompt"**, not "Start" (a button names what it does). Shared marks and the prompt text: `components/learning/PathMark.tsx`.
  - `scripts/order-numbered-topics.ts` (pure parsing in `services/learningDb/numberedTopics.ts`, unit-tested): dry run by default, `--apply`, `--apply --rename`, `--subject`, `--email`. Tested end to end on a throwaway user in the dev database (then deleted). **The dev database has no numbered topics**, so on Ramin's data it changes nothing today.
  - UI tested like a person (`scratchpad/scripts/path-qa.js`, `home-next-context.js`): rail → path, three topics typed one after another (a bug found and fixed: the input lost focus while saving), Start it from the menu, a slow drag by the grip with the drop line, Move down, Copy prompt (clipboard read back), the row opens the path; light and dark; no page errors; the detector found nothing. **Not done:** the phone layout (Docs has none yet). **Sample data left on the dev user's System Design path:** Message queues (in progress, with a next step), Leader election, Sharding and partitioning (planned); `CLEAN=1 node path-qa.js` removes them.
- **1.2 ✅**
  - Migration `20261114200000_sessions_projects_weak_spots` (generated, renamed to sort after `doc_update`): `WorkSession`, `Project`, `WeakSpot` as the contract, plus `WeakSpot.textKey` (lower case, single spaces) for the one-per-text rule; tokens with `learning:write` got `sessions:write`.
  - `services/learningDb/sessions.service.ts`; routes in `learning.routes.ts` behind `scopeByMethod('sessions:write')` (a hook token holds only `read` + `sessions:write`); token allowlist: `PUT /api/sessions/by-key/:key`, `GET /api/sessions`, `GET /api/projects` (the rest is the app's). The PUT is in `SELF_LOGGED`.
  - **Beyond the contract:** a chat key `s_` + 12 carries its start second (`newSessionKey`), so an agent checkpoint without `minutes` gets the time since the brief (capped at 300) and `endedAt = now`; a new row without a title takes the first commit, "Worked on <project>", or the topic's title; a hook closing a session a chat wrote keeps the chat as its writer (source, agent name); `project.nextStep` follows a session's `nextStep` when the session has no topic. The answer is `{ session, topic, weakSpots, topicEditId }`.
  - Weak spots both ways: Recall's question task lists up to 5 open ones with ids (`questionsTask` 3rd argument; on demand and the night batch); the questions schema gained a required `weakSpotId` (empty when none); `answerRecall` then clears one on a strong answer / "Knew it" and opens one (the question, source `recall`) on a weak answer to a question that had none. No extra model call. `GET /api/subjects/:id/path` topics carry `weakSpots`.
  - Rhythm: `rhythmLast7` takes `sessionDays`.
  - UI: Home "Today so far: 45 min study" (else "Last session: …"), under the slip like "Your week" under the goal card, opening a Sessions sheet (14 days by day, edit title and minutes inline, remove); Ctrl K Task mode catches `log 40m graphs` on Enter before TaskInput sees it (TaskInput not touched), with an optional kind word (`log 1h build …`) and a subject named in the title; the path shows "2 weak spots" (a quiet chip, a popover).
  - Tested: unit (keys, weak-spot text, the task text, `weakSpotId` kept through storage), integration `sessions.test.ts` (5: checkpoints, refusals, the hook and scopes, by hand + rhythm, Recall both ways); full suites 932 unit + 461 integration. UI like a person (`scratchpad/scripts/session-qa.js`): typed `log 40m …` key by key, the line, the sheet, the inline edit, a checkpoint's weak spots in the popover; light and dark; no page errors; detector clean; the test's data removed.
- **1.3 ✅**
  - `GET /api/brief?project=&key=` (`services/brief/brief.service.ts`, `controllers/learning/brief.controller.ts`; token `read`): composed from `getToday` (goals, plan, focus, next), `getLearningSettings` (profile), the sessions service (recent, last session per next topic, open weak spots, the project) and the coach's evidence (`loadCoachRows` + `buildCoachEvidence`: Recall's last 7 days, ending yesterday as the coach's window does). `today.revisions` also has `waiting`. `session.key` is a fresh `s_` key, or `key` as sent.
  - Profile: `User.agentProfile` VARCHAR(600) (migration `20261114210000_agent_profile`), in the learning settings GET/PATCH; Settings → Agents → "About you, for your agents" (`components/settings/AgentProfile.tsx`: textarea, counter, Save enabled only on a change). Tested like a person (typed, saved, reloaded, the brief starts with it; then cleared).
  - MCP `get_brief`, `checkpoint`, `list_sessions` (`mcp/src/tools/record.ts`, listed first); `INSTRUCTIONS` now say: start with get_brief, checkpoint as you go. 33 tools; the tool JSON stays under the 40,000 budget (catalogue test). A full brief fixture is 1,650 characters (unit test ≤ 2,400). `checkpoint` answers with Undo only when it changed the topic (a `topic_update` edit).
  - Skill `mcp/skills/recollect-study/SKILL.md`; `npm run install:skill` installs both skills. Home's and the path's study prompt now says "start with get_brief … checkpoint as we go".
  - **Real runs** (Claude Code, `claude -p`, `scratchpad/agent-runs/run-study1|study2|dsa|dsa2.jsonl`; each loaded the study skill by itself): (1) Message queues: brief first, 2 checkpoints, a weak spot (exactly-once) and the next step; (2) the next chat opened knowing chat 1's weak spot, cleared it (2/2), wrote the note with `create_doc topicId revise` (attached, done, revisions from 15 Nov; canvas 9 boxes, no problems), finished the topic, next step "Start 8. Leader election"; (3) DSA practice: **found a flaw**: two problems under one key overwrote each other's outcome; the skill now gives each problem its own key (`<key>:1`, `:2`), and the re-run (dsa2) wrote two sessions. Minutes read "1 min": each run took under a minute.
  - Left on the dev user from these runs: the sessions, the "Message queues" note (done, scheduled), weak spots on BFS / DFS, topic edits under Home → From your agent (each undoable).
  - Full suites after 1.3 (re-run after the stop report): 932 unit + 462 integration. The report had quoted the 1.2 numbers; the re-run found one stale expectation (the settings defaults in `learning-loop.test.ts` lacked `agentProfile: null`), fixed.
- **1.4 ✅**
  - `mcp/src/hook.ts` (`dist/hook.js start|prompt|stop|end`), as the design: config `~/.recollect/hooks.json`, open sessions `~/.recollect/open/<session>.json`, the sweep, active minutes from its own timestamps, the 2-minute / 2-prompt floor, 3 s limits, silent failures to `hook.log`, exit 0 always. The brief is printed with the MCP's own `briefText`, under a one-line header. **Beyond the design:** commits come from the folder's repo and the repos directly inside it (his workspace is several repos); a resumed session whose first part was already logged gets its own key (`cc_<id>:r<time>`); test knobs `RECOLLECT_HOOKS_HOME`, `RECOLLECT_HOOKS_CONFIG`, `RECOLLECT_HOOKS_MIN_MINUTES`, `RECOLLECT_HOOKS_MIN_PROMPTS`.
  - `mcp/scripts/install-hooks.mjs` (`npm run install:hooks`, `--remove`, `--token`, `--allow`, `--url`, `--settings`, `--home`): asks for the token once; backs up `settings.json`; our hooks are the ones whose command runs `mcp/dist/hook.js`.
  - Tested: `mcp/test/unit/hook.test.ts` (7: allow list, minutes, the floor, the project name, the whole flow against a fake API in a scratch folder, the floor dropping a short session, the sweep). **A real run:** installed into a throwaway settings file with a throwaway token (read + sessions:write) and a scratch `~/.recollect`; a headless `claude --settings … -p` in an allowed scratch folder answered with the session key and the brief's first line from its context (so SessionStart's stdout reached the model), and SessionEnd logged the session (build, project = the folder, source hook). Then `--remove` emptied the hooks; the token was revoked and the session and project deleted. **Not tested:** an interactive session over minutes (the minutes floor and real commit subjects), a window closed without SessionEnd in real life (the sweep is unit-tested only), the VS Code extension (the docs say hooks fire there too).
  - **Not installed** on Ramin's machine: his Claude Code settings are untouched (stop point).
