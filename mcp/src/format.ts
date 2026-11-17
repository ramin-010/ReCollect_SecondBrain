// Compact text for agents (they pay per token): one line per thing, ids where the next call needs
// them, dates as YYYY-MM-DD.
import type { GoalForecast, Milestone, RevisionItem } from './types.js';

export const UNDO_LINE = 'Undo: the user can undo this from Home → From your agent.';

/** Revision cycles of a topic (1, 3, 7 and 21 days). */
export const REVISION_CYCLES = 4;

/** Every write result ends with the Undo line. */
export function withUndo(text: string): string {
    return `${text}\n${UNDO_LINE}`;
}

/**
 * A save in a work folder (B10): the agent saved it on its own, so its answer says to keep it out of the
 * reply (a real run showed one "I also saved your idea as a pocket note" in nineteen turns).
 */
export function quietly(workMode: boolean | undefined, text: string): string {
    return workMode ? `${text}\nSaved quietly: say nothing about it in your reply unless he asked for it.` : text;
}

export function plural(n: number, word: string, many = `${word}s`): string {
    return `${n} ${n === 1 ? word : many}`;
}

/** `"text"` on one line, cut to `max` characters. */
export function quote(text: string | null | undefined, max = 80): string {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    return `"${clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean}"`;
}

/** The parts of an instant in a time zone (UTC when the zone is unknown to this Node). */
function partsIn(date: Date, timeZone: string): Record<string, string> {
    let fmt: Intl.DateTimeFormat;
    try {
        fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch {
        fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** An ISO instant → its day in the user's time zone (`2026-11-14`); UTC without a zone. */
export function dayOf(iso: string | null | undefined, timeZone = 'UTC'): string {
    if (typeof iso !== 'string') return '?';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso.length >= 10 ? iso.slice(0, 10) : '?';
    const p = partsIn(date, timeZone);
    return `${p['year']}-${p['month']}-${p['day']}`;
}

/** An ISO instant → `2026-11-14 15:00` in the user's time zone; UTC without a zone. */
export function timestamp(iso: string | null | undefined, timeZone = 'UTC'): string {
    if (typeof iso !== 'string') return '?';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const p = partsIn(date, timeZone);
    return `${p['year']}-${p['month']}-${p['day']} ${p['hour']}:${p['minute']}`;
}

export function daysLeftText(daysLeft: number): string {
    if (daysLeft > 0) return `${plural(daysLeft, 'day')} left`;
    if (daysLeft === 0) return 'due today';
    return `${plural(-daysLeft, 'day')} past the deadline`;
}

export function forecastText(forecast: Pick<GoalForecast, 'status' | 'behindDays'> | null | undefined): string {
    switch (forecast?.status) {
        case 'on_track':
            return 'on track';
        case 'ahead':
            return 'ahead of plan';
        case 'behind':
            return forecast.behindDays ? `behind by ${plural(forecast.behindDays, 'day')}` : 'behind (no milestones done yet)';
        case 'no_data':
            return 'no forecast yet';
        case 'overdue':
            return 'past the deadline';
        case 'done':
            return 'done';
        default:
            return 'no forecast';
    }
}

export function cycleText(cycleNumber: number): string {
    return `cycle ${cycleNumber}/${REVISION_CYCLES}`;
}

/** One due revision: title · subject · cycle · lateness · the doc to open. */
export function revisionLine(item: RevisionItem, extra = ''): string {
    const parts = [item.title.trim() || 'Untitled', item.subject?.name ?? 'no subject', cycleText(item.cycleNumber)];
    const late = item.daysLate ?? 0;
    parts.push(late > 0 ? `${plural(late, 'day')} late` : 'due today');
    if (item.minutes) parts.push(`~${item.minutes} min`);
    parts.push(item.kind === 'topic' ? (item.docId ? `doc ${item.docId}` : 'no doc') : 'a note (no doc)');
    // The review's own id: complete_revision and move_revision take it.
    parts.push(`review ${item._id}`);
    return `- ${extra}${parts.join(' · ')}`;
}

export function milestoneLine(m: Milestone): string {
    return `[${m.done ? 'x' : ' '}] ${m.title}${m.dueDay ? ` · due ${m.dueDay}` : ''} · id ${m._id}`;
}

/** "next: "Title" (due …, id …)" for a goal's next milestone. */
export function nextMilestoneText(m: Milestone | null | undefined): string {
    if (!m) return 'no open milestones';
    return `next: ${quote(m.title, 60)} (${m.dueDay ? `due ${m.dueDay}, ` : ''}id ${m._id})`;
}

/** Comma-separated quoted names, or a fallback. */
export function nameList(names: readonly string[], none = 'none'): string {
    return names.length > 0 ? names.map((n) => quote(n, 60)).join(', ') : none;
}
