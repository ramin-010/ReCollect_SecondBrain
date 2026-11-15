// Context: today's Home (plan, focus, goals) and the learning overview per subject.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cycleText, daysLeftText, forecastText, nextMilestoneText, plural, quote, revisionLine } from '../format.js';
import { zSubjectName } from '../schemas.js';
import { findSubject, listSubjects } from '../subjects.js';
import { READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import { ToolError } from '../errors.js';
import type { LearningSettings, Subject, Today, TopicStatus } from '../types.js';
import { nextUpLine } from './paths.js';

const FOCUS_LIMIT = 3;

const MODE_TEXT: Record<string, string> = {
    busy: ' · busy week: a shorter plan',
    comeback: ' · comeback day: a lighter plan',
};

function todayText(t: Today): string {
    const lines: string[] = [];
    const streak = t.stats?.streak ?? 0;
    lines.push(`Today ${t.today} (${t.timezone})${streak > 0 ? ` · streak ${plural(streak, 'day')}` : ''}${MODE_TEXT[t.plan.mode] ?? ''}`);

    const planned = t.plan.planned;
    if (planned.length === 0 && t.plan.waitingCount === 0) {
        lines.push('Revisions: none due today.');
    } else {
        if (planned.length > 0) {
            lines.push(`Revisions on today's plan (${planned.length}, ~${t.plan.estMinutes} of ${t.plan.budgetMin} min):`);
            for (const item of planned) lines.push(revisionLine(item));
        }
        if (t.plan.waitingCount > 0) lines.push(`${planned.length > 0 ? '+' : ''}${t.plan.waitingCount} more due, waiting for room (list_due shows them).`);
    }
    if (t.plan.doneToday.length > 0) lines.push(`Done today: ${plural(t.plan.doneToday.length, 'revision')}.`);

    const focus = t.focus.items;
    if (focus.length > 0) {
        lines.push(`Focus (${focus.length} of ${FOCUS_LIMIT}):`);
        for (const f of focus) lines.push(`- [${f.done ? 'x' : ' '}] ${f.text} · id ${f._id}`);
    } else {
        lines.push(`Focus: none yet (add_focus adds up to ${FOCUS_LIMIT} a day).`);
    }
    if (t.focus.carryOver.length > 0) lines.push(`Unfinished from yesterday: ${t.focus.carryOver.map((f) => quote(f.text, 60)).join(', ')}`);

    if (t.next && t.next.length > 0) {
        lines.push('Next up (each path’s next topic):');
        for (const n of t.next) lines.push(`- ${nextUpLine(n)}`);
    }

    if (t.goals.length > 0) {
        lines.push('Goals:');
        for (const g of t.goals) {
            lines.push(
                `- ${quote(g.title, 80)} · due ${g.deadline} (${daysLeftText(g.daysLeft)}) · ${g.progress.done}/${g.progress.total} milestones · ` +
                    `${forecastText(g.forecast)} · ${nextMilestoneText(g.nextMilestone)} · id ${g._id}`
            );
        }
    } else {
        lines.push('Goals: none active (create_goal adds one).');
    }
    return lines.join('\n');
}

// ─── Learning overview ─────────────────────────────────────────────────

interface Counts {
    topics: number;
    due: number;
    waiting: number;
    soon: number;
    mastered: number;
    unscheduled: number;
}

function countsOf(statuses: readonly TopicStatus[]): Counts {
    const counts: Counts = { topics: statuses.length, due: 0, waiting: 0, soon: 0, mastered: 0, unscheduled: 0 };
    for (const s of statuses) {
        if (s.state === 'due') counts.due += 1;
        else if (s.state === 'completed') counts.mastered += 1;
        else if (s.state === 'start') counts.unscheduled += 1;
        else {
            counts.waiting += 1;
            if (s.state === 'early' || (s.inDays !== null && s.inDays <= 7)) counts.soon += 1;
        }
    }
    return counts;
}

function countsText(c: Counts): string {
    if (c.topics === 0) return 'no topics yet';
    const parts = [
        c.due && `${c.due} due`,
        c.waiting && `${c.waiting} waiting`,
        c.mastered && `${c.mastered} mastered`,
        c.unscheduled && `${c.unscheduled} unscheduled`,
    ].filter(Boolean);
    return `${plural(c.topics, 'topic')}: ${parts.join(', ')}`;
}

const STATE_ORDER: Record<TopicStatus['state'], number> = { due: 0, early: 1, wait: 2, start: 3, completed: 4 };

function topicLine(s: TopicStatus): string {
    let state: string;
    switch (s.state) {
        case 'due':
            state = `due now (${s.next ? `${cycleText(s.next.cycleNumber)}, scheduled ${s.next.scheduledFor}` : 'scheduled'})`;
            break;
        case 'early':
        case 'wait':
            state = s.next ? `next review ${s.next.scheduledFor}, in ${plural(s.inDays ?? 1, 'day')} (${cycleText(s.next.cycleNumber)})` : 'scheduled';
            break;
        case 'completed':
            state = `mastered (${s.done}/${s.total} reviews done)`;
            break;
        default:
            state = 'not scheduled (schedule_revision starts it)';
    }
    return `- ${s.title.trim() || 'Untitled'} · ${state} · ${s.docId ? `doc ${s.docId}` : 'no doc'}`;
}

function settingsText(settings: LearningSettings | null): string | null {
    if (!settings) return null;
    const busy = settings.busyUntil ? ` · busy week until ${settings.busyUntil}` : '';
    return `Daily revision budget ${settings.dailyBudgetMin} min${busy}`;
}

function overviewText(subjects: readonly Subject[], statuses: readonly TopicStatus[], settings: LearningSettings | null): string {
    const total = countsOf(statuses);
    const lines = [
        `Learning overview: ${plural(statuses.length, 'topic')} in ${plural(subjects.length, 'subject')} · ${total.due} due now · ` +
            `${total.waiting} waiting (${total.soon} due within 7 days) · ${total.mastered} mastered · ${total.unscheduled} unscheduled`,
    ];
    const budget = settingsText(settings);
    if (budget) lines.push(budget);
    for (const subject of subjects) {
        const mine = statuses.filter((s) => s.subjectId === subject._id);
        lines.push(`- ${subject.name} · ${countsText(countsOf(mine))} · id ${subject._id}`);
    }
    if (subjects.length === 0) lines.push('No subjects yet (create_subject adds one).');
    else lines.push('Pass subject: "<name>" to list one subject\'s topics with their next review dates.');
    return lines.join('\n');
}

function subjectText(subject: Subject, statuses: readonly TopicStatus[]): string {
    const mine = statuses
        .filter((s) => s.subjectId === subject._id)
        .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.inDays ?? 0) - (b.inDays ?? 0) || a.title.localeCompare(b.title));
    return [`${subject.name} · ${countsText(countsOf(mine))} · id ${subject._id}`, ...mine.map(topicLine)].join('\n');
}

export function registerContextTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'get_today',
        {
            title: 'Today',
            description:
                "Ramin's day on Home: today's planned revisions (with the doc to open), his focus lines, each path's next topic, " +
                'and his active goals (deadline, days left, milestones, forecast, next milestone). Start here to plan a day.',
            input: {},
            annotations: READ_ONLY,
        },
        async () => todayText(await api.get<Today>('/api/today'))
    );

    defineTool(
        server,
        ctx,
        'get_learning_overview',
        {
            title: 'Learning overview',
            description:
                'Per subject: topics (docs under revision) due now, waiting, mastered (all 4 reviews done) or not scheduled, and the daily revision budget. ' +
                'With subject: its topics, each with its next review and doc id. For planning a week or finding gaps.',
            input: {
                subject: zSubjectName.optional().describe('A subject name to list its topics (case-insensitive).'),
            },
            annotations: READ_ONLY,
        },
        async ({ subject }) => {
            const [subjects, statuses, settings] = await Promise.all([
                listSubjects(api),
                api.get<TopicStatus[]>('/api/topics/statuses'),
                api.get<LearningSettings>('/api/learning/settings').catch(() => null),
            ]);
            if (!subject) return overviewText(subjects, statuses, settings);
            const found = findSubject(subjects, subject);
            if (!found) throw new ToolError(`No subject named ${quote(subject, 60)}. Subjects: ${subjects.map((s) => quote(s.name, 60)).join(', ') || 'none'}.`);
            return subjectText(found, statuses);
        }
    );
}
