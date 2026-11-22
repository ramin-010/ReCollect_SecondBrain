# Daily loop v2: spec (contract for the backend and the frontend)

_2026-11-14. These are Ramin's three answers, decided by the supervisor at his request ("go with the things and complete all three questions"):_
1. **Time blocks and all end-of-day logging are switched OFF** (the code is kept; `routineEnabled` defaults to false).
2. **First goal:** an editable example, "Product-company SDE role" by 30 Jun 2027. Ramin sets the real one in the app.
3. **Nudge:** a morning email digest (default 08:30 local) plus the app as his browser start page. Phone push comes later.

Builds on LEARNING_SPEC.md (existing endpoints stay). PRODUCT.md (in recollect/) holds the why. JSON uses `_id`, and days are 'YYYY-MM-DD' in the user's timezone.

## 1. Settings (User fields + endpoints)
| Field | Type / default | Notes |
|---|---|---|
| `dailyBudgetMin` | Int, 25 (5–120) | the size of Today |
| `routineEnabled` | Bool, false | time blocks / timeline / Day Manager / triage / debrief / catch-up |
| `busyUntil` | Day? | busy mode is on while today ≤ busyUntil; "Busy week" sets today+6 |
| `nudgeEmailEnabled` | Bool, true | |
| `nudgeTime` | "HH:mm", "08:30" | user's local time |
| `lastNudgeDay` | Day? | idempotency |
| `lastSeenDay` | Day? | set by `POST /api/learning/ensure-today` (already called on load) |

- `GET /api/learning/settings` returns these fields plus `timezone`.
- `PATCH /api/learning/settings` accepts any subset (zod; 400 INVALID_INPUT).

## 2. Today = a budgeted plan + a quiet backlog (no writes in GET)
Pure engine function `planToday({ candidates, today, budgetMin, mode, goalSubjectIds })` returns `{ planned, waitingCount, estMinutes }`.
- **Candidates:** the earliest pending revision per item with scheduledFor ≤ today.
- **Minutes per item:** cycle 1 = 8 min, otherwise 5 (constants in the engine).
- **Priority:**
  1. linked to an active goal's subjects
  2. lower cycle first
  3. more days late (capped at 14)
  4. scheduledFor ascending
  5. stable id
- **Filling:** add items until the budget is reached. With any candidates, plan at least 3 (so a big first item doesn't leave Today empty).
- **Modes:**

  | mode | when | limit |
  |---|---|---|
  | `busy` | busyUntil ≥ today | max 3 items, budget ≤ 10 |
  | `comeback` | lastSeenDay ≤ today−3 (or null with history) | max 5 items that day |
  | `normal` | otherwise | the budget |

- The `GET /api/today` response gains:
  ```json
  "plan": { "mode": "normal|busy|comeback", "budgetMin": 25, "estMinutes": 23,
            "planned": [ /* revision items, same item shape as today */ ],
            "waitingCount": 12, "doneToday": [ /* … */ ] }
  ```
  Keep the old `revisions` block for now (back-compat); the new UI uses `plan`.
- **`POST /api/revisions/fresh-start`** reschedules every overdue pending chain. Each chain's earliest pending revision is spread over the next days (at most `itemsPerDay` = what fits the budget), and later cycles keep their gaps. It returns `{ moved, spreadDays }`. The UI asks for confirmation first; there is no undo.

## 3. Focus lines (up to 3 per day, no times)
- **Model:** `FocusItem { id, userId, day, text ≤140, done, sortOrder, createdAt }`. A 4th item → 409 FOCUS_LIMIT.
- **Endpoints:**
  - `POST /api/focus` {text} → today
  - `PATCH /api/focus/:id` {text?, done?}
  - `DELETE /api/focus/:id`
  - `POST /api/focus/carry-over` {ids}: copies yesterday's unfinished items to today, within the limit
- **`GET /api/today`** adds `"focus": { "items": [...], "carryOver": [ /* yesterday's unfinished */ ] }`.

## 4. Goals with deadlines
- **Models:**
  - `Goal { id, userId, title ≤120, why? ≤500, deadline Day, status active|done|archived, createdAt, updatedAt }`, plus links to Subject (many-to-many)
  - `GoalMilestone { id, goalId, title ≤140, dueDay?, done, doneAt?, sortOrder }`
  - A 4th active goal → 409 GOAL_LIMIT.
- **Pure engine function `goalForecast({ milestones, createdDay, deadline, today })`** returns `{ daysLeft, progress:{done,total}, pacePerWeek, projectedDay|null, status, behindDays, requiredPerWeek, suggestion }`.
  - `status` is one of: on_track · ahead · behind · no_data · overdue · done.
  - `pacePerWeek` = milestones done ÷ weeks since creation (minimum 1 week).
  - `projectedDay` = today + remaining ÷ pace.
  - `no_data` when nothing is done and fewer than 7 days have passed.
  - `suggestion` is plain text, e.g. "1 more milestone a week keeps you on track".
  - It never scolds.
- **Endpoints:**
  - `GET /api/goals`, `POST /api/goals`
  - `PATCH /api/goals/:id`, `DELETE /api/goals/:id`
  - `POST /api/goals/:id/milestones`
  - `PATCH /api/goal-milestones/:id`, `DELETE /api/goal-milestones/:id`
- **`GET /api/today`** adds `"goals": [{ _id, title, deadline, daysLeft, progress, forecast, nextMilestone }]` (active goals only).
- **Naming (one name for one thing):** in the UI, "Goals" means only these. Revise's weekly/monthly items are todos shown as "This week" / "This month" and are never called goals.

## 5. Rhythm (replaces the streak in the UI)
- `stats.rhythm = { last7: [{ day, active }], activeDays }`. A day is active if at least 1 revision was completed or a focus item was done.
- Keep the streak fields for back-compat; the UI stops featuring them.

## 6. Routine off by default
- **When `routineEnabled` is false:**
  - `GET /api/today` returns `schedule: null`, `triage: null`, `todayDebrief: null`.
  - The rollover cron skips slot generation, backfill and triage, so nothing "missed" builds up in the background. Streak/rhythm settling is unaffected.
- **Weekly review is never a modal on open.** The UI shows a quiet "Plan your week" link on Mondays.

## 7. Morning nudge (email)
- **Schedule:** a cron every 15 min. It sends to users with nudgeEmailEnabled, whose local time is at or past nudgeTime, and whose lastNudgeDay ≠ today, then sets lastNudgeDay. It's idempotent.
- **Subject:**
  - "Today: 6 revisions · ~25 min"
  - busy mode: "Busy week: just 3 things today"
  - nothing due: "Nothing due today"
- **Body:** the top 3 planned items, active goals with days left, and one button "Open Recollect" (`APP_URL`).
- Reuses the existing mailer and its templates' style.

## 8. Pocket (frontend only)
- One-click copy on code blocks and on single-line notes.
- Ctrl+K also searches quick notes.
- Pinned notes come first.

## 9. Dev seed
`dev@recollect.local` gets:
- the example goal (deadline 2027-06-30, 6 milestones, 2 done)
- `dailyBudgetMin` 25 and 2 focus items
- an overdue backlog of about 15 items (some about 35 days late), so the budget/"waiting" UI shows
- pinned notes including an ssh/deploy command in a fenced code block
- one long-text note and one link note

Keep the existing routine data, which is now hidden by `routineEnabled=false`.

## 10. As built (2026-11-14): where the implementation differs from this spec
These come from worker G1, the backend. The frontend client (G2) matches them.
1. **Settings:** `GET /api/learning/settings` also returns `routineMode`. PATCH ignores `lastNudgeDay` and `lastSeenDay`.
2. **`needsEnsure`:** also true when `lastSeenDay` < today, so the client calls `POST ensure-today` once a day.
3. **Comeback mode:** reads `prevSeenDay` (an extra User field), so it lasts the whole day after ensure-today. "History" means any revision completed before today.
4. **Plan items:** `plan.planned` and `plan.doneToday` items are the existing revision items plus `minutes`. Overdue planned items carry `daysLate`; done items carry `canUndo`.
5. **The plan counts `doneToday`** toward the budget, the minimum of 3 and the busy/comeback caps, so finishing the plan doesn't refill it.
6. **Carry-over:** `POST /api/focus/carry-over` returns `{items, carried}`. It carries unfinished lines from any earlier day and de-duplicates by text. It returns 409 only when today is full and something could still be carried.
7. **Goal JSON:** `{_id,title,why,deadline,status,subjects:[{_id,name,color}],milestones,daysLeft,progress,forecast,nextMilestone,createdAt,updatedAt}`.
   - POST also accepts `subjectIds` and `milestones:[{title,dueDay?}]`.
   - The deadline must be today or later (400 `INVALID_DAY`).
   - Re-activating a 4th goal returns 409 `GOAL_LIMIT`.
8. **Milestone JSON:** `{_id,goalId,title,dueDay,done,doneAt,sortOrder}`. POST and PATCH return `{milestone, goal}`; DELETE returns `{deleted:true, goal}`.
9. **Forecast:**
   - `daysLeft` goes negative after the deadline.
   - `behindDays` is 0 unless behind; when overdue it's the days past the deadline; it's null when behind with no pace yet.
   - `requiredPerWeek` is null when overdue.
   - `ahead` means a pace of at least 1.25× what's required.
   - The client writes its own one-sentence forecast, because `suggestion` repeats the status.
10. **Fresh start:** accepts `{dryRun:true}`, which returns the same answer without writing. The confirm sheet uses it ("This moves 15 items over the next 5 days").
11. **Nudge:**
    - It goes only to users with revisions, goals or focus lines, never to ghost users.
    - It skips reserved domains such as `.local`.
    - It sends to `reminderEmail`, falling back to the account email.
    - The subject is "Today's plan is done" when nothing is planned but items are waiting.
    - A failed send isn't retried that day.
12. **Rhythm:** `stats.rhythm.last7` is ordered oldest to newest.

**Open follow-ups** (found by G2; in STATE §8):
- add the goal's `createdDay` and `busyUntil` to `/api/today`
- in busy mode, the minimum-3 rule can exceed the 10-min cap
- add a "next due day" when nothing is due

### 2026-11-21 evening (Home rethought on dev, not committed; HISTORY bl, `recollect/DESIGN.md` design log)
- **The slip (§2)** is no longer a card: an open list under a one-line label ("Revise · 0 of 7 · 60-min budget"). Rows carry no minutes; **the budget is a session the user starts** (Start; the dashed line fills with the time; "N min over"; "done in N min"), kept per day in the browser. Rows read "Title · Subject", "2/4", "41d late". A doc's row opens the doc and its check asks Complete or Quiz me on it; a note unfolds and edits in place; a calendar moves any row. A row ticked now strikes through from the centre and moves to the end, faded.
- **Focus (§3)** sits inside "Today's focus" under the tasks due (or, with none due, each path's next topic), with "Add a focus" last (a focus line, never a task).
- **Tasks on Home** come right under the buddy, before the slip.

