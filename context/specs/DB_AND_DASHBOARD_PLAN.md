# Database choice + porting the Revise dashboard (plan v0.1)

_2026-10-21. **Status: Postgres only, decided.** Ramin asked for "whatever is better and self-hostable on our EC2", and the answer is Postgres + Prisma 7 (§3a). **Dashboard UI: the same elements and arrangement as Revise** (Ramin, 2026-10-21; §5)._

_Background: based on two read-only code audits done the same day (the Recollect `backend/` + `recollect/`, and the Revise dashboard). This replaces the "keep MongoDB" line in RECOLLECT_PRODUCT_PLAN.md §4, which was a guess I never measured._

---

## 1. The question
- Recollect runs on Express + **MongoDB** (Mongoose).
- Revise runs on Next.js + **Postgres** (Prisma) and holds Ramin's real data and the daily loop.

The merged app could use **(A) Postgres only**, **(B) MongoDB only**, or **(C) both**.

## 2. Recommendation: (A) Postgres only, with Prisma. Not both.

| | A · Postgres only | B · Mongo only | C · Both |
|---|---|---|---|
| Work now | Port Recollect's data layer (the biggest job) | Rewrite Revise's queries in Mongoose | Nothing extra now… |
| The loop you use daily | Prisma models and most queries carry over, so lowest risk | Every query is rewritten, so behaviour can drift | Carries over |
| Links between features (doc ↔ topic ↔ revision ↔ task ↔ workspace) | Real joins, foreign keys, transactions | Embedded arrays + manual joins (already strained: `collaborators.user` is queried 23×) | **No joins or transactions across the two DBs.** You keep them consistent by hand, forever |
| Streaks, adherence, insights | Plain SQL | Aggregation pipelines | Split across DBs |
| Agent writing over MCP | Constraints reject bad writes | Only what the code checks | Mixed |
| Ops | 1 DB, 1 migration tool, 1 backup | 1 DB, no migrations today | 2 of everything |
| Importing your Revise data | Postgres → Postgres, mostly the same models | Convert every table | Mostly direct |

### The numbers behind it (audits of 2026-10-21)
**Recollect backend:** 17.6k LOC in total.
- **Being cut anyway:** about 3.4k (email, legacy content, dashboards, expenses, LiveKit, slides), plus 2.8k of fully commented-out code (`controllers/wrokspace_and_todo_dump`).
- **Kept: about 10.8k LOC.** Only about 6.7k of that touches the database: **~270 Mongoose calls in 24 files**, which become **14 tables + 7 child/join tables + a little JSONB**.
- **Nothing is genuinely hard.** There is 1 real aggregation (it becomes one JOIN), 6 transactions, and 2 TTL indexes (they become expiry checks + a cleanup cron). No change streams, GridFS or `$text`.
- **Effort: about 60–100 h by hand.** Most of it is mechanical, so Claude Code can take much of it. Every module still needs tests, because permission checks are copy-pasted into each handler and there is no service layer.
- **Frontend: almost zero changes.** It uses `_id` 581 times but never depends on the ObjectId format. It works unchanged **if the API keeps returning `_id` and the same nested shapes.**

**Revise dashboard:**
- **19 Prisma models.**
- **About 2.9k LOC of server actions full of Prisma queries.** On Postgres those queries survive; on Mongo every one is rewritten.
- About 1.5k LOC of pure logic.

**Why not both:** almost every core feature crosses the line:
- a revision opens a doc
- a task comes from a doc
- an agent note lands in a subject
- a challenge counts revisions

Two databases would be acceptable only as a temporary step, and we don't need one. You keep using Revise until the new app replaces it, so nothing is in a hurry.

**Why not Mongo only:** it's the cheapest *today*. But the part you rely on daily gets rewritten query by query, and everything ahead is relational: memberships and roles, schedules, challenges, QA steps, insights. And now is the cheapest moment to switch: **0 users means no data migration, only code.**

**Honest cost:** A costs more up front, the 60–100 h backend port, partly offset because Revise's ~2.9k LOC of Prisma queries don't need rewriting. In return you get:
- one relational database with constraints
- Prisma types end to end
- versioned migrations (Recollect has none today)
- SQL for stats

## 3. Decisions that come with it
- **Keep the Express backend** rather than moving to Next.js server actions. The MCP server, Hocuspocus and the cron jobs need a long-running Node service, and the frontend already talks REST through axios.
- **Keep Recollect as the base**, not Revise. It has the UI you like, multi-user auth, workspaces and collaboration. Revise's core moves in.
- **Database setup:**
  - Prisma 7 (as in Revise) with one Postgres database.
  - Local Postgres for development (you already run one for Revise); Neon or Supabase for hosting.
  - Text IDs (cuid/uuid).
  - The API keeps returning `_id`.
- **Yjs document state:** (since 2026-11-15 it is `bytea`: MANAGER_AND_DOCS_PLAN D3, As built) for now it stays **Base64 TEXT**, exactly as today, so there are no conversions at the API and less risk (decided 2026-10-21 when the build started). Moving it to `bytea` is an optional later optimisation; the Hocuspocus handler change would be just `load()` and `save()`.
- **Add a service layer:** controllers → services → Prisma. Permission helpers (`canEditDoc`, `requireWorkspaceRole`, …) are written once and tested.

### 3a. Prisma *and* Postgres (they aren't alternatives), self-hosted on EC2
- **Postgres is the database**: the server that stores the data. **Prisma is the library** our Node code uses to talk to it (schema, migrations, typed queries). We use both, exactly as Revise does today: `prisma` / `@prisma/client` 7.8 + `@prisma/adapter-pg` + `pg`.
- **Prisma needs no hosting.** It's an open-source npm package inside the backend; no Prisma cloud service is needed. On each deploy, run `prisma migrate deploy`.
- **Why Prisma rather than Drizzle or Kysely:** Revise is already on Prisma 7, so its 19 models and about 2.9k LOC of queries carry over. Prisma 7 runs on the plain `pg` driver (no separate engine binary), so it's light enough.
- **Self-hosting Postgres on the EC2:**
  - **Install:** Postgres 17 in Docker (official image) with its data on the EBS volume, or `apt install postgresql-17`.
  - **Initialise it as UTF-8, with the server timezone set to UTC.** For the locale, use `en_US.UTF-8` or ICU, not `C`, so case-insensitive search folds non-ASCII letters too (the local dev DB uses `C`, which folds only ASCII).
  - **Network:** port 5432 is **not** open to the internet. The app connects over localhost/VPC; for admin access, use an SSH tunnel.
  - **One server, two databases:** `revise` (moved off RDS) and `recollect` (the new app). The import script reads `revise` and writes `recollect`.
  - **Moving Revise off RDS:** `pg_dump` from RDS → `pg_restore` on the EC2, then change Revise's connection string. Keep RDS for a week as a fallback. RDS's free tier only lasts 12 months anyway.
  - **Backups (RDS did this for you; self-hosting means you own it):**
    - a nightly `pg_dump` (compressed) to S3: keep 7 daily + 4 weekly
    - a weekly EBS snapshot
    - **one test restore** before you trust it

    Revise's `scripts/backup-db.mjs` JSON backup is an extra safety net.
  - **Size:** Postgres + Express + Hocuspocus + Next.js on one box needs **at least 2 GB of RAM**, and 4 GB is comfortable. Build the Next.js app in CI or on another machine, or add swap; builds are the memory spike.

## 4. Phase 0: cut, then move to Postgres
1. **Cut first:**
   - email, legacy content, dashboards, expenses, LiveKit, slides
   - delete the dead dump folder
   - move the Cloudinary-delete helpers out of `content.controller.ts` (two kept files import them)
2. **Prisma schema:** the 14 kept models + child tables, plus the learning-core models from Revise, cleaned up (§5).
3. **Port one module at a time, on a branch, each with tests, keeping the same REST shapes.** Order:
   1. auth / users / OTP
   2. docs + collaboration + share / access requests
   3. tags
   4. todos
   5. workspaces (the biggest: about 100 calls)
   6. notifications / activity
   7. recent visits
   8. drawings
   9. reminders / uploads
4. **Fix while porting:**
   - the doc-save 500 (the server-side editor schema lacks `textStyle` etc.)
   - the OTP expiry check (it currently relies on Mongo deleting the OTP)
   - the Reminder status `"processing"`, which isn't in its enum
   - the unescaped regex searches, which become `ILIKE`
5. **Remove Mongoose and turn CI on.** `main` keeps running on Mongo until the branch merges.

## 5. Phase 1: rebuild the Revise dashboard inside Recollect

### What the dashboard is today
| Part | What it does | Size / notes | Do you use it? |
|---|---|---|---|
| **Revisions due** | Today, overdue ("N days late"), done today; "Cycle k of 4"; complete / uncomplete / reschedule | Core | ✅ daily (you said) |
| **Add revision** | Starts 4 revisions at +1 / +3 / +7 / +21 days | From a topic page or a capture | ✅ (you said) |
| Tasks tabs | Due today / upcoming, weekly goals, inbox, "All" | Maps to Recollect todos | ? |
| Quick Notes | Vault / scratch, pinned, notes by day, attachments, live via Pusher | 1,271 LOC | ? |
| Schedule timeline + Day Manager | Time blocks, routine (MASTER / DAILY), "now" marker | Day Manager is 1,128 LOC | ? |
| Wrap up day / debrief, multi-day catch-up, triage | Rate the day; mark missed blocks | Writes "skipped" | ? |
| Weekly review, AI export (mentor report) | Monday review; export for an AI mentor | Pure logic | ? |
| Header stats | Streak, 7-day adherence | Pure logic | ? |
| Ctrl+K quick note | Global capture, with a "start revisions" toggle | Merge into Recollect's Ctrl+K | ? |

### Approach: carry over the behaviour, rebuild the UI
1. **Logic becomes pure, tested functions** in `backend/src/services/learning/`:
   - revision maths: start, complete, reschedule, mastered, overdue
   - slot generation + backfill
   - adherence and debrief stats
   - the Day Manager's `recalculate`
   - date helpers (currently copied in 5 places)
   - **per-user timezone** instead of fixed IST

   This needs no database, so it can start right away, alongside Phase 0.
2. **Data:** copy Revise's Prisma models into the shared schema.
   - Scope them by Recollect *user*: a Revise "workspace" is not the same as a Recollect team workspace.
   - Tasks, reminders and inbox map to Recollect todos, which already have reminders and a cron.
3. **API:** server actions become REST.
   - **One `GET /api/today`** returns everything the page needs.
   - `POST /api/revisions/start`, plus `/:id/complete`, `/:id/uncomplete` and `/:id/reschedule`.
   - Quick-note CRUD; debrief and catch-up.
   - Daily slots are created by a **cron at each user's midnight**, not while the page loads (Revise writes to the DB during render).
4. **UI: same elements, same arrangement as Revise's dashboard** (Ramin, 2026-10-21), **not** the prototype's `#/today`.
   - Every widget in the table above, laid out the way Revise lays them out: header with stats → timeline bar → revisions due, tasks tabs and Quick Notes in the same places → the same modals.
   - Only the *look* adapts to Recollect (its theme colours, fonts, Dialog, DropdownMenu, Tabs and date picker), so the page doesn't clash with the rest of the app.
   - Before building, capture Revise's dashboard as reference screenshots (look only; never save the catch-up modal). Then compare side by side as we go.
   - **One Ctrl+K:** Recollect's quick-add plus a "revise this" toggle that does what Revise's Ctrl+K does.
5. **Opening a revision** goes to a Recollect Doc (a topic = a doc + a subject + its revisions). Revise's free-form topic canvas is not carried over in v1.
6. **Import your data** with one script, Revise Postgres → new Postgres. Dry-run it on a copy and **never write to Revise's database.**
7. **Use both apps for 2 weeks, then retire Revise.**

### Keep exactly as it is in v1
- Completing a revision is **one click (done / undone)**. Revise has no rating step. The "solved cold / needed a hint / couldn't" buttons in the prototype were my idea; they can come later as an option.
- Cycles of 1 / 3 / 7 / 21 days. Completing early or late shifts the later cycles counted from today.

### Revise bugs to fix rather than copy (from the audit)
- "Today" starts at 05:30 IST, because real times are compared with day labels.
- The streak never drops after missed days.
- One-off blocks show on every day in MASTER mode.
- Overdue tasks only appear under All → Overdue.
- Dates typed into Ctrl+K ("tomorrow") are silently dropped.
- Calendar reminders aren't filtered by workspace.
- The ACTIVE / PARTIAL statuses and actual times are never set.
- Unmarking a revision doesn't undo the date shifts or streaks.

## 6. Decisions
**Settled on 2026-10-21:**
- Postgres only, using Prisma 7, self-hosted on the EC2.
- v1 dashboard = the full Revise dashboard: all its elements in the same arrangement, so every row in the §5 table is in scope.
- One-click "done", the same as Revise.

**Still open:**
1. **Where does your topic content live in Revise:** the canvas, or text notes? If it's mostly the canvas, we need a converter or a read-only view.
2. **Hours per week** you can give this. This turns the phases into dates.
