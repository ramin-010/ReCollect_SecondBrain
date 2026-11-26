import { afterEach, describe, expect, it } from 'vitest';
import { UNDO, UUID_RE, connect, fail, lastLine, ok, type Harness } from './harness.js';
import { DSA, SYS, revisionItem, status, subjects, today } from './fixtures.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const chain = (start: string[]) => start.map((day, i) => ({ _id: `r${i + 1}`, cycleNumber: i + 1, intervalDays: [1, 3, 7, 21][i]!, scheduledFor: day, status: 'pending', completedAt: null }));
const DAYS = ['2026-11-15', '2026-11-17', '2026-11-21', '2026-12-05'];

describe('list_subjects', () => {
    it('one line per subject with topic count and id', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()) });
        expect((await h.call('list_subjects')).text).toBe('2 subjects:\n- DSA · 2 topics · id subjDsa1\n- System Design · 0 topics · id subjSys2');
    });

    it('none yet', async () => {
        h = await connect({ 'GET /api/subjects': ok([]) });
        expect((await h.call('list_subjects')).text).toMatch(/^No subjects yet/);
    });
});

describe('create_subject', () => {
    it('creates a new subject (with an Idempotency-Key)', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()), 'POST /api/subjects': ok({ _id: 'subjAi3', name: 'AI', description: null }, 201) });
        const res = await h.call('create_subject', { name: ' AI ' });
        expect(h.requests[1]).toMatchObject({ method: 'POST', path: '/api/subjects', body: { name: 'AI' } });
        expect(h.requests[1]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text).toBe(`Created subject "AI" · id subjAi3.\n${UNDO}`);
    });

    it('an existing name (any case) is not created twice', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()) });
        const res = await h.call('create_subject', { name: 'dsa' });
        expect(res.text).toBe('Subject "DSA" already exists (id subjDsa1). Nothing created.');
        expect(h.requests.map((r) => r.method)).toEqual(['GET']);
    });
});

describe('schedule_revision', () => {
    it('a doc with no topic and no subject: asks for a subject, writes nothing', async () => {
        h = await connect({
            'GET /api/topics/by-doc/docA': ok({ topic: null, chain: [], nextAction: { kind: 'start' } }),
            'GET /api/subjects': ok(subjects()),
        });
        const res = await h.call('schedule_revision', { docId: 'docA' });
        expect(res.isError).toBe(true);
        expect(res.text).toContain('pass subject (one of "DSA", "System Design")');
        expect(h.requests.every((r) => r.method === 'GET')).toBe(true);
    });

    it('a doc with no topic + a subject: POST /api/topics with startRevisions true', async () => {
        h = await connect({
            'GET /api/topics/by-doc/docA': ok({ topic: null, chain: [], nextAction: { kind: 'start' } }),
            'GET /api/subjects': ok(subjects()),
            'POST /api/topics': ok({ topic: { _id: 'tNew', subjectId: DSA._id, docId: 'docA', title: 'Two pointers' }, chain: chain(DAYS) }, 201),
        });
        const res = await h.call('schedule_revision', { docId: 'docA', subject: 'dsa' });
        const post = h.requests.find((r) => r.method === 'POST')!;
        expect(post.path).toBe('/api/topics');
        expect(post.body).toEqual({ docId: 'docA', subjectId: DSA._id, startRevisions: true });
        expect(post.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text).toBe(`Scheduled "Two pointers" under DSA: reviews on ${DAYS.join(', ')}.\n${UNDO}`);
    });

    it('create_subject_if_missing files the doc under a new subject', async () => {
        h = await connect({
            'GET /api/topics/by-doc/docA': ok({ topic: null, chain: [], nextAction: { kind: 'start' } }),
            'GET /api/subjects': ok(subjects()),
            'POST /api/subjects': ok({ _id: 'subjAi3', name: 'AI', description: null }, 201),
            'POST /api/topics': ok({ topic: { _id: 'tNew', subjectId: 'subjAi3', docId: 'docA', title: 'Attention' }, chain: chain(DAYS) }, 201),
        });
        const res = await h.call('schedule_revision', { docId: 'docA', subject: 'AI', create_subject_if_missing: true });
        expect(h.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/api/subjects', '/api/topics']);
        expect(h.requests.at(-1)!.body).toEqual({ docId: 'docA', subjectId: 'subjAi3', startRevisions: true });
        expect(res.text).toBe(`Created subject "AI" (id subjAi3).\nScheduled "Attention" under AI: reviews on ${DAYS.join(', ')}.\n${UNDO}`);
    });

    it('a topic without revisions: POST /api/revisions/start', async () => {
        h = await connect({
            'GET /api/topics/by-doc/docA': ok({ topic: { _id: 't1', subjectId: DSA._id, docId: 'docA', title: 'Two pointers' }, chain: [], nextAction: { kind: 'start' } }),
            'POST /api/revisions/start': ok({ chain: chain(DAYS) }, 201),
        });
        const res = await h.call('schedule_revision', { docId: 'docA' });
        expect(h.requests[1]).toMatchObject({ method: 'POST', path: '/api/revisions/start', body: { topicId: 't1' } });
        expect(res.text).toBe(`Scheduled "Two pointers" for revision: reviews on ${DAYS.join(', ')}.\n${UNDO}`);
    });

    it('already scheduled: says when, writes nothing, no Undo line', async () => {
        const next = chain(DAYS)[1]!;
        h = await connect({
            'GET /api/topics/by-doc/docA': ok({ topic: { _id: 't1', subjectId: DSA._id, docId: 'docA', title: 'Two pointers' }, chain: chain(DAYS), nextAction: { kind: 'wait', inDays: 3, next } }),
        });
        const res = await h.call('schedule_revision', { docId: 'docA' });
        expect(res.text).toBe('"Two pointers" is already scheduled: next review 2026-11-17 (cycle 2/4). Nothing changed.');
        expect(h.requests).toHaveLength(1);
    });

    it('already scheduled under another subject: says it stays there', async () => {
        h = await connect({
            'GET /api/topics/by-doc/docA': ok({ topic: { _id: 't1', subjectId: DSA._id, docId: 'docA', title: 'Two pointers' }, chain: [], nextAction: { kind: 'completed' } }),
            'GET /api/subjects': ok(subjects()),
        });
        const res = await h.call('schedule_revision', { docId: 'docA', subject: SYS.name });
        expect(res.text).toBe('"Two pointers" has finished all its reviews (mastered). Nothing changed. It stays under DSA (agents can\'t move docs between subjects).');
    });

    it('an unknown doc: a clear message instead of "Not found"', async () => {
        h = await connect({ 'GET /api/topics/by-doc/docZ': fail(404, 'Not found', 'NOT_FOUND') });
        const res = await h.call('schedule_revision', { docId: 'docZ' });
        expect(res).toEqual({ text: 'No doc with id docZ that the user can open (search_docs finds docs).', isError: true });
    });

    it('a token without learning:write gets the scope named', async () => {
        h = await connect({
            'GET /api/topics/by-doc/docA': ok({ topic: { _id: 't1', subjectId: DSA._id, docId: 'docA', title: 'T' }, chain: [], nextAction: { kind: 'start' } }),
            'POST /api/revisions/start': fail(403, 'This access token lacks the "learning:write" scope'),
        });
        expect((await h.call('schedule_revision', { docId: 'docA' })).text).toContain('lacks the "learning:write" scope');
    });
});

describe('list_due', () => {
    it("lists today's plan first, then the waiting ones, with doc ids", async () => {
        h = await connect({ 'GET /api/today': ok(today()) });
        const res = await h.call('list_due');
        expect(res.text).toBe(
            [
                "Due on 2026-11-14: 3 revisions, 2 on today's plan (~13 of 25 min).",
                "On today's plan, in order:",
                '- Two pointers · DSA · cycle 2/4 · 3 days late · ~5 min · doc docA · review rev1',
                '- Heaps · DSA · cycle 1/4 · due today · ~8 min · doc docB · review rev2',
                'Waiting for room (they come in as the plan frees up):',
                '- Tries · DSA · cycle 3/4 · due today · doc docC · review rev3',
            ].join('\n')
        );
    });

    it('nothing due', async () => {
        const empty = today({
            revisions: { totalDue: 0, overdue: [], dueToday: [], doneToday: [] },
            plan: { mode: 'normal', budgetMin: 25, estMinutes: 0, planned: [], waitingCount: 0, doneToday: [revisionItem({ status: 'done' })] },
        });
        h = await connect({ 'GET /api/today': ok(empty) });
        expect((await h.call('list_due')).text).toBe('Nothing due on 2026-11-14.\nDone today: 1 revision.');
    });

    it('a capture (note) has no doc', async () => {
        const note = revisionItem({ _id: 'revN', kind: 'capture', itemId: 'c1', title: 'A link', subject: null, docId: undefined });
        h = await connect({ 'GET /api/today': ok(today({ plan: { mode: 'normal', budgetMin: 25, estMinutes: 5, planned: [note], waitingCount: 0, doneToday: [] }, revisions: { totalDue: 1, overdue: [], dueToday: [note], doneToday: [] } })) });
        expect((await h.call('list_due')).text).toContain('- A link · no subject · cycle 2/4 · due today · a note (no doc) · review revN');
    });
});

describe('get_today', () => {
    it('plan, focus and goals in a few lines (no pocket notes)', async () => {
        h = await connect({ 'GET /api/today': ok(today()) });
        const res = await h.call('get_today');
        expect(res.text).toBe(
            [
                'Today 2026-11-14 (Asia/Kolkata) · streak 5 days',
                "Revisions on today's plan (2, ~13 of 25 min):",
                '- Two pointers · DSA · cycle 2/4 · 3 days late · ~5 min · doc docA · review rev1',
                '- Heaps · DSA · cycle 1/4 · due today · ~8 min · doc docB · review rev2',
                '+1 more due, waiting for room (list_due shows them).',
                'Focus (1 of 3):',
                '- [ ] Finish 2 graph problems · id f1',
                'Goals:',
                '- "Product-company SDE role" · due 2027-06-30 (228 days left) · 1/2 milestones · behind by 12 days · next: "Finish arrays" (due 2026-12-01, id ms1) · id goal1',
            ].join('\n')
        );
        expect(h.requests).toHaveLength(1);
        expect(h.requests[0]).toMatchObject({ method: 'GET', path: '/api/today' });
    });

    it('an empty day, busy mode and yesterday\'s carry-over', async () => {
        const quiet = today({
            stats: { streak: 0 },
            plan: { mode: 'busy', budgetMin: 10, estMinutes: 0, planned: [], waitingCount: 0, doneToday: [] },
            focus: { items: [], carryOver: [{ _id: 'f0', day: '2026-11-13', text: 'Read DDIA ch. 3', done: false }] },
            goals: [],
        });
        h = await connect({ 'GET /api/today': ok(quiet) });
        expect((await h.call('get_today')).text).toBe(
            [
                'Today 2026-11-14 (Asia/Kolkata) · busy week: a shorter plan',
                'Revisions: none due today.',
                'Focus: none yet (add_focus adds up to 3 a day).',
                'Unfinished from yesterday: "Read DDIA ch. 3"',
                'Goals: none active (create_goal adds one).',
            ].join('\n')
        );
    });

    it("next up: each path's next topic, with its next step and the topic id (SYNC_SPINE_SPEC 1.1)", async () => {
        const next = [
            { subject: { _id: SYS._id, name: 'System Design' }, topic: { _id: 't5', title: 'Caching', position: 5, status: 'in_progress' as const }, done: 4, total: 16, nextStep: 'Do the stampede exercise' },
            { subject: { _id: DSA._id, name: 'DSA' }, topic: { _id: 't9', title: 'Graphs', position: 9, status: 'planned' as const }, done: 8, total: 20, nextStep: null },
        ];
        h = await connect({ 'GET /api/today': ok(today({ goals: [], next })) });
        const text = (await h.call('get_today')).text;
        expect(text).toContain(
            [
                'Next up (each path’s next topic):',
                '- System Design: ▶ 5. Caching · next step: Do the stampede exercise · 4 of 16 done · topic id t5',
                '- DSA: ○ 9. Graphs · 8 of 20 done · topic id t9',
                'Goals: none active (create_goal adds one).',
            ].join('\n')
        );
    });

    it('a revoked token: the agent is told to make a new one', async () => {
        h = await connect({ 'GET /api/today': fail(401, 'This access token was revoked') });
        const res = await h.call('get_today');
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(/^The Kaaga token is invalid or revoked: make a new one in Settings → Agents/);
    });
});

describe('get_learning_overview', () => {
    const statuses = () => [
        status({ topicId: 't1', title: 'Two pointers', state: 'due', inDays: 0, next: { _id: 'r', cycleNumber: 2, intervalDays: 3, scheduledFor: '2026-11-13', status: 'pending', completedAt: null } }),
        status({ topicId: 't2', title: 'Heaps', docId: 'docB', state: 'wait', inDays: 4, next: { _id: 'r2', cycleNumber: 3, intervalDays: 7, scheduledFor: '2026-11-18', status: 'pending', completedAt: null } }),
        status({ topicId: 't3', title: 'Tries', docId: 'docC', state: 'wait', inDays: 12, next: { _id: 'r3', cycleNumber: 4, intervalDays: 21, scheduledFor: '2026-11-26', status: 'pending', completedAt: null } }),
        status({ topicId: 't4', title: 'Arrays', docId: 'docD', state: 'completed', inDays: null, done: 4 }),
        status({ topicId: 't5', title: 'Caching', docId: 'docE', subjectId: SYS._id, state: 'start', inDays: null, done: 0, total: 0 }),
    ];
    const routes = () => ({
        'GET /api/subjects': ok([...subjects(), { _id: 'subjAi3', name: 'AI', description: null, topics: [] }]),
        'GET /api/topics/statuses': ok(statuses()),
        'GET /api/learning/settings': ok({ dailyBudgetMin: 25, busyUntil: '2026-11-20', timezone: 'Asia/Kolkata' }),
    });

    it('counts per subject from the statuses, plus the budget', async () => {
        h = await connect(routes(), { set: 'web' });
        expect((await h.call('get_learning_overview')).text).toBe(
            [
                'Learning overview: 5 topics in 3 subjects · 1 due now · 2 waiting (1 due within 7 days) · 1 mastered · 1 unscheduled',
                'Daily revision budget 25 min · busy week until 2026-11-20',
                '- DSA · 4 topics: 1 due, 2 waiting, 1 mastered · id subjDsa1',
                '- System Design · 1 topic: 1 unscheduled · id subjSys2',
                '- AI · no topics yet · id subjAi3',
                'Pass subject: "<name>" to list one subject\'s topics with their next review dates.',
            ].join('\n')
        );
        expect(h.requests.map((r) => r.path).sort()).toEqual(['/api/learning/settings', '/api/subjects', '/api/topics/statuses']);
    });

    it("with subject: that subject's topics, due first", async () => {
        h = await connect(routes(), { set: 'web' });
        expect((await h.call('get_learning_overview', { subject: 'dsa' })).text).toBe(
            [
                'DSA · 4 topics: 1 due, 2 waiting, 1 mastered · id subjDsa1',
                '- Two pointers · due now (cycle 2/4, scheduled 2026-11-13) · doc docA',
                '- Heaps · next review 2026-11-18, in 4 days (cycle 3/4) · doc docB',
                '- Tries · next review 2026-11-26, in 12 days (cycle 4/4) · doc docC',
                '- Arrays · mastered (4/4 reviews done) · doc docD',
            ].join('\n')
        );
    });

    it('an unknown subject lists the real ones', async () => {
        h = await connect(routes(), { set: 'web' });
        const res = await h.call('get_learning_overview', { subject: 'Rust' });
        expect(res.isError).toBe(true);
        expect(res.text).toBe('No subject named "Rust". Subjects: "DSA", "System Design", "AI".');
    });

    it('ends write results with the Undo line, read results without it', async () => {
        h = await connect(routes(), { set: 'web' });
        expect(lastLine((await h.call('get_learning_overview')).text)).not.toBe(UNDO);
    });
});
