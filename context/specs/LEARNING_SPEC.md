# LEARNING_SPEC: the Revise dashboard inside Recollect (v1)

*E0 design, 2026-10-21. To be implemented by WP-E1 (backend), WP-E2 (frontend) and WP-E3 (import).*

**Sources:**
- `../research/audits/2026-10-21-revise-dashboard-audit.md`
- `DB_AND_DASHBOARD_PLAN.md` §5–6
- STATE.md §7 ("Engine decisions")
- the pure engine in `backend/src/services/learning/*`
- Revise's `prisma/schema.prisma` and its dashboard, actions and global components
- Recollect's schema, `MIGRATION_CONVENTIONS.md`, the todos port (C2), and the frontend (`HomeView`, `QuickTaskAdd`, `ui-base`, the stores)

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Owner | Every learning row has a `userId`. One Revise workspace = one Recollect user. It is never a Recollect team Workspace. |
| Home | `/` renders `LearningHome`, which is Revise's `DashboardClient` layout in Recollect's look. It sits behind a new flag `features.learningHome` (on). The old `HomeView` stays in the code. |
| Days | A learning day is `'YYYY-MM-DD'` in `User.timezone` (default `Asia/Kolkata`). It is stored as a Postgres `date` and is the engine's `DayString`. Instants stay timestamps. |
| No writes on GET | A **rollover** runs once per user per local day. It settles or bridges the streak, backfills slots, creates today's slots and heals triage. A cron triggers it every 15 min, and so does `POST /api/learning/ensure-today`, which the Home page calls when `GET /api/today` reports `needsEnsure`. |
| Tag clash | Revise's per-subject `Tag` table becomes `Topic.tags String[]`. Revise tags only ever held a name, and Recollect's `Tag` is a *global, ownerless* label table, so sharing it would leak names between users. Recollect's `Tag` stays the todo-label table. |
| Captures | A Revise capture becomes one of three things: **TASK** → Recollect `Todo` (+ new `Todo.goalType`); **NOTE/LINK** → new `Capture` model (these carry "Note" revision chains and the Inbox, and a todo can't do either); **active reminder** → a `Todo` due that day. |
| Inbox | Captures with no subject, no topic and no pending revision, exactly as Revise. |
| Topic | A topic is a doc + a subject + revisions: `Topic.docId → Doc`. Opening a topic revision opens `/docs?id=<docId>`. Opening a capture revision expands it inline (as Revise). |
| Undo | `Revision.undo` (engine `CompletionUndo`), plus `beforeLastCredit` snapshots on User and SubjectStreak. |
| Streak | Rest days (nothing due, nothing done) are neutral: the rollover "bridges" them. A day that ends with something due still open breaks the streak at that midnight. |
| Not in v1 | Habits (the export's habit section is skipped when empty), Revise ActivityLog, canvas rendering (kept verbatim in `Topic.legacyCanvas`), the planner page (Q1), Pusher realtime (Home refetches on focus instead), AI ✨ for notes. |

## 1. Data model

Add the following to `backend/prisma/schema.prisma` as one migration, `learning`. The name check is clean: no new model or enum clashes with an existing one. Revise's `Tag`, `ActivityLog`, `Reminder`, `Workspace`, `Attachment`, `NoteCategory`, `Habit`, `TopicMention` and `TopicCaptureLink` are **not** created.

```prisma
// ============================================================================
// Learning (Revise's dashboard). Owned by a Recollect user (one Revise workspace = one user).
// @db.Date columns hold the user's LOCAL calendar day (engine DayString): write with
// dayToUtcMidnight(day), read with dayFromUtcMidnight(date). Instants stay timestamps.
// ============================================================================

enum RoutineMode {
  MASTER
  DAILY
}

enum RevisionStatus {
  pending
  done
  /// In Revise's schema; nothing writes it.
  missed
}

enum CaptureType {
  NOTE
  LINK
}

enum GoalType {
  NONE
  WEEKLY
  MONTHLY
}

enum SlotStatus {
  UPCOMING
  ACTIVE
  COMPLETED
  SKIPPED
  PARTIAL
}

enum BlockLogStatus {
  COMPLETED
  SKIPPED
  PARTIAL
}

enum QuickNoteCategory {
  /// "Vault"
  PRIMARY
  /// "Scratch"
  TEMPORARY
}

// ── ADD these fields to existing models ─────────────────────────────────────
// model User {
//   /// IANA zone for learning days ("today", streaks, slots, goal due days).
//   timezone                 String      @default("Asia/Kolkata")
//   /// Revise Workspace.routineMode.
//   routineMode              RoutineMode @default(MASTER)
//   /// Global revision streak = engine StreakState. lastGlobalStreakDay = last credited day,
//   /// or the last rest day bridged by the rollover.
//   globalStreak             Int         @default(0)
//   longestGlobalStreak      Int         @default(0)
//   lastGlobalStreakDay      DateTime?   @db.Date
//   /// StreakSnapshot { current, longest, lastCreditDay } from just before the last credit (same-day undo).
//   globalStreakBeforeCredit Json?
//   /// Last local day the rollover finished for this user (null = never).
//   learningRolledOverDay    DateTime?   @db.Date
//
//   subjects Subject[]  topics Topic[]  captures Capture[]  revisions Revision[]
//   subjectStreaks SubjectStreak[]  dailyHistory DailyHistory[]  timeBlocks TimeBlock[]
//   scheduleSlots DailyScheduleSlot[]  dayDebriefs DayDebrief[]  quickNotes QuickNote[]
// }
// model Doc  { topics Topic[] }
// model Todo {
//   /// Revise weekly/monthly goals (Home "Weekly" tab, Monday review).
//   goalType GoalType @default(NONE)
// }

model Subject {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name         String
  description  String?
  icon         String?
  /// Hex. New subjects get '#007acc' (Revise's default).
  color        String?
  lastActiveAt DateTime @default(now())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  topics   Topic[]
  captures Capture[]
  streaks  SubjectStreak[]
  history  DailyHistory[]

  @@index([userId, createdAt])
}

/// A doc + a subject + its revisions.
model Topic {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  subjectId    String
  subject      Subject  @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  /// The content. SET NULL when the doc is deleted: the topic and its revision history survive,
  /// and POST /api/topics/:id/doc creates a fresh doc.
  docId        String?
  doc          Doc?     @relation(fields: [docId], references: [id], onDelete: SetNull)
  /// Shown only when there is no doc (otherwise doc.title).
  title        String
  /// Revise's per-subject Tag rows, as names.
  tags         String[] @default([])
  sortOrder    Float?
  isArchived   Boolean  @default(false)
  /// Imported topics only: Revise canvasData verbatim, for a later read-only canvas view. Never edited.
  legacyCanvas Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  revisions Revision[]
  captures  Capture[]

  @@unique([userId, docId])
  @@index([subjectId])
}

/// Revise NOTE/LINK captures: the Inbox and "Note" revisions. (TASK captures became Todos.)
model Capture {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  type          CaptureType @default(NOTE)
  title         String?
  content       String?
  url           String?
  /// LINK that is an uploaded file.
  cloudPublicId String?
  fileType      String?
  /// Revise NoteCategory.name (the "#tag").
  category      String?
  isPinned      Boolean     @default(false)
  subjectId     String?
  subject       Subject?    @relation(fields: [subjectId], references: [id], onDelete: SetNull)
  topicId       String?
  topic         Topic?      @relation(fields: [topicId], references: [id], onDelete: SetNull)
  /// [{ url, publicId, fileName, fileType }]
  attachments   Json        @default("[]")
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  revisions Revision[]

  @@index([userId, subjectId, createdAt(sort: Desc)])
  @@index([topicId])
}

model Revision {
  id           String         @id @default(cuid())
  /// Owner, copied from the topic/capture so dashboard queries need no joins.
  userId       String
  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// Exactly one of topicId / captureId is set (CHECK constraint in the migration SQL).
  topicId      String?
  topic        Topic?         @relation(fields: [topicId], references: [id], onDelete: Cascade)
  captureId    String?
  capture      Capture?       @relation(fields: [captureId], references: [id], onDelete: Cascade)
  /// 1..4
  cycleNumber  Int
  /// 1, 3, 7, 21
  intervalDays Int
  scheduledFor DateTime       @db.Date
  completedAt  DateTime?
  status       RevisionStatus @default(pending)
  /// engine CompletionUndo { revisionId, completedDay, shifts[] }: set by complete, cleared by uncomplete.
  undo         Json?
  createdAt    DateTime       @default(now())

  @@unique([topicId, cycleNumber])
  @@unique([captureId, cycleNumber])
  @@index([userId, status, scheduledFor])
  @@index([userId, completedAt])
}

model SubjectStreak {
  userId           String
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  subjectId        String
  subject          Subject   @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  currentStreak    Int       @default(0)
  longestStreak    Int       @default(0)
  /// Revise lastCalculated (its epoch default becomes NULL).
  lastCreditDay    DateTime? @db.Date
  beforeLastCredit Json?

  @@id([userId, subjectId])
}

model DailyHistory {
  id               String   @id @default(cuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  subjectId        String
  subject          Subject  @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  date             DateTime @db.Date
  revisionsDue     Int
  revisionsDone    Int
  streakMaintained Boolean

  @@unique([userId, subjectId, date])
}

model TimeBlock {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String
  /// 'HH:mm'
  startTime String
  endTime   String
  color     String
  /// 0 = Mon … 6 = Sun (DAILY routine); null for MASTER blocks and one-offs.
  dayOfWeek Int?
  /// Set = a one-off block for that day only.
  date      DateTime? @db.Date
  createdAt DateTime  @default(now())

  sessionLogs BlockSessionLog[]
  slots       DailyScheduleSlot[]

  @@index([userId])
}

model BlockSessionLog {
  id          String         @id @default(cuid())
  timeBlockId String
  timeBlock   TimeBlock      @relation(fields: [timeBlockId], references: [id], onDelete: Cascade)
  date        DateTime       @db.Date
  status      BlockLogStatus
  remark      String?
  minutesDone Int?
  createdAt   DateTime       @default(now())

  @@unique([timeBlockId, date])
  @@index([date])
}

model DailyScheduleSlot {
  id              String     @id @default(cuid())
  userId          String
  user            User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceBlockId   String?
  sourceBlock     TimeBlock? @relation(fields: [sourceBlockId], references: [id], onDelete: SetNull)
  date            DateTime   @db.Date
  title           String
  color           String
  startTime       String
  endTime         String
  status          SlotStatus @default(UPCOMING)
  actualStartTime String?
  actualEndTime   String?
  remark          String?
  minutesDone     Int?
  sortOrder       Int        @default(0)
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@unique([sourceBlockId, date])
  @@index([userId, date])
}

model DayDebrief {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date            DateTime @db.Date
  blocksPlanned   Int      @default(0)
  blocksCompleted Int      @default(0)
  blocksSkipped   Int      @default(0)
  totalFocusedMin Int      @default(0)
  /// 1-5
  energy          Int?
  focus           Int?
  mood            Int?
  tags            String[] @default([])
  narrative       String?
  tomorrowIntent  String?
  freeWrite       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, date])
}

model QuickNote {
  /// Client-made UUID: the widget upserts by id for optimistic saves. No default.
  id          String            @id
  userId      String
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  content     String
  isPinned    Boolean           @default(false)
  category    QuickNoteCategory @default(PRIMARY)
  /// [{ url, publicId, fileName, fileType }]
  attachments Json              @default("[]")
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@index([userId, createdAt])
}
```

Create the migration with `prisma migrate dev --create-only --name learning`, then append this SQL:

```sql
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_exactly_one_item"
  CHECK (("topicId" IS NULL) <> ("captureId" IS NULL));
```

**Why each choice:**
- `Revision.userId` is denormalised so the Home page's revision query is one indexed scan. Revise had to go topic → subject → workspace.
- `@@unique([topicId|captureId, cycleNumber])` closes Revise's double-start race at the database level, alongside the engine's `ALREADY_STARTED` check.
- `Topic.docId` is SET NULL rather than CASCADE, because deleting a doc must not erase revision or streak history.
- `@@unique([userId, docId])` lets each collaborator revise a shared doc on their own.
- `Capture.subjectId` and `topicId` are SET NULL (Revise cascaded): deleting a subject moves its notes to the Inbox instead of deleting them.
- Attachments become Json, following the convention that data never queried on its own goes into a Json column. Revise's Attachment table and QuickNote.attachments are only ever read whole.
- `DailyHistory` is kept because the engine writes it on every completion, and it preserves the imported history behind Revise's subject "flame" view.
- No Habit, ActivityLog or goal tables. Nothing on the dashboard reads them, goals live on `Todo.goalType`, and the total revisions done can be derived as `count(done)`.
- Streak, routine and rollover state live on `User`, mirroring Revise and the engine types. `serializeUser` picks fields explicitly, so none of this leaks into `/api/me`.

### Engine follow-ups (WP-E1; pure functions with unit tests in `tests/unit/learning`)

1. **Rest-day-neutral rollover** (STATE decision 2). Add `rollOverStreakDay(state, endedDay, openDueAtEnd)`:
   - `current === 0` → unchanged.
   - `lastCreditDay === endedDay` → unchanged.
   - `lastCreditDay !== endedDay − 1` → `current = 0`.
   - `openDueAtEnd === 0` → `lastCreditDay = endedDay` (a bridge; `beforeLastCredit = null`).
   - otherwise → `current = 0`.
   - `openDueAt(D)` counts revisions with `scheduledFor ≤ D AND (status = pending OR completedAt ≥ startOfDay(D+1, tz))`. The same function works per subject.
   - Update the streaks.ts header, which still says rest days break the streak.
2. **Catch-up focus time** (STATE decision 3). `applyCatchUp` must compute `totalFocusedMin` from each day's COMPLETED/PARTIAL slots (via `computeDebriefStats`) instead of writing 0.
3. **Single-day debrief count.** The *service* passes all of the day's slots to `planDebriefSave`, with the client's edits merged in, so `planned` counts every block and not only the unresolved ones. No engine change is needed.
4. **Blocks after midnight.** In `recalculate`, a block whose parsed start is more than 12 h before the cascade point is next-day, so add 1440. Test: a 00:30–01:30 block after a 22:00–23:00 block stays 60 min instead of collapsing to 5.
5. **Actual times.** `DayManagerSlotUpdate` gains an optional `minutesDone`. Add a new `stampActualTimes(existing, update, nowHHmm)`:
   - → ACTIVE sets `actualStartTime`.
   - → COMPLETED/PARTIAL/SKIPPED sets `actualEndTime`.
   - This fixes "ACTIVE/PARTIAL and actual times are never set". The Day Manager row gets **Start** and **Partial** actions next to Done/Skip.

## 2. REST contract

### Conventions
- **Router and auth:** one router, `src/routers/learning.routes.ts`, mounted with `app.use('/api', …)` after `userRoutes`, behind `authMiddleware`. Always use `requireUser(req).id` and never pass `undefined` into a `where`.
- **Envelope:**
  - success → `{ success: true, data }`
  - error → `{ message, code? }`
  - JSON uses `_id` in both directions; controllers map to the engine's `id`.
  - days are `'YYYY-MM-DD'`, instants are ISO strings
  - bodies are validated with zod
- **Not-owned ids** → 404 `Not found`, never 403.
- **`LearningError` mapping** (`src/services/learning/http.ts` plus one branch in `errorHandler`):

| Codes | HTTP |
|---|---|
| `INVALID_*`, `CATCH_UP_INVALID`, `DEBRIEF_INVALID` | 400 |
| `REVISION_NOT_FOUND` | 404 |
| `NOT_PENDING`, `NOT_DONE`, `LATER_CYCLE_DONE`, `ALREADY_STARTED`, `UNDO_MISMATCH` | 409 |
| `MIXED_CHAIN` | 500 |

- **Layout:**
  - DB services in `src/services/learningDb/*.service.ts`; `services/learning/` stays pure
  - serializers in `src/db/serializers/learning.ts`
  - controllers in `src/controllers/learning/*`

### `GET /api/today`: everything the Home page needs, in one call (zero writes)

```jsonc
{ "success": true, "data": {
  "today": "2026-10-21", "timezone": "Asia/Kolkata", "needsEnsure": false,
  "user": { "_id": "ck…", "name": "Ramin" },
  "stats": { "streak": 12, "longestStreak": 30,
             "adherence": 64, "adherenceDelta": 14, "adherenceDone": 9, "adherenceTotal": 14,
             "totalTopics": 120, "mastered": 40, "inProgress": 50, "notStarted": 30 },
  "revisions": { "totalDue": 5, "dueToday": [/*RevisionItem*/], "overdue": [], "doneToday": [] },
  "schedule": { "routineMode": "MASTER", "slots": [/*Slot*/] },
  "triage": { "kind": "none" },
  "todayDebrief": null,
  "tasks": [/*Task*/],
  "inbox": { "count": 7, "items": [/*Capture*/] },
  "quickNotes": [/*QuickNote*/],
  "weeklyReview": { "isReviewDay": false, "goals": [] }
}}
```

**Shapes:**
- **RevisionItem:**
  ```
  { _id, kind: 'topic'|'capture', itemId, title, subject: {_id,name,color}|null /* null = "General" */,
    cycleNumber, intervalDays, scheduledFor, status, completedAt, daysLate /* overdue only */, tags,
    docId /* topic */, content, url, attachments /* capture */, canUndo /* done only */ }
  ```
  - `title` is `doc.title ?? topic.title` for topics, and `title || content[0..50] || 'Capture'` for captures.
  - `dueToday` is the flattened `dueTodayBySubject`, which keeps Revise's ordering.
- **Slot:** `{ _id, sourceBlockId, date, title, color, startTime, endTime, status, actualStartTime, actualEndTime, remark, minutesDone, sortOrder }`.
- **triage:**
  - `{kind:'debrief', date, slots, existingDebrief}`, or
  - `{kind:'catch-up', days:[{date,slots}], prefill}`.
- **Task:** `serializeTodo(row)` (C2's `todoShape.ts`) plus `goalType`.
- **Capture:** `{ _id, type, title, content, url, fileType, category, isPinned, subject, topicId, attachments, createdAt, updatedAt }`.
- **QuickNote:** `{ _id, content, isPinned, category, attachments, createdAt, updatedAt }`.
- **Debrief:** every DayDebrief field plus `_id`.

**Rules:**
- **`needsEnsure`** is true when `learningRolledOverDay` is null or before `today`. The client then calls ensure and refetches.
- **Triage healing:** slots that `findTriageSlots().heal` would heal are *shown* as resolved. The actual write happens in the rollover.
- **tasks:** personal todos (the same filter as `listPersonalTodos`: own or assigned, private/shared), loaded with `todoInclude`. A todo is included when either:
  - it is not complete and has a `dueDate` or a goal (`goalType ≠ NONE`), or
  - it was completed today (shown dimmed).

  Todos with no due date and no goal stay in `/todo`. This prevents a flood: in Revise, dateless tasks were weekly goals.
- **inbox:** captures with no subject, no topic and no pending revision; pinned first, then newest; at most 10, plus a `count`.
- **weeklyReview.goals:** filled only on Mondays (`isWeeklyReviewDay`), using `isUnresolvedWeeklyGoal`.
- **Engine functions used:**
  - `today` and `buildRevisionBuckets` for the revision lists
  - `revisionProgress`, `effectiveStreak` and `computeAdherence` (over 14 days of slots) for the header stats
  - `findTriageSlots` and `planTriage` (30 days) for the triage, with `catchUpPrefill` for its prefill
  - `isWeeklyReviewDay` and `isUnresolvedWeeklyGoal` for the Monday review
- **Performance:** run the queries in parallel; target < 300 ms with 2k revisions and 500 notes on local Postgres.

### Endpoints

| # | Method + path | Body | `data` | Errors | Engine |
|---|---|---|---|---|---|
| 1 | GET `/api/today` | – | above | 401 | above |
| 2 | POST `/api/learning/ensure-today` | – | `{ rolledOver, days }` | 401 | rollover (below) |
| 3 | PATCH `/api/learning/settings` | `{ timezone?, routineMode? }` | `{ timezone, routineMode }` | 400 `INVALID_TIMEZONE` | `isValidTimeZone` |
| 4 | POST `/api/revisions/start` | `{ topicId }` or `{ captureId }` | `{ chain }` 201 | 404, 409 `ALREADY_STARTED` | `startRevisions(today)` |
| 5 | POST `/api/revisions/:id/complete` | – | `{ item, chain, streak, mastered }` | 404, 409 `NOT_PENDING` | `completeRevision`, `countDue`, `streakEffectsOfCompletion` |
| 6 | POST `/api/revisions/:id/uncomplete` | – | `{ item, chain, streak }` | 404, 409 `NOT_DONE`/`LATER_CYCLE_DONE` | `uncompleteRevision`, `streakEffectsOfUncompletion` |
| 7 | POST `/api/revisions/:id/reschedule` | `{ day }` (≥ today) | `{ item, chain }` | 400, 404, 409 `NOT_PENDING` | `rescheduleRevision` |
| 8 | GET `/api/subjects` | – | `[{ _id, name, color, icon, description, topics:[{_id,title,docId}] }]` | – | – |
| 9 | POST `/api/subjects` | `{ name, description?, color?, icon? }` | Subject 201 | 400 | – |
| 10 | PATCH `/api/subjects/:id` | partial | Subject | 400/404 | – |
| 11 | DELETE `/api/subjects/:id` | – | `{ deleted:true }` (topics and revisions go; docs stay; captures move to the Inbox) | 404 | – |
| 12 | GET `/api/topics/by-doc/:docId` | – | `{ topic\|null, chain, nextAction }` | 404 (doc not viewable: `canViewDoc`) | `nextRevisionAction` |
| 13 | POST `/api/topics` | `{ docId, subjectId, tags?, startRevisions? = true }` | `{ topic, chain }` 201 | 400/404, 409 (exists) | `startRevisions` |
| 14 | PATCH `/api/topics/:id` | `{ subjectId?, tags?, isArchived? }` | Topic | 400/404 | – |
| 15 | DELETE `/api/topics/:id` | – | `{ deleted:true }` (doc stays) | 404 | – |
| 16 | POST `/api/topics/:id/doc` | – | `{ docId }` (empty doc titled after the topic, if missing) | 404 | – |
| 17 | GET `/api/captures/categories` | – | `string[]` (distinct) | – | – |
| 18 | POST `/api/captures` | `{ type?, title?, content?, url?, category?, subjectId?, topicId?, isPinned?, attachments?, revise? }` | `{ capture, chain? }` 201 | 400 (empty), 404 | `startRevisions` (same transaction when `revise`) |
| 19 | PATCH `/api/captures/:id` | `{ title?, content?, url?, category?, isPinned?, subjectId? }` | Capture | 404 | – |
| 20 | DELETE `/api/captures/:id` | – | `{ deleted:true }` | 404 | – (Cloudinary cleanup after commit; errors logged and ignored) |
| 21 | POST `/api/learning/uploads` | multipart `file` (≤ 20 MB; multer → Cloudinary `resource_type:'auto'`) | `{ url, publicId, fileName, fileType }` | 400, 413 | – |
| 22 | PUT `/api/quick-notes/:id` (id = UUID) | `{ content, category, attachments? }` | QuickNote (201 if new) | 400 (empty / bad id), 404 (another user's id) | – |
| 23 | PATCH `/api/quick-notes/:id` | `{ isPinned }` | QuickNote | 404 | – |
| 24 | DELETE `/api/quick-notes/:id` | – | `{ deleted:true }` | 404 | – |
| 25 | PUT `/api/schedule/today` | `{ slots:[{ _id ('new-…' = create), title, color, startTime, endTime, status, sortOrder, remark, minutesDone? }] }` | `[Slot]` | 400 `INVALID_TIME` | `planDayScheduleSave` + `stampActualTimes` |
| 26 | PUT `/api/debriefs/:day` (≤ today) | `{ form:{energy,focus,mood,tags,narrative,tomorrowIntent,freeWrite}, slots:[{ _id, status, remark, minutesDone, actualStartTime, actualEndTime }] }` | Debrief | 400 `DEBRIEF_INVALID` | `planDebriefSave` (over all of the day's slots) |
| 27 | POST `/api/schedule/catch-up` | `{ dates, context:{energy,focus,mood,tags,narrative}, decisions:[{ slotId, status, remark? }] }` | `{ debriefs }` | 400 `CATCH_UP_INVALID` | heal, then `applyCatchUp` |
| 28 | POST `/api/learning/goals/:todoId/shift` | `{ target:'THIS_WEEK'\|'MONTHLY' }` | Task | 404 | `shiftWeeklyGoal` |
| 29 | GET `/api/learning/export/mentor?from&to` | – | `{ prompt }` | 400 `INVALID_RANGE` | `buildMentorReportInput` (`habits: []`), `buildMentorPrompt` |
| 30–33 | GET/POST/PATCH/DELETE `/api/schedule/blocks[/:id]` | TimeBlock fields | TimeBlock(s) | 400/404 | **optional:** build only if Q1 = yes |

**Changes to `/api/todos` (C2's code):**
- `POST` and `PATCH` accept `goalType`. A new weekly or monthly goal with no date gets `dueDate = parseDateOnly(initialGoalDueDay(…))`, which is 18:00 local.
- `serializeTodo` returns `goalType`.
- The dashboard's toggle, reschedule and delete use the existing `PATCH`/`DELETE /api/todos/:id`.

### Write paths
- **Complete** (one `$transaction`):
  1. `SELECT … FOR UPDATE` on the user row and on the chain rows.
  2. Load the chain (with `subjectId` via the topic or capture).
  3. Run `completeRevision(chain, id, now, tz)`, apply its patches, and store the result's `undo` on the revision.
  4. Count pending-due revisions *after* the change, globally and per subject.
  5. Run `streakEffectsOfCompletion`, then write the User streak columns, upsert SubjectStreak and upsert DailyHistory.
- **Uncomplete** follows the same steps, with these differences:
  - Call `uncompleteRevision(chain, id, parseUndo(row.undo), tz)`. An invalid record counts as `null`, which falls back to interval spacing.
  - Clear `undo`.
  - Count `completedToday` as well as pending-due.
  - Run `streakEffectsOfUncompletion`. A `history: null` result deletes the row.
- **Reschedule:** lock the chain, run `rescheduleRevision`, apply the patches.

### Rollover (cron and ensure)
- **Cron:** `startLearningCron()`, called from `index.ts`, runs `*/15 * * * *` and once at boot.
- **Who it covers:** users with any TimeBlock or Revision whose `today(tz)` is after `learningRolledOverDay`.
- **Per user, in one transaction:**
  1. **Claim the day:** `updateMany({ where: { id, OR:[{learningRolledOverDay:null},{learningRolledOverDay:{lt:today}}] }, data:{ learningRolledOverDay: today } })`. A count of 0 means another run won, so stop.
  2. **Streaks:** for each ended day D, run `rollOverStreakDay` on the global streak and on each SubjectStreak.
     - D runs from `(old ?? lastGlobalStreakDay ?? today−1) + 1` to `today − 1`.
     - It is capped at 30 days; anything older just settles.
  3. **Slots and healing**, in Revise's order:
     1. `backfillMissedDays` → `createMany({ skipDuplicates })`
     2. `planDaySlots(today)`
     3. `findTriageSlots().heal` → updates
- **Test:** idempotent, and catches up after 3 missed days.

## 3. Frontend plan

### Files
- `app/(app)/page.tsx`: `features.learningHome ? <LearningHome/> : <HomeView/>`. Add the flag to `lib/features.ts`, default on.
- `components/learning/*`: the components below.
- `lib/api/learningApi.ts`: uses `axiosInstance`; one function per endpoint, plus `uploadLearningFile`.
- `lib/store/learningStore.ts`: Zustand `useLearningStore`. (`dashboardStore` is taken by the legacy dashboards.)
- `lib/learning/types.ts`: the DTOs above.
- `lib/learning/taskGroups.ts`: a pure function that groups tasks into overdue / today / upcoming / weekly.
- `lib/learning/dates.ts`: `formatDay`, `greeting(tz)` ("Still up" before 5), `nowMinutes(tz)`.
- `lib/learning/parseNote.ts`: copied from Revise `lib/notes/parseNote.ts`. It is a pure parser, so `react-markdown` is not needed.
- `lib/learning/engine/`: a **copy** of the backend's `errors`, `time`, `types`, `schedule`, `dayManager` and `debrief` modules, taken *after* the follow-ups land. Give each a header with "copied from backend/src/services/learning; re-copy on change". The Day Manager, debrief stats and the timezone helpers run client-side.

### Component tree (same arrangement as `DashboardClient`)

```
LearningHome                         max-w-[1200px], p-4 md:p-8
├─ TriageInterceptor                 payload.triage → DayDebriefDialog("Action Required") | CatchUpDialog; dismiss = hide for this visit
├─ HomeHeader                        greeting+date (tz) │ Wrap Up Day · ✨ export · 🔥 N day streak · 🎯 N% blocks this week ±Δ · New Subject
├─ ScheduleTimeline                  non-skipped slots by sortOrder, "now" dot every 30 s, ⚙ → DayManagerDialog
├─ grid lg:grid-cols-[1fr_500px] gap-8
│  ├─ left (flex-col gap-16)
│  │  ├─ RevisionsDue                badge totalDue; today rows → overdue (collapsible, "N days late") → done today (dimmed)
│  │  │  └─ RevisionRow + ItemActionMenu   Complete | Unmark · Reschedule (hidden when done) · Edit (captures)
│  │  └─ TasksPanel                  tabs [Due Today|Upcoming] [Weekly] [Inbox] + "All" → AllTasksDialog; ProgressCard (desktop)
│  └─ right (lg:sticky)              QuickNotesPanel (composer, Vault/Scratch, search, pinned, grouped by day, attachments); ProgressCard (mobile)
└─ dialogs: CreateSubjectDialog, DayManagerDialog, DayDebriefDialog (Wrap Up Day), WeeklyReviewDialog (mounted ONCE),
   RescheduleDialog, AttachmentPreviewDialog, EditCaptureDialog, AiExportDialog
```

### Revise → Recollect component map

| Revise | Recollect (`components/learning/`) | Reuses |
|---|---|---|
| `TaskActionMenu` | `ItemActionMenu.tsx` | `ui-base/DropdownMenu`. `window.confirm` becomes `AlertDialog`. |
| `TasksSidebar` | `TasksPanel.tsx`, `TaskRow.tsx`, `AllTasksDialog.tsx`, `ProgressCard.tsx` | new `ui-base/Tabs.tsx` (wraps `@radix-ui/react-tabs`, already installed); "Edit" opens the existing `todo/PersonalTaskDetailModal` |
| `QuickNotesWidget`, `NoteContent` | `QuickNotesPanel.tsx`, `QuickNoteItem.tsx`, `NoteContent.tsx` | `react-textarea-autosize`, `uuid` (both installed) |
| `DayDebriefModal`, `MultiDayCatchUpModal` | `DayDebriefDialog.tsx`, `CatchUpDialog.tsx` | `ui-base/Dialog`; engine `computeDebriefStats`, `canSaveDebrief`, `canSaveCatchUp` |
| `DayManagerModal` | `DayManagerDialog.tsx` | Dialog + `@dnd-kit` + engine `dayManager.ts` |
| `RescheduleModal` (589-LOC `TasksCalendar`) | `RescheduleDialog.tsx` | `ui-base/Popover` + `SmartDatePicker`. Revisions use the date part only, turned into a tz day; tasks use date + time. |
| `WeeklyReviewModal`, `AiContextExportModal`, `CreateSubjectModal`, `ResourcePreviewModal`, `GlobalEditCaptureModal` | `WeeklyReviewDialog`, `AiExportDialog`, `CreateSubjectDialog`, `AttachmentPreviewDialog`, `EditCaptureDialog` | Dialog, Input, Textarea, Button. Edit opens from the store, not a window event. |
| topic page `RevisionButton` | `DocRevisionButton.tsx` | Goes in the `docs/doc_editor/index.tsx` toolbar, next to "Add task linked to this doc". |

**Look:** keep Revise's sizes, spacing and order, and swap its colours for Recollect's tokens:

| Revise | Recollect |
|---|---|
| `bg-sidebar` | `--surface-elevated` |
| `hover:bg-hover` | `--surface-raised` |
| `border-divider` | `--border-subtle` |
| `text-foreground` / `text-muted` | `--foreground` / `--muted-foreground` |
| `accent` | `--primary` |
| emerald / amber / red | `--success` / `--warning` / `--destructive` (adherence: ≥70 / ≥40 / below) |

Fonts come from the app.

### Data flow
- **Load:** on mount, `load()` calls `GET /api/today`. If `needsEnsure`, it calls ensure once, then `GET` again.
- **Refetch:**
  - on `visibilitychange` after more than 60 s hidden (this replaces Pusher)
  - when a 60 s timer sees `today(tz)` change (midnight)
  - Quick-note drafts and optimistic notes are merged by id, never clobbered.
- **Optimistic updates (revert and toast on failure):**
  - complete / unmark moves the row between buckets and updates `totalDue`, then swaps in the server's `item` and `streak`. A 409 `LATER_CYCLE_DONE` shows "Undo cycle k first".
  - reschedule removes the row.
  - task toggle flips `status`.
  - quick-note create, edit, pin and delete work as in Revise (client UUID upsert).
  - capture create, edit or delete, debrief, catch-up and goal shift trigger a refetch after success.
  - Day Manager save replaces `schedule.slots` with the response.
- **Dates:**
  - Days stay strings and are compared as strings.
  - Display a day with `formatDay(day)`, which uses `Intl` with `timeZone:'UTC'` on `day+'T00:00:00Z'`.
  - Instants are `new Date(iso)` only at the edges. Turn one into a day with the engine's `dayOf(date, tz)`.
  - Never use `new Date('YYYY-MM-DD')`: that is UTC midnight, the 05:30 IST bug.
  - "now" (timeline, greeting, Day Manager `nowMinutes`) is `minutesOfDay(new Date(), tz)`.
- **Task tabs** (`taskGroups.ts`):
  - The "Due Today" tab shows overdue tasks first, with an Overdue badge, then today's. This fixes "overdue only in All".
  - When that tab would be empty, it becomes "Upcoming" with the 5 soonest.
  - Weekly = `goalType WEEKLY`.
  - The All dialog has Overdue / Today / Upcoming tabs.
- **Todo client (C2's findings):** the task widgets and the palette's Task mode must use the **fixed** `lib/api/todoApi.ts`:
  - TaskInput sends label names as `tags`, but `createTodo`/`updateTodo` forward only `labels`, so the backend (which reads `tags`) loses them.
  - Date-only AI dates are parsed as UTC.

  If the client isn't fixed when WP-E2 starts, E2 fixes it first: forward `tags` as names, and turn date-only values into the user's day.
- **Day Manager drag and drop** needs a **new dependency to approve**: `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0` and `@dnd-kit/utilities ^3.2.2` (Revise's versions, which work with React 19).
  - Set-up: `PointerSensor` (distance 5) + `KeyboardSensor` (`sortableKeyboardCoordinates`), `closestCenter`, `verticalListSortingStrategy`.
  - `onDragEnd` calls `moveSlot(state, active.id, over.id)`.
  - Every other control calls an engine handler (`updateSlot`, `togglePin`, `stepDuration`, `fillGap`, `pushDelay`, `setDayStart`, `addBlock`, `createCustomBlock`), and renders through `dayManagerRows` and `dayManagerSummary`.
  - Save sends `toSaveUpdates(slots, nowMinutes)` to `PUT /api/schedule/today`.
- **Doc integration:**
  - `DocsView` (`components/docs/doc_view/index.tsx`) reads `?id=`: it finds the doc in the store or calls `docApi.fetchDoc`, then `setCurrentDoc`.
  - `DocRevisionButton` calls #12. Its states come from `nextRevisionAction`:
    - *start*: subject picker, then #13
    - *due* / *early*: #5
    - *wait*: "Next revision in N days"
    - *completed*: "Mastered"

## 4. Ctrl+K: one palette

Keep the single listener in `app/(app)/layout.tsx` and extend `components/todo/QuickTaskAdd.tsx`.

- **Top row:**
  - a mode switch `[Task | Note | Link]` (Revise's Note/Task/Resource)
  - a **↻ Revise this** toggle
  - a subject chip, `learning/SubjectPicker.tsx` (Revise's LevelSelector). The default is Inbox. On `/docs` with a topic, it defaults to that topic's subject and topic.
  - 📌 pin and 📎 attach in Note/Link mode
- **Task mode** (the default, ↻ off): today's `TaskInput`, unchanged, plus a Goal chip (None / Week / Month) that maps to `goalType`. Saves through the fixed `todoApi` to `POST /api/todos`.
- **Note / Link mode** (↻ off): a new `learning/CaptureComposer.tsx` with Revise's behaviour:
  - title with date and `#category` highlighting, using `parseTaskInput` from `lib/utils/smartDateParser` (the same parser Revise used)
  - a details textarea
  - a `#category` dropdown (#17)
  - files (#21)

  It saves to #18. **A typed date ("tomorrow") turns the note into a task due that day**: a hint chip says "→ task due Thu 22 Oct" and it saves via `POST /api/todos`. This fixes "dates silently dropped".
- **↻ on** (any mode): saves a Capture (NOTE, or LINK for a bare URL) with `revise:true`, and the server starts the +1/+3/+7/+21 cycles in the same transaction.
  - The hint lists the 4 dates. A typed date is ignored for revisions, and the chip says so.
  - Turning ↻ on in Task mode switches to Note, because todos can't be revised.
- **Keys and after-save:**
  - Enter saves, Shift+Enter adds a newline, Esc closes.
  - After a save, call `useLearningStore.getState().refresh()` if Home is mounted.
  - Inside the quick-note composer, Ctrl+K keeps Revise's "insert link" and calls `stopPropagation`, so the palette doesn't open mid-note.

## 5. Import plan (Revise → Recollect; reads Revise only)

### Where topic content lives (answers STATE's open question)
Topic content lives **only** in `Topic.canvasData = { blocks[], connections[] }`. There is no text or notes column.
- **Blocks:** `text | code | image | embed | file`, each positioned with x / y / width / height.
- **Text blocks** store TipTap HTML: StarterKit, CodeBlockLowlight, TaskList, Table, plus Revise-only nodes:
  - callout `div[data-callout-type]`
  - mermaid `div[data-type=mermaid]`
  - mention `span[data-mention-id][data-label]`
  - `span[data-type=saved-resource]`
  - `div[data-type=image-gallery][data-images]`
  - `span[data-type=context-pill]`
- **Topic resources** are captures with `topicId` set, plus pinned `TopicCaptureLink`s.

So it is all canvas. The conversion is lossless for text but drops the spatial layout and the arrows. The original JSON is kept in `Topic.legacyCanvas`.

### Canvas → Doc (`scripts/import-revise/canvasToDoc.ts`, a pure function with fixture tests)
1. **Order:** sort the blocks by (y, x), i.e. reading order.
2. **Convert by block type:**
   - **text:** parse the HTML with `happy-dom`. This is the **one new dev dependency, for the script only; approve it.** Then rewrite the Revise-only nodes:

     | Revise node | Becomes |
     |---|---|
     | callout | blockquote |
     | mermaid | `pre>code.language-mermaid` |
     | table | one `p` per row, "a \| b \| c" |
     | mention | link "@Title" to the target topic's new doc (`/docs?id=`) |
     | context pill | text |
     | saved resource | link |
     | gallery | `img`s |

     Then run `DOMParser.fromSchema(getDocSchema())` (`services/docs/docContent.ts`, i.e. exactly the editor's schema).
   - **code:** `codeBlock {language}`.
   - **image:** `resizableImage {src}`. Leave it out of `Doc.cloudImages`, so Recollect never deletes Revise's files.
   - **embed / file:** a link paragraph.
   - **connections:** dropped (counted in the report).
3. **Resources:** append a "Resources" section (h2 + bullet list) for the topic's captures and pinned library captures.
4. **Encode:** `docJsonToYjsState(json)` → `Doc.yjsState`, and `generatePreviewAndMetadata` for `previewState`.
   - Doc fields: `{ userId, title: topic.title, docType:'notes', createdAt/updatedAt = the topic's }`.
   - Pass 1 creates every doc id, so mentions can link to them. Pass 2 fills in the content.

### Field mapping

| Revise | Recollect | Notes |
|---|---|---|
| User streak fields | target User `globalStreak`, `longestGlobalStreak`, `lastGlobalStreakDay` | `beforeCredit` and `learningRolledOverDay` = null, so the first rollover settles the streak honestly |
| Workspace | User `routineMode` | one workspace per run (`--workspace`); the dry-run lists all of them with row counts |
| Subject | Subject | same fields |
| Tag + `_TagToTopic` (A = Tag, B = Topic) | `Topic.tags` | names |
| Topic | Topic + new Doc | `legacyCanvas = canvasData` |
| Capture NOTE/LINK | Capture | `category` = NoteCategory.name; Attachment rows → `attachments` Json; goal/due fields dropped |
| Capture TASK | Todo (`id` = capture id) | see the TASK rules below |
| Reminder, not dismissed | Todo (`id` = reminder id) | title and description from its capture; due on the reminder day; pending; **no `Reminder` row**, so no surprise emails. Dismissed reminders are dropped. |
| Revision | Revision | `userId`; status validated; `undo` = null |
| SubjectStreak | SubjectStreak | epoch `lastCalculated` → null |
| DailyHistory | DailyHistory | duplicates per (subject, day) merged: sum done, max due |
| TimeBlock, DailyScheduleSlot, BlockSessionLog, DayDebrief | same models | duplicates after day normalisation: newest wins (reported) |
| QuickNote | QuickNote | same UUID; unknown category → PRIMARY |

**TASK captures become todos with these rules:**
- **title:** the capture's title, or else the first 80 characters of its content.
- **description:** the escaped content as `<p>` HTML, plus attachment links.
- **status:** complete or pending, with `completedAt`.
- **dueDate:** `parseDateOnly(reviseDueDay)`; when Revise's `time` field is set, that sets the clock time.
- **goalType:** copied.
- **category:** becomes a Recollect Tag (`resolveTagIds`) on a TodoTag row.
- **topic:** becomes `references:[{type:'doc', refId}]`.
- **pin and subject:** dropped.
- **TASK captures with revisions** are imported as NOTE Captures instead, so the chain survives. These are counted in the report.

**Dates:**
- **Day columns:** every Revise day label goes through `dayFromReviseLabel`, which handles 00:00Z labels and the legacy 18:30Z rows.
- **Task and reminder due dates:** use `reviseDueDay(v)`:
  - if the UTC time is 23:59:59.999 (Revise's end-of-day label), take the UTC date
  - otherwise take the IST day

  The result is stored at 18:00 local (Recollect's date-only rule, `utils/timezone.parseDateOnly`).

**Dropped:**
- `ActivityLog`: only the subject page and an unused counter read it.
- `Habit`: counted. If the dry-run finds any, ask whether the mentor report needs them.
- `NoteCategory` colours and icons, `TopicMention` (folded into doc links) and `TopicCaptureLink` (folded into Resources).
- Revise User/auth.
- Revise's database itself stays untouched as the archive.

**Ids:**
- Keep Revise's UUIDs as primary keys for every learning row (QuickNote has to anyway). The backend validates no id format.
- Docs get new cuids, linked through `Topic.docId`.
- Re-runs match rows by id.

### Safety, dry-run, verification
- **The script never connects to live Revise.**
  - Take a `pg_dump` (a read-only operation) and `pg_restore` it into `revise_copy` on the dev Postgres (127.0.0.1:5433).
  - The source URL comes from env `REVISE_SOURCE_URL` and is never logged.
  - The connection uses `options=-c default_transaction_read_only=on`; every read runs in `BEGIN READ ONLY`; the source module exposes only fixed SELECTs (raw `pg`, no second Prisma client).
- **Target:**
  - the backend's Prisma client
  - one interactive transaction (timeout 10 min)
  - it refuses if the user already has learning rows, unless `--replace`. That flag deletes the user's learning rows and the docs of imported topics, and is meant only before Ramin starts writing in Recollect.
  - production needs an explicit `--target-env prod`
- **Invocation:** `npm run import:revise -- --target-email … --workspace … [--dry-run|--verify|--replace]`.
- **`--dry-run`:** does everything, then rolls back. Writes `import-report.json` and a `.md` summary:
  - rows in and out per table
  - dropped and merged rows, with reasons
  - the count of legacy 18:30Z rows
  - canvas statistics: blocks by type, unsupported nodes, connections dropped, empty canvases
  - habits and workspaces found
  - 3 sample docs as plain text
- **`--verify`:** run after the real import. It checks:
  - ids and counts are equal
  - every revision's (cycle, interval, day, status, completedAt) is equal
  - today's Revisions Due buckets computed from the source (engine `buildRevisionBuckets` on the mapped rows) equal `GET /api/today`'s
  - the streak equals Revise's value, or is 0 where Revise's stale number should have dropped (listed)
  - 7-day adherence is equal
  - quick-note content hashes are equal
  - **text coverage**: every text block's plain text appears in its doc (`yjsStateToDocJson` → text)

## 6. Work packages

| WP | Scope | Depends on | Acceptance |
|---|---|---|---|
| **E1 Backend** | migration `learning` (+ CHECK); engine follow-ups 1–5; `learningDb` services, serializers, controllers and router for #1–29 (#30–33 only if Q1 = yes); `goalType` in C2's todo input and shape; rollover service + cron + ensure; error mapping; integration tests with `TEST_DB_NAME=recollect_test_e1` | nothing (C2 is done) | tsc 0; unit and integration suites pass (happy path, 401, foreign id 404, 400, every 409); a Prisma query spy proves `GET /api/today` issues SELECTs only; undo restores dates **and** streak exactly; rest day = neutral, missed day = 0 at midnight; rollover idempotent and catches up 3 days; `/api/today` < 300 ms on the fixture |
| **E2 Frontend** | everything in §3 and §4; `ui-base/Tabs`; `?id=` doc deep link; `DocRevisionButton`; engine copy; todoApi fix if still open | E1 contract (can start against `lib/learning/fixtures/today.json`); `@dnd-kit` approval | side-by-side screenshots match Revise's reference shots (same elements, same order, desktop and mobile); every action works against local E1; plain Ctrl+K task creation unchanged; no new tsc errors and no new lint errors; no `new Date('YYYY-MM-DD')` in learning code |
| **E3 Import** | `scripts/import-revise/` (source, mapping, canvasToDoc, verify, report); `happy-dom` dev dependency | E1 schema; C1's `docContent.ts` schema (textStyle fix); a restored `revise_copy` | supervisor reviews the dry-run report; `--verify` passes 100% or lists accepted exceptions; real run on `recollect_dev`; Ramin spot-checks 5 docs |

## 7. Open questions for Ramin

1. **Routine editing.** Do you change your weekly routine (time blocks) often? v1 has no planner page: the Day Manager edits today only, and there is no Vacation pre-skip. If you do, we add a small Routine editor (#30–33 are designed for it).
2. **The 2-week overlap.** Which app will you *write* to? The recommendation is Recollect, with Revise kept read-only. If you keep writing in Revise, we re-import with `--replace` just before you switch.
3. **Home widgets.** Is it OK for `/` to lose today's Recollect Home widgets (Recently visited, Plan your day), or should "Recently visited" stay below the timeline?
4. **"Delay +30m".** It currently shrinks the first block, as in Revise. Keep that, or should it push the whole day back 30 min?
5. **Dated notes.** Is it OK that a Ctrl+K note with a date becomes a task due that day? This replaces Revise's "reminder notes"; such tasks show in the Tasks tab and can email like any Recollect reminder.
