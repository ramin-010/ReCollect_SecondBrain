// The agent edit log: what agents wrote, and whether the user kept or undid it. TOOL_ACCESS_PLAN §12.3: an app takes
// back a change it made itself (undo_edit), on the user's ask; another app's change, or one made in the app, is the
// user's to undo on Home.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { plural, timestamp } from '../format.js';
import { zId } from '../schemas.js';
import { CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import type { AgentEdit } from '../types.js';
import { userTimeZone } from '../timezone.js';

function stateOf(edit: AgentEdit): string {
    if (edit.undoneAt) return edit.undoneBy ? `taken back by ${edit.undoneBy}` : 'undone by the user';
    if (edit.seenAt) return 'kept';
    return 'not reviewed yet';
}

/** `agentName` is a function on a pooled server (each request has its own agent). */
export function registerEditTools(server: McpServer, ctx: ToolContext, agentName: string | (() => string)): void {
    const { api } = ctx;
    const me = () => (typeof agentName === 'function' ? agentName() : agentName);

    defineTool(
        server,
        ctx,
        'recent_agent_edits',
        {
            title: 'Recent agent edits',
            description:
                'What agents (you included) recently wrote in Kaaga, newest first: each edit with its id, its doc id and whether the user kept it, undid it or has not reviewed it yet. ' +
                'Check it to avoid repeating work, after an error to see whether a write went through, or for the id undo_edit needs (mine: true lists only yours).',
            input: {
                limit: z.number().int().min(1).max(100).optional().describe('How many edits, 1–100 (default 10).'),
                mine: z.boolean().optional().describe('Only this app’s own edits (the ones undo_edit can take back).'),
            },
            annotations: READ_ONLY,
        },
        async ({ limit, mine }) => {
            const [edits, zone] = await Promise.all([api.get<AgentEdit[]>('/api/agent/edits', { limit: limit ?? 10, ...(mine ? { mine: '1' } : {}) }), userTimeZone(api)]);
            if (edits.length === 0) return mine ? 'No edits by this app yet.' : 'No agent edits yet.';
            const lines = edits.map((e) =>
                [
                    `- ${e.id}`,
                    timestamp(e.createdAt, zone),
                    e.summary,
                    ...(e.agentName && e.agentName !== me() ? [`by ${e.agentName}`] : []),
                    ...(e.docId ? [`doc ${e.docId}`] : []),
                    stateOf(e),
                ].join(' · ')
            );
            return [`${plural(edits.length, 'edit')} by ${mine ? 'this app' : 'agents'}, newest first (times in ${zone}); undo_edit takes back one of this app's own by its id:`, ...lines].join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'undo_edit',
        {
            title: 'Take back a change you made',
            description:
                'Take back a change this app made in Kaaga, when they ask ("undo that", "revert what you added", "that was only a demo"): the same Undo as on Home, by the edit id a write’s answer gave (or recent_agent_edits with mine: true). ' +
                'Only this app’s own changes; to remove just part of what you added to a doc: edit_doc_part.',
            input: { editId: zId('edit').describe('From the write’s answer, or recent_agent_edits.') },
            annotations: CHANGES,
        },
        async ({ editId }) => {
            const e = await api.post<AgentEdit>(`/api/agent/edits/${encodeURIComponent(editId)}/take-back`, {});
            return `Taken back: ${e.summary}. The user sees it on Home → From your agent, marked as taken back by you.`;
        }
    );
}
