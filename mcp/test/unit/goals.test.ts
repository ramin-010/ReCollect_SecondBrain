import { afterEach, describe, expect, it } from 'vitest';
import { UNDO, UUID_RE, connect, fail, lastLine, ok, type Harness } from './harness.js';
import { DSA, SYS, goal, milestone, subjects } from './fixtures.js';
import { TOOL_GROUP_NAMES } from '../../src/server.js';
/** Every group: the focus and milestone edits are on more_tools (the manage group) since 2026-11-15. */
const all = (routes: Parameters<typeof connect>[0]) => connect(routes, { groups: TOOL_GROUP_NAMES });

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

describe('list_goals', () => {
    it('active goals in detail (why, subjects, milestones with ids, forecast); others in one line', async () => {
        const archived = goal({ _id: 'goal2', title: 'Old goal', status: 'archived', deadline: '2026-10-01', daysLeft: -44, milestones: [], subjects: [] });
        h = await connect({ 'GET /api/goals': ok([goal(), archived]) });
        expect((await h.call('list_goals')).text).toBe(
            [
                '2 goals, active first:',
                '- "Product-company SDE role" · active · due 2027-06-30 (228 days left) · 1/2 milestones · on track · id goal1',
                '  Why: A role where I build products',
                '  Subjects: DSA',
                '  [x] Pick a sheet · id ms0',
                '  [ ] Finish arrays · due 2026-12-01 · id ms1',
                '  Forecast: 1 more milestone a week keeps you on track.',
                '- "Old goal" · archived · due 2026-10-01 (44 days past the deadline) · 0/0 milestones · id goal2',
            ].join('\n')
        );
    });

    it('no goals', async () => {
        h = await connect({ 'GET /api/goals': ok([]) });
        expect((await h.call('list_goals')).text).toMatch(/^No goals yet/);
    });
});

describe('create_goal', () => {
    it('resolves subjects by name and sends each milestone’s dueDay', async () => {
        const created = goal({
            _id: 'goalN',
            title: 'Ship the MCP server',
            why: null,
            deadline: '2026-12-31',
            daysLeft: 47,
            subjects: [DSA, SYS],
            milestones: [milestone({ _id: 'mA', title: 'Tools', dueDay: '2026-11-20' }), milestone({ _id: 'mB', title: 'Tests', dueDay: null })],
        });
        h = await connect({ 'GET /api/subjects': ok(subjects()), 'POST /api/goals': ok(created, 201) });
        const res = await h.call('create_goal', {
            title: 'Ship the MCP server',
            deadline: '2026-12-31',
            why: 'Agents write my docs',
            subjects: ['dsa', 'System design'],
            milestones: [{ title: 'Tools', dueDay: '2026-11-20' }, { title: 'Tests' }],
        });
        const post = h.requests.find((r) => r.method === 'POST')!;
        expect(post.path).toBe('/api/goals');
        expect(post.headers['idempotency-key']).toMatch(UUID_RE);
        expect(post.body).toEqual({
            title: 'Ship the MCP server',
            deadline: '2026-12-31',
            why: 'Agents write my docs',
            subjectIds: [DSA._id, SYS._id],
            milestones: [{ title: 'Tools', dueDay: '2026-11-20' }, { title: 'Tests' }],
        });
        expect(res.text).toBe(
            [
                'Created goal "Ship the MCP server" · due 2026-12-31 (47 days left) · 0/2 milestones · on track · id goalN',
                'Subjects: DSA, System Design',
                '  [ ] Tools · due 2026-11-20 · id mA',
                '  [ ] Tests · id mB',
                UNDO,
            ].join('\n')
        );
    });

    it('a minimal goal sends only title and deadline (no subjects lookup)', async () => {
        h = await connect({ 'POST /api/goals': ok(goal({ milestones: [], subjects: [] }), 201) });
        await h.call('create_goal', { title: 'T', deadline: '2027-01-01' });
        expect(h.requests).toHaveLength(1);
        expect(h.requests[0]!.body).toEqual({ title: 'T', deadline: '2027-01-01' });
    });

    it('unknown subjects are named; nothing is created', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()) });
        const res = await h.call('create_goal', { title: 'T', deadline: '2027-01-01', subjects: ['DSA', 'Rust', 'Go'] });
        expect(res.isError).toBe(true);
        expect(res.text).toBe('No subject named "Rust", "Go". Subjects: "DSA", "System Design". Call create_subject first.');
        expect(h.requests.map((r) => r.method)).toEqual(['GET']);
    });

    it('rejects a date that is not YYYY-MM-DD or not a real day', async () => {
        h = await connect({});
        expect((await h.call('create_goal', { title: 'T', deadline: '31/12/2026' })).isError).toBe(true);
        expect((await h.call('create_goal', { title: 'T', deadline: '2026-02-30' })).isError).toBe(true);
        expect(h.requests).toHaveLength(0);
    });

    it("the API's limits pass through (a 4th active goal)", async () => {
        h = await connect({ 'POST /api/goals': fail(409, 'Up to 3 active goals', 'GOAL_LIMIT') });
        expect(await h.call('create_goal', { title: 'T', deadline: '2027-01-01' })).toEqual({ text: 'Up to 3 active goals', isError: true });
    });
});

describe('update_goal', () => {
    it('PATCHes only what changes; an empty why clears it; subjects become ids', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()), 'PATCH /api/goals/goal1': ok(goal({ deadline: '2027-03-31', daysLeft: 137 })) }, { groups: TOOL_GROUP_NAMES });
        const res = await h.call('update_goal', { goalId: 'goal1', deadline: '2027-03-31', why: '', subjects: ['DSA'] });
        const patch = h.requests.find((r) => r.method === 'PATCH')!;
        expect(patch.path).toBe('/api/goals/goal1');
        expect(patch.headers['idempotency-key']).toMatch(UUID_RE);
        expect(patch.body).toEqual({ why: null, deadline: '2027-03-31', subjectIds: [DSA._id] });
        expect(res.text).toBe(
            `Updated goal (why, deadline, subjects): "Product-company SDE role" · active · due 2027-03-31 (137 days left) · 1/2 milestones · on track · id goal1\n${UNDO}`
        );
    });

    it('status only', async () => {
        h = await connect({ 'PATCH /api/goals/goal1': ok(goal({ status: 'done' })) }, { groups: TOOL_GROUP_NAMES });
        await h.call('update_goal', { goalId: 'goal1', status: 'done' });
        expect(h.requests[0]!.body).toEqual({ status: 'done' });
    });

    it('nothing to change → an error, no call', async () => {
        h = await connect({}, { groups: TOOL_GROUP_NAMES });
        const res = await h.call('update_goal', { goalId: 'goal1' });
        expect(res).toMatchObject({ isError: true });
        expect(res.text).toMatch(/^Nothing to change/);
        expect(h.requests).toHaveLength(0);
    });

    it('an unknown goal id says which', async () => {
        h = await connect({ 'PATCH /api/goals/nope': fail(404, 'Not found', 'NOT_FOUND') }, { groups: TOOL_GROUP_NAMES });
        expect(await h.call('update_goal', { goalId: 'nope', title: 'X' })).toEqual({ text: 'No goal with id nope (list_goals shows them).', isError: true });
    });
});

describe('add_milestone', () => {
    it('POSTs title + dueDay and reports the goal progress', async () => {
        const added = milestone({ _id: 'msN', title: 'Graphs', dueDay: '2027-01-15' });
        h = await all({ 'POST /api/goals/goal1/milestones': ok({ milestone: added, goal: goal({ milestones: [milestone(), added] }) }, 201) });
        const res = await h.call('add_milestone', { goalId: 'goal1', title: 'Graphs', dueDay: '2027-01-15' });
        expect(h.requests[0]).toMatchObject({ method: 'POST', path: '/api/goals/goal1/milestones', body: { title: 'Graphs', dueDay: '2027-01-15' } });
        expect(h.requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text).toBe(
            `Added milestone "Graphs" (due 2027-01-15) to "Product-company SDE role" · id msN · goal at 0/2 milestones, on track.\n${UNDO}`
        );
    });

    it('without a date', async () => {
        h = await all({ 'POST /api/goals/goal1/milestones': ok({ milestone: milestone({ dueDay: null }), goal: goal() }, 201) });
        await h.call('add_milestone', { goalId: 'goal1', title: 'Finish arrays' });
        expect(h.requests[0]!.body).toEqual({ title: 'Finish arrays' });
    });
});

describe('complete_milestone', () => {
    it('PATCHes {done: true} and names the next milestone', async () => {
        const done = milestone({ _id: 'ms1', done: true, doneAt: '2026-11-14T10:00:00Z' });
        const next = milestone({ _id: 'ms2', title: 'Graphs', dueDay: '2027-01-15' });
        h = await all({ 'PATCH /api/goal-milestones/ms1': ok({ milestone: done, goal: goal({ milestones: [done, next] }) }) });
        const res = await h.call('complete_milestone', { milestoneId: 'ms1' });
        expect(h.requests[0]).toMatchObject({ method: 'PATCH', path: '/api/goal-milestones/ms1', body: { done: true } });
        expect(h.requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text).toBe(
            `Completed milestone "Finish arrays" in "Product-company SDE role" · 1/2 done · on track · next: "Graphs" (due 2027-01-15, id ms2).\n${UNDO}`
        );
        expect(lastLine(res.text)).toBe(UNDO);
    });

    it('an unknown milestone id says which', async () => {
        h = await all({ 'PATCH /api/goal-milestones/x1': fail(404, 'Not found', 'NOT_FOUND') });
        expect((await h.call('complete_milestone', { milestoneId: 'x1' })).text).toBe('No milestone with id x1 (list_goals shows them).');
    });
});

describe('update_milestone and remove_milestone', () => {
    it('reopens a milestone ticked by mistake, renames it, moves its day', async () => {
        const reopened = milestone({ _id: 'ms1', title: 'Arrays and strings', dueDay: '2027-01-20' });
        h = await all({ 'PATCH /api/goal-milestones/ms1': ok({ milestone: reopened, goal: goal({ milestones: [reopened] }) }) });
        const res = await h.call('update_milestone', { milestoneId: 'ms1', done: false, title: 'Arrays and strings', dueDay: '2027-01-20' });
        expect(h.requests[0]).toMatchObject({ method: 'PATCH', path: '/api/goal-milestones/ms1', body: { done: false, title: 'Arrays and strings', dueDay: '2027-01-20' } });
        expect(res.text.split('\n')[0]).toMatch(/^Milestone \[ \] Arrays and strings · due 2027-01-20 · id ms1 in "Product-company SDE role"/);
        expect(lastLine(res.text)).toBe(UNDO);
    });

    it('needs something to change', async () => {
        h = await all({});
        expect((await h.call('update_milestone', { milestoneId: 'ms1' })).text).toBe('Send title, dueDay, done, or a mix.');
        expect(h.requests).toHaveLength(0);
    });

    it('removes one (Undo brings it back); an unknown id says which', async () => {
        h = await all({
            'DELETE /api/goal-milestones/ms1': ok({ deleted: true, goal: goal({ milestones: [] }) }),
            'DELETE /api/goal-milestones/x1': fail(404, 'Not found', 'NOT_FOUND'),
        });
        const res = await h.call('remove_milestone', { milestoneId: 'ms1' });
        expect(h.requests[0]).toMatchObject({ method: 'DELETE', path: '/api/goal-milestones/ms1' });
        expect(h.requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text.split('\n')[0]).toMatch(/^Removed the milestone from "Product-company SDE role"/);
        expect(lastLine(res.text)).toBe(UNDO);
        expect((await h.call('remove_milestone', { milestoneId: 'x1' })).text).toBe('No milestone with id x1 (list_goals shows them).');
    });
});
