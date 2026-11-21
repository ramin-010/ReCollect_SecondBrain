// Goals with deadlines and milestones (Home's goal cards and their forecast). Up to 3 active.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError, orNotFound } from '../errors.js';
import { daysLeftText, forecastText, milestoneLine, nextMilestoneText, plural, quote, withUndo } from '../format.js';
import { zDay, zId, zSubjectName } from '../schemas.js';
import { resolveSubjects } from '../subjects.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import type { Goal, MilestoneResult } from '../types.js';

const zGoalId = zId('goal').describe('Goal id (from list_goals or get_today).');
const zMilestoneTitle = z.string().trim().min(1, 'A milestone needs a title').max(140);

/** title · status · due (days left) · progress · forecast · id */
function goalSummary(g: Goal, withStatus = true): string {
    return [
        quote(g.title, 100),
        ...(withStatus ? [g.status] : []),
        `due ${g.deadline} (${daysLeftText(g.daysLeft)})`,
        `${g.progress.done}/${g.progress.total} milestones`,
        ...(g.status === 'active' ? [forecastText(g.forecast)] : []),
        `id ${g._id}`,
    ].join(' · ');
}

function goalDetails(g: Goal): string[] {
    const lines = [`- ${goalSummary(g)}`];
    if (g.status !== 'active') return lines;
    if (g.why) lines.push(`  Why: ${g.why.replace(/\s+/g, ' ').trim()}`);
    if (g.subjects.length > 0) lines.push(`  Subjects: ${g.subjects.map((s) => s.name).join(', ')}`);
    for (const m of g.milestones) lines.push(`  ${milestoneLine(m)}`);
    if (g.forecast?.suggestion) lines.push(`  Forecast: ${g.forecast.suggestion}`);
    return lines;
}

export function registerGoalTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'list_goals',
        {
            title: 'List goals',
            description:
                "The user's goals, active first: deadline, days left, milestone progress, the forecast (on track / behind …) and, for active goals, the why, subjects and every milestone with its id.",
            input: {},
            annotations: READ_ONLY,
        },
        async () => {
            const goals = await api.get<Goal[]>('/api/goals');
            if (goals.length === 0) return 'No goals yet (create_goal adds one; up to 3 active).';
            return [`${plural(goals.length, 'goal')}, active first:`, ...goals.flatMap(goalDetails)].join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'create_goal',
        {
            title: 'Create a goal',
            description:
                'Create a goal with a fixed deadline and milestones, e.g. "Product-company SDE role" by 2027-06-30. Up to 3 goals can be active. ' +
                'Milestones drive the forecast on Home: give 4–10 concrete steps, each with a due date. subjects links existing subjects by name.',
            input: {
                title: z.string().trim().min(1, 'A goal needs a title').max(120).describe('Short goal title.'),
                deadline: zDay.describe("The deadline, 'YYYY-MM-DD' (today or later)."),
                why: z.string().trim().max(500).optional().describe('Why it matters, one or two sentences.'),
                subjects: z.array(zSubjectName).max(20).optional().describe('Names of existing subjects this goal is about.'),
                milestones: z
                    .array(
                        z.object({
                            title: zMilestoneTitle,
                            dueDate: zDay.optional().describe("'YYYY-MM-DD'"),
                        })
                    )
                    .max(20)
                    .optional()
                    .describe('Milestones in order.'),
            },
            annotations: ADDS,
        },
        async ({ title, deadline, why, subjects, milestones }) => {
            const linked = await resolveSubjects(api, subjects ?? []);
            const goal = await api.post<Goal>('/api/goals', {
                title,
                deadline,
                ...(why ? { why } : {}),
                ...(linked.length > 0 ? { subjectIds: linked.map((s) => s.id) } : {}),
                ...(milestones?.length ? { milestones: milestones.map((m) => ({ title: m.title, ...(m.dueDate ? { dueDay: m.dueDate } : {}) })) } : {}),
            });
            const lines = [`Created goal ${goalSummary(goal, false)}`];
            if (goal.subjects.length > 0) lines.push(`Subjects: ${goal.subjects.map((s) => s.name).join(', ')}`);
            for (const m of goal.milestones) lines.push(`  ${milestoneLine(m)}`);
            return withUndo(lines.join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'update_goal',
        {
            title: 'Update a goal',
            description:
                "Change a goal's title, why, deadline, status (active / done / archived) or linked subjects (the list replaces the old one). Pass only what changes.",
            input: {
                goalId: zGoalId,
                title: z.string().trim().min(1).max(120).optional(),
                why: z.string().trim().max(500).optional().describe('New why; an empty string clears it.'),
                deadline: zDay.optional().describe("'YYYY-MM-DD', today or later."),
                status: z.enum(['active', 'done', 'archived']).optional(),
                subjects: z.array(zSubjectName).max(20).optional().describe('Subject names; replaces the linked subjects ([] unlinks all).'),
            },
            annotations: CHANGES,
        },
        async ({ goalId, title, why, deadline, status, subjects }) => {
            const body: Record<string, unknown> = {};
            if (title !== undefined) body['title'] = title;
            if (why !== undefined) body['why'] = why === '' ? null : why;
            if (deadline !== undefined) body['deadline'] = deadline;
            if (status !== undefined) body['status'] = status;
            if (subjects !== undefined) body['subjectIds'] = (await resolveSubjects(api, subjects)).map((s) => s.id);
            const changed = Object.keys(body).map((k) => (k === 'subjectIds' ? 'subjects' : k));
            if (changed.length === 0) throw new ToolError('Nothing to change: pass title, why, deadline, status or subjects.');
            const goal = await orNotFound(api.patch<Goal>(`/api/goals/${goalId}`, body), `No goal with id ${goalId} (list_goals shows them).`);
            return withUndo(`Updated goal (${changed.join(', ')}): ${goalSummary(goal)}`);
        }
    );

    defineTool(
        server,
        ctx,
        'add_milestone',
        {
            title: 'Add a milestone',
            description: 'Add a milestone at the end of a goal\'s list, ideally with a due date.',
            input: {
                goalId: zGoalId,
                title: zMilestoneTitle.describe('A concrete, checkable step.'),
                dueDate: zDay.optional().describe("'YYYY-MM-DD'"),
            },
            annotations: ADDS,
        },
        async ({ goalId, title, dueDate }) => {
            const { milestone, goal } = await orNotFound(
                api.post<MilestoneResult>(`/api/goals/${goalId}/milestones`, { title, ...(dueDate ? { dueDay: dueDate } : {}) }),
                `No goal with id ${goalId} (list_goals shows them).`
            );
            return withUndo(
                `Added milestone ${quote(milestone.title, 100)}${milestone.dueDay ? ` (due ${milestone.dueDay})` : ''} to ${quote(goal.title, 80)} · id ${milestone._id} · ` +
                    `goal at ${goal.progress.done}/${goal.progress.total} milestones, ${forecastText(goal.forecast)}.`
            );
        }
    );

    defineTool(
        server,
        ctx,
        'complete_milestone',
        {
            title: 'Complete a milestone',
            description: "Mark a goal's milestone as done (when the user says they finished it).",
            input: { milestoneId: zId('milestone').describe('Milestone id (from list_goals).') },
            annotations: CHANGES,
        },
        async ({ milestoneId }) => {
            const { milestone, goal } = await orNotFound(
                api.patch<MilestoneResult>(`/api/goal-milestones/${milestoneId}`, { done: true }),
                `No milestone with id ${milestoneId} (list_goals shows them).`
            );
            return withUndo(
                `Completed milestone ${quote(milestone.title, 100)} in ${quote(goal.title, 80)} · ${goal.progress.done}/${goal.progress.total} done · ` +
                    `${forecastText(goal.forecast)} · ${nextMilestoneText(goal.nextMilestone)}.`
            );
        }
    );

    defineTool(
        server,
        ctx,
        'update_milestone',
        {
            title: 'Change a milestone',
            description:
                "Change a goal's milestone (list_goals shows the ids): its title, its due day (null clears it), or done (false reopens a milestone ticked by mistake).",
            input: {
                milestoneId: zId('milestone').describe('Milestone id (from list_goals).'),
                title: zMilestoneTitle.optional().describe('The new title.'),
                dueDay: zDay.nullable().optional().describe('The new due day (YYYY-MM-DD), or null for none.'),
                done: z.boolean().optional().describe('true completes it, false reopens it.'),
            },
            annotations: CHANGES,
        },
        async ({ milestoneId, title, dueDay, done }) => {
            if (title === undefined && dueDay === undefined && done === undefined) throw new ToolError('Send title, dueDay, done, or a mix.');
            const body = { ...(title !== undefined ? { title } : {}), ...(dueDay !== undefined ? { dueDay } : {}), ...(done !== undefined ? { done } : {}) };
            const { milestone, goal } = await orNotFound(
                api.patch<MilestoneResult>(`/api/goal-milestones/${milestoneId}`, body),
                `No milestone with id ${milestoneId} (list_goals shows them).`
            );
            return withUndo(
                `Milestone ${milestoneLine(milestone)} in ${quote(goal.title, 80)} · ${goal.progress.done}/${goal.progress.total} done · ${forecastText(goal.forecast)}.`
            );
        }
    );

    defineTool(
        server,
        ctx,
        'remove_milestone',
        {
            title: 'Remove a milestone',
            description: "Remove a goal's milestone (list_goals shows the ids), e.g. one added by mistake or one the user dropped. The user can bring it back with Undo.",
            input: { milestoneId: zId('milestone').describe('Milestone id (from list_goals).') },
            annotations: CHANGES,
        },
        async ({ milestoneId }) => {
            const { goal } = await orNotFound(
                api.delete<{ deleted: true; goal: Goal }>(`/api/goal-milestones/${milestoneId}`),
                `No milestone with id ${milestoneId} (list_goals shows them).`
            );
            return withUndo(`Removed the milestone from ${quote(goal.title, 80)} · ${goal.progress.done}/${goal.progress.total} done · ${forecastText(goal.forecast)}.`);
        }
    );
}
