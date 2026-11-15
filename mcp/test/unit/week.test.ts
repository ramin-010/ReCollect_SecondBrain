// The week tools (LOOP_COMPLETE_SPEC 1.6): what each sends and how it answers.
import { afterEach, describe, expect, it } from 'vitest';
import { connect, ok, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const target = (over: Record<string, unknown> = {}) => ({
    _id: 'wt1',
    weekStart: '2026-11-16',
    text: 'Finish 7. Message queues',
    status: 'open',
    done: false,
    progress: null,
    topic: { _id: 't7', title: 'Message queues' },
    milestone: null,
    task: null,
    measure: null,
    subject: null,
    project: null,
    ...over,
});

const text = async (name: string, args: Record<string, unknown>) => (await h!.call(name, args)).text;

describe('week tools', () => {
    it('get_week lists the targets with ids, last week and the waiting review', async () => {
        h = await connect({
            'GET /api/week': ok({
                weekStart: '2026-11-16',
                weekEnd: '2026-11-22',
                targets: [target({ done: true }), target({ _id: 'wt2', text: '10 graph problems', topic: null, measure: 'practice', progress: { done: 3, total: 10 }, subject: { name: 'DSA' } })],
                lastWeek: { weekStart: '2026-11-09', targets: { done: 3, total: 4 }, minutes: { study: 240, practice: 90, build: 0, review: 0 }, topicsDone: 2, revisionsDone: 14 },
                review: { due: true, weekStart: '2026-11-16' },
            }),
        });
        const out = await text('get_week', {});
        expect(out).toContain('Week Mon 16 Nov – Sun 22 Nov: 1/2 done');
        expect(out).toContain('[x] "Finish 7. Message queues" · topic "Message queues" · id wt1');
        expect(out).toContain('[ ] "10 graph problems" · 3/10 practice in DSA · id wt2');
        expect(out).toContain('3/4 targets, study 4 h, practice 1 h 30 min, 2 topics finished, 14 revisions');
        expect(out).toContain('weekly review for the week of Mon 16 Nov is waiting');
    });

    it('add_week_target resolves the subject and sends the count; update_week_target needs a change', async () => {
        h = await connect({
            'GET /api/subjects': ok([{ _id: 's1', name: 'DSA' }]),
            'POST /api/week/targets': ok(target({ _id: 'wt3', text: '10 graph problems', topic: null, measure: 'practice', progress: { done: 0, total: 10 }, subject: { name: 'DSA' } })),
        });
        const out = await text('add_week_target', { text: '10 graph problems', measure: 'practice', amount: 10, subject: 'DSA' });
        expect(h.requests.at(-1)!.body).toMatchObject({ text: '10 graph problems', measure: 'practice', amount: 10, subjectId: 's1' });
        expect(out).toContain('Added to the week of Mon 16 Nov');
        expect(out).toContain('Undo');
        expect(await text('update_week_target', { targetId: 'wt3' })).toMatch(/Send text or status/);
    });

    it('suggest builds the payload by kind', async () => {
        h = await connect({ 'POST /api/suggestions': ok({ _id: 'sg1' }) });
        expect(await text('suggest', { kind: 'focus_line', text: 'Two sliding-window mediums' })).toContain('waits on Home');
        expect(h.requests.at(-1)!.body).toEqual({ kind: 'focus_line', text: 'Two sliding-window mediums', payload: { text: 'Two sliding-window mediums' } });
        expect(await text('suggest', { kind: 'profile_edit', text: 'Learns by building' })).toMatch(/needs profile/);
    });
});

describe('get_mirror', () => {
    it('prints each goal’s paths with pace and fix, then subjects; quotes the app’s numbers', async () => {
        h = await connect({
            'GET /api/mirror': ok({
                today: '2026-11-14',
                goals: [
                    {
                        _id: 'g1',
                        title: 'Offer',
                        deadline: '2027-05-16',
                        daysLeft: 183,
                        milestones: { done: 1, total: 6 },
                        forecast: { status: 'behind' },
                        paths: [{ subject: { name: 'System Design' }, done: 7, total: 16, perWeek: 0.5, requiredPerWeek: 0.4, landsOn: '2027-06-01', status: 'behind', fix: { extraPerWeek: 1, orLandsOn: '2027-06-01' } }],
                        hoursPerWeek: [{ weekStart: '2026-11-09', minutes: { study: 120, practice: 0, build: 0, review: 0 } }],
                    },
                ],
                subjects: [{ _id: 's1', name: 'DSA', path: null, quiz: [{ day: '2026-11-12', done: 3, total: 4 }], weakSpots: { open: 2, clearedIn30: 1 }, practice: { alone: 3, hints: 1, after_answer: 0 }, minutesPerTopic: null }],
                weeks: [{ weekStart: '2026-11-09', minutes: { study: 120, practice: 0, build: 0, review: 0 }, targets: { done: 1, total: 3 } }],
            }),
        });
        const out = await text('get_mirror', {});
        expect(out).toContain('Goal "Offer" · due 2027-05-16 (183 days) · milestones 1/6 · behind');
        expect(out).toContain('System Design: 7/16 topics at 0.5/wk, needs 0.4/wk, lands 2027-06-01 · behind · fix: 1 more topic a week, or finish 2027-06-01');
        expect(out).toContain('DSA: quiz 3/4 · weak spots 2 open, 1 cleared in 30 days · practice: 3 alone, 1 with hints, 0 after the answer');
        expect(out).toContain('Weeks (oldest first): 2 h (1/3 targets)');
    });
});

describe('task tools', () => {
    const task = (over: Record<string, unknown> = {}) => ({ _id: 'td1', title: 'Book the mock interview', status: 'pending', priority: 'high', due: '2026-11-14T12:30:00.000Z', ...over });

    it('list_tasks sends the window and prints ids; add_task and update_task send what was given and offer Undo', async () => {
        h = await connect({ 'GET /api/tasks': ok([task(), task({ _id: 'td2', title: 'Renew the domain', status: 'complete', priority: 'normal', due: null })]), 'POST /api/tasks': ok(task()), 'PATCH /api/tasks/td1': ok(task({ status: 'complete' })) });
        const list = await text('list_tasks', { due: 'today' });
        expect(h.requests[0]!.query).toEqual({ due: 'today' });
        expect(list).toContain('[ ] "Book the mock interview" · due Sat 14 Nov, 18:00 · high · id td1');
        expect(list).toContain('[x] "Renew the domain" · id td2');
        expect(await text('add_task', { title: 'Book the mock interview', due: '2026-11-14', priority: 'high' })).toContain('Undo');
        expect(h.requests.at(-1)!.body).toEqual({ title: 'Book the mock interview', due: '2026-11-14', priority: 'high' });
        expect(await text('update_task', { taskId: 'td1', status: 'complete' })).toMatch(/Changed: \[x\]/);
        expect(await text('update_task', { taskId: 'td1' })).toMatch(/Send title, due, priority or status/);
    });
});
