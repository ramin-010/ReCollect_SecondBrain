// The brief and the record (SYNC_SPINE_SPEC 1.3): get_brief, checkpoint, list_sessions.
import { afterEach, describe, expect, it } from 'vitest';
import { UNDO, connect, fail, lastLine, ok, type Harness } from './harness.js';
import { SYS, subjects } from './fixtures.js';
import { briefText, type Brief } from '../../src/tools/record.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const session = (over: Record<string, unknown> = {}) => ({ day: '2026-11-13', kind: 'study' as const, minutes: 50, title: 'Cache-aside and stampedes', subject: 'System Design', project: null, score: { done: 7, total: 10 }, ...over });

function fullBrief(): Brief {
    return {
        now: { day: '2026-11-14', weekday: 'Sat', time: '19:40', timezone: 'Asia/Kolkata' },
        profile:
            'Backend engineer, learning system design and DSA around a full-time job. Likes short explanations, then a quiz; diagrams for anything with more than three moving parts. Weak at keeping a weekly rhythm.',
        goals: [
            {
                _id: 'g1',
                title: 'Ship the side project',
                deadline: '2027-05-16',
                daysLeft: 183,
                progress: { done: 1, total: 6 },
                forecast: { status: 'behind', behindDays: 12 },
                nextMilestone: { _id: 'm1', title: 'Landing page live; first users invited', dueDay: '2026-11-22' },
            },
        ],
        today: { revisions: { planned: 8, estMinutes: 49, done: 1, waiting: 9 }, focus: [{ _id: 'f1', text: 'Two sliding-window mediums before work', done: false }, { _id: 'f2', text: 'Read DDIA ch. 5 (replication)', done: true }] },
        next: [
            {
                subject: { _id: SYS._id, name: 'System Design' },
                topic: { _id: 't7', title: 'Message queues', position: 7, status: 'in_progress' },
                done: 6,
                total: 16,
                nextStep: 'Do the outbox pattern exercise',
                lastSession: session({ title: 'Outbox pattern, part 1', minutes: 35, score: { done: 6, total: 8 } }),
                weakSpots: [
                    { _id: 'w1', text: 'at-least-once vs exactly-once' },
                    { _id: 'w2', text: 'outbox polling vs CDC' },
                ],
            },
            { subject: { _id: 'subjDsa1', name: 'DSA' }, topic: { _id: 't9', title: 'Graphs: BFS and DFS', position: 9, status: 'planned' }, done: 8, total: 20, nextStep: null, lastSession: null, weakSpots: [] },
        ],
        recent: [
            session(),
            session({ day: '2026-11-12', kind: 'build', minutes: 80, title: 'Paths in the Docs library', subject: null, project: 'second_brain', score: null }),
            session({ day: '2026-11-11', minutes: 40, title: 'Graphs', score: null }),
        ],
        recall: { days: 7, finished: 5, weakTopics: [{ title: 'Caching strategies', weak: 2 }] },
        project: { key: 'second_brain', name: 'second_brain', nextStep: 'Hook installer', lastSession: { day: '2026-11-12', minutes: 80, title: 'Paths in the Docs library' } },
        session: { key: 's_0abcdefgh123' },
    };
}

describe('get_brief', () => {
    it('a full day fits in 2,400 characters and ends with the session key', () => {
        const text = briefText(fullBrief());
        expect(text.length).toBeLessThanOrEqual(2400);
        expect(text).toContain('About the user: Backend engineer');
        expect(text).toContain(
            '- System Design: ▶ 7. Message queues · next step: Do the outbox pattern exercise · 6 of 16 done · topic id t7\n  last: Fri 13 Nov · 35 min study · "Outbox pattern, part 1" · System Design · quiz 6/8 · weak spots: at-least-once vs exactly-once; outbox polling vs CDC'
        );
        expect(text).toContain('Recall, last 7 days: 5 reviews finished · weakest: Caching strategies (2 weak)');
        expect(lastLine(text)).toBe('Session key: s_0abcdefgh123 (pass it to checkpoint)');
    });

    it('asks the API with the project and a key to reuse', async () => {
        h = await connect({ 'GET /api/brief': ok(fullBrief()) });
        await h.call('get_brief', { project: 'second_brain', key: 'cc_abc' });
        expect(h.requests[0]).toMatchObject({ method: 'GET', path: '/api/brief', query: { project: 'second_brain', key: 'cc_abc' } });
        // MCP_MEMORY_PLAN §4.2: the brief only reads. A host's old list may still send `about`: it is not passed
        // on, and the answer says to reconnect.
        const old = await h.call('get_brief', { about: 'Help me plan a calm week before the exam' });
        expect(h.requests[1]!.query).toEqual({});
        expect(lastLine(old.text)).toBe('about was not passed on. This app’s list of Kaaga tools is out of date: reconnect the Kaaga connector. What the user says about themselves goes to remember or update_memory.');
    });
});

describe('checkpoint', () => {
    const written = (over: Record<string, unknown> = {}) =>
        ok({
            session: {
                _id: 'ws1',
                key: 's_k',
                kind: 'study',
                day: '2026-11-14',
                minutes: 35,
                title: 'Outbox pattern, part 1',
                subject: { _id: SYS._id, name: 'System Design' },
                topic: { _id: 't7', title: 'Message queues' },
                project: null,
                score: { done: 6, total: 8 },
                outcome: null,
                nextStep: null,
                source: 'agent',
                agentName: 'study-chat',
            },
            topic: { _id: 't7', title: 'Message queues', status: 'in_progress', position: 7, nextStep: 'Do the outbox exercise' },
            weakSpots: [{ _id: 'w1', text: 'at-least-once vs exactly-once' }],
            topicEditId: null,
            ...over,
        });

    it('PUTs the key with the subject resolved; says what is saved; Undo only when the topic changed', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()), 'PUT /api/sessions/by-key/s_k': [written(), written(), written({ topicEditId: 'e1' })] });
        const res = await h.call('checkpoint', { key: 's_k', subject: 'system design', topicId: 't7', score: { done: 6, total: 8 }, weakSpots: ['at-least-once vs exactly-once'] });
        const put = h.requests.find((r) => r.method === 'PUT')!;
        expect(put.body).toEqual({ subjectId: SYS._id, topicId: 't7', score: { done: 6, total: 8 }, weakSpots: ['at-least-once vs exactly-once'] });
        expect(res.text).toBe(
            [
                'Checkpoint saved: "Outbox pattern, part 1" · 35 min study · Message queues · quiz 6/8.',
                'Topic: 7. Message queues · in progress · next step: Do the outbox exercise',
                'Open weak spots: at-least-once vs exactly-once',
            ].join('\n')
        );
        // MCP_MEMORY_PLAN §4.2: `said` and `learned` went (one way in: remember, update_memory); an old list's call runs without them.
        const old = await h.call('checkpoint', { key: 's_k', title: 'Heaps', said: ['I want to do one DP problem a day this month'], learned: [{ text: 'x' }] });
        expect(h.requests.filter((r) => r.method === 'PUT').at(-1)!.body).toEqual({ title: 'Heaps' });
        expect(lastLine(old.text)).toMatch(/^said and learned were not passed on\. .*reconnect the Kaaga connector/);
        const done = await h.call('checkpoint', { key: 's_k', topicStatus: 'done' });
        expect(lastLine(done.text)).toBe(UNDO);
        expect((await h.call('checkpoint', { key: 's_k' })).text).toMatch(/^Send at least a title/);
    });

    it('a refusal from the server stays an error', async () => {
        h = await connect({ 'PUT /api/sessions/by-key/s_k': fail(400, 'title: Too big') });
        const other = await h.call('checkpoint', { key: 's_k', title: 'x'.repeat(10) });
        expect(other.isError).toBe(true);
    });
});

describe('list_sessions', () => {
    it('day totals by kind, then each session with who wrote it', async () => {
        h = await connect({
            'GET /api/sessions': ok({
                sessions: [
                    { _id: 'a', key: null, kind: 'study', day: '2026-11-14', minutes: 45, title: 'Graphs', subject: null, topic: null, project: null, score: null, outcome: null, nextStep: null, source: 'user', agentName: null },
                    {
                        _id: 'b',
                        key: 'cc_1',
                        kind: 'build',
                        day: '2026-11-14',
                        minutes: 80,
                        title: 'Paths UI',
                        subject: null,
                        topic: null,
                        project: { key: 'second_brain', name: 'second_brain' },
                        score: null,
                        outcome: null,
                        nextStep: null,
                        source: 'hook',
                        agentName: 'Claude Code hook',
                    },
                ],
                days: [{ day: '2026-11-14', minutes: { study: 45, practice: 0, build: 80, review: 0 }, count: 2 }],
            }),
        });
        // MCP_MEMORY_PLAN §4.1: list_sessions is in the manage group (not listed), and still runs by its name (TOOL_ACCESS_PLAN §2).
        const res = await h.call('list_sessions', {});
        expect(h.requests[0]!.query).toEqual({ days: '7' });
        expect(res.text).toBe(['Sat 14 Nov · 2 h 5 min: study 45 min, build 1 h 20 min', '- "Graphs" · 45 min study · by hand', '- "Paths UI" · 1 h 20 min build · second_brain · hook'].join('\n'));
    });
});

describe('get_brief on the web (MCP_MEMORY_PLAN §4.6)', () => {
    const view = {
        now: { day: '2026-11-19', weekday: 'Thu', time: '09:00', timezone: 'Asia/Kolkata' },
        who: 'A backend engineer who studies at night.',
        inMotion: [{ _id: 't1', type: 'thread', text: 'Walking after work', stage: 'active', last: { day: '2026-11-18', kind: 'done', text: 'Walked' } }],
        savedLately: [{ text: 'Prefers backend work', day: '2026-11-18', app: 'Claude', update: null }],
        asks: [{ _id: 'a1', threadId: 't1', text: 'Did you get your walk in?', answers: ['Yes', 'Not today'] }],
        howTo: ['Pass on what the user says.', 'Read this again on a later day.'],
    };

    it('asks for the buddy view and prints it small, with the ids update_memory needs', async () => {
        h = await connect({ 'GET /api/brief': ok(view) }, { set: 'web' });
        const text = (await h.call('get_brief', {})).text;
        expect(h.requests[0]!.query).toEqual({ view: 'buddy' });
        expect(text).toBe(
            [
                'Today: Thu 2026-11-19 09:00 (Asia/Kolkata)',
                'Who they are: A backend engineer who studies at night.',
                'In motion (their buddy follows these; ids for update_memory):',
                '- "Walking after work" · id t1 · 2026-11-18 done',
                'Saved lately: "Prefers backend work" (2026-11-18, Claude)',
                'Their buddy\'s question (ask once at a natural pause; pass the answer with update_memory on t1): "Did you get your walk in?" (Yes / Not today)',
                'Pass on what the user says.',
                'Read this again on a later day.',
                // TOOL_ACCESS_PLAN §5.4: the way to the rest of the catalogue, last.
                'More than the listed tools: find_tools("<the job>").',
            ].join('\n')
        );
        expect(text.length).toBeLessThan(900);
    });

    it('an older server answers the full brief: printed as before, then the way to the rest', async () => {
        h = await connect({ 'GET /api/brief': ok(fullBrief()) }, { set: 'web' });
        const lines = (await h.call('get_brief', {})).text.split('\n');
        expect(lines.slice(-2)).toEqual(['Session key: s_0abcdefgh123 (pass it to checkpoint)', 'More than the listed tools: find_tools("<the job>").']);
    });
});
