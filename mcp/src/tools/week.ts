// The week and suggestions (LOOP_COMPLETE_SPEC 1.6): 3–5 targets for Monday to Sunday that tick
// themselves when what they point at is done, and proposals the user accepts on Home with one tap.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { plural, quote, withUndo } from '../format.js';
import { zDay, zId, zSubjectName } from '../schemas.js';
import { resolveSubject } from '../subjects.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

type Kind = 'study' | 'practice' | 'build' | 'review';

interface WeekTarget {
    _id: string;
    text: string;
    status: 'open' | 'done' | 'dropped';
    done: boolean;
    progress: { done: number; total: number } | null;
    topic: { _id: string; title: string } | null;
    milestone: { _id: string; title: string } | null;
    task: { _id: string; title: string } | null;
    measure: 'practice' | 'minutes' | 'topics' | null;
    subject: { name: string } | null;
    project: { name: string } | null;
}

interface Week {
    weekStart: string;
    weekEnd: string;
    targets: WeekTarget[];
    lastWeek: { weekStart: string; targets: { done: number; total: number }; minutes: Record<Kind, number>; topicsDone: number; revisionsDone: number };
    review: { due: boolean; weekStart: string };
}

const shortDay = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
const mins = (m: number): string => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

function targetLine(t: WeekTarget): string {
    const what = t.topic ? `topic ${quote(t.topic.title, 50)}` : t.milestone ? `milestone ${quote(t.milestone.title, 50)}` : t.task ? `task ${quote(t.task.title, 50)}` : null;
    const count = t.progress ? `${t.progress.done}/${t.progress.total} ${t.measure}${t.subject ? ` in ${t.subject.name}` : t.project ? ` in ${t.project.name}` : ''}` : null;
    return `${t.done ? '[x]' : '[ ]'} ${quote(t.text, 90)}${[what, count].filter(Boolean).map((x) => ` · ${x}`).join('')} · id ${t._id}`;
}

export function registerWeekTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'get_week',
        {
            title: 'The week',
            description: "The user's week (Monday to Sunday): its targets and what is done (worked out), last week in numbers, and whether their weekly review waits.",
            input: { week: zDay.optional().describe('Any day of the week (default: this week).') },
            annotations: READ_ONLY,
        },
        async ({ week }) => {
            const w = await api.get<Week>('/api/week', { start: week });
            const lines = [`Week ${shortDay(w.weekStart)} – ${shortDay(w.weekEnd)}: ${w.targets.length ? `${w.targets.filter((t) => t.done).length}/${w.targets.length} done` : 'no targets'}`];
            for (const t of w.targets) lines.push(targetLine(t));
            const l = w.lastWeek;
            const kinds = (Object.entries(l.minutes) as [Kind, number][]).filter(([, m]) => m > 0).map(([k, m]) => `${k} ${mins(m)}`).join(', ');
            lines.push(`Week before ${shortDay(w.review.weekStart)}: ${l.targets.total ? `${l.targets.done}/${l.targets.total} targets` : 'no targets'}${kinds ? `, ${kinds}` : ''}, ${plural(l.topicsDone, 'topic')} finished, ${plural(l.revisionsDone, 'revision')}.`);
            if (w.review.due) lines.push(`Their weekly review for the week of ${shortDay(w.review.weekStart)} is waiting on Home. If they plan it with you, add 3 to 5 targets with add_week_target on their yes.`);
            return lines.join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'add_week_target',
        {
            title: 'Add a week target',
            description:
                'A week target (at most 5), on their yes: text that points at one thing (topicId, milestoneId, taskId: it ticks itself) or counts (measure + amount).',
            input: {
                text: z.string().trim().min(1).max(140),
                week: zDay.optional().describe('Any day of the week (default: this week).'),
                topicId: zId('topic').optional(),
                milestoneId: zId('milestone').optional(),
                taskId: zId('task').optional(),
                measure: z.enum(['practice', 'minutes', 'topics']).optional(),
                amount: z.number().int().min(1).max(10_000).optional(),
                subject: zSubjectName.optional().describe('Count only in this subject.'),
                project: z.string().trim().min(1).max(200).optional().describe('Count only in this project (minutes).'),
            },
            annotations: ADDS,
        },
        async ({ text, week, topicId, milestoneId, taskId, measure, amount, subject, project }) => {
            const subjectId = subject ? (await resolveSubject(api, subject)).id : undefined;
            let projectId: string | undefined;
            if (project) {
                const list = await api.get<Array<{ _id: string; key: string; name: string }>>('/api/projects');
                const want = project.toLowerCase();
                projectId = list.find((p) => p.key === want || p.name.toLowerCase() === want)?._id;
                if (!projectId) throw new ToolError(`No project ${quote(project)}: projects come from logged sessions (${list.map((p) => p.key).join(', ') || 'none yet'}).`);
            }
            const t = await api.post<WeekTarget & { weekStart: string }>('/api/week/targets', { text, weekStart: week, topicId, milestoneId, todoId: taskId, measure, amount, subjectId, projectId });
            return withUndo(`Added to the week of ${shortDay(t.weekStart)}: ${targetLine(t)}`);
        }
    );

    defineTool(
        server,
        ctx,
        'update_week_target',
        {
            title: 'Change a week target',
            description: 'Change a target (get_week shows ids): its text, or its status: done (ticked), open, or dropped (removed from the week).',
            input: {
                targetId: zId('target'),
                text: z.string().trim().min(1).max(140).optional(),
                status: z.enum(['open', 'done', 'dropped']).optional(),
            },
            annotations: CHANGES,
        },
        async ({ targetId, text, status }) => {
            if (text === undefined && status === undefined) throw new ToolError('Send text or status.');
            const t = await api.patch<WeekTarget>(`/api/week/targets/${targetId}`, { text, status });
            return withUndo(`${t.status === 'dropped' ? 'Dropped' : 'Changed'}: ${targetLine(t)}`);
        }
    );

    defineTool(
        server,
        ctx,
        'suggest_to_user',
        {
            title: 'Suggest something to the user',
            description:
                "Propose instead of doing when it is their call and they can't say yes here: a week target, a focus line, or a profile change. It waits on Home until they accept.",
            input: {
                kind: z.enum(['week_target', 'focus_line', 'profile_edit']),
                text: z.string().trim().min(1).max(200).describe('What the card says (for a target or focus line: the line itself).'),
                reason: z.string().trim().max(200).optional().describe('Why, in one line.'),
                topicId: zId('topic').optional().describe('week_target: the topic it points at.'),
                profile: z.string().max(600).optional().describe('profile_edit: the whole new profile text.'),
            },
            annotations: ADDS,
        },
        async ({ kind, text, reason, topicId, profile }) => {
            if (kind === 'profile_edit' && profile === undefined) throw new ToolError('profile_edit needs profile: the whole new text.');
            const payload = kind === 'profile_edit' ? { profile } : { text: text.slice(0, 140), ...(topicId ? { topicId } : {}) };
            const s = await api.post<{ _id: string }>('/api/suggestions', { kind, text, reason, payload });
            return `Suggested (${kind.replace('_', ' ')}): ${quote(text)}. It waits on Home for the user (id ${s._id}).`;
        }
    );
}
