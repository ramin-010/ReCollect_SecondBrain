// TOOL_ACCESS_PLAN §4.7 (11-27): the tools that were missing. Their pocket (quick private notes on Home): read,
// changed and deleted only while they allow chats at it (Settings › Agents; off by default, and then each answers that
// it is private and changes nothing). Subjects: renamed or described; an empty one deleted at once, one that holds
// topics, notes or docs only asks (a card on Home for their tap). Every change is undoable from Home.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { plural, quote, withUndo } from '../format.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

interface PocketNote {
    id: string;
    text: string;
    cut: boolean;
    pinned: boolean;
    day: string;
    files: string[];
}

const zPocketId = z.string().trim().min(1).max(64).describe('The pocket note id (list_pocket_notes shows it).');
const zSubjectRef = z.string().trim().min(1).max(100).describe('The subject: its id or its name (list_subjects).');

const pocketLine = (n: PocketNote) => `- ${quote(n.text, 400)}${n.pinned ? ' · pinned' : ''} · ${n.day}${n.files.length ? ` · ${plural(n.files.length, 'file')}` : ''} · id ${n.id}`;

export function registerPocketTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'list_pocket_notes',
        {
            title: 'Read their pocket notes',
            description: 'Their pocket notes (quick private notes on Home), pinned first, each cut at 300 characters; id reads one in full. Only while they allow chats at their pocket (Settings › Agents).',
            input: { id: zPocketId.optional().describe('One note, in full.'), limit: z.number().int().min(1).max(100).optional().describe('Default 30.') },
            annotations: READ_ONLY,
        },
        async ({ id, limit }) => {
            const r = await api.get<{ notes: PocketNote[]; total: number }>('/api/agent/pocket', { id, limit });
            if (id) {
                const n = r.notes[0]!;
                return [`Pocket note ${n.id}${n.pinned ? ' (pinned)' : ''} · ${n.day}${n.files.length ? ` · files: ${n.files.join(', ')}` : ''}`, n.text].join('\n');
            }
            if (!r.notes.length) return 'Their pocket is empty.';
            const lines = [`Their pocket: ${plural(r.total, 'note')}${r.total > r.notes.length ? ` (the first ${r.notes.length}; limit shows more)` : ''}.`, ...r.notes.map(pocketLine)];
            if (r.notes.some((n) => n.cut)) lines.push('A note cut at 300 characters reads in full with its id.');
            return lines.join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'update_pocket_note',
        {
            title: 'Change a pocket note',
            description: 'Change one of their pocket notes: its text, or pin it to the top (or unpin it). Only while they allow chats at their pocket.',
            input: { id: zPocketId, text: z.string().trim().min(1).max(100_000).optional().describe('Its whole new text.'), pinned: z.boolean().optional() },
            annotations: CHANGES,
        },
        async ({ id, text, pinned }) => {
            const n = await api.patch<PocketNote & { editId: string | null }>(`/api/agent/pocket/${encodeURIComponent(id)}`, { text, pinned });
            const line = `Pocket note ${n.id}: ${quote(n.text, 120)}${n.pinned ? ' (pinned)' : ''}`;
            return n.editId ? withUndo(`Changed. ${line}`) : `Nothing changed. ${line}`;
        }
    );

    defineTool(
        server,
        ctx,
        'delete_pocket_note',
        {
            title: 'Delete a pocket note',
            description: 'Delete one of their pocket notes, on their word. Undo on Home brings it back. Only while they allow chats at their pocket.',
            input: { id: zPocketId },
            annotations: CHANGES,
        },
        async ({ id }) => {
            await api.post(`/api/agent/pocket/${encodeURIComponent(id)}/delete`, {});
            return withUndo(`Deleted the pocket note ${id}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'update_subject',
        {
            title: 'Rename or describe a subject',
            description: 'Rename a subject (a course) or set its description. A name they already have is refused.',
            input: { subject: zSubjectRef, name: z.string().trim().min(1).max(100).optional().describe('The new name.'), description: z.string().max(500).nullable().optional().describe('null clears it.') },
            annotations: CHANGES,
        },
        async ({ subject, name, description }) => {
            if (name === undefined && description === undefined) return 'Nothing to change: send name, description, or both.';
            const r = await api.patch<{ id: string; name: string; description: string | null; editId: string | null }>(`/api/agent/subjects/${encodeURIComponent(subject)}`, { name, description });
            const line = `${quote(r.name)}${r.description ? ` · ${quote(r.description, 120)}` : ''} · id ${r.id}`;
            return r.editId ? withUndo(`Subject ${line}.`) : `Nothing changed: subject ${line}.`;
        }
    );

    defineTool(
        server,
        ctx,
        'delete_subject',
        {
            title: 'Delete a subject',
            description: 'Delete a subject on their word. An empty one goes at once (Undo on Home); one that holds topics, notes or docs only asks: a card on Home, and their tap deletes it with everything in it (the app keeps it for a week to bring back).',
            input: { subject: zSubjectRef, reason: z.string().trim().max(200).optional().describe('Why, in one line (the card shows it).') },
            annotations: ADDS,
        },
        async ({ subject, reason }) => {
            const r = await api.post<{ id: string; name: string; deleted: boolean; asked: boolean; text?: string; editId?: string }>(`/api/agent/subjects/${encodeURIComponent(subject)}/delete`, { reason });
            if (r.deleted) return withUndo(`Deleted the empty subject ${quote(r.name)}.`);
            return `${quote(r.name)} holds topics, notes or docs, so it waits for their tap: a card on Home says "${r.text ?? 'Delete the subject'}". Nothing is deleted until they tap "Do it".`;
        }
    );
}
