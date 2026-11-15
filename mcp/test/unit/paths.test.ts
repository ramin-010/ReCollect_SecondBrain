import { afterEach, describe, expect, it } from 'vitest';
import { UNDO, connect, fail, lastLine, ok, type Harness } from './harness.js';
import { SYS, subjects } from './fixtures.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const topic = (over: Record<string, unknown>) => ({ _id: 't1', title: 'How the web works', status: 'done', position: 1, docId: 'd1', nextStep: null, startedAt: null, doneAt: null, ...over });
const path = (topics: Array<Record<string, unknown>>, next: Record<string, unknown> | null) => ({
    subject: { _id: SYS._id, name: SYS.name },
    topics,
    next,
    done: topics.filter((t) => t['status'] === 'done').length,
    total: topics.length,
});

describe('get_path', () => {
    it('shows the course in order with marks, positions, next steps and ids', async () => {
        const caching = topic({ _id: 't2', title: 'Caching', status: 'in_progress', position: 2, docId: null, nextStep: 'Do the stampede exercise' });
        const queues = topic({ _id: 't3', title: 'Queues', status: 'planned', position: 3, docId: null });
        h = await connect({ 'GET /api/subjects': ok(subjects()), [`GET /api/subjects/${SYS._id}/path`]: ok(path([topic({}), caching, queues], caching)) });
        const res = await h.call('get_path', { subject: 'system design' });
        expect(res.text).toBe(
            [
                'System Design: 1 of 3 topics done · next: 2. Caching',
                '✓ 1. How the web works · doc d1 · id t1',
                '▶ 2. Caching · next step: Do the stampede exercise · id t2',
                '○ 3. Queues · id t3',
            ].join('\n')
        );
    });
});

describe('plan_topics and update_topic', () => {
    it('plans topics after one, and says how the path looks now', async () => {
        const planned = topic({ _id: 't9', title: 'Consistent hashing', status: 'planned', position: 2, docId: null });
        h = await connect({
            'GET /api/subjects': ok(subjects()),
            [`POST /api/subjects/${SYS._id}/path`]: ok({ created: ['t9'], path: path([topic({}), planned], planned) }, 201),
        });
        const res = await h.call('plan_topics', { subject: 'System Design', titles: ['Consistent hashing'], after: 't1' });
        expect(h.requests.find((r) => r.method === 'POST')).toMatchObject({ body: { titles: ['Consistent hashing'], after: 't1' } });
        expect(res.text.split('\n')[0]).toBe('Planned 1 topic in "System Design".');
        expect(res.text).toContain('○ 2. Consistent hashing · id t9');
        expect(lastLine(res.text)).toBe(UNDO);
    });

    it('starts a topic with a next step; needs something to change; an unknown id says which', async () => {
        const started = topic({ _id: 't2', title: 'Caching', status: 'in_progress', position: 2, docId: null, nextStep: 'Read chapter 5' });
        h = await connect({
            'PATCH /api/topics/t2/path': ok({ topic: started, path: path([topic({}), started], started) }),
            'PATCH /api/topics/x1/path': fail(404, 'Not found', 'NOT_FOUND'),
        });
        const res = await h.call('update_topic', { topicId: 't2', status: 'in_progress', nextStep: 'Read chapter 5' });
        expect(h.requests[0]).toMatchObject({ method: 'PATCH', path: '/api/topics/t2/path', body: { status: 'in_progress', nextStep: 'Read chapter 5' } });
        expect(res.text.split('\n')[0]).toBe('▶ 2. Caching · next step: Read chapter 5 · id t2');
        expect((await h.call('update_topic', { topicId: 't2' })).text).toBe('Send status, nextStep, after or title.');
        expect((await h.call('update_topic', { topicId: 'x1', status: 'done' })).text).toBe('No topic with id x1 (get_path shows them).');
    });
});
