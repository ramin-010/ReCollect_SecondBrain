// Revision: put a doc on the spaced-revision schedule, and today's full due list.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError, orNotFound } from '../errors.js';
import { cycleText, nameList, plural, quote, revisionLine, withUndo } from '../format.js';
import { zDocId, zSubjectName } from '../schemas.js';
import { afterSubject, findSubject, listSubjects, resolveSubject } from '../subjects.js';
import { ADDS, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import type { ChainRevision, RevisionItem, Today, TopicByDoc, TopicCreated } from '../types.js';

const reviewDays = (chain: readonly ChainRevision[]): string =>
    chain
        .filter((r) => r.status === 'pending')
        .map((r) => r.scheduledFor)
        .join(', ') || 'none pending';

function dueText(t: Today): string {
    const plannedIds = new Set(t.plan.planned.map((r) => r._id));
    const all: RevisionItem[] = [...t.revisions.overdue, ...t.revisions.dueToday];
    const waiting = all.filter((r) => !plannedIds.has(r._id)).sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0));
    const total = Math.max(all.length, t.plan.planned.length + waiting.length);
    const done = t.plan.doneToday.length;
    const doneLine = done > 0 ? `Done today: ${plural(done, 'revision')}.` : null;

    if (total === 0) return [`Nothing due on ${t.today}.`, doneLine].filter(Boolean).join('\n');
    const lines = [`Due on ${t.today}: ${plural(total, 'revision')}, ${t.plan.planned.length} on today's plan (~${t.plan.estMinutes} of ${t.plan.budgetMin} min).`];
    if (t.plan.planned.length > 0) {
        lines.push("On today's plan, in order:");
        for (const item of t.plan.planned) lines.push(revisionLine(item));
    }
    if (waiting.length > 0) {
        lines.push('Waiting for room (they come in as the plan frees up):');
        for (const item of waiting) lines.push(revisionLine(item));
    }
    if (doneLine) lines.push(doneLine);
    return lines.join('\n');
}

export function registerRevisionTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'schedule_revision',
        {
            title: 'Schedule revision',
            description:
                'Put a doc on spaced revision: reviews 1, 3, 7 and 21 days from today, on Home when due. ' +
                'A doc in no subject yet needs subject (a name); a doc already scheduled stays as it is.',
            input: {
                docId: zDocId,
                subject: zSubjectName.optional().describe('Subject to file the doc under if it has none yet (case-insensitive name).'),
                create_subject_if_missing: z.boolean().optional().describe('Create the subject if no subject has that name.'),
            },
            annotations: ADDS,
        },
        async ({ docId, subject, create_subject_if_missing }) => {
            const notFound = `No doc with id ${docId} that the user can open (search_docs finds docs).`;
            const status = await orNotFound(api.get<TopicByDoc>(`/api/topics/by-doc/${docId}`), notFound);

            if (!status.topic) {
                if (!subject) {
                    const names = (await listSubjects(api)).map((s) => s.name);
                    throw new ToolError(
                        `This doc isn't filed under a subject yet: pass subject (one of ${nameList(names)}) to file and schedule it, or create_subject first.`
                    );
                }
                const resolved = await resolveSubject(api, subject, { createIfMissing: create_subject_if_missing });
                const created = await afterSubject(
                    api,
                    resolved,
                    orNotFound(api.post<TopicCreated>('/api/topics', { docId, subjectId: resolved.id, startRevisions: true }), notFound)
                );
                const lines = resolved.created ? [`Created subject ${quote(resolved.name, 60)} (id ${resolved.id}).`] : [];
                lines.push(`Scheduled ${quote(created.topic.title, 100)} under ${resolved.name}: reviews on ${reviewDays(created.chain)}.`);
                return withUndo(lines.join('\n'));
            }

            const { topic, nextAction } = status;
            let note = '';
            if (subject) {
                const current = (await listSubjects(api)).find((s) => s._id === topic.subjectId);
                const wanted = findSubject(current ? [current] : [], subject);
                if (current && !wanted) note = ` It stays under ${current.name} (agents can't move docs between subjects).`;
            }
            const title = quote(topic.title, 100);
            switch (nextAction.kind) {
                case 'start': {
                    const started = await api.post<{ chain: ChainRevision[] }>('/api/revisions/start', { topicId: topic._id });
                    return withUndo(`Scheduled ${title} for revision: reviews on ${reviewDays(started.chain)}.${note}`);
                }
                case 'completed':
                    return `${title} has finished all its reviews (mastered). Nothing changed.${note}`;
                case 'due':
                    return `${title} is already scheduled and due now (${cycleText(nextAction.next.cycleNumber)}, ${nextAction.next.scheduledFor}). Nothing changed.${note}`;
                default:
                    return `${title} is already scheduled: next review ${nextAction.next.scheduledFor} (${cycleText(nextAction.next.cycleNumber)}). Nothing changed.${note}`;
            }
        }
    );

    defineTool(
        server,
        ctx,
        'list_due',
        {
            title: 'Due revisions',
            description:
                "Every revision due today or overdue: today's plan first (in order, fitted to their daily budget), then the ones waiting for room. " +
                'Each with the doc to open and its review id.',
            input: {},
            annotations: READ_ONLY,
        },
        async () => dueText(await api.get<Today>('/api/today'))
    );
}
