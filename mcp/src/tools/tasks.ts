// Personal tasks (LOOP_COMPLETE_SPEC 4.1): list, add, change, tick. Never workspace tasks, never a delete.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { quietly, quote, withUndo } from '../format.js';
import { zId } from '../schemas.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

interface Task {
    _id: string;
    title: string;
    status: string;
    priority: string;
    due: string | null;
}

const zDue = z.string().trim().max(40).describe('A day YYYY-MM-DD (6 pm his time) or an ISO time.');

function taskLine(t: Task): string {
    const due = t.due ? ` · due ${new Date(t.due).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : '';
    return `${t.status === 'complete' ? '[x]' : '[ ]'} ${quote(t.title, 90)}${due}${t.priority !== 'normal' ? ` · ${t.priority}` : ''} · id ${t._id}`;
}

export function registerTaskTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'list_tasks',
        {
            title: 'Tasks',
            description: "The user's personal tasks, soonest due first: due today (and overdue), this week, overdue, or all (all includes done ones).",
            input: { due: z.enum(['today', 'week', 'overdue', 'all']).optional().describe('Default all.') },
            annotations: READ_ONLY,
        },
        async ({ due }) => {
            const list = await api.get<Task[]>('/api/tasks', { due });
            return list.length ? list.map(taskLine).join('\n') : `No tasks${due && due !== 'all' ? ` ${due === 'week' ? 'this week' : due}` : ''}.`;
        }
    );

    defineTool(
        server,
        ctx,
        'add_task',
        {
            title: 'Add a task',
            description: 'Add a personal task for the user (when he asks, or agrees). A dated one shows on Home under Due today.',
            input: { title: z.string().trim().min(1).max(200), due: zDue.optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() },
            annotations: ADDS,
        },
        async ({ title, due, priority }) => quietly(ctx.workMode, withUndo(`Added: ${taskLine(await api.post<Task>('/api/tasks', { title, due, priority }))}`))
    );

    defineTool(
        server,
        ctx,
        'update_task',
        {
            title: 'Change a task',
            description: 'Change a task (list_tasks shows ids): its title, due day, priority, or status (complete ticks it).',
            input: {
                taskId: zId('task'),
                title: z.string().trim().min(1).max(200).optional(),
                due: zDue.nullable().optional(),
                priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
                status: z.enum(['pending', 'in_progress', 'complete']).optional(),
            },
            annotations: CHANGES,
        },
        async ({ taskId, ...patch }) => {
            if (Object.values(patch).every((v) => v === undefined)) throw new ToolError('Send title, due, priority or status.');
            return withUndo(`Changed: ${taskLine(await api.patch<Task>(`/api/tasks/${taskId}`, patch))}`);
        }
    );
}
