// The manager's tools (MANAGER_AND_DOCS_PLAN §3.3), the "manage" group: the trash, reviews marked
// done or moved, a few settings, projects, what waits for the user. Level 2 tools act at once and are
// undoable; empty_trash is level 3: it only asks, and his tap on Home does it.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError } from '../api.js';
import { ToolError } from '../errors.js';
import { plural, quietly, quote, withUndo } from '../format.js';
import { zDay, zDocId, zId } from '../schemas.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

interface TrashState {
    id: string;
    title: string;
    trashedAt: string | null;
    editId: string | null;
}

interface Suggestion {
    _id: string;
    kind: string;
    text: string;
    reason: string | null;
    proposedBy: string;
    agentName: string | null;
}

interface ChainRevision {
    cycleNumber: number;
    scheduledFor: string;
    status: string;
}

interface Settings {
    dailyBudgetMin: number;
    busyUntil: string | null;
    nudgeEmailEnabled: boolean;
    nudgeTime: string;
    agentProfile: string | null;
    timezone: string;
}

interface Reminder {
    _id: string;
    taskId: string;
    task: string;
    at: string;
    when: string;
    status: string;
    createdTask?: boolean;
    /** Stage 7: it rings (an alarm), or it is silent (shows on his phone's home screen). */
    ring?: boolean;
    repeat?: string | null;
}

interface LockPin {
    _id: string;
    text: string;
    from: string;
    to: string;
    days: number[];
    until: string | null;
    now: boolean;
}

const REPEAT_WORDS: Record<string, string> = { daily: 'every day', weekdays: 'every weekday', weekly: 'every week' };
const DAY_NAMES: Record<string, string> = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' };
// A series on chosen days comes as "mo,we,fr" (a newer server joins a day asked for the same thing at the same time).
const repeatWords = (repeat: string) => REPEAT_WORDS[repeat] ?? `on ${repeat.split(',').map((d) => DAY_NAMES[d] ?? d).join(', ')}`;
const howItRings = (r: Reminder) => `${r.ring ? 'rings' : 'silent'}${r.repeat ? `, ${repeatWords(r.repeat)}` : ''}`;

interface RecallResults {
    topic: { _id: string; title: string; docId: string | null };
    sets: Array<{
        finishedAt: string;
        cycle: number;
        result: string | null;
        counts: { strong: number; partial: number; weak: number };
        missed: Array<{ question: string; grade: string; feedback: string }>;
    }>;
    weakSpots: Array<{ _id: string; text: string }>;
}

interface Sharing {
    title: string;
    published: { url: string; since: string } | null;
    people: Array<{ name: string; role: string }>;
    requests: Array<{ name: string; requestedAt: string }>;
}

interface Spread {
    moved: number;
    spreadDays: number;
    asked: boolean;
    card: { _id: string; text: string } | null;
}

interface Project {
    _id: string;
    key: string;
    name: string;
    /** PERSONAL_OFFICE_PLAN (newer servers): personal, study or work. */
    kind?: 'personal' | 'study' | 'work';
    nextStep: string | null;
    isArchived: boolean;
    goal: { _id: string; title: string } | null;
}

const TAP = 'Waiting for the user’s tap: it shows under Suggested on their Home with "Do it"; nothing happens until they tap it.';

function settingsText(s: Settings): string {
    return [
        `Daily budget: ${s.dailyBudgetMin} min`,
        `Busy until: ${s.busyUntil ?? 'not busy'}`,
        `Morning email: ${s.nudgeEmailEnabled ? `on, at ${s.nudgeTime}` : 'off'}`,
        `Time zone: ${s.timezone} (agents can't change it)`,
        `Profile for agents: ${s.agentProfile ? quote(s.agentProfile, 300) : 'none'}`,
    ].join('\n');
}

export function registerManageTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'trash_doc',
        {
            title: 'Move a doc to the trash',
            description: 'Move a doc of theirs to the trash (kept 30 days, then gone; restore_doc takes it out). For "delete this doc".',
            input: { docId: zDocId },
            annotations: CHANGES,
        },
        async ({ docId }) => {
            const s = await api.post<TrashState>(`/api/agent/docs/${docId}/trash`, {});
            return s.editId ? withUndo(`Moved ${quote(s.title)} to the trash (30 days).`) : `${quote(s.title)} was already in the trash.`;
        }
    );

    defineTool(
        server,
        ctx,
        'restore_doc',
        {
            title: 'Restore a doc',
            description: 'Take a doc out of the trash (where trash_doc or the user put it), as it was.',
            input: { docId: zDocId },
            annotations: CHANGES,
        },
        async ({ docId }) => {
            const s = await api.post<TrashState>(`/api/agent/docs/${docId}/restore`, {});
            return s.editId ? withUndo(`Restored ${quote(s.title)}.`) : `${quote(s.title)} was not in the trash.`;
        }
    );

    defineTool(
        server,
        ctx,
        'empty_trash',
        {
            title: 'Empty the trash (needs their tap)',
            description: "Ask to delete the docs in their trash for good. It can't be undone, so it only asks: they tap \"Do it\" on Home.",
            input: { reason: z.string().trim().max(200).optional() },
            annotations: ADDS,
        },
        async ({ reason }) => {
            const card = await api.post<Suggestion>('/api/actions', { action: 'empty_trash', reason });
            return `Asked: ${card.text}. ${TAP}`;
        }
    );

    defineTool(
        server,
        ctx,
        'complete_revision',
        {
            title: 'Mark a review done',
            description: 'Mark a due review done (list_due shows ids) when they have just reviewed it with you; the next one is scheduled.',
            input: { revisionId: zId('revision') },
            annotations: CHANGES,
        },
        async ({ revisionId }) => {
            const r = await api.post<{ item: { title: string; cycleNumber: number }; chain: ChainRevision[]; mastered: boolean }>(`/api/revisions/${revisionId}/complete`, {});
            const next = r.chain.find((c) => c.status === 'pending');
            return withUndo(`Done: ${quote(r.item.title)}, review ${r.item.cycleNumber}. ${r.mastered ? 'All four reviews done: mastered.' : next ? `Next review ${next.scheduledFor}.` : ''}`.trim());
        }
    );

    defineTool(
        server,
        ctx,
        'move_revision',
        {
            title: 'Move a review',
            description: 'Move a pending review to another day (today or later).',
            input: { revisionId: zId('revision'), day: zDay },
            annotations: CHANGES,
        },
        async ({ revisionId, day }) => {
            const r = await api.post<{ item: { title: string; cycleNumber: number } }>(`/api/revisions/${revisionId}/reschedule`, { day });
            return withUndo(`Moved ${quote(r.item.title)} (review ${r.item.cycleNumber}) to ${day}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'get_settings',
        { title: 'Settings', description: 'Their learning settings: daily budget, busy days, the morning email, the profile agents read.', input: {}, annotations: READ_ONLY },
        async () => settingsText(await api.get<Settings>('/api/learning/settings'))
    );

    defineTool(
        server,
        ctx,
        'update_settings',
        {
            title: 'Change settings',
            description: 'Change their daily budget (minutes), busy-until day (null ends it), the morning email (on/off, time HH:mm) or the profile agents read.',
            input: {
                dailyBudgetMin: z.number().int().min(5).max(600).optional(),
                busyUntil: zDay.nullable().optional(),
                nudgeEmailEnabled: z.boolean().optional(),
                nudgeTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
                agentProfile: z.string().max(600).nullable().optional(),
            },
            annotations: CHANGES,
        },
        async (patch) => {
            if (Object.values(patch).every((v) => v === undefined)) throw new ToolError('Send at least one setting.');
            return withUndo(`Changed.\n${settingsText(await api.patch<Settings>('/api/learning/settings', patch))}`);
        }
    );

    defineTool(
        server,
        ctx,
        'update_project',
        {
            title: 'Change a project',
            description: 'Change a coding project (by key or name, as get_brief shows): its name, next step, goal, archive it, or what it is (personal, study, work: work time is not counted as progress), only when the user asks.',
            input: {
                project: z.string().trim().min(1).max(120),
                name: z.string().trim().min(1).max(120).optional(),
                nextStep: z.string().trim().max(300).nullable().optional(),
                goalId: zId('goal').nullable().optional(),
                isArchived: z.boolean().optional(),
                kind: z.enum(['personal', 'study', 'work']).optional(),
            },
            annotations: CHANGES,
        },
        async ({ project, ...patch }) => {
            if (Object.values(patch).every((v) => v === undefined)) throw new ToolError('Send name, nextStep, goalId, isArchived or kind.');
            const all = await api.get<Project[]>('/api/projects');
            const want = project.toLowerCase();
            const found = all.find((p) => p.key.toLowerCase() === want) ?? all.find((p) => p.name.toLowerCase() === want);
            if (!found) throw new ToolError(`No project ${quote(project)}. Projects: ${all.map((p) => p.key).join(', ') || 'none'}.`);
            const p = await api.patch<Project>(`/api/projects/${found._id}`, patch);
            return withUndo(`Project ${quote(p.name)}: next ${p.nextStep ? quote(p.nextStep) : 'not set'}${p.goal ? ` · goal ${quote(p.goal.title)}` : ''}${p.isArchived ? ' · archived' : ''}${p.kind && p.kind !== 'personal' ? ` · ${p.kind}` : ''}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'list_suggestions',
        {
            title: 'Waiting for the user',
            description: "What waits under Suggested on their Home: proposals and actions that need their tap. Agents can't accept them.",
            input: {},
            annotations: READ_ONLY,
        },
        async () => {
            const list = await api.get<Suggestion[]>('/api/suggestions');
            if (list.length === 0) return 'Nothing is waiting for them.';
            const by = (s: Suggestion) => (s.agentName ? ` · from ${s.agentName}` : s.proposedBy === 'app' ? ' · from the app' : '');
            const clip = (t: string) => (t.length > 160 ? `${t.slice(0, 159)}…` : t);
            return [`${plural(list.length, 'item')} waiting:`, ...list.map((s) => `- ${s.kind === 'action' ? '[needs their tap] ' : ''}${clip(s.text)}${by(s)}`)].join('\n');
        }
    );

    // ── Stage 4 part 2: reminders, Recall results, sharing (read), the spread ──

    defineTool(
        server,
        ctx,
        'set_reminder',
        {
            title: 'Set a reminder',
            description:
                'Remind them: silent unless they ask for an alarm (ring: true). On a task (taskId) or a title (a new task). at: "HH:mm", "YYYY-MM-DDTHH:mm" (their zone) or ISO.',
            input: {
                at: z.string().trim().min(4).max(40),
                taskId: zId('task').optional(),
                title: z.string().trim().min(1).max(200).optional(),
                ring: z.boolean().optional(),
                repeat: z.enum(['daily', 'weekdays', 'weekly']).optional(),
            },
            annotations: ADDS,
        },
        async ({ at, taskId, title, ring, repeat }) => {
            if (!taskId === !title) throw new ToolError('Give taskId (an existing task) or title (a new task), one of them.');
            const base = { at, ...(taskId ? { taskId } : { title }) };
            let r: Reminder & { createdTask?: boolean };
            try {
                r = await api.post<Reminder>('/api/reminders', { ...base, ...(ring ? { ring } : {}), ...(repeat ? { repeat } : {}) });
            } catch (err) {
                // An older Recollect server (before stage 7's release) refuses ring and repeat: there a reminder rings, once.
                if (!(err instanceof ApiError) || err.status !== 400 || !(ring || repeat) || !/\b(ring|repeat)\b/.test(err.message)) throw err;
                r = await api.post<Reminder>('/api/reminders', base);
            }
            // An older server says nothing of how it rings: there every reminder rings (an alarm on the phone, an email), once.
            const kind = r.ring === undefined ? ' (this Recollect server rings every reminder, once: silent and repeating ones come with its next release)' : ` (${howItRings(r)})`;
            return quietly(ctx.workMode, withUndo(`Reminder set: ${quote(r.task)} at ${r.when}${kind}${r.createdTask ? ' (a new task)' : ''} · id ${r._id}.`));
        }
    );

    defineTool(
        server,
        ctx,
        'list_reminders',
        { title: 'Reminders', description: 'Their reminders still to come, soonest first, with ids for cancel_reminder.', input: {}, annotations: READ_ONLY },
        async () => {
            const list = await api.get<Reminder[]>('/api/reminders');
            if (list.length === 0) return 'No reminders to come.';
            return [`${plural(list.length, 'reminder')}:`, ...list.map((r) => `- ${r.when} · ${quote(r.task)}${r.ring === undefined ? '' : ` · ${howItRings(r)}`} · id ${r._id}`)].join('\n');
        }
    );

    // Stage 7 (V1): his own words on the lock screen for a window; his pin wins over the buddy's words in it.
    defineTool(
        server,
        ctx,
        'show_on_lock_screen',
        {
            title: 'Show on their lock screen',
            description:
                'Put their words on their phone\'s lock screen for a window, on their say-so ("put this on my lock screen until 6"). from/to "HH:mm" (their time; from: now, to: midnight); days "weekdays", "weekends" or 0-6 (Sunday 0) to repeat; until "YYYY-MM-DD". Without days or until: today only.',
            input: {
                text: z.string().trim().min(1).max(120),
                from: z.string().trim().max(5).optional(),
                to: z.string().trim().max(5).optional(),
                days: z.union([z.enum(['weekdays', 'weekends']), z.array(z.number().int().min(0).max(6)).max(7)]).optional(),
                until: z.string().trim().max(10).optional(),
            },
            annotations: ADDS,
        },
        async ({ text, from, to, days, until }) => {
            const p = await api.post<LockPin>('/api/lock-pins', { text, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(days ? { days } : {}), ...(until ? { until } : {}) });
            const when = `${p.from}-${p.to === '00:00' ? 'midnight' : p.to}${p.days.length ? ` on ${p.days.length === 5 && !p.days.includes(0) && !p.days.includes(6) ? 'weekdays' : `days ${p.days.join(',')}`}` : ''}${p.until ? ` until ${p.until}` : ''}`;
            return `On their lock screen: ${quote(p.text)} ${when}${p.now ? ' (showing now)' : ''} · id ${p._id}. clear_lock_line takes it off.`;
        }
    );

    defineTool(
        server,
        ctx,
        'clear_lock_line',
        {
            title: 'Clear their lock screen line',
            description: 'Take their pinned words off the lock screen: the one showing now, one by id (from show_on_lock_screen), or all.',
            input: { id: z.string().trim().min(1).max(40).optional(), all: z.boolean().optional() },
            annotations: CHANGES,
        },
        async ({ id, all }) => {
            const r = await api.post<{ cleared: number }>('/api/lock-pins/clear', { ...(id ? { id } : {}), ...(all ? { all } : {}) });
            return r.cleared ? `Cleared ${plural(r.cleared, 'pinned line')} from their lock screen.` : 'Nothing pinned was showing.';
        }
    );

    defineTool(
        server,
        ctx,
        'cancel_reminder',
        { title: 'Cancel a reminder', description: 'Cancel a reminder still to come (list_reminders shows ids). The task stays.', input: { reminderId: zId('reminder') }, annotations: CHANGES },
        async ({ reminderId }) => {
            const r = await api.post<Reminder>(`/api/reminders/${reminderId}/cancel`, {});
            return withUndo(`Cancelled the reminder for ${quote(r.task)} (${r.when}).`);
        }
    );

    defineTool(
        server,
        ctx,
        'get_recall',
        {
            title: 'Recall results',
            description: "A topic's last Recall sessions: grades, the questions they missed with the grader's words, open weak spots. To quiz them on what they get wrong. topicId, or docId.",
            input: { topicId: zId('topic').optional(), docId: zDocId.optional() },
            annotations: READ_ONLY,
        },
        async ({ topicId, docId }) => {
            if (!topicId === !docId) throw new ToolError('Give topicId or docId, one of them.');
            const r = await api.get<RecallResults>(topicId ? `/api/topics/${topicId}/recall` : `/api/topics/${docId}/recall?by=doc`);
            const lines = [`Recall on ${quote(r.topic.title)}:`];
            if (r.sets.length === 0) lines.push('No finished Recall session yet.');
            for (const s of r.sets) {
                lines.push(`- ${s.finishedAt.slice(0, 10)} · review ${s.cycle} · ${s.result ?? 'no result'} (${s.counts.strong} strong, ${s.counts.partial} partial, ${s.counts.weak} weak)`);
                for (const m of s.missed) lines.push(`  - ${m.grade}: ${quote(m.question, 160)}${m.feedback ? ` · ${m.feedback}` : ''}`);
            }
            lines.push(r.weakSpots.length ? `Open weak spots: ${r.weakSpots.map((w) => quote(w.text, 80)).join('; ')}` : 'No open weak spots.');
            return lines.join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'get_sharing',
        {
            title: 'Who can see a doc',
            description: 'Who can see a doc of theirs: published to the web or not (its read-only link), the people added with their roles, and who asks to edit.',
            input: { docId: zDocId },
            annotations: READ_ONLY,
        },
        async ({ docId }) => {
            const s = await api.get<Sharing>(`/api/agent/docs/${docId}/sharing`);
            const web = s.published ? `published since ${s.published.since.slice(0, 10)} (${s.published.url})` : 'not published';
            const people = s.people.length ? s.people.map((p) => `${p.name} (${p.role === 'editor' ? 'can edit' : 'can view'})`).join(', ') : 'nobody added';
            const asks = s.requests.length ? ` · asking to edit: ${s.requests.map((r) => r.name).join(', ')}` : '';
            return `${quote(s.title)}: ${web} · ${people}${asks}.`;
        }
    );

    defineTool(
        server,
        ctx,
        'publish_doc',
        {
            title: 'Publish a doc to the web (needs their tap)',
            description:
                'Ask to publish a doc of theirs (anyone with the link can read it, never edit; the link stays until unpublished) or to stop publishing it (on: false; its link stops working). It leaves the app, so it only asks: they tap "Do it" on Home.',
            input: { docId: zDocId, on: z.boolean().default(true), reason: z.string().trim().max(200).optional() },
            annotations: ADDS,
        },
        async ({ docId, on, reason }) => {
            const card = await api.post<Suggestion>('/api/actions', { action: 'publish_doc', input: { docId, on }, reason });
            return `Asked: ${card.text}. ${TAP}`;
        }
    );

    defineTool(
        server,
        ctx,
        'share_doc',
        {
            title: 'Share a doc with someone (needs their tap)',
            description:
                'Ask to give someone with a Recollect account access to a doc of theirs by their email: role "viewer" (can view), "editor" (can edit), or "remove" to take it away. It only asks: they tap "Do it" on Home.',
            input: {
                docId: zDocId,
                email: z.string().trim().email().max(200),
                role: z.enum(['viewer', 'editor', 'remove']).default('editor'),
                reason: z.string().trim().max(200).optional(),
            },
            annotations: ADDS,
        },
        async ({ docId, email, role, reason }) => {
            const card = await api.post<Suggestion>('/api/actions', { action: 'share_doc', input: { docId, email, role }, reason });
            return `Asked: ${card.text}. ${TAP}`;
        }
    );

    defineTool(
        server,
        ctx,
        'spread_backlog',
        {
            title: 'Spread the overdue reviews',
            description: 'Spread every overdue review over today and the next days, as their daily budget allows (undoable). Over 20 at once it only asks: they tap "Do it" on Home.',
            input: { reason: z.string().trim().max(200).optional() },
            annotations: CHANGES,
        },
        async ({ reason }) => {
            const r = await api.post<Spread>('/api/revisions/spread', reason ? { reason } : {});
            if (r.moved === 0) return 'Nothing is overdue: nothing to spread.';
            if (r.asked) return `Asked: ${r.card?.text ?? `spread ${r.moved} overdue reviews`}. ${TAP}`;
            return withUndo(`Spread ${plural(r.moved, 'overdue review')} over ${plural(r.spreadDays, 'day')}.`);
        }
    );
}
