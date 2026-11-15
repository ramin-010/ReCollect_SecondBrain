// The buddy (BUDDY_MEMORY_PLAN §3.1 B): what a chat learns about Ramin goes to his memory, and a
// chat can look things up there. remember is in the default set (record); the rest are on more_tools.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { quote, withUndo } from '../format.js';
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
            return r.notes.map(noteLine).join('\n');
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
            return list.length ? list.map(memoryLine).join('\n') : query ? `Nothing about "${query}" yet.` : 'Nothing yet.';
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
