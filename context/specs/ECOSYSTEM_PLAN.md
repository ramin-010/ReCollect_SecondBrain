# The ecosystem: system design review and the master work list

_2026-11-14 (night), written by Fable for Ramin (to judge) and for every later session (to build from). Ramin's ask: review the MCP and agent architecture, the canvas, and the app's own AI; say whether the whole design can deliver the buddy experience, not only whether each part works; change the plan where it can't; and line up all remaining work in one place._

**Progress (2026-11-15 ~12:40): stages 1–4 BUILT; stage 5 nearly done (the new editor live for every doc since the switch, sharing rebuilt, Ask AI inside a doc built 11-15; D3 and the old editor's cleanup left); stage 6 built locally and checked on his phone (what needs a public address waits for the deploy, incl. our own Android app, §10); stage 7 (the deploy) is Ramin's own work (his ruling, 11-15); stage 8 not started. STATE.md §6 has the detail.**

**Status: PLAN, approved by Ramin on 2026-11-14 (his answers are in §9). Built on 2026-11-14 night: Phase 0 and Phase 1 items 1.1–1.4 (SYNC_SPINE_SPEC "As built"). **Order revised the same night (Ramin: no waiting week; build everything, then deploy, then real-life testing): the build order at the top of §5 rules, and §11 is the review of what was built.** This file is the one work list; [BUDDY_PLAN](BUDDY_PLAN.md), [AGENT_DIAGRAMS_PLAN](AGENT_DIAGRAMS_PLAN.md) and [DOCS_EDITOR_V2_PLAN](DOCS_EDITOR_V2_PLAN.md) stay as the detail for their parts.**

---

## 1. The verdict

**The parts are sound. The system is not yet a buddy, for three reasons that are about design, not bugs:**

1. **Nothing happens unless a model chooses to call a tool.** Every tool is "pull". A study chat that loads the skill will write its record; a coding session never will, and a chat you simply close writes nothing. "A by-product of the work" needs capture points that don't depend on a model remembering (§4, change 1 and 2).
2. **"Where things stand" is worked out in several places.** Home, the coach, and each agent tool build their own picture from their own queries. They agree today because they share the same engine functions, but there is no single picture an agent, Home and the app's AI all read. The buddy needs one (change 3).
3. **It is only awake while three programs run on one PC.** The database doesn't start after a reboot; every agent call fails when the backend is down; no phone, no web chat, no night jobs. A buddy you have to start by hand is another app to manage (change 6 and 7).

There is also one risk outside the design, and it is the biggest: **the work is not saved anywhere but this disk** (§9, question 1).

**What is solid and stays:** one database; one rules layer in front of it (tokens are refused everything not on a list); every agent write is labelled, logged and undoable; writes can't happen twice on a retry; agent writes go live into an open doc; answers are short text with the ids the next call needs; the diagram language (agents never write coordinates); the AI spend meter and cap. 919 + 450 backend tests and 134 MCP tests cover it.

## 2. The system as it should be: one picture

```
 CAPTURE POINTS (where the record comes from, none of them a form)
   study chat (skill)      Claude Code (hooks)      the app itself         later: phone chat, calendar
   brief → checkpoint      start → brief, end → log  revisions, Recall      share menu
            │                       │                      │
            ▼                       ▼                      ▼
 ONE TOOL CATALOGUE  (defined once in mcp/; three ways in: local stdio · remote HTTP · the app's own Ask AI)
            │
 ONE RULES LAYER     (scopes per token, default deny, every write logged + undoable, retry-safe)
            │
 ONE STORE           goals → paths → week → today   ·   sessions (the record)   ·   notes, revisions, Recall
            │                                            projects · tasks · decisions
 ONE PICTURE         "the brief": where things stand, worked out by code in one service
            │
   ┌────────┼──────────────┬───────────────────┐
   ▼        ▼              ▼                   ▼
  Home    agents' brief   coach + Sunday      Ask AI
 "what now?"              proposals           (same tools, same picture)
```

**Six rules of the design (Decided):**
1. **One catalogue.** A tool is written once and works for every agent, local or remote, and for the app's own AI. No second tool set is ever written by hand.
2. **One picture.** "Where things stand" is composed on the server, in one service. Tools and screens only format it.
3. **Code computes, models write.** Every number, date and status comes from code. A model chooses words and meaning (the lesson of the ERP pipeline).
4. **Capture never depends on memory.** Each kind of work has a capture point that fires by itself (a hook, the app's own event) or can be called many times safely (a checkpoint). No "end of chat" step that loses everything when skipped.
5. **Proposals from the app, direct writes from a chat you asked.** What the app, the coach or a night job suggests waits for one tap. What an agent does because you asked is written at once and can be undone.
6. **A new noun is done only when it is everywhere:** table and service, API with a scope, logged with an undo, a tool, a line in the brief, a place on Home, tests. (The checklist in §8.)

## 3. Review

### 3.1 MCP and the agent side

| | Finding |
|---|---|
| Solid | Thin local server over the REST API; token allowlist checked before any route runs; 29 tools; undo for every write kind; retry-safe writes; errors written for an agent to act on; a notes skill that real runs followed (1–2 writes per full note) |
| **Gap: pull only** | No session record, no start-of-chat brief, no hook. Continuity between chats does not exist yet (BUDDY B2/B4 plan it; this review changes how: §4) |
| **Gap: the read side is thin** | An agent can't see Recall results or weak answers, the last session, what changed lately, or a project. `get_today` + `get_learning_overview` + `list_goals` + `get_path` are four calls to learn what one brief should say |
| **Gap: your work has no noun** | Subjects, topics, goals and focus lines exist. A **project** (Recollect itself, your job, a side build) does not, so a coding session has nothing to attach to. Tasks exist but tokens are refused them; decisions don't exist |
| Gap: doc edits are coarse | Create, append, replace a section, change a canvas. No insert at a place, edit one block, move, delete, rename a doc, or move it to a subject. The block tools come with the editor rebuild (DocOps); **doc details (title, subject, topic) don't need to wait** |
| Gap: search | Substring match over the newest 1000 docs. Fine today, wrong at a few thousand notes. Postgres full-text search fixes it with no new dependency |
| Weight | The 29 tool definitions cost about 7,900 tokens in every chat that loads them; a third is the three diagram-writing tools. About 10 more tools are planned. Needs a budget (§8) |
| Drift | The MCP README still said "20 tools" and described canvases as not updatable (fixed today). Nothing checks docs, allowlist and undo against the tool list |
| Identity | One token, and the agent's name is whatever its environment says. Fine for you alone; a hook or a phone chat should get its own token with only the scopes it needs |

### 3.2 The canvas: do agents have complete control?

**Over what a diagram says: yes, and reliably. Over where the pixels go: no, on purpose.** Models place boxes badly, and your own arrangement must win over an agent's.

| An agent can | An agent cannot (by design) | Real gaps |
|---|---|---|
| Add, remove, rename boxes; set shape, kind (icon), colour | Set x, y, width or height | **Layout hints**: no way to say "database at the bottom" or "these three in one row". Add only if real notes show the need (ELK supports it) |
| Add and remove arrows; label, dashed, two-way | Draw an arrow's route | **Mermaid can't be seen**, only checked: `preview_diagram` draws canvases only |
| Zones: add, nest, rename, remove, grow | Move a box you placed (unless it asks for `relayout`) | **Deleting a board** (or any block) waits for the editor rebuild's block tools |
| Notes; direction; lay the whole board out again | | Boards over about 20 boxes read small; the answer says "split it" |
| Rewrite the whole text and keep every place you set | | |
| Put a board anywhere in a note (a fence in the Markdown); see it as a PNG; get problems named after every write | | |

Verdict: nothing to redesign. Two small additions go on the list (layout hints on evidence; delete with DocOps).

### 3.3 The app's own AI (Recall, practice note, weekly coach, old "Ask AI")

| | Finding |
|---|---|
| Solid | One Claude client, one spend meter, a monthly cap, structured outputs checked before use, evidence gathered by code, refusals handled, tests never call the API |
| **Two AI systems** | The old "Ask AI to write" and the `@ai` task parser still run on a chain of six fallbacks across Groq, Gemini and Cohere: unmetered, unchecked output, three more keys. It should be one client and one meter |
| **Three silos** | Recall, practice and coach are three separate single calls. That is right for them. But "Ask AI" needs a tool loop, and there is no shared way to run one yet. It must run on the same catalogue as agents (rule 1), not a new set of functions |
| Not connected to chats | What you get wrong in Recall never reaches your study chat, and what the chat finds weak never reaches Recall. This two-way link is the point of the session record |
| Unchecked numbers | The coach writes numbers from the evidence itself. Code should compute and check them |
| Not measured | No test set. About $0.14 of checks so far. Tuning prompts without one is guessing |
| Asleep | The night batch is off in dev, and nothing runs when the PC is off |
| Model use | Opus 5.5 at low effort for everything. Right for questions, grading, the coach and Ask AI. Parsing a task line or summarising a session should use Haiku 5.5 |

## 4. Changes to the plan (Decided unless marked)

| # | Change | Why | Where it lands |
|---|---|---|---|
| 1 | **Checkpoint, not wrap-up.** `get_brief` hands the chat a session key. `checkpoint` writes the session under that key and can be called again and again (after each part, each quiz). The last call is the record | Chats don't end, they get closed. A single end-of-chat call is the step most often skipped | B2 + B4 |
| 2 | **Claude Code hooks, moved up from "later".** On session start: print the brief into the session and open a session row. On session end: close it with active minutes (from timestamps the hook keeps itself), project, branch and commit subjects. Only in folders on an allow list; other folders log nothing | This is the only capture point that needs no model to remember. It is what makes "in sync with where I spend my time" true for coding | New slice H, right after B4 |
| 3 | **One picture: `GET /api/brief`.** Composed on the server from goals, paths, the week, today, the last sessions, weak spots and Recall results. `get_brief` only formats it. Home's "what now", the coach and Ask AI read the same service | Today the picture is assembled in four places, one of them inside the MCP client | B4, then C moves the coach onto it |
| 4 | **Projects, a small noun.** Name, a key (the repo folder), an optional goal, a next step. Made by the first session logged from a folder. No boards, no project management | So build sessions attach to something and a session in a repo opens with "last time here… next…" | B2 |
| 5 | **A profile text in the brief.** "About me, for my agents": at most 600 characters, edited in Settings → Agents; agents may propose changes once suggestions exist (change 9) | Every chat then starts knowing how you learn instead of being told again | B4 |
| 6 | **Auto-start now.** The database and backend start when Windows starts | Until the deploy, this removes "is it running?" from your day | Phase 0 |
| 7 | **Deploy before the editor rebuild** _(Ramin agreed, 11-14)_ | The deploy unlocks always-on, web and phone chats, night jobs and notifications. The rebuild improves a screen that already works after the QA pass | Phase 2 before 3 |
| 8 | **Order inside B: paths → sessions → brief + study skill → hooks → a week of real use → the week → mirror** | Brief, checkpoint and hooks are what make it feel connected. The week is planning on top and is better designed from real session data | Phase 1 |
| 9 | **One mechanism for proposals.** A `Suggestion` row (kind, what it would do, who proposed it, pending / accepted / dismissed) and one "Suggested" place on Home | The Sunday review, the coach's focus lines and "next topic" would otherwise each grow their own card and their own accept code | B3 |
| 10 | **`update_doc`** (title, subject, attach to a planned topic), with `create_doc topicId` | Agents can't fix a wrong title or filing today; it doesn't depend on the editor | B1 |
| 11 | **One AI system.** Remove "Ask AI to write" (slash item, node, route). Move the `@ai` task parser to the Claude client on Haiku 5.5 with a checked output, then delete the Groq/Gemini/Cohere code and keys | One client, one meter, one cap | Phase 0 (the slash item) and F (the parser) |
| 12 | **Ask AI runs on the catalogue.** The backend connects to the same tool definitions as a client and gives them to Claude. A `mcp/` HTTP entry serves remote chats and this. Detail decided in a short spike | Rule 1. Every new tool or block reaches Ask AI on the day it is added | Phase 2 (HTTP entry), Phase 3 (Ask AI) |
| 13 | **A scope per job.** New scope `sessions:write`; the hook's token has only that and `read`. One token per agent | A hook that can only log sessions can't damage anything | H |
| 14 | **Drift guards** (tests): the README lists every tool; every write a token may make has a log kind with an undo; tool definitions stay under a token budget | The README had already drifted | Phase 0 |
| 15 | **Search on Postgres full-text** | Reliable "find my note on X" at any size, no new dependency | Phase 2 |

**Kept as decided before:** no required log ever; no calendar or time blocks in the app; ~~no chat window in the app until Ask AI lands on the editor's tools~~ (changed 11-14 late: Ramin asked for an Ask AI page that manages everything; it is stage 4, [MANAGER_AND_DOCS_PLAN](MANAGER_AND_DOCS_PLAN.md) §3); no embeddings or vector search (nothing free fits the licence rule, and full-text is enough at your size); agents never delete docs, goals or subjects.

## 5. The master work list

Sizes: S = hours, M = a day or two, L = several days. Each item names its detail doc. **The contracts for Phases 0 and 1 are in [SYNC_SPINE_SPEC](SYNC_SPINE_SPEC.md); build from that file.**

### Build order (revised 2026-11-14 late night; this order rules, the phase tables below are the catalogue)

**Ramin's ruling:** he will not wait a week between building steps. Build everything planned, then deploy, then test it in real life. This reverses "deploy before the editor rebuild" (§9 answer 2): the editor now comes before the deploy.

**What Fable kept from the old order:** using it does not need the deploy. The app, the MCP server and the hooks all work on his PC today, so he can use each piece as it lands while the build goes on, and what he notices is fixed at the next stage boundary. The waiting week is gone; the feedback is not.

| Stage | What | Items | Size | Needs Ramin |
|---|---|---|---|---|
| **1. Close the spine** | The review's fixes (§11); his data parted from test data, a daily local dump; hooks installed and checked in the VS Code extension | 1.5 (now the fixes, not a waiting week) | S | install (5 min); say which data is his; a cent of AI |
| **2. The loop complete** | The week and the one Suggested place; the mirror and the coach on checked numbers; tasks for agents and one AI system; the decision journal; full-text search | 1.6, 1.7, 4.1, 4.2, search (from 2.3) | M + M + M + S + S | looks at screens (not blocking) |
| **3. Real notes in** | Revise import (dry run, then his yes); the Recall test set on real notes | 4.4, part of 1.7 | M | approach, yes to import, about $1 of AI |
| **4. The manager (Ask AI)** | Ramin's ask (11-14 late): a page where he asks and the app acts, across everything. Levels on every tool and "needs your tap"; the trash; the missing tools (revisions, reminders, settings, sharing, projects) and tool groups; the catalogue inside the backend; the engine, threads and the page; a test set | new; takes over 3.4 and change 12 | M + M + M–L | approves the price per use; about $2 of AI for the test set |
| **5. Docs: the editor rebuild, the doc backend, sharing** | Notion measured, the spike, editor core and blocks, DocOps and block tools, migration and switch; the doc backend's old parts; sharing rebuilt (publish + people) with the public page on the new editor; Ask AI inside a doc; cleanup | 3.0–3.3, 3.5, plus [MANAGER_AND_DOCS_PLAN](MANAGER_AND_DOCS_PLAN.md) §1–2 | L + L + M + M | logs into Notion for REA; signs off the switch |
| **6. Ready for always-on, built locally** | Phone layouts on the new editor (the manager too), installable; the morning notification; remote MCP with its login; night jobs, pruning and the trash's emptying (run locally); the wallpaper and widget drawing; calendar read; share target; canvas extras; the polish lane; honest landing copy | 2.2, 2.3, 2.4, 2.5a, 4.3, 4.5 | M–L | his phone model |
| **7. Deploy** | The plan with prices first; then EC2, HTTPS, dumps, error reporting, his data moved; the checks only a server allows: claude.ai's connector, the phone install, notifications, the wallpaper trial, a shared link opened by someone else | 2.1, 2.5b | L | approves the cost; phone in hand |
| **8. Real life** | Two weeks on every surface, then the fix list; the Android shell (2.5c) only if he keeps the wallpaper; then "for other people" | — | — | uses it |

**Contracts:** stages 1–3 in [LOOP_COMPLETE_SPEC](LOOP_COMPLETE_SPEC.md); stage 4 and the doc backend and sharing of stage 5 in [MANAGER_AND_DOCS_PLAN](MANAGER_AND_DOCS_PLAN.md); the editor of stage 5 in [DOCS_EDITOR_V2_PLAN](DOCS_EDITOR_V2_PLAN.md); stages 6 and 7 each get a short spec when they start.

**Why this order inside "everything":** each stage feeds the next. The week and the mirror need only the record (built). Tasks and decisions are small nouns that the week can point at. The import comes before the editor so the migration is tested on his real notes, and before the Recall test set, which needs them. The manager comes when the catalogue is whole for everything but fine doc edits, and before the editor, so the block tools have their main user waiting the day they land. Sharing is rebuilt with the editor because its public page is drawn by it. Phone layouts come after the editor so the note screen is built once. The deploy is last because nothing before it needs a server.

**What this order costs, said plainly:** the week and the mirror are designed without real session data, so expect to adjust them in stage 8; and the phone, claude.ai chats and night jobs arrive last. Both are accepted by Ramin's ruling.

### Phase 0: safety net (before more building)
| # | Item | Size | Needs |
|---|---|---|---|
| 0.1 | ✅ **Save the work** (11-14): `recollect` `28737f0` and `backend` `a4675fa` on `pg-migration`; a new root repo (`main`, `045c978`) for `STATE.md`, `context/`, `mcp/`, `.claude/skills`, `Study/`, `prototype/`. **Ramin pushes**; the root repo needs a new private remote | S | done; push is Ramin's |
| 0.2 | Auto-start the database and backend at Windows start | S | — |
| 0.3 | Hide "Ask AI to write" (one line now; removed fully in Phase 3) | S | — (Ramin said yes) |
| 0.4 | Drift guards: the three tests of change 14 | S | — |

### Phase 1: the sync spine ([BUDDY_PLAN](BUDDY_PLAN.md) B, reordered)
| # | Item | Size | Needs |
|---|---|---|---|
| 1.1 | **Finish B1 paths**: Today's `next`; `create_doc topicId`; `update_doc`; the subject page's path and Home's Next up; the script that reads "01 ·" prefixes into the order | M | — |
| 1.2 | **B2 sessions**: the session table with a key (checkpoint), kinds study / practice / build / review; projects; weak spots into Recall and Recall results back out; the quick manual log; the last session on Home | M | 1.1 |
| 1.3 | **B4 brief + study skill**: `GET /api/brief` (the one picture), `get_brief`, `checkpoint`, the profile note, the `recollect-study` skill, the Start prompt, new server instructions ("start with the brief, checkpoint as you go") | M | 1.2 |
| 1.4 | **H hooks**: session start and end for Claude Code, the folder allow list, `sessions:write`, `npm run install:hooks` | S–M | 1.3 |
| 1.5 | ~~A week of real use~~ → **close the spine** (11-14 late: the review's fixes, his data parted from test data, hooks checked in VS Code). Real use runs beside the build; the judged period is stage 8 | S | 1.4 |
| 1.6 | **B3 the week**: 3–5 targets, the `Suggestion` mechanism, the Sunday review card, week tools | M | 1.5 |
| 1.7 | **C mirror**: pace and forecast from paths and sessions; the coach reads the brief's service, code computes and checks its numbers; DSA outcomes; **a Recall test set of about 20 real notes before any prompt tuning** | M | 1.2 |

### Phase 2: always on (the deploy)
| # | Item | Size | Needs |
|---|---|---|---|
| 2.1 | EC2: Postgres, backend, live editing, frontend, HTTPS, nightly dumps, error reporting; AI limited to Ramin's account; the landing page says only true things | L | 0.1 |
| 2.2 | **Remote MCP**: the catalogue's HTTP entry at `/mcp`, with the login claude.ai expects (check: it likely needs OAuth, not a pasted token) | M | 2.1 |
| 2.3 | Night jobs on: the Recall batch, the Sunday proposal, the morning line, pruning of old snapshots and edit logs; full-text search | M | 2.1 |
| 2.4 | Phone 1–2 (Android): the phone layout for Today, Recall, reading a note and capture; installable; one quiet morning notification. Ramin's bar: "great and smooth", or it isn't worth having | M–L | 2.1 |
| 2.5 | **The ambient phone** (Ramin's idea, 11-14; §10): a wallpaper and a widget about his day. (a) the server draws them from the brief; (b) a week's trial through a phone automation app, no native code; (c) if he keeps using it, a small Android shell app with a real widget | S–M, then M–L | 2.4, 1.3 |

### Phase 3: the editor rebuild ([DOCS_EDITOR_V2_PLAN](DOCS_EDITOR_V2_PLAN.md), AGENT_DIAGRAMS step 6)
| # | Item | Size | Needs |
|---|---|---|---|
| 3.0 | Measure Notion with REA (Ramin logs in), the spike, the block audit (§11 there). Stop and report if the spike fails | M | — |
| 3.1 | Editor core, then custom blocks (callout, diagram, canvas ported, tables) | L | 3.0 |
| 3.2 | Server: DocOps, Markdown dialect v2, block tools for agents (`get_outline`, insert, update, move, delete), checks at every boundary | L | 3.0 |
| 3.3 | Migration of every stored doc, then the switch; the public viewer; Markdown paste | M | 3.1, 3.2 |
| 3.4 | **Ask AI** in a doc, on the catalogue (change 12): a tool loop with a turn limit, the cap checked each turn, doc text marked as data, edits live and undoable, a small fixed test set before it ships | M | 3.2 |
| 3.5 | Cleanup of the old editor and the old AI chain | S | Ramin signs off 3.3 |

### Phase 4: the rest of life
| # | Item | Size | Needs |
|---|---|---|---|
| 4.1 | F tasks, light: agents add, list and tick personal tasks; dated tasks on Today; the `@ai` parser on Claude | M | 1.3 |
| 4.2 | F decision journal: decided what, why, expected, look-again date; comes back on Today | S–M | 1.3 |
| 4.3 | G: read Google Calendar to size the day; share-to-Recollect on the phone; Telegram only if wanted | S each | 2.1 |
| 4.4 | Revise import, then retire Revise | M | Phase 1 |
| 4.5 | Canvas: layout hints (on evidence), Mermaid preview for agents, the follow-ups in STATE §8 | S each | — |

**The polish lane (STATE §8):** theme leftovers, the Settings shell, Home follow-ups, the Mongo-era issues, the phone header. Not scheduled; take one or two with each phase when they sit next to the work.

**For other people (BUDDY_PLAN §10):** after it works for Ramin for a month: accounts that pay for their own AI, path templates, the phone stages.

## 6. What "connected" will look like, as a check on the design

1. **Morning, phone or PC.** Home says: 3 to revise (12 min), next: Caching part 2, this week 2 of 4 targets. _(today + paths + week, from the one picture)_
2. **You open a study chat.** It calls the brief, already knows you got "write-behind" wrong in Recall yesterday, starts there, teaches, quizzes, checkpoints twice. You close the tab. _(nothing lost: change 1)_
3. **You open Claude Code in `second_brain`.** The hook prints: "Last here Thursday, 90 min: paths backend. Next: Today's next line." You work. On exit the session logs itself. _(change 2, 4)_
4. **Evening.** Home shows the day: 50 min study, 2 h build, the topic moved to done and its note is scheduled for revision. You typed none of it.
5. **Sunday.** One card: last week in a line, three proposed targets, one coach suggestion. One tap. _(change 9)_

If any step needs you to type a record or start a server, the design has failed at that step.

## 7. Risks, said plainly

- **Hooks are specific to Claude Code.** Other editors and claude.ai have no such hook; there the skill and checkpoints carry it, and a chat that never calls a tool leaves no record. Honest limit.
- **Active minutes are an estimate** (gaps over five minutes are not counted). Good enough for "where did my week go", not for billing.
- **The brief can grow.** It is held to about 400 tokens by default, with more on request.
- **Privacy at work.** Commit subjects from your job's repos should not leave that machine; the allow list is the guard, and off-list folders log nothing.
- **Deploy cost and upkeep** are new monthly work. To be priced before 2.1 starts.
- **Checked on 11-14:** the hook inputs and limits (in [SYNC_SPINE_SPEC](SYNC_SPINE_SPEC.md) 1.4; whether the end hook fires when a window is just closed is not documented, so the design sweeps up unclosed sessions). **Not verified yet:** what login claude.ai needs for a remote MCP server (2.2); how the backend best loads the catalogue for Ask AI (`mcp/` is an ES module, the backend is CommonJS: the spike in change 12).

## 8. Standing gates (so the ecosystem stays organised)

**A noun is done when:** table + service · API route with a scope, on the token allow list · every write logged with an undo case · a tool with a compact answer · a line in the brief · a place on Home · unit and integration tests · README and the skill updated.

**A tool is done when:** it answers in short text with the ids the next call needs · its errors say what to do next · a real Claude Code run used it without help · the tool definitions stay under the budget (10,000 tokens; 7,900 today).

**An AI feature is done when:** code gathers the evidence and computes every number · the output is checked before it is stored · the call is metered and under the cap · it has a small fixed test set · a failure leaves a plain fallback, never a blank.

**Every UI change:** DESIGN_RULES + DESIGN.md, light and dark, tested like a person.

## 9. Ramin's answers (2026-11-14)

1. **Save the work: yes.** The supervisor commits, Ramin pushes. Done as 0.1.
2. **Deploy before the editor rebuild: yes.**
3. **Hooks: yes**, from an allow list of folders starting with `E:\PERSONAL_PROJECTS\`, with commit subjects and a short brief at session start.
4. **Hide "Ask AI to write": yes. The week: Monday to Sunday, review on Sunday. Phone: Android; the installed web app, if it works "great and smooth"; no Telegram asked for.**
5. **New ask:** a wallpaper at a particular time or by how his day has been, or a dynamic wallpaper or widget on the home and lock screen about his day and tasks (§10).
6. **"Don't start building yet, wait for my instruction."**

## 10. The ambient phone: wallpaper and widget (Ramin's idea; Fable's reading)

**It fits the design well.** A wallpaper or widget is one more reader of the brief (rule 2): you see where you stand without opening anything and without a notification. The server already turns drawings into PNGs (the canvas preview), so a wallpaper is a new drawing, not a new system.

**What an installed web app can't do on Android:** set the wallpaper, add a home-screen widget, or put anything on the lock screen except notifications. All three need a native piece. So:

| Step | What | Native code |
|---|---|---|
| a | The server draws `wallpaper.png` (for the phone's size, light or dark) and answers a small `widget` summary, both from the brief | none |
| b | **A week's trial:** a phone automation app (MacroDroid or Tasker) fetches the picture at set times and sets it as home and lock wallpaper. Proves whether he likes living with it | none |
| c | If he keeps it: a small Android shell app that opens Recollect full screen, ships a real home-screen widget, and sets the wallpaper itself on a schedule or when the day changes. Installed from a file, no store | Kotlin (Apache licence tools) |

**Decided (Ramin, 2026-11-15):** step a is built (ALWAYS_ON_SPEC 6.6, checked on his phone). **No automation-app trial (b): we build our own Android app (c) after the deploy**, so the wallpaper, the lock screen, a home-screen widget and any customisation are ours. Its short spec: [ANDROID_APP_SPEC](ANDROID_APP_SPEC.md) (2026-11-15). **The deploy itself is Ramin's own work (his ruling, 2026-11-15): the builder does development only.**

**States, not statistics** (so it never becomes a guilt wall, the lesson of Revise):
- Morning: what today holds ("3 to revise, about 12 min · next: Caching part 2").
- Working hours: calm; at most the day's focus line.
- Evening: how the day went, in one line.
- Day done: a clean, good-looking wallpaper with nothing to do on it. That is the reward; no streaks or points.
- Busy and comeback modes: lighter. Never red, never an overdue count as the headline.

**Open points:** titles show by default (Ramin, 11-14: it is all his own work, no need to hide it); a "hide titles" setting exists for when he wants it. Lock-screen widgets depend on the phone and Android version (Ramin to say which phone). Text must sit clear of the clock and the icons. A few updates a day, not live. **Honest limit:** the supervisor can't hold a phone; step c is tested on an emulator and then by Ramin.

## 11. Review of the spine as built (Fable, 2026-11-14 late night)

Read: the sessions service, the brief, the hook, the record tools, the study skill, the spec's "As built", and the full suites run again.

**Verdict: good work, built to the contracts.** The checks happen before any write, repeated checkpoints are safe, a hook can never block Claude Code, the brief is composed from the services that own each part (no second copy of the logic), and the changes the builder made to the plan are right (a Startup shortcut instead of a scheduled task; the path inside the Docs library; "Copy prompt" instead of "Start"; one key per practice problem, found by a real run).

**What is weak (each is an item in [LOOP_COMPLETE_SPEC](LOOP_COMPLETE_SPEC.md) S1):**
1. **Hooks were never run in the VS Code extension**, which is where Ramin works. The one capture point that needs no model is unproven on his main surface.
2. **A swept session loses the rest of its work** (a window idle over 30 minutes, then used again).
3. **Build sessions have no real title** without a commit ("Worked on second_brain"), and a project's "next" never fills in a coding session.
4. **Study minutes are wall-clock time**, so a chat left open logs hours.
5. **A chat's checkpoint in a coding session makes a study row;** a subfolder becomes its own project.
6. **Test data and his real data share one account**, and his real data has no backup but this disk.
7. **Not run:** Recall with the new `weakSpotId` on a real model call; the night batch; the phone layout; the order script on real numbered notes.
8. **Process:** the stop report quoted test numbers from before the last backend change; the full run afterwards found one failing test (fixed). Reports must quote the run made after the last change.

**Design note for Home:** "From your agent" sits above Focus and Next up and pushes them off the first screen. Fixed with the week's Home work (1.6).
