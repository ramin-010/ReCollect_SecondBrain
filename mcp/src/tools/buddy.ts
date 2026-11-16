// The buddy (BUDDY_MEMORY_PLAN §3.1 B): what a chat learns about Ramin goes to his memory, and a
// chat can look things up there. remember is in the default set (record); the rest are on more_tools.
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { quietly, quote, withUndo } from '../format.js';
import { clockText, dayLabel, localDay, markLogged, readClock } from '../hook.js';
import { zId } from '../schemas.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

export const MEMORY_KINDS = ['fact', 'preference', 'value', 'aim', 'idea', 'decision', 'pattern', 'state', 'thread', 'win'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

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
}

export type NoteOutcome = { status: 'saved' | 'seen' | 'wrong'; memory: Memory } | { status: 'empty' };

const zKind = z.enum(MEMORY_KINDS);

export interface WorkDay {
    day: string;
    projects: Array<{ project: string; office: boolean; minutes: number; sessions: number; commits: string[]; lines: Array<{ _id: string; kind: string; text: string; at?: string | null }> }>;
}

export const WORK_LINE_KINDS = ['did', 'decided', 'stuck', 'next'] as const;

type LogWorkResult = { status: 'saved'; day: string; project: string; saved: number; skipped: number } | { status: 'off' } | { status: 'paused' };

const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

/** One day of the work log as text: "Sun 15 Nov" then each project with its time, lines and commits. */
export function workDayText(d: WorkDay): string {
    const day = new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const parts = d.projects.map((p) => {
        const head = `${p.project}${p.minutes ? ` · ${mins(p.minutes)}` : ''}${p.sessions > 1 ? ` in ${p.sessions} sessions` : ''}`;
        const lines = p.lines.map((l) => `  - ${l.at ? `${l.at} ` : ''}${l.kind === 'did' ? '' : `${l.kind}: `}${l.text}`);
        const commits = p.commits.length ? [`  commits: ${p.commits.slice(0, 5).join('; ')}`] : [];
        return [head, ...lines, ...commits].join('\n');
    });
    return `${day}\n${parts.join('\n')}`;
}

/** One note about Ramin, as remember takes it. */
export const zNoteFields = {
    text: z.string().trim().min(1).max(300).describe('One thing, e.g. "Studies best after 9 pm".'),
    kind: zKind.optional().describe('Default fact. pattern: a habit; state: a mood or worry; thread: a promise or plan.'),
    private: z.boolean().optional().describe('Health, money, family, other people, fears, work conflicts, leaving his job (a state is, by default).'),
};
/** checkpoint's learned: the same note without the descriptions (they are on remember). */
export const zNote = z.object({ text: z.string().trim().min(1).max(300), kind: zKind.optional(), private: z.boolean().optional() });

export function memoryLine(m: Memory): string {
    const marks = [m.kind, m.sensitivity === 'private' ? 'private' : null, m.pinned ? 'pinned' : null, m.byUser ? 'his own' : null, m.status !== 'active' ? m.status : null, m.seenCount > 1 ? `seen ${m.seenCount}×` : null].filter(Boolean);
    return `${quote(m.text, 200)} (${marks.join(', ')}) · id ${m._id}`;
}

export function noteLine(n: NoteOutcome): string {
    if (n.status === 'empty') return 'Not saved: nothing left after removing secrets.';
    if (n.status === 'saved') return `Saved: ${memoryLine(n.memory)}`;
    if (n.status === 'seen') return `Already known, seen again: ${memoryLine(n.memory)}`;
    return `Not saved: Ramin marked ${quote(n.memory.text, 80)} wrong.`;
}

export function registerBuddyTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'remember',
        {
            title: 'Remember about Ramin',
            description: 'Save something lasting he says about himself (a preference, worry, plan, promise, aim, idea, decision) for his buddy, which remembers across chats. One thing a call.',
            input: zNoteFields,
            annotations: ADDS,
        },
        async (note) => {
            const r = await api.post<{ paused: boolean; notes: NoteOutcome[] }>('/api/buddy/remember', note);
            if (r.paused) return 'Not saved: Ramin has paused his buddy (nothing is kept while it is paused).';
            return quietly(ctx.workMode, r.notes.map(noteLine).join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'recall_memory',
        {
            title: 'What his buddy knows',
            description: 'Search what Ramin’s buddy knows about him (words or word starts), or list it by kind. Private ones are marked: use them only to understand him, never repeat them unasked.',
            input: {
                query: z.string().trim().max(200).optional(),
                kind: zKind.optional(),
                status: z.enum(['active', 'faded', 'closed', 'all']).optional().describe('Default active.'),
                limit: z.number().int().min(1).max(50).optional(),
            },
            annotations: READ_ONLY,
        },
        async ({ query, kind, status, limit }) => {
            if (ctx.workMode) return 'Not in a work folder: his buddy’s memory stays out of work chats.';
            const list = await api.get<Memory[]>('/api/buddy/memories', { q: query, kind, status, limit: limit ?? 20 });
            // His months (the buddy's chapters) that hold the words: "what was I doing in March?".
            const months = query && !kind ? await api.get<Array<{ period: string; text: string }>>('/api/buddy/chapters', { q: query }).catch(() => []) : [];
            const lines = [...list.map(memoryLine), ...months.map((m) => `Month ${m.period}: ${m.text}`)];
            return lines.length ? lines.join('\n') : query ? `Nothing about "${query}" yet.` : 'Nothing yet.';
        }
    );

    defineTool(
        server,
        ctx,
        'get_work_log',
        {
            title: 'His work log',
            description:
                'What Ramin did, per project and day (from his chats with agents and his sessions): the lines, the time, the commits. Use it for "what did I do on <project> yesterday?" or before a standup. Search words with query; days with from and to (YYYY-MM-DD; the last 7 by default).',
            input: {
                project: z.string().trim().max(100).optional().describe('The project (folder name); all of them if left out.'),
                query: z.string().trim().max(200).optional(),
                from: z.string().trim().max(10).optional(),
                to: z.string().trim().max(10).optional(),
            },
            annotations: READ_ONLY,
        },
        async ({ project, query, from, to }) => {
            // A work folder asks about its own project only (his other work and his life stay out).
            const params = ctx.workMode ? { project: ctx.workProject ?? project, work: '1', q: query, from, to } : { project, q: query, from, to };
            if (ctx.workMode && !params.project) return 'Name the project: in a work folder the log answers for that project only.';
            const days = await api.get<WorkDay[]>('/api/buddy/work', params);
            if (!days.length) return query ? `Nothing about "${query}" in his work log.` : 'Nothing in his work log for those days (it may be off: About you › How your buddy learns).';
            return days.map(workDayText).join('\n');
        }
    );

    // B10: one key per chat (this server lives as long as the chat), so a second log_work replaces, not doubles.
    const chatKey = `lw_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    defineTool(
        server,
        ctx,
        'log_work',
        {
            title: "Log the day's work",
            description:
                'When he asks to log the day’s work ("log today’s work", /log-work). First call it without lines: it answers the day’s turn times here. Then send 3–6 lines (plain past tense; at = the time span, e.g. "10:15–11:40"). A second call replaces this chat’s lines.',
            input: {
                lines: z
                    .array(z.object({ kind: z.enum(WORK_LINE_KINDS), text: z.string().trim().min(1).max(160), at: z.string().trim().max(20).optional() }))
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
                if (!ctx.clockProject) return 'No clock here (Recollect’s hooks don’t run in this folder): send the lines without times, with the project.';
                const clock = readClock(name, theDay);
                return clock.length ? clockText(name, theDay, clock) : `No turns on the clock for ${name} on ${theDay}: send the lines without times.`;
            }
            if (!name) throw new ToolError('Name the project: no folder is known here.');
            const r = await api.post<LogWorkResult>('/api/buddy/work', { key: chatKey, project: name, day: theDay, office: !!ctx.workMode, lines });
            if (r.status === 'off') return 'Not logged: his work log is off (About you › How your buddy learns).';
            if (r.status === 'paused') return 'Not logged: his buddy is paused (nothing is kept while it is paused).';
            if (ctx.clockProject) {
                try {
                    markLogged(name, r.day);
                } catch {
                    // The marker only stops the reminders to log; the lines are saved.
                }
            }
            const when = dayLabel(new Date(`${r.day}T12:00:00`));
            return `Logged ${r.saved} ${r.saved === 1 ? 'line' : 'lines'} for ${r.project}, ${when}${r.skipped ? ` (${r.skipped} left out: already in his log, or removed by him)` : ''}.`;
        }
    );

    defineTool(
        server,
        ctx,
        'forget',
        {
            title: 'Forget a memory',
            description: 'Close a memory that is no longer true (he changed, or it was a misunderstanding). Memories he wrote or changed himself are his: you can’t close those.',
            input: { id: zId('memory'), reason: z.string().trim().max(200).optional().describe('Why, in a few words.') },
            annotations: CHANGES,
        },
        async ({ id, reason }) => {
            const r = await api.post<{ memory: Memory; editId: string }>(`/api/buddy/memories/${encodeURIComponent(id)}/close`, reason ? { reason } : {});
            return withUndo(`Forgot: ${quote(r.memory.text, 120)}.`);
        }
    );
}
