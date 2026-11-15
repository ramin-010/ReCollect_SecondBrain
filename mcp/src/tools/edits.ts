// The agent edit log: what agents wrote, and whether Ramin kept or undid it.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { plural, timestamp } from '../format.js';
import { READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import type { AgentEdit } from '../types.js';
import { userTimeZone } from '../timezone.js';

function stateOf(edit: AgentEdit): string {
    if (edit.undoneAt) return 'undone by Ramin';
    if (edit.seenAt) return 'kept';
    return 'not reviewed yet';
}

export function registerEditTools(server: McpServer, ctx: ToolContext, agentName: string): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'recent_agent_edits',
        {
            title: 'Recent agent edits',
            description:
                'What agents (you included) recently wrote in Recollect, newest first: each edit with its doc id and whether Ramin kept it, undid it or has not reviewed it yet. ' +
                'Check it to avoid repeating work, or after an error to see whether a write went through.',
            input: {
                limit: z.number().int().min(1).max(100).optional().describe('How many edits, 1–100 (default 10).'),
            },
            annotations: READ_ONLY,
        },
        async ({ limit }) => {
            const [edits, zone] = await Promise.all([api.get<AgentEdit[]>('/api/agent/edits', { limit: limit ?? 10 }), userTimeZone(api)]);
            if (edits.length === 0) return 'No agent edits yet.';
            const lines = edits.map((e) =>
                [
                    `- ${timestamp(e.createdAt, zone)}`,
                    e.summary,
                    ...(e.agentName && e.agentName !== agentName ? [`by ${e.agentName}`] : []),
                    ...(e.docId ? [`doc ${e.docId}`] : []),
                    stateOf(e),
                ].join(' · ')
            );
            return [`${plural(edits.length, 'edit')} by agents, newest first (times in ${zone}):`, ...lines].join('\n');
        }
    );
}
