# The manager (Ask AI), the doc backend and sharing

_2026-11-14 (late night), written by Fable for Ramin (to judge) and the builder (Opus 5.5). Ramin's asks: check the doc backend ("it is old"); sharing works the old way and may not work at all; and an Ask AI page that is "like a manager": it can reach everything in the app and do any action asked (schedules, tasks, docs, settings, goals). Plan it all and line it up so everything stays consistent._

**Status (2026-11-15): BUILT: stage 4 (the manager, §3), Ask AI inside a doc (§3.4 "the same engine with the doc in hand": DOCS_EDITOR_V2_PLAN phase 5) and §1–2 (the doc backend's fixes D1, D2, D3, D5, D6, D7, D8; sharing rebuilt); D9 backlog; "As built" at the end. Originally: PLAN. It adds stage 4 (the manager) and widens stage 5 (docs) of [ECOSYSTEM_PLAN](ECOSYSTEM_PLAN.md) §5 "Build order". The contracts here are firm enough to build from; each stage still starts with a short check of this file against the code as it then is.**

---

## 1. Review: the doc backend

Read: `docs.service.ts`, `docSharing.service.ts`, `docPermissions.ts`, the live-editing server (`collaboration/`), the routes and the tables.

**The core is sound and stays:** one permission module that every route and the live server use; one live editor for every doc; viewers connect read-only; agent writes go into the live doc with a snapshot and an Undo; images are cleaned up without touching what an Undo may still need.

**What is old or missing:**

| # | Finding | What to do | Where |
|---|---|---|---|
| D1 | **A legacy save route can overwrite a live doc.** `POST /api/docs/:id` turns editor JSON into a stored state. It belonged to the retired solo editor; nothing in the app calls it now, but it is still open | Remove the route, its client code and the offline store | Stage 5 |
| D2 | **Delete is final.** The owner's delete removes the doc, its history and its images at once. Agents have no delete at all, and a manager AI must not get a final one | **Trash:** delete moves a doc to the trash for 30 days; restore brings it back; a night job empties it | Stage 4 (the manager needs it) |
| D3 | **The doc's state is stored as Base64 text**, and rewritten whole on every save. Fine at his size, wasteful later | Store bytes (`bytea`) as part of the rebuild's migration, when every doc is rewritten anyway | Stage 5 · **done 2026-11-15** (As built) |
| D4 | **No plain text of a doc is kept**, so search reads the newest 1000 docs one by one | The full-text column of LOOP_COMPLETE_SPEC "Search" | Stage 2 (already planned) |
| D5 | **Snapshots and the edit log grow forever** | Pruning in the night jobs | Stage 6 (already planned) |
| D6 | **Live rights don't follow changes.** A demoted editor keeps writing until they reconnect; someone who leaves stays connected (known since the Mongo days) | A role change or removal closes that person's live connection at once; they reconnect with their new rights | Stage 5, with sharing |
| D7 | The live server's allowed web addresses are written in the code; an unused `shareToken` path is still read | Addresses from the environment; remove the dead path | Stage 5 (needed by the deploy) |
| D8 | `docType` (notes, meeting, project, personal) is a leftover: the library only passes it along | Drop it in the rebuild's migration unless the block audit finds a use | Stage 5 |
| D9 | No history a person can open (snapshots exist only for agent edits) | Backlog. With the manager editing docs, every one of its edits already has a snapshot and an Undo | Later |

## 2. Review: sharing

**Ramin is right: it is half-wired, and one part is a hole.**

- The owner can make a link (an old-style dialog). The link lives 3 days. Making a new one deletes the old links and requests **and lifts every ban**.
- Anyone with the link reads the doc on a public page that still has the old look. That part works.
- A logged-in visitor can ask for access; the owner gets an email. **But the panel where the owner approves was removed from the app, so the request can never be answered.**
- **Nothing in the app shows who has access**, changes a role or removes someone. The routes exist; the screens are gone.
- **The hole:** `POST /api/save/:slug` still lets any logged-in person who has a link join the doc at the link's role (an editor link → an editor) with no approval. The app no longer calls it, but it is open.

### The new model (Decided; Ramin can overrule): Notion's two ideas, nothing else

1. **Publish: "anyone with the link can view".** A switch on the doc. The link is stable until switched off (switching on again makes a new link); no 3-day expiry. Read-only, no login, drawn by the new editor in the app's look. **A link never gives edit rights.**
2. **People: named access.** Add someone by email as "can view" or "can edit" (they need an account; inviting people without one comes with Workspace). A logged-in visitor of a published doc can ask to edit; the owner answers **inside the Share popover** and gets a notification.

Gone: expiring links, editor links, the join-by-link route, bans (a removed person can ask again, and the owner can decline).

```
Doc              + publicSlug? (unique) · publishedAt? · trashedAt?
AccessRequest      shareLinkId removed (a request belongs to the doc)
ShareLink, DocBannedUser      dropped (every old link has expired)
```

| Route | Who | Does |
|---|---|---|
| `PUT /api/docs/:id/publish { on }` | owner | `{ url }` or off |
| `GET /api/public/docs/:slug` | anyone | The doc, read-only. Never a trashed doc |
| `GET /api/docs/:id/people` | owner (collaborators see the list without requests) | Owner, people with roles, pending requests |
| `POST /api/docs/:id/people { email, role }` · `PATCH …/:userId { role }` · `DELETE …/:userId` | owner (a collaborator may remove themselves) | Add, change, remove. The live connection follows at once (D6) |
| `POST /api/docs/:id/requests` · `POST …/:reqId/approve` · `/decline` | a logged-in visitor · owner | Ask; answer. A notification and an email |

- **UI:** one Share popover on the doc page (theme v2, Notion's pattern): the people list with roles, pending requests on top, and the Publish switch with "Copy link". The library gets a "Shared" filter. Taste-critical: screens.
- **Agents and the manager:** they may read a doc's sharing. Publishing or adding a person is an **outward** action: it needs Ramin's tap (§3.2).
- Built in stage 5, because the public page must be drawn by the new editor and a link is useless to others before the deploy anyway. **The hole is closed now:** stage 1 removes `POST /api/save/:slug`.

---

## 3. The manager: Ask AI

### 3.1 What it is

**Was it planned? Partly.** The plan had Ask AI *inside a doc*, on the tool catalogue (ECOSYSTEM_PLAN change 12, item 3.4), and said no chat page in the app until then. Ramin now asks for the full thing: **a page where he asks and the app acts, across everything.** That fits the design exactly, because of rule 1 (one catalogue): the manager is Claude with the same tools his coding agents use, running inside the app. Nothing new has to be invented for it to "reach everything"; it reaches whatever the catalogue reaches, and every tool added later reaches it the same day.

- **Where:** a page (`/ask`), Ctrl K ("Ask…"), and later inside a doc (the same engine with the doc in hand) and on the phone.
- **What it knows at the start:** the brief (the one picture) and his profile, the same as any agent.
- **What it can do:** everything in the catalogue (§3.3). Each write is labelled "Ask AI" under "From your agent" and can be undone, like every agent write.
- **Why have it when Claude Code can do the same:** on the PC his chats already are the manager, on his subscription. The page matters on the phone, away from an editor, and for other people later. **It runs on his API key, so each use costs money** (metered, under the monthly cap, shown in Settings → AI). Prices and the model per job are worked out at the start of stage 4 with the claude-api skill and shown to him before it is built.

### 3.2 "Any action" has three levels (Decided)

A manager that can do anything must not be able to do anything silently.

| Level | Actions | How it happens |
|---|---|---|
| **1. Read** | Everything he can see | At once |
| **2. Change, undoable** | Create and edit docs, goals, milestones, focus, paths, the week, sessions, tasks, decisions, reminders, revision dates, learning settings; **move a doc to the trash** | At once, logged, Undo |
| **3. Needs his tap** | Anything that leaves the app or can't be undone: publish a doc, add a person, send an email, change more than 20 things in one go, empty the trash | The tool does not act. It writes a pending **action** (a `Suggestion` of kind `action`: what it would do, in words, and the exact call). A card shows in the chat and under Suggested on Home: **Do it / Dismiss**. His tap runs it |
| **Never** | Password, tokens, deleting the account, the AI spend cap, other people's data | No tool exists |

- The same levels hold for outside agents (Claude Code, a phone chat): one rule for every caller. The level is a property of the tool, written beside it in the catalogue and checked by a test (every tool has a level; every level-3 tool goes through the pending action).
- Level 3 is also the guard against a doc or a web page that tries to give the model orders: text read by a tool is data, and the worst an order hidden in it can do is ask for his tap.

### 3.3 The catalogue must become whole first

"Everything on the app" is a checklist, not a promise. After stage 2 the catalogue covers docs (whole-doc and section edits), diagrams, subjects, paths, goals, focus, sessions, the week, tasks and decisions. **Missing for a manager, added in stage 4:**

| Area | New tools |
|---|---|
| Revisions | `complete_revision`, `move_revisions` (a day, a subject, or "spread the backlog"), beside `list_due` and `schedule_revision` |
| Reminders ("schedules") | `set_reminder`, `list_reminders`, `cancel_reminder` (on a task, or free-standing: "remind me at 7 pm") |
| Settings | `get_settings`, `update_settings` (daily budget, busy mode, the morning line's time, the profile). Not security |
| Docs | `trash_doc`, `restore_doc`, `get_sharing`; level 3: `publish_doc`, `share_doc` |
| Projects | `update_project` (name, goal, next step, archive) |
| Recall | `get_recall` (results and weak answers of a topic), so it can quiz him in the chat on what he gets wrong |
| Suggestions | `list_suggestions` (it can say what is waiting for his tap; it can never accept one) |

Fine edits inside a doc (insert, move, delete a block) arrive with the editor rebuild's block tools and reach the manager the day they exist.

**On "schedules":** the manager sets reminders and due dates, moves revisions and plans the week; from stage 6 it reads his Google Calendar to size the day. It does **not** get a time-block calendar: rigid blocks are what made him stop opening Revise (PRODUCT.md). Ramin can overrule this.

**Tool weight:** about 60 tools is too much to send to every outside chat. The catalogue gets **groups** (core, docs, plan, record, manage). The local and remote servers offer the core and docs groups by default and the rest on request (`RECOLLECT_TOOLS=all`, or a `more_tools` call); the manager always has all of them (its own calls cache the definitions). The 40,000-character budget then holds for the default set.

### 3.4 The engine (one, for the page, the doc and the phone)

- **The catalogue inside the backend:** the spike of change 12, done first. `mcp/` is an ES module and the backend is CommonJS, so the likely answer is that the backend talks to the catalogue's HTTP entry on the same machine (the entry remote chats need anyway). The spike decides; either way no second tool set is written.
- **`services/assistant/`:** a tool loop on the Claude client (load the claude-api skill first): streaming; at most 12 tool rounds per message; the spend cap checked before every round; the brief and the profile as the cached start; its writes carry the actor "Ask AI". Failures say what happened in plain words; a stopped loop says what it finished.
- **Threads:** `AssistantThread` and `AssistantMessage` (his words, the answer, the tools used with their results in short form). Kept 90 days, deletable. A thread that studies or works checkpoints like any chat, so the record stays whole.
- **The page:** a quiet chat in theme v2: the thread list, the answer streaming, each action as a small row ("Added task 'Book the mock' · Undo"), level-3 cards with Do it / Dismiss, and what the message cost in the corner. Taste-critical: screens.
- **Before it ships:** a fixed test set of about 25 real requests ("move tomorrow's revisions to Sunday", "what did I do this week?", "plan next week from my goal", "make a note on X with a diagram", "delete my three oldest drafts") with the tools each should use and the level each should hit. Run after every prompt or tool change. About a dollar or two per full run: ask first.

---

## 4. Where it all goes (the order is in ECOSYSTEM_PLAN §5)

| Stage | From this file |
|---|---|
| 1. Close the spine | Remove `POST /api/save/:slug` (the hole in §2) |
| 2. The loop complete | `Suggestion` already carries kind `action` and the proposer `ask_ai` (so the manager needs no new mechanism); every new tool is written with its level |
| **4. The manager** (new) | Levels on every tool and the pending action; the trash; the missing tools of §3.3 and tool groups; the catalogue in the backend; the engine, threads and the page; the test set |
| **5. Docs** (wider) | The editor rebuild as planned, plus: D1, D3, D6, D7, D8; sharing as §2 with the Share popover and the public page on the new editor; Ask AI inside a doc (the stage-4 engine with the doc in hand) |
| 6. Always-on parts | The manager on the phone layout; pruning (D5) and the trash's night job |

## 5. Risks, said plainly

- **Cost.** The manager is the first feature that spends API money every time he uses it. The cap protects the month; the model choice and prompt caching decide whether a normal day costs cents. Priced before stage 4 is built.
- **A manager that is wrong with confidence.** Mitigated by: numbers come from tools, not from the model; every change is listed with Undo; level 3 needs a tap; the test set.
- **Scope.** "Can do anything" grows forever. The rule: the manager gets a new power only as a catalogue tool with a level, a test and an Undo. No special cases in the chat code.
- **Sharing waits for stage 5.** Until then the Share button makes old 3-day links that others can read but nothing more. Acceptable while the app runs only on his PC.

## Stage 4, part 2: build notes (Opus 5.5, 2026-11-14 night, for the next session)

Part 1 is built (As built below). Part 2, in this order; the contract is §3.4 plus these notes.
1. **Threads ✅ (built 11-14 night: migration `20261114290000_assistant_threads`, `services/assistant/threads.service.ts`, `GET /api/assistant/threads`, `GET`/`DELETE /api/assistant/threads/:id`, cookie only, pruned by the hourly job; `assistant-threads.test.ts`)**: `AssistantThread { id, userId, title (from the first message), createdAt, updatedAt, archivedAt? }`, `AssistantMessage { id, threadId, role user|assistant, text, tools Json (each call: name, level, short input, short result, ok, editId?), usage Json, costUsd Decimal, createdAt }`; kept 90 days (the trash job's hourly cron can prune), deletable by him.
2. **The engine ✅ (built 11-14 night, tested with a fake model only; differs: the stream is per tool call and per answer, not token by token, because the app's Claude client is non-streaming; token streaming can come with the page)** `services/assistant/engine.ts`: `claude-sonnet-5-5` (`ASSISTANT_MODEL` overrides), effort low, streaming; tools = `openCatalogueFor(userId, ownBaseUrl)` (part 1) as Claude tool definitions; the system prompt = the manager's rules (levels in words: a level-3 tool only asks; never say an action is done when it waits for his tap; numbers come from tools) + his profile + `get_brief`'s text, with `cache_control` on the last tool and the system block (cached prefix ~17k tokens); at most 12 tool rounds per message; before every round the cap (`usage.service`, feature `assistant`) and stop cleanly when reached; every call metered (`pricing.ts` gains Sonnet 5.5: $2 / $10, cache read $0.10, cache write $2.50 (5 min)); a failed tool answers the model with its error text; a stopped loop says what it finished.
3. **API ✅ (built as `POST /api/assistant/messages { threadId?, text }`; `assistant-engine.test.ts`: a tool round then the answer, the doc made as "Ask AI", metering, the cached start, level 3 only asking, the 12-round stop, the cap)**: answering a stream (SSE: `text` deltas, `tool` start/end with the level and a one-line result, `done` with cost) and `GET` threads/messages; cookie only (the manager is his, in the app); not on the token list.
4. **The page ✅ (built 11-14 night; QA on the fake model, light and dark, 1024 and 390, error states; one real message through it: 9 s, 4.8 cents; screens `screens/30`–`37`)** `/ask` (taste-critical: screens): a thread list (left, compact), the conversation (720 column like a doc), each tool call as a small row ("Added task 'Book the mock' · Undo", Undo through the edit log), a level-3 call as a card with Do it / Dismiss (the same suggestion), the cost of each answer in meta, a composer at the bottom (Enter sends, Shift+Enter a new line), Ctrl K gains "Ask…". Light and dark; person-speed QA on the QA account with a **fake model** first (a stub engine behind an env flag), then one real run on his yes.
5. **The rest of §3.3's tools ✅ (built 11-14 night: `set_reminder`, `list_reminders`, `cancel_reminder`, `get_recall`, `get_sharing`, `spread_backlog`; 59 tools; `manager-tools-2.test.ts`, MCP `manage.test.ts`)** (each with a level, a test, an Undo): reminders (`set_reminder` on a task or a free one, `list_reminders`, `cancel_reminder`), `get_recall` (a topic's results and weak answers), `get_sharing` (read), spreading the backlog (level 3 when it moves more than 20). The catalogue's manage group takes them (the 40,000 budget is for the default groups only).
6. **The test set ✅ written (25 cases + `scripts/eval-manager.ts`: graded by code, every change undone after each case; `--fake` checks the runner for free)** (`backend/evals/manager.json`, ~25 real requests with the tools and the level each should hit) and its runner; a full run is about $1–2: **ask first**.

## As built

- **The engine streams, and Stop (2026-11-15 ~18:00):** §3.4's "the stream sends each answer whole" no longer holds: `runAssistant` calls Claude through `AiClient.streamMessage` (the SDK's beta stream; tool inputs not eager) and emits `delta { text, round }` as the words arrive; `POST /api/assistant/threads/:id/stop` ends a running turn (no further tool; what was done stays; `stopped: "stopped"`). The /ask page and the box in a doc both show the words as they come and a Stop. Detail: DOCS_EDITOR_V2_PLAN As built.

- **Stage 5, D3 done (2026-11-15 ~13:20, Opus 5.5): the doc's Yjs state is bytes.** `Doc.yjsState`, `DocSnapshot.yjsState` and `agentUpdate` are `bytea` (Prisma `Bytes`), by a hand-written migration (`20261115130000_doc_state_bytes`: Postgres decodes the Base64 in place, `ALTER … TYPE BYTEA USING decode(…, 'base64')`; the search trigger, which names the column, is dropped and made again around it; updatedAt and the docs' words untouched). `previewState` stays text (it is JSON).
  - **Code:** `services/docs/docState.ts` (`StateBytes`, `DocState` = bytes or Base64, `stateBytes`, `stateUpdate`, `stateBase64`): functions that read a state take either form; everything stored is bytes. The live server loads and stores bytes (no Base64 round trip on every save); agent snapshots and Undo use the bytes directly; search's refresh compares `md5(bytea)` with an md5 of the same bytes. **The doc JSON no longer carries `yjsState`**: nothing in the app read it (a doc is read through the live server), and it sent the whole doc as Base64 with every doc fetch. The public page's `state` stays Base64 (a JSON edge).
  - **Checked:** typecheck 0; 1006 unit + 511 integration (the migration ran on the test database first). **A dry run on a copy of his database** (`scripts/d3-dry-run.mjs`: the newest dump restored, the migrations applied, md5 of the decoded Base64 in the real database against md5 of the bytes in the copy): 59 of 59 docs and 26 of 26 snapshots byte-for-byte equal, every doc's words kept, `check-blocks` 58/58. **Then the real database**, after a dump (`recollect_dev-2026-11-15-1320.dump`): `migrate diff` afterwards is empty (no drift); `check-blocks` 58/58; `switch-qa.js` 7/7; an agent insert + Undo on the running server (`scratchpad/scripts/d3-live-check.js`, QA account). A doc of his was open in his browser during the restart: it reconnected, nothing changed.
- **Stage 5, Ask AI inside a doc (2026-11-15 ~13:00, Opus 5.5):** §3.4's one engine with the doc in hand, as DOCS_EDITOR_V2_PLAN phase 5 (its plan and As built hold the detail): `runAssistant({ doc })`, the same catalogue, levels and limits, the doc (with block ids and his focus) instead of the brief, metered `doc_ask`; a doc's asks are threads on the doc (`AssistantThread.docId`), not listed on `/ask`. A real ask costs about 1¢ warm, 5¢ cold.
- **Stage 5, sharing rebuilt (2026-11-15 late morning, Opus 5.5): §2 as written, with these differences.**
  - **Data** (migration `20261115100000_sharing_publish_people`, after a dump): `Doc.publicSlug` (unique) + `publishedAt`; `AccessRequest` without `shareLinkId` (its `role` defaults to editor: a reader asks to edit); `ShareLink`, `DocBannedUser` and the enum dropped. **Not every old link had expired:** 5 were still open (4 of Ramin's 3-day *editor* links made 11-13/14, one of another account's); the migration ended them 1-2 days early (they are in the 10:27 dump). His one pending request from another account was kept and now shows in the Share popover.
  - **Routes** (`services/docs/docSharing.service.ts`, `controllers/docSharing.controller.ts`, cookie only): `PUT /api/docs/:id/publish { on }` (owner; a trashed doc 409; `updatedAt` kept), `GET /api/public/docs/:slug` (anyone; a login cookie only adds `access` and, for someone with the doc, `docId`; never a trashed doc; `no-store`), **`POST /api/public/docs/:slug/request`** (logged in; by slug instead of §2's `POST /api/docs/:id/requests`, so only someone holding the live link can ask; a viewer may ask too), `GET/POST/PATCH/DELETE /api/docs/:id/people[/:userId]` (every change answers the whole popover state; the email is matched case-insensitively and a placeholder user is not an account: 404 `NO_ACCOUNT`), `POST /api/docs/:id/requests/:reqId/approve|decline`. Gone: `/api/create-doc-link`, `/api/doc/:slug`, `request-access`, `pending-requests`, `shared-by-me`, `collaborators/*`, the hourly link cleanup.
  - **The link:** `/p/<the title's first words>-<12 random characters>` (about 60 bits), stable until unpublished; publishing again makes a new one.
  - **What a reader gets:** a fresh Y.Doc with only the page (`blocks/publicState.ts`: the blocks, or the old content converted on the fly, and the boards of its canvases), never the doc's own state (after the switch that also holds the old editor's frozen copy, the metadata map and every board ever made). Drawn by the new editor, read-only, in the app's look (`app/p/[slug]`, `components/docs/public/`).
  - **Notifications and email:** a request → the owner (notification linking to `/docs/<id>?share=1`, which opens the popover; email); adding someone → them; approving → the requester (notification + email); declining sends nothing. Emails skip undeliverable addresses (`.local` and the like), so QA runs never mail. A notification with a link opens it (the bell's list).
  - **Live rights (D6) in the browser:** a demoted editor turns read-only within about a second; removal shows "You no longer have access". This needed a fix: `docApi.fetchDoc` dropped the server's `role`, so anyone opening a shared doc by its address got the owner's page (editable, owner menus) until a library visit filled the store; the page also defaulted to "owner" (now "viewer").
  - **Agents and the manager:** `get_sharing` reads the new model; **`publish_doc` and `share_doc` (level 3)** only ask (`POST /api/actions`: a card under Suggested with the exact words; his tap runs it). MCP: 66 tools.
  - **UI:** the Share popover on the doc page for everyone with access (the owner changes things; people see the list and can leave; the owner's button shows a neutral count while someone asks); the library's view is "Shared" (shared with him, or his and published or with people; a quiet globe or people icon after the title). The old dialog, `SharedDocViewer`, `PendingRequestsPanel` and `app/doc/[slug]` are deleted. Buttons rendered as links keep their look (`.rc a.rc-btn*` in rc-ui.css).
  - **Tests:** `doc-sharing.test.ts` (15, rewritten), `docs.test.ts`/`collab.test.ts`/`doc-search.test.ts` without bans, `manager-tools-2` (get_sharing), MCP `manage.test.ts` (+1); **in the browser** `scratchpad/scripts/share-qa.js` with two QA accounts (`qa2@recollect.local` from the seed): 17/17 in light and in dark (screens 63-86); `public-rich.js` (every block kind on the public page, light and dark, screens 87-88).
- **Stage 5, D6 done (2026-11-15 morning, Opus 5.5):** a role change (`PATCH /api/docs/:id/collaborators/:id`) now closes that person's live connections with code 4005 (`refreshUserAccess` in `collaboration/hocuspocus.ts`); their editor reconnects at once and the server authorizes it with the new role, so a demoted editor's writes are dropped from then on (integration test in `collab.test.ts`); removal already disconnected them. The doc page follows the live scope (`useCollaboration` exposes `readOnly` from the server's answer): typechecked, not tried in a browser (it needs two accounts). D3 and D8 wait for the editor switch's migration; sharing (publish + people) is not rebuilt yet.
- **Stage 4, part 2 built (2026-11-14/15 night, Opus 5.5).** Threads, the engine and its stream, **the page** (`/ask`; screens 30-37), **the last tools** and **the test set**. Differs from the notes above:
  - The stream sends each tool call as it finishes and the answer whole (the app's Claude client does not stream tokens). A tool event carries `detail` (the title or query it used), `suggestionId` (the card a call left; also for `spread_backlog` when it only asked) and, read back, `undone` and the card's state.
  - **A hard cap of 10 changes per message** in the engine (past it a change is refused and the model is told to ask), plus two rules: more than 5 changes, or "everything of a kind", asks first; the tool made for a job beats many small calls. Found by the test set ("move every doc I have to the trash" moved 20).
  - **QA runs on a fake model:** `ASSISTANT_FAKE=<emails>|all` on the backend's start (never in production) answers those accounts from a script that picks real tools by keywords (`services/assistant/fakeModel.ts`).
  - Reminders reuse the old todo reminders (a reminder is a task with a time; the email cron delivers it); a free-standing one makes its task, and its Undo deletes that task. `spread_backlog` is the app's fresh start (`freshStart`, which now reports each moved review for the Undo); over 20 it becomes the `spread_backlog` action.
  - Tests: `assistant-engine.test.ts` (3: incl. the fake, the cap), `manager-tools-2.test.ts` (6), MCP `manage.test.ts` (+3), `evalManager.test.ts` (2). The real test set: 25/25 after the fixes, about $0.31 a full run (cached).
- **Stage 4, part 1 built (2026-11-14 night, Opus 5.5): levels, actions, the trash, the first manage tools, groups, the catalogue in the backend.** The engine, threads, the page, the rest of §3.3's tools (reminders, `get_recall`, `get_sharing`, spreading the backlog) and the test set are part 2.
  - **Levels** (`TOOL_LEVELS` in `mcp/src/server.ts`, tested: every tool has one, read-only ⇔ 1, level 3 says "tap"). **Actions** (level 3): `POST /api/actions { action, input, reason }` (token, `SELF_LOGGED`) checks the action and keeps it as a pending `Suggestion` of kind `action` (`services/actions/actions.service.ts`: one executor table; asking again updates the same card; at most 10 waiting); Home's Suggested shows "Do it" (never in "Add all"); accepting runs it, cookie only. First action: `empty_trash`.
  - **The trash** (migration `20261114280000_trash_and_manager_kinds`): `Doc.trashedAt`; app routes `POST /api/docs/:id/trash|restore`, `POST /api/docs/trash/empty`; agent routes `POST /api/agent/docs/:id/trash|restore` (logged `doc_trash` / `doc_restore`, each undone by the other); owner only; out of lists and search; an hourly job deletes after 30 days; raw SQL so `updatedAt` stays. Library: "Move to trash" (toast with Undo), a Trash view (Restore, Delete for good, Empty trash, each final step asks first); the doc page: a quiet surface-2 bar (Restore, Delete for good). Screens `screens/27`–`29`.
  - **Agent writes opened** (each logged with an Undo): `POST /api/revisions/:id/complete` and `/reschedule`, `PATCH /api/learning/settings` (only the budget, busy-until, the morning email and the profile: anything else 403 `SETTING_NOT_ALLOWED`), `PATCH /api/projects/:id`. The token file's old rule "nothing that fakes his own actions" is rewritten: nothing permanent instead.
  - **MCP** (53 tools): the manage group `trash_doc`, `restore_doc`, `empty_trash` (asks), `complete_revision`, `move_revision`, `get_settings`, `update_settings`, `update_project`, `list_suggestions`; **groups** core, docs, plan, record listed by default (the 40,000 budget holds for these; `add_canvas` and `preview_diagram` descriptions were shortened to fit `more_tools`), manage on `more_tools` (the client is told the list changed) or `RECOLLECT_TOOLS=all`. The study skill turns them on to mark a review done.
  - **The catalogue in the backend (the spike, decided):** `mcp/src/embedded.ts` (`openCatalogue`: the same server, every group, an in-memory client) loaded by `backend/src/services/assistant/catalogue.ts` with a native dynamic import (CommonJS can't `import()` through tsc; under vitest its own `import()`), calling this API back over HTTP with the user's own token "Ask AI (built in)" (all scopes, kept in memory, a new one revokes the old). Checked by an integration test (52 tools with levels; `create_doc` logged as "Ask AI") and under ts-node against the running API. **Differs from §3.4's guess:** no HTTP entry for MCP was needed for this.
  - Tests: integration `manager-tools.test.ts` (5), `assistant-catalogue.test.ts` (1); MCP `manage.test.ts` (4), levels and groups in `server.test.ts`. Full suites after part 1: backend typecheck 0, 962 unit + 490 integration, MCP 167, frontend tsc 0. Then part 2's threads (+1 integration test).
- **Stage 4, priced (2026-11-14 night, Ramin's answers):** the manager runs on **Claude Sonnet 5.5** (about 4 cents for a typical message of three tool steps with the tool list cached, 8 cents cold; Opus 5.5 would be about twice that, Haiku 5.5 under a cent but weaker at multi-step requests). **The AI cap is $50 a month** for everything (Recall and the manager): `DEFAULT_MONTHLY_CAP_USD` 50, the column default 50 (migration `20261114270000_ai_cap_50`), his account's stored cap set from 30 to 50.
