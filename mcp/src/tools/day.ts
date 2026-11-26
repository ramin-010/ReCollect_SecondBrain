// Day: focus lines (Home's "Today's focus") and pocket notes (quick notes; agents add, never read).
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { quietly, quote, withUndo } from '../format.js';
import { ToolError, orNotFound } from '../errors.js';
import { ADDS, CHANGES, defineTool, type ToolContext } from '../tool.js';
import type { FocusItem, QuickNote } from '../types.js';

/** The API's limits (focus.service.ts: FOCUS_TEXT_MAX, FOCUS_LIMIT). */
export const FOCUS_TEXT_MAX = 140;

export function registerDayTools(server: McpServer, ctx: ToolContext, newId: () => string = randomUUID): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'add_focus',
        {
            title: 'Add a focus line',
            description:
                `Add a line to today's focus on Home: a short intention for the day (at most ${FOCUS_TEXT_MAX} characters), e.g. "Finish 2 graph problems". ` +
                'Up to 3 a day: a 4th is refused. get_today shows the current ones.',
            input: {
                text: z.string().trim().min(1, 'A focus line cannot be empty').max(FOCUS_TEXT_MAX).describe('The focus line.'),
            },
            annotations: ADDS,
        },
        async ({ text }) => {
            const item = await api.post<FocusItem>('/api/focus', { text });
            return withUndo(`Added focus ${quote(item.text, FOCUS_TEXT_MAX)} for ${item.day} · id ${item._id}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'update_focus',
        {
            title: 'Change a focus line',
            description:
                "Change one of today's focus lines (get_today shows them with their ids): new words, or tick it done / untick it. Use it to fix a line you added by mistake or to tick what the user finished.",
            input: {
                focusId: z.string().trim().min(1).max(64).describe('The focus line id (get_today shows it).'),
                text: z.string().trim().min(1, 'A focus line cannot be empty').max(FOCUS_TEXT_MAX).optional().describe('The new words.'),
                done: z.boolean().optional().describe('true ticks it, false unticks it.'),
            },
            annotations: CHANGES,
        },
        async ({ focusId, text, done }) => {
            if (text === undefined && done === undefined) throw new ToolError('Send text, done, or both.');
            const item = await orNotFound(
                api.patch<FocusItem>(`/api/focus/${focusId}`, { ...(text !== undefined ? { text } : {}), ...(done !== undefined ? { done } : {}) }),
                `No focus line with id ${focusId} (get_today shows them).`
            );
            return withUndo(`Focus ${quote(item.text, FOCUS_TEXT_MAX)} is now ${item.done ? 'done' : 'open'} · id ${item._id}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'remove_focus',
        {
            title: 'Remove a focus line',
            description:
                "Remove one of today's focus lines (get_today shows the ids), e.g. one you added by mistake or one the user dropped. The user can bring it back with Undo.",
            input: { focusId: z.string().trim().min(1).max(64).describe('The focus line id (get_today shows it).') },
            annotations: CHANGES,
        },
        async ({ focusId }) => {
            await orNotFound(api.delete(`/api/focus/${focusId}`), `No focus line with id ${focusId} (get_today shows them).`);
            return withUndo(`Removed focus line ${focusId}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'add_pocket_note',
        {
            title: 'Add a pocket note',
            description:
                "Drop a quick note into the user's pocket (their private scratch notes on Home): a reminder, a link, an idea to come back to.",
            input: {
                text: z.string().trim().min(1, 'The note is empty').max(100_000).describe('The note (plain text or simple Markdown).'),
                pinned: z.boolean().optional().describe('Pin it to the top.'),
            },
            annotations: ADDS,
        },
        async ({ text, pinned }) => {
            // A new id per note: the API creates a note under the id we pick (PUT), and our own
            // retry reuses this URL and its Idempotency-Key, so it can never add the note twice.
            const note = await api.put<QuickNote>(`/api/quick-notes/${newId()}`, { content: text, category: 'PRIMARY', ...(pinned ? { isPinned: true } : {}) });
            return quietly(ctx.workMode, withUndo(`Added a pocket note${note.isPinned || pinned ? ' (pinned)' : ''}.`));
        }
    );
}
