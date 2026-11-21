// The buddy (BUDDY_MEMORY_PLAN §3.1 B; MCP_MEMORY_PLAN §4.2, §4.8): what a chat learns about the user goes to
// their memory, with when it was said and whose word it is; progress on, a change to or the end of something known
// goes to update_memory; a chat looks things up with recall_memory. Every save answers with what is related and
// what is in motion, so one app sees what another saved or corrected.
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError } from '../api.js';
import { ToolError } from '../errors.js';
import { quietly, quote, withUndo } from '../format.js';
import { clockText, dayLabel, localDay, markLogged, readClock } from '../hook.js';
import { zId } from '../schemas.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

export const MEMORY_KINDS = ['fact', 'preference', 'value', 'aim', 'idea', 'decision', 'pattern', 'state', 'thread', 'win'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const UPDATE_KINDS = ['said', 'progress', 'done', 'skipped', 'changed', 'paused', 'resumed', 'dropped', 'finished'] as const;

export interface Memory {
    _id: string;
    text: string;
    kind: MemoryKind;
    sensitivity: 'open' | 'private';
    status: 'active' | 'faded' | 'closed' | 'wrong';
    pinned: boolean;
    byUser: boolean;
    seenCount: number;
    lastSeenDay: string;
    /** Newer servers (MCP_MEMORY_PLAN §4.8): where it came from, and its place in a chain of corrections. */
    firstSeenDay?: string;
    source?: string;
    agentName?: string | null;
    inferred?: boolean;
    checkSince?: string | null;
    closedDay?: string | null;
    closeReason?: string | null;
    replacedBy?: { _id: string; text: string } | null;
    replaces?: { _id: string; text: string } | null;
}

export type NoteOutcome =
    /** mayReplace (newer servers): an older memory its words may replace; that one is marked to check, both kept. */
    | { status: 'saved'; memory: Memory; mayReplace?: { _id: string; text: string } }
    | { status: 'seen'; memory: Memory; reopened?: true; noted?: true }
    | { status: 'closed'; memory: Memory; replacedBy: Memory | null }
    | { status: 'wrong'; memory: Memory; similar?: true }
    | { status: 'empty' }
    /** One day's doing of something already followed: recorded as its day news, no new memory (newer servers). */
    | { status: 'linked'; target: 'thread' | 'memory'; update: string; label: string; thread?: { _id: string; title: string; stage: string }; memory?: Memory };

/** "Related" and "In motion" (§4.2, §4.6), as the API answers them. */
export interface ThreadLast {
    day: string;
    kind: string;
    text: string;
}
export interface Related {
    memories: Array<{ _id: string; text: string; kind: string; lastSeenDay: string; app: string; looksLikeOld: boolean }>;
    threads: Array<{ _id: string; title: string; stage: string; last: ThreadLast | null }>;
}
export interface InMotion {
    _id: string;
    type: 'thread' | 'memory';
    text: string;
    stage?: string;
    kind?: string;
    last: ThreadLast | null;
    /** A thread the person changed since its title was written: their newest change (newer servers). */
    now?: { day: string; text: string } | null;
}

const zKind = z.enum(MEMORY_KINDS);

export interface WorkDay {
    day: string;
    projects: Array<{
        project: string;
        office: boolean;
        minutes: number;
        sessions: number;
        commits: string[];
        lines: Array<{
            _id: string;
            kind: string;
            text: string;
            at?: string | null;
            /** Newer servers (stage 12): the app that wrote it, what came after it on a later day, the decision it changed. */
            app?: string | null;
            later?: { kind: string; day: string; text: string; word: string } | null;
            was?: { text: string; day: string; kind?: string; app?: string | null } | null;
            /** An open line a later done line likely closed, not linked (newer servers). */
            likely?: { _id: string; text: string; day: string; app: string | null } | null;
        }>;
    }>;
}

export const WORK_LINE_KINDS = ['did', 'decided', 'stuck', 'next'] as const;

type LogWorkResult = { status: 'saved'; day: string; project: string; saved: number; skipped: number } | { status: 'off' } | { status: 'paused' };

const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

/** One day of the work log as text: "Sun 15 Nov" then each project with its time, lines and commits. */
export function workDayText(d: WorkDay): string {
    const day = new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const parts = d.projects.map((p) => {
        const head = `${p.project}${p.minutes ? ` · ${mins(p.minutes)}` : ''}${p.sessions > 1 ? ` in ${p.sessions} sessions` : ''}`;
        const lines = p.lines.map((l) => {
            const word = l.kind === 'stuck' ? 'open' : l.kind;
            const kind = l.kind === 'did' || new RegExp(`^(${word}|stuck)\\b`, 'i').test(l.text.trim()) ? '' : `${word}: `;
            const later = l.later ? ` (${l.later.word} ${l.later.day}: ${quote(l.later.text, 80)})` : '';
            // What it follows: the open problem it fixes, the decision it changed (newer servers).
            const was = !l.was
                ? ''
                : l.kind === 'decided' && (!l.was.kind || l.was.kind === 'decided')
                  ? ` (changed from ${quote(l.was.text, 80)}, ${l.was.day})`
                  : l.was.kind === 'stuck' && l.kind === 'did'
                    ? ` (fixes the open ${quote(l.was.text, 80)}, ${l.was.day}${l.was.app ? ` via ${l.was.app}` : ''})`
                    : ` (after ${quote(l.was.text, 80)}, ${l.was.day})`;
            const marks = [l.app ? `via ${l.app}` : null, `id ${l._id}`].filter(Boolean).join(' · ');
            const likely = l.likely && !l.later ? ` (likely done by ${quote(l.likely.text, 80)}, not linked)` : '';
            return `  - ${l.at ? `${l.at} ` : ''}${kind}${l.text}${was}${later}${likely} · ${marks}`;
        });
        const commits = p.commits.length ? [`  commits: ${p.commits.slice(0, 5).join('; ')}`] : [];
        return [head, ...lines, ...commits].join('\n');
    });
    return `${day}\n${parts.join('\n')}`;
}

/**
 * The open view as text (stage 12): what is still open, then what was open and got closed in the last days (with what
 * closed it), so "is anything from the review still open?" is answered from both.
 */
export function openText(days: readonly WorkDay[]): string {
    const all = days.flatMap((d) => d.projects.flatMap((p) => p.lines.map((l) => ({ ...l, day: d.day, project: p.project }))));
    const item = (l: (typeof all)[number]) => `- ${l.project} · ${l.day}: ${l.kind === 'next' ? 'next: ' : ''}${l.text}${l.app ? ` · via ${l.app}` : ''} · id ${l._id}`;
    const open = all.filter((l) => !l.later && !l.likely);
    const likely = all.filter((l) => !l.later && l.likely);
    const closed = all.filter((l) => l.later);
    return [
        open.length ? ['Still open:', ...open.map(item)].join('\n') : 'Nothing is still open.',
        ...(likely.length
            ? [['Likely done, not linked (a later line looks like the fix: say it looks done, not confirmed):', ...likely.map((l) => `${item(l)} → likely fixed by ${quote(l.likely!.text, 100)}${l.likely!.app ? ` (via ${l.likely!.app})` : ''}`)].join('\n')]
            : []),
        ...(closed.length ? [['Open lately, now closed:', ...closed.map((l) => `${item(l)} → ${l.later!.word} ${l.later!.day}: ${quote(l.later!.text, 100)}`)].join('\n')] : []),
    ].join('\n');
}

/** When it was said, if not just now (§4.2). */
const zSaidOn = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    .describe('When they said it, if not just now: YYYY-MM-DD, with THH:mm when you know the time. Never later than now.');
const zInferred = z.boolean().optional().describe('true when they did not say it and you are concluding it.');

/** One note about the user, as remember takes it. */
export const zNoteFields = {
    text: z.string().trim().min(1).max(300).describe('One thing, in their words where possible, e.g. "Walks after work most days".'),
    kind: zKind.optional().describe('Default fact. pattern: a habit; state: a mood or worry; thread: a plan or promise.'),
    said_on: zSaidOn.optional(),
    inferred: zInferred,
    private: z.boolean().optional().describe('Health, money, family, other people, fears, work conflicts (a state is, by default).'),
};

/** Where a memory came from: its app, or Recollect itself. */
function viaOf(m: Memory): string | null {
    if (m.agentName) return m.agentName;
    if (!m.source) return null;
    return m.source === 'hook' ? 'Claude Code' : m.source === 'buddy' ? 'the buddy' : m.source === 'agent' ? 'an agent' : 'Recollect';
}

/** A memory as one line: its words, then its marks (kind, whose word, when said and last seen, where from, its chain), then its id. */
export function memoryLine(m: Memory): string {
    const via = viaOf(m);
    const marks = [
        m.kind,
        m.inferred ? 'inferred' : null,
        m.checkSince ? 'check: said two ways, which one holds is not settled' : null,
        m.sensitivity === 'private' ? 'private' : null,
        m.pinned ? 'pinned' : null,
        m.byUser ? 'their own' : null,
        m.status === 'closed' && m.closeReason ? `closed: ${quote(m.closeReason, 90)}` : m.status !== 'active' ? m.status : null,
        m.replacedBy ? `replaced by ${quote(m.replacedBy.text, 70)} (id ${m.replacedBy._id})` : null,
        m.seenCount > 1 ? `seen ${m.seenCount}×` : null,
        m.firstSeenDay ? `said ${m.firstSeenDay}${m.lastSeenDay !== m.firstSeenDay ? `, last ${m.lastSeenDay}` : ''}` : null,
        via ? `via ${via}` : null,
    ].filter(Boolean);
    return `${quote(m.text, 200)} (${marks.join(', ')}) · id ${m._id}`;
}

/** A thread: one thing going on in their life the buddy follows (its stage, its last words). */
export interface ThreadFound {
    _id: string;
    title: string;
    stage: string;
    sensitive: boolean;
    firstDay: string;
    last: Array<{ day: string; kind: string; text: string }>;
}

export function threadLine(t: ThreadFound): string {
    const marks = [t.stage, t.sensitive ? 'private' : null, `since ${t.firstDay}`].filter(Boolean);
    const last = t.last.map((e) => `${e.day} ${e.kind}: ${quote(e.text, 120)}`).join('; ');
    return `Going on: ${quote(t.title, 120)} (${marks.join(', ')})${last ? ` · ${last}` : ''} · id ${t._id}`;
}

export function noteLine(n: NoteOutcome): string {
    if (n.status === 'empty') return 'Not saved: nothing left after removing secrets.';
    if (n.status === 'saved') {
        const replaces = n.mayReplace ? `This may replace ${quote(n.mayReplace.text, 100)} (id ${n.mayReplace._id}): if it does, call update_memory on it with changed or dropped. Both are kept until then.\n` : '';
        return `${replaces}Saved: ${memoryLine(n.memory)}${n.memory.inferred ? '\nKept as an inference until they say it themselves.' : ''}`;
    }
    if (n.status === 'seen') {
        if (n.reopened) return `Said again after it was closed, so it is active again: ${memoryLine(n.memory)}`;
        if (n.noted) return `Already known (an inference adds a note only): ${memoryLine(n.memory)}`;
        return `Already known, seen again: ${memoryLine(n.memory)}`;
    }
    if (n.status === 'closed') {
        const when = n.memory.closedDay ? ` on ${n.memory.closedDay}` : '';
        const why = n.memory.closeReason ? ` (${quote(n.memory.closeReason, 90)})` : '';
        const next = n.replacedBy
            ? ` It was replaced by ${quote(n.replacedBy.text, 90)}: if they changed back, call update_memory with on ${n.replacedBy._id} and update changed.`
            : ' Said again on a later day, it comes back.';
        return `Kept as a note only: ${quote(n.memory.text, 120)} was closed${when}${why} and stays closed.${next}`;
    }
    if (n.status === 'linked') {
        const id = n.thread?._id ?? n.memory?._id ?? '';
        return `Counted as ${n.update} on ${quote(n.label, 100)} (id ${id}), not saved as a new memory: it is one day's news about something already followed.`;
    }
    if (n.status !== 'wrong') return 'Saved.';
    if (n.similar) return `Not saved: it is close to ${quote(n.memory.text, 80)}, which the user marked wrong.`;
    return `Not saved: the user marked ${quote(n.memory.text, 80)} wrong.`;
}

const lastText = (l: ThreadLast | null) => (l ? ` · ${l.day} ${l.kind}: ${quote(l.text, 70)}` : '');

/** "Related" and "In motion" as lines (nothing when both are empty). */
export function listsText(related: Related | undefined, inMotion: InMotion[] | undefined): string {
    const lines: string[] = [];
    const rel = related ?? { memories: [], threads: [] };
    if (rel.memories.length || rel.threads.length) {
        lines.push('Related (newest first; another app may have saved or changed these):');
        for (const m of rel.memories) {
            const hint = m.looksLikeOld ? ` · if this replaces it, call update_memory with on ${m._id} and update changed` : '';
            lines.push(`- ${quote(m.text, 120)} (${m.kind}, last ${m.lastSeenDay}, via ${m.app}) · id ${m._id}${hint}`);
        }
        for (const t of rel.threads) lines.push(`- Going on: ${quote(t.title, 100)} (${t.stage}${lastText(t.last)}) · id ${t._id}`);
    }
    if (inMotion?.length) lines.push(`In motion (pass progress on these with update_memory and the id): ${inMotion.map((x) => `${quote(x.text, 70)}${x.now ? ` (now: ${quote(x.now.text, 70)})` : ''} [${x._id}${x.last ? `; ${x.last.day} ${x.last.kind}` : ''}]`).join(' · ')}`);
    return lines.join('\n');
}

const OLDER_SERVER_SAVE = 'This Recollect server is older: saved without when it was said and whose word it is (it takes them from its next release).';

interface UpdateAnswer {
    paused: boolean;
    target?: 'memory' | 'thread';
    outcome?: 'noted' | 'seen' | 'already' | 'replaced' | 'history' | 'check' | 'closed' | 'reopened' | 'repeat' | 'apart';
    /** Newer servers: not about the thing named, so kept as its own note; or recorded as another kind than chosen. */
    apart?: { from: { _id: string; text: string }; note: NoteOutcome };
    readAs?: { from: string; to: string };
    memory?: Memory;
    replaced?: Memory | null;
    movedFrom?: string | null;
    current?: { text: string; day: string; app: string } | null;
    editId?: string | null;
    thread?: { _id: string; title: string; stage: string } | null;
    related?: Related;
    inMotion?: InMotion[];
}

/** update_memory's answer as text: what changed, what was replaced or closed (with Undo), then the lists. */
export function updateText(r: UpdateAnswer, said: string): string {
    const lines: string[] = [];
    const m = r.memory;
    if (r.movedFrom && m) lines.push(`That id was an older version: applied to the newest, ${quote(m.text, 100)} (id ${m._id}).`);
    if (r.readAs) lines.push(`Recorded as ${r.readAs.to}, not ${r.readAs.from}: the words tell of one day's doing, not a new routine or an end.`);
    const t = r.thread;
    switch (r.outcome) {
        case 'apart':
            lines.push(`Not about ${quote(r.apart?.from.text, 90)}: the words share nothing with it, so it was left as it was and this was kept as its own note.`);
            if (r.apart) lines.push(noteLine(r.apart.note));
            break;
        case 'replaced':
            lines.push(`Changed: now ${quote(m?.text, 120)} (id ${m?._id}). ${quote(r.replaced?.text, 100)} is closed and kept as history.`);
            break;
        case 'seen':
            lines.push(t ? `Added to ${quote(t.title, 100)} (${t.stage}) · id ${t._id}` : `Noted on ${quote(m?.text, 120)} (seen ${m?.seenCount ?? 1}×, last ${m?.lastSeenDay}) · id ${m?._id}`);
            break;
        case 'already':
            lines.push(`It already says that: seen again · id ${m?._id}`);
            break;
        case 'repeat':
            lines.push(t ? `Already on ${quote(t.title, 100)}: nothing new.` : 'Already noted: nothing new.');
            break;
        case 'history':
            lines.push(
                `Kept as history only: ${quote(r.current?.text, 100)}${r.current ? ` (${r.current.app}, ${r.current.day})` : ''} was said later, so it stays the current version.`
            );
            break;
        case 'check':
            lines.push(
                `Not decided: ${quote(r.current?.text, 100)}${r.current ? ` (${r.current.app})` : ''} was said the same day and the order can't be known, so it stays and is marked "check". Ask the user which is right, then pass the answer with update_memory (update changed, or said to keep it).`
            );
            break;
        case 'closed':
            lines.push(t ? `Closed: ${quote(t.title, 100)} (${said}).` : `Closed: ${quote(m?.text, 120)} (${said}).`);
            break;
        case 'reopened':
            lines.push(t ? `Active again: ${quote(t.title, 100)} · id ${t._id}` : `Active again: ${quote(m?.text, 120)} · id ${m?._id}`);
            break;
        default:
            if (m?.status === 'closed') lines.push(`Noted: ${quote(m.text, 100)} is closed; if they took it up again, call update_memory with update resumed.`);
            else lines.push(t ? `Noted on ${quote(t.title, 100)}: nothing changes until they say it themselves.` : 'Noted as an inference: nothing changes until they say it themselves.');
    }
    const text = lines.join('\n');
    const lists = listsText(r.related, r.inMotion);
    const body = lists ? `${text}\n${lists}` : text;
    return r.editId ? withUndo(body) : body;
}

export function registerBuddyTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'remember',
        {
            title: 'Remember about the user',
            description:
                'Save what the user says about their own life (habits, plans, likes), unasked. Anything new that will matter later: a habit, a plan, a preference, a worry, an interest; one thing a call, in their words. Not the work at hand, general questions or other people’s private things. Their buddy keeps it with its date and decides when to bring it up. Progress on, a change to or the end of something already known goes to update_memory.',
            input: zNoteFields,
            annotations: ADDS,
        },
        async ({ said_on, inferred, ...note }) => {
            const body = { ...note, ...(said_on ? { saidOn: said_on } : {}), inferred: inferred ?? false, ...(ctx.project ? { project: ctx.project } : {}) };
            let r: { paused: boolean; notes: NoteOutcome[]; related?: Related; inMotion?: InMotion[] };
            let older = false;
            try {
                r = await api.post('/api/buddy/remember', body);
            } catch (err) {
                // An older Recollect server (before the deploy) refuses the new fields: it saves without them.
                if (!(err instanceof ApiError) || err.status !== 400 || !/saidOn|inferred|unrecognized/i.test(err.message)) throw err;
                r = await api.post('/api/buddy/remember', { ...note, ...(ctx.project ? { project: ctx.project } : {}) });
                older = true;
            }
            if (r.paused) return 'Not saved: the user has paused their buddy (nothing is kept while it is paused).';
            const lines = r.notes.map(noteLine);
            if (older) lines.push(OLDER_SERVER_SAVE);
            // A work folder: what was saved and nothing else (no "Related", no "In motion": MCP_MEMORY_PLAN R12).
            if (ctx.workMode) return quietly(true, lines.join('\n'));
            const lists = listsText(r.related, r.inMotion);
            return [lines.join('\n'), lists].filter(Boolean).join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'update_memory',
        {
            title: 'Update what the buddy knows',
            description:
                'Pass on news about something already known: progress, a change, an end. When the user reports it on something their buddy knows (in get_brief, recall_memory or an earlier answer): "got my steps in today", "I walk in the mornings now", "I’ve learned enough about that for now". Give its id in on.',
            input: {
                on: z.string().trim().min(1).max(60).describe('The id of the memory or thread.'),
                update: z
                    .enum(UPDATE_KINDS)
                    .optional()
                    .describe("One day: progress, done or skipped. changed: how it goes from now on (text is the new way), never one day's doing. paused, resumed, dropped, finished. Default said."),
                text: z.string().trim().min(1).max(300).describe('What they said, in their words.'),
                said_on: zSaidOn.optional(),
                inferred: zInferred,
            },
            annotations: CHANGES,
        },
        async ({ on, update, text, said_on, inferred }) => {
            let r: UpdateAnswer;
            try {
                r = await api.post('/api/buddy/update', { on, update: update ?? 'said', text, inferred: inferred ?? false, ...(said_on ? { saidOn: said_on } : {}), ...(ctx.project ? { project: ctx.project } : {}) });
            } catch (err) {
                // An older Recollect server has no update route (tokens are refused there).
                if (err instanceof ApiError && (err.status === 404 || err.status === 403) && /cannot be used for this endpoint|not found/i.test(err.message) && !/nothing with that id/i.test(err.message)) {
                    return 'This Recollect server is older: it takes update_memory from its next release. Save it with remember for now.';
                }
                throw err;
            }
            if (r.paused) return 'Not kept: the user has paused their buddy (nothing is kept while it is paused).';
            return updateText(r, update ?? 'said');
        }
    );

    defineTool(
        server,
        ctx,
        'recall_memory',
        {
            title: 'What their buddy knows',
            description:
                'Look up what is known about the user: habits, plans, preferences, life events. Search it before you rely on their routine, plans or preferences (words or word starts), or list it by kind. Each line says when it was said, the app it came from and what replaced it. Private ones are marked: use them only to understand the user, never repeat them unasked.',
            input: {
                query: z.string().trim().max(200).optional(),
                kind: zKind.optional(),
                status: z.enum(['active', 'faded', 'closed', 'all']).optional().describe('Default active.'),
                limit: z.number().int().min(1).max(50).optional(),
            },
            annotations: READ_ONLY,
        },
        async ({ query, kind, status, limit }) => {
            if (ctx.workMode) return 'Not in a work folder: their buddy’s memory stays out of work chats.';
            const list = await api.get<Memory[]>('/api/buddy/memories', { q: query, kind, status, limit: limit ?? 20 });
            // What is going on in their life that holds the words (threads; a server without them answers 404).
            const threads = query && !kind ? await api.get<ThreadFound[]>('/api/buddy/threads', { q: query, limit: 5 }).catch(() => []) : [];
            // Their months (the buddy's chapters) that hold the words: "what was I doing in March?".
            const months = query && !kind ? await api.get<Array<{ period: string; text: string }>>('/api/buddy/chapters', { q: query }).catch(() => []) : [];
            const lines = [...list.map(memoryLine), ...threads.map(threadLine), ...months.map((m) => `Month ${m.period}: ${m.text}`)];
            if (lines.length) return lines.join('\n');
            return query ? `Nothing about "${query}" yet. Try other words for the same thing, or list by kind (pattern for habits, preference, aim).` : 'Nothing yet.';
        }
    );

    defineTool(
        server,
        ctx,
        'get_work_log',
        {
            title: 'Their work log',
            description:
                'Their work per project and day, from all their chats and apps, each thing once at its newest: "what did I do yesterday?", a standup, what was decided (view decided) or is still open (view open). query searches words; from, to: YYYY-MM-DD.',
            input: {
                project: z.string().trim().optional(),
                query: z.string().trim().max(200).optional(),
                from: z.string().trim().optional(),
                to: z.string().trim().optional(),
                view: z.enum(['all', 'done', 'decided', 'open']).optional(),
            },
            annotations: READ_ONLY,
        },
        async ({ project, query, from, to, view }) => {
            // A work folder asks about its own project only (their other work and their life stay out).
            const base = ctx.workMode ? { project: ctx.workProject ?? project, work: '1', q: query, from, to } : { project, q: query, from, to };
            const params = view && view !== 'all' ? { ...base, view } : base;
            if (ctx.workMode && !params.project) return 'Name the project: in a work folder the log answers for that project only.';
            const days = await api.get<WorkDay[]>('/api/buddy/work', params);
            if (!days.length) {
                if (view === 'open') return 'Nothing open in their work log.';
                return query ? `Nothing about "${query}" in their work log.` : 'Nothing in their work log for those days (it may be off: About you › How your buddy learns).';
            }
            return view === 'open' ? openText(days) : days.map(workDayText).join('\n');
        }
    );

    if (ctx.set === 'web') registerWebLogWork(server, ctx);
    else registerChatLogWork(server, ctx);

    defineTool(
        server,
        ctx,
        'update_work_line',
        {
            title: 'Change a work line you logged',
            description: 'Your own work line: same_as folds it into a line saying the same; text rewords it today; on makes it news on a line; remove on their word.',
            // Lengths are the server's to check (the web set's 24,000 characters).
            input: {
                id: z.string().trim(),
                same_as: z.string().trim().optional(),
                text: z.string().trim().optional(),
                on: z.string().trim().optional(),
                remove: z.boolean().optional(),
            },
            annotations: CHANGES,
        },
        async ({ id, same_as, text, on, remove }) => {
            const given = [same_as ? { sameAs: same_as } : null, text ? { text } : null, on ? { on } : null, remove ? { remove: true } : null].filter(Boolean);
            if (given.length !== 1) throw new ToolError('Send one change: same_as, text, on or remove.');
            const r = await api.patch<ChangeLineAnswer>(`/api/buddy/work/line/${encodeURIComponent(id)}`, given[0]!);
            switch (r.status) {
                case 'joined':
                    return [`Folded into ${quote(r.into?.text, 100)} · id ${r.into?._id}: listed once.`, r.picture ? pictureText(r.picture) : ''].filter(Boolean).join('\n');
                case 'reworded':
                    return `Reworded: ${quote(r.line?.text, 120)} · id ${r.line?._id}`;
                case 'linked':
                    return [`Now news on ${quote(r.follows?.text, 100)} · id ${r.follows?._id}.`, r.picture ? pictureText(r.picture) : ''].filter(Boolean).join('\n');
                case 'removed':
                    return 'Removed from their work log (it won’t be written again).';
                case 'off':
                    return LOG_OFF;
                default:
                    return LOG_PAUSED;
            }
        }
    );

    defineTool(
        server,
        ctx,
        'forget',
        {
            title: 'Forget a memory',
            description:
                'Use this when a memory is no longer true and was a misunderstanding, or the user asks you to forget it: it is closed (Undo on Home). A change of routine goes to update_memory instead, so the old version stays as history. Memories the user wrote or changed themselves are theirs: you can’t close those.',
            input: { id: zId('memory'), reason: z.string().trim().max(200).optional().describe('Why, in a few words.') },
            annotations: CHANGES,
        },
        async ({ id, reason }) => {
            const r = await api.post<{ memory: Memory; editId: string }>(`/api/buddy/memories/${encodeURIComponent(id)}/close`, reason ? { reason } : {});
            return withUndo(`Forgot: ${quote(r.memory.text, 120)}.`);
        }
    );
}

// ─── The work log's writers (ECOSYSTEM_V2_PLAN stage 12) ────────────────────

/** A line as a writer is shown it (the brief's Work part, every log_work answer). */
export interface PictureLine {
    _id: string;
    kind: string;
    text: string;
    project: string;
    day: string;
    app: string | null;
    office?: true;
    /** Close in words to the line just written. */
    close?: true;
    /** An open line a later done line likely closed, not linked. */
    likely?: { _id: string; text: string; app: string | null };
}

/** What a writer is shown (W5): what is open, and that day's other lines. */
export interface WorkPicture {
    open: PictureLine[];
    today: PictureLine[];
}

/** Stage 13: one line's outcome when a call carries `more` (every line's, in order). */
interface LineOutcome {
    status: 'saved' | 'already' | 'removed' | 'full' | 'empty';
    line: PictureLine | null;
    follows?: PictureLine | null;
    onMissing?: true;
}

type LogLineAnswer =
    | { status: 'saved'; line: PictureLine; follows: PictureLine | null; onMissing?: true; picture: WorkPicture; lines?: LineOutcome[] }
    | { status: 'already'; line: PictureLine | null; picture: WorkPicture; lines?: LineOutcome[] }
    | { status: 'removed'; picture?: WorkPicture; lines?: LineOutcome[] }
    | { status: 'full'; picture: WorkPicture; lines?: LineOutcome[] }
    | { status: 'off' }
    | { status: 'paused' };

/** One line's outcome in words (stage 13: a call may carry several). */
function outcomeText(o: LineOutcome): string {
    switch (o.status) {
        case 'saved':
            return `Logged: ${quote(o.line!.text, 120)} (${o.line!.project}) · id ${o.line!._id}${o.follows ? `, news on ${quote(o.follows.text, 80)}` : ''}.${o.onMissing ? ' (Its on id is not a line of theirs you can see, so it is a new line.)' : ''}`;
        case 'already':
            return `Already in their log: ${o.line ? `${quote(o.line.text, 120)}${o.line.app ? ` (via ${o.line.app})` : ''} · id ${o.line._id}` : 'a line from a work folder'}. Not logged again.`;
        case 'removed':
            return 'Not logged: they removed a line that says the same from their log.';
        case 'full':
            return 'Not logged: 30 new work lines from chats in a day is the most (news on a known line still goes, with on).';
        default:
            return 'Not logged: nothing was left once secrets were taken out.';
    }
}

/** The nudges after a save (the live hour, 11-20: a fix logged without `on` left its open line open; an open problem was logged twice). */
function linkNudges(saved: readonly LineOutcome[], picture: WorkPicture | undefined): string[] {
    if (!picture?.open.length) return [];
    const loose = saved.filter((o) => o.status === 'saved' && o.line && !o.follows);
    const did = loose.filter((o) => o.line!.kind === 'did').map((o) => o.line!._id);
    const open = loose.filter((o) => o.line!.kind === 'stuck').map((o) => o.line!._id);
    const out: string[] = [];
    if (did.length) out.push(`If ${did.length > 1 ? 'one of these fixes' : 'this fixes'} one of the open lines below, link it now: update_work_line with id ${did.join(' or ')} and on <that line's id>.`);
    if (open.length) out.push(`If ${open.length > 1 ? 'one of these is' : 'yours is'} the same problem as an open line below, fold it now: update_work_line with id ${open.join(' or ')} and same_as <that line's id>.`);
    return out;
}

interface ChangeLineAnswer {
    status: 'joined' | 'reworded' | 'linked' | 'removed' | 'off' | 'paused';
    line?: PictureLine;
    into?: PictureLine;
    follows?: PictureLine;
    picture?: WorkPicture;
}

const LOG_OFF = 'Not logged: their work log is off (About you › How your buddy learns).';
const WEB_LOG_OFF = `${LOG_OFF} Log no work in this chat.`;
const LOG_PAUSED = 'Not logged: their buddy is paused (nothing is kept while it is paused).';

const SHOWN_KIND: Readonly<Record<string, string>> = { did: 'done', decided: 'decided', stuck: 'open', next: 'next' };

/** One line of the picture: its words, its kind, project and app, its id. */
export function pictureItem(l: PictureLine): string {
    const marks = [SHOWN_KIND[l.kind] ?? l.kind, l.project && l.project !== 'other' ? l.project : null, l.app ? `via ${l.app}` : null].filter(Boolean).join(', ');
    const likely = l.likely ? ` · likely done by ${quote(l.likely.text, 70)}${l.likely.app ? ` (via ${l.likely.app})` : ''}, not linked` : '';
    return `${quote(l.text, 90)} (${marks}) · id ${l._id}${likely}`;
}

/** The picture as lines: a line close in words first (the writer judges whether it is the same thing), what is open, the day's other lines. */
export function pictureText(p: WorkPicture): string {
    const close = [...p.open, ...p.today].filter((l) => l.close);
    const open = p.open.filter((l) => !l.close);
    const today = p.today.filter((l) => !l.close);
    const out: string[] = [];
    if (close.length) out.push(`Close in words (if one is the same thing, it was already logged: fold yours into it with update_work_line same_as; a different thing stays): ${close.map(pictureItem).join(' · ')}`);
    if (open.length) out.push(`Open in their log (news on one: log_work with its id in on): ${open.map(pictureItem).join(' · ')}`);
    if (today.length) out.push(`Also logged that day: ${today.map(pictureItem).join(' · ')}`);
    return out.join('\n');
}

/** claude.ai and ChatGPT: one outcome a call, written at once unless already there; the answer shows the picture. */
function registerWebLogWork(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;
    defineTool(
        server,
        ctx,
        'log_work',
        {
            title: 'Log a work outcome',
            description:
                "Log an outcome of the user's work, unasked: a result they confirm (fixed, shipped, sent; a report pasted from another tool counts), a decision they reached (with why), or a problem left open. One plain past-tense line per result; a message with two or three: the others in more. Not questions, untried ideas or work in progress. News on a line you were shown: its id in on. Already logged: don't call.",
            // Lengths and the day's form are the server's to check (the web set's 24,000 characters).
            input: {
                text: z.string().trim().min(1),
                kind: z.enum(['did', 'decided', 'open']).optional(),
                project: z.string().trim().optional().describe('Reuse a name from get_brief.'),
                on: z.string().trim().optional(),
                day: z.string().trim().optional().describe('YYYY-MM-DD, up to 3 days back.'),
                // Stage 13: the other results of the same message (the live hour: two fixes in one message were lost).
                more: z.array(z.object({ text: z.string().trim().min(1), kind: z.enum(['did', 'decided', 'open']).optional(), on: z.string().trim().optional() })).max(2).optional(),
            },
            annotations: ADDS,
        },
        async ({ text, kind, project, on, day, more }) => {
            const kindOf = (k: 'did' | 'decided' | 'open' | undefined) => (k === 'open' ? 'stuck' : (k ?? 'did'));
            const body = {
                text,
                kind: kindOf(kind),
                ...(project ? { project } : {}),
                ...(on ? { on } : {}),
                ...(day ? { day } : {}),
                ...(more?.length ? { more: more.map((m) => ({ text: m.text, kind: kindOf(m.kind), ...(m.on ? { on: m.on } : {}) })) } : {}),
            };
            let r: LogLineAnswer;
            try {
                r = await api.post<LogLineAnswer>('/api/buddy/work/line', body);
            } catch (err) {
                // An older Recollect server (before the deploy) has no such route: tokens are refused there.
                if (err instanceof ApiError && (err.status === 404 || err.status === 403) && /cannot be used for this endpoint|not found/i.test(err.message)) {
                    return 'This Recollect server is older: it takes work lines from its next release.';
                }
                throw err;
            }
            // Stage 13: several lines in one call: each one's outcome, then the nudges and the picture once.
            if ('lines' in r && r.lines && r.lines.length > 1) {
                const anySaved = r.lines.some((o) => o.status === 'saved');
                return [
                    ...r.lines.map(outcomeText),
                    ...linkNudges(r.lines, r.picture),
                    r.picture ? pictureText(r.picture) : '',
                    anySaved ? 'Logged quietly: say nothing about it in your reply unless they asked for it.' : r.lines.some((o) => o.status === 'full') ? 'If it matters, they can add it in Recollect.' : '',
                ]
                    .filter(Boolean)
                    .join('\n');
            }
            switch (r.status) {
                case 'saved': {
                    const head = `Logged: ${quote(r.line.text, 120)} (${r.line.project}) · id ${r.line._id}${r.follows ? `, news on ${quote(r.follows.text, 80)}` : ''}.`;
                    const missing = r.onMissing ? 'That on id is not a line of theirs you can see, so it was logged as a new line.' : '';
                    // The live hour (11-20): a fix logged without `on` left its open line open; an open problem was logged twice.
                    const ask =
                        r.picture.open.length && !r.follows
                            ? r.line.kind === 'did'
                                ? `If this fixes one of the open lines below, link it now: update_work_line with id ${r.line._id} and on <that line's id>.`
                                : r.line.kind === 'stuck'
                                  ? `If yours is the same problem as an open line below, fold it now: update_work_line with id ${r.line._id} and same_as <that line's id>.`
                                  : ''
                            : '';
                    return [head, missing, ask, pictureText(r.picture), 'Logged quietly: say nothing about it in your reply unless they asked for it.'].filter(Boolean).join('\n');
                }
                case 'already': {
                    const what = r.line ? `${quote(r.line.text, 120)}${r.line.app ? ` (via ${r.line.app})` : ''} · id ${r.line._id}` : 'a line from a work folder';
                    return [`Already in their log: ${what}. Not logged again.`, pictureText(r.picture)].filter(Boolean).join('\n');
                }
                case 'removed':
                    return 'Not logged: they removed a line that says the same from their log.';
                case 'full':
                    return 'Not logged: 30 new work lines from chats in a day is the most (news on a known line still goes, with on). If it matters, they can add it in Recollect.';
                case 'off':
                    return WEB_LOG_OFF;
                default:
                    return LOG_PAUSED;
            }
        }
    );
}

/** Claude Code (and Ask AI): the chat's list for a day, with the hooks' clock, given what other chats already logged. */
function registerChatLogWork(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;
    // B10: one key per chat (this server lives as long as the chat), so a second log_work replaces, not doubles.
    const chatKey = `lw_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    /** What other chats and apps already logged (stage 12): an older server has no picture, and says nothing. */
    async function alreadyLogged(day: string, project: string): Promise<string> {
        try {
            const p = await api.get<WorkPicture | null>('/api/buddy/work/picture', { day, ...(project ? { project } : {}), ...(ctx.workMode ? { work: '1' } : {}) });
            if (!p || (!p.open.length && !p.today.length)) return '';
            return `Already in their log from other chats (don't repeat these; a line that is news on one carries its id in on):\n${pictureText(p)}`;
        } catch {
            return '';
        }
    }

    defineTool(
        server,
        ctx,
        'log_work',
        {
            title: "Log the day's work",
            description:
                'When the user asks to log the day’s work ("log today’s work", /log-work). First call it without lines: it answers the day’s turn times here and what other chats logged. Then send 3–6 lines (plain past tense; at = the time span, e.g. "10:15–11:40"; on = the id of a line it is news on). A second call replaces this chat’s lines.',
            input: {
                lines: z
                    .array(z.object({ kind: z.enum(WORK_LINE_KINDS), text: z.string().trim().min(1).max(160), at: z.string().trim().max(20).optional(), on: z.string().trim().max(40).optional() }))
                    .max(8)
                    .optional(),
                day: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Default today.'),
                project: z.string().trim().max(100).optional(),
            },
            annotations: ADDS,
        },
        async ({ lines, day, project }) => {
            const theDay = day ?? localDay(new Date());
            const name = (project ?? ctx.clockProject ?? '').trim().toLowerCase();
            if (!lines?.length) {
                const already = await alreadyLogged(theDay, name);
                if (!ctx.clockProject) return ['No clock here (Recollect’s hooks don’t run in this folder): send the lines without times, with the project.', already].filter(Boolean).join('\n');
                const clock = readClock(name, theDay);
                return [clock.length ? clockText(name, theDay, clock) : `No turns on the clock for ${name} on ${theDay}: send the lines without times.`, already].filter(Boolean).join('\n');
            }
            if (!name) throw new ToolError('Name the project: no folder is known here.');
            const r = await api.post<LogWorkResult>('/api/buddy/work', { key: chatKey, project: name, day: theDay, office: !!ctx.workMode, lines });
            if (r.status === 'off') return LOG_OFF;
            if (r.status === 'paused') return LOG_PAUSED;
            if (ctx.clockProject) {
                try {
                    markLogged(name, r.day);
                } catch {
                    // The marker only stops the reminders to log; the lines are saved.
                }
            }
            const when = dayLabel(new Date(`${r.day}T12:00:00`));
            return `Logged ${r.saved} ${r.saved === 1 ? 'line' : 'lines'} for ${r.project}, ${when}${r.skipped ? ` (${r.skipped} left out: already in their log, or removed by them)` : ''}.`;
        }
    );
}
