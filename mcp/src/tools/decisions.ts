// The decision journal (LOOP_COMPLETE_SPEC 4.2): a decision with its why and a day to look again.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { quote, withUndo } from '../format.js';
import { ADDS, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

interface Decision {
    _id: string;
    title: string;
    why: string;
    expect: string | null;
    lookAgainDay: string;
    status: 'open' | 'reviewed';
    verdict: string | null;
    project: { name: string } | null;
    createdAt: string;
}

const line = (d: Decision) =>
    `${quote(d.title, 80)} (${d.createdAt.slice(0, 10)}${d.project ? `, ${d.project.name}` : ''}) because ${quote(d.why, 100)}${d.expect ? ` · expected ${quote(d.expect, 70)}` : ''} · ${d.status === 'reviewed' ? `judged ${d.verdict}` : `look again ${d.lookAgainDay}`} · id ${d._id}`;

export function registerDecisionTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'log_decision',
        {
            title: 'Log a decision',
            description: 'A decision that matters (a design choice, a career call): what, why, what they expect, when to look again. That day Home asks "Was this right?".',
            input: {
                title: z.string().trim().min(1).max(160).describe('What was decided.'),
                why: z.string().trim().min(1).max(600),
                expect: z.string().trim().max(400).optional().describe('What they expect to happen.'),
                lookAgain: z.string().trim().min(2).max(20).describe('A day YYYY-MM-DD, or 30d / 6w / 3m.'),
                project: z.string().trim().max(200).optional().describe('The project (repo folder) it belongs to.'),
            },
            annotations: ADDS,
        },
        async (input) => withUndo(`Logged: ${line(await api.post<Decision>('/api/decisions', input))}`)
    );

    defineTool(
        server,
        ctx,
        'list_decisions',
        {
            title: 'Decisions',
            description: 'Their decisions, newest first: open or reviewed, or one project’s (what was decided there and why).',
            input: { status: z.enum(['open', 'reviewed']).optional(), project: z.string().trim().max(200).optional() },
            annotations: READ_ONLY,
        },
        async ({ status, project }) => {
            const list = await api.get<Decision[]>('/api/decisions', { status, project });
            return list.length ? list.map(line).join('\n') : 'No decisions logged yet.';
        }
    );
}
