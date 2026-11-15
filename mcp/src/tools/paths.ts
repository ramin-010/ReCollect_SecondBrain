// Paths (BUDDY_PLAN B1): a subject's topics in order (a course: "01 · How the web works" …
// "16 · Machine coding"), each planned, in progress, done or skipped, and what comes next. Agents
// plan the course, insert a topic where it is needed, and move a topic along as Ramin studies it.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError, orNotFound } from '../errors.js';
import { plural, quote, withUndo } from '../format.js';
import { zId, zSubjectName } from '../schemas.js';
import { resolveSubject } from '../subjects.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import type { NextUp, PathStatus } from '../types.js';

type TopicStatus = PathStatus;

export interface PathTopic {
    _id: string;
    title: string;
    status: TopicStatus;
    position: number;
    docId: string | null;
    nextStep: string | null;
}

export interface Path {
    subject: { _id: string; name: string };
    topics: PathTopic[];
    next: PathTopic | null;
    done: number;
    total: number;
}

const MARK: Record<TopicStatus, string> = { done: '✓', in_progress: '▶', planned: '○', skipped: '–' };

function topicLine(t: PathTopic): string {
    return [`${MARK[t.status]} ${t.position}. ${t.title}`, ...(t.nextStep ? [`next step: ${t.nextStep}`] : []), ...(t.docId ? [`doc ${t.docId}`] : []), `id ${t._id}`].join(' · ');
}

/** "System Design: ▶ 5. Caching · next step: … · 4 of 16 done · topic id t5" */
export function nextUpLine(n: NextUp): string {
    return [
        `${n.subject.name}: ${MARK[n.topic.status]} ${n.topic.position}. ${n.topic.title}`,
        ...(n.nextStep ? [`next step: ${n.nextStep}`] : []),
        `${n.done} of ${n.total} done`,
        `topic id ${n.topic._id}`,
    ].join(' · ');
}

/** The whole path in a few lines: done/total, what is next, then every topic. */
export function pathText(p: Path): string {
    const head = `${p.subject.name}: ${p.done} of ${plural(p.total, 'topic')} done · ${p.next ? `next: ${p.next.position}. ${p.next.title}` : 'nothing planned next'}`;
    return [head, ...p.topics.map(topicLine)].join('\n');
}

export function registerPathTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'get_path',
        {
            title: "A subject's path",
            description:
                "The topics of a subject in their order, like a course: ✓ done, ▶ in progress, ○ planned, – skipped, with each one's next step and doc, and the topic to do next. " +
                'Read it before studying with Ramin, to pick up where he is.',
            input: { subject: zSubjectName.describe('The subject name, e.g. "System Design".') },
            annotations: READ_ONLY,
        },
        async ({ subject }) => {
            const s = await resolveSubject(api, subject);
            return pathText(await api.get<Path>(`/api/subjects/${s.id}/path`));
        }
    );

    defineTool(
        server,
        ctx,
        'plan_topics',
        {
            title: 'Plan topics on a path',
            description:
                "Put topics on a subject's path as planned (not studied yet, no doc): a whole course at once, or one topic where it is needed (after: the topic it follows). " +
                'Keep titles short; numbers are not needed (the order gives them). Ramin can undo it.',
            input: {
                subject: zSubjectName.describe('The subject name.'),
                titles: z.array(z.string().trim().min(1).max(200)).min(1).max(50).describe('The topic titles, in order.'),
                after: zId('topic').nullable().optional().describe('The topic they follow (get_path shows ids); null puts them first; leave out for the end.'),
            },
            annotations: ADDS,
        },
        async ({ subject, titles, after }) => {
            const s = await resolveSubject(api, subject);
            const result = await api.post<{ created: string[]; path: Path }>(`/api/subjects/${s.id}/path`, { titles, ...(after !== undefined ? { after } : {}) });
            return withUndo(`Planned ${plural(result.created.length, 'topic')} in ${quote(s.name, 60)}.\n${pathText(result.path)}`);
        }
    );

    defineTool(
        server,
        ctx,
        'update_topic',
        {
            title: 'Move a topic along its path',
            description:
                'Change one topic on its path: status (in_progress when Ramin starts it, done when he has learned it, skipped, or back to planned), the next step to take on it (null clears it), ' +
                'its place (after: the topic it follows; null puts it first), or the title of a planned topic. Ramin can undo it.',
            input: {
                topicId: zId('topic').describe('The topic id (get_path shows them).'),
                status: z.enum(['planned', 'in_progress', 'done', 'skipped']).optional(),
                nextStep: z.string().max(300).nullable().optional().describe('What to do next on it, e.g. "Do the consistent-hashing exercise".'),
                after: zId('topic').nullable().optional().describe('Move it after this topic; null puts it first.'),
                title: z.string().trim().min(1).max(200).optional().describe('A new title (planned topics only: a topic with a doc takes its doc’s title).'),
            },
            annotations: CHANGES,
        },
        async ({ topicId, status, nextStep, after, title }) => {
            if (status === undefined && nextStep === undefined && after === undefined && title === undefined) throw new ToolError('Send status, nextStep, after or title.');
            const body = {
                ...(status !== undefined ? { status } : {}),
                ...(nextStep !== undefined ? { nextStep } : {}),
                ...(after !== undefined ? { after } : {}),
                ...(title !== undefined ? { title } : {}),
            };
            const { topic, path } = await orNotFound(
                api.patch<{ topic: PathTopic; path: Path }>(`/api/topics/${topicId}/path`, body),
                `No topic with id ${topicId} (get_path shows them).`
            );
            return withUndo(`${topicLine(topic)}\n${pathText(path)}`);
        }
    );
}
