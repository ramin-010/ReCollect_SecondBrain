// The buddy's tools (BUDDY_MEMORY_PLAN §3.1 B): remember, recall_memory, forget; checkpoint's learned;
// the brief's buddy lines.
import { afterEach, describe, expect, it } from 'vitest';
import { UNDO, connect, fail, ok, type Harness } from './harness.js';
import { TOOL_GROUP_NAMES } from '../../src/server.js';
import { briefText, type Brief } from '../../src/tools/record.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const memory = (over: Record<string, unknown> = {}) => ({
    _id: 'mem1',
    text: 'Studies best after 9 pm',
    kind: 'fact',
    sensitivity: 'open',
    status: 'active',
    pinned: false,
    byUser: false,
    seenCount: 1,
    lastSeenDay: '2026-11-16',
    ...over,
});

describe('remember', () => {
    it('posts one note and says what became of it', async () => {
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory: memory() }] }, 201) });
        const res = await h.call('remember', { text: 'Studies best after 9 pm', kind: 'fact' });
        expect(h.requests[0]!.body).toEqual({ text: 'Studies best after 9 pm', kind: 'fact' });
        expect(res.text).toBe('Saved: "Studies best after 9 pm" (fact) · id mem1');
    });

    it('seen again, marked wrong, paused', async () => {
        h = await connect({
            'POST /api/buddy/remember': [
                ok({ paused: false, notes: [{ status: 'seen', memory: memory({ seenCount: 3, sensitivity: 'private', kind: 'state' }) }] }),
                ok({ paused: false, notes: [{ status: 'wrong', memory: memory({ status: 'wrong' }) }] }),
                ok({ paused: true, notes: [] }),
            ],
        });
        expect((await h.call('remember', { text: 'x y' })).text).toBe('Already known, seen again: "Studies best after 9 pm" (state, private, seen 3×) · id mem1');
        expect((await h.call('remember', { text: 'x y' })).text).toBe('Not saved: Ramin marked "Studies best after 9 pm" wrong.');
        expect((await h.call('remember', { text: 'x y' })).text).toMatch(/paused his buddy/);
    });
});

describe('recall_memory and forget (manage)', () => {
    it('searches, lists, and says when nothing is known', async () => {
        h = await connect({ 'GET /api/buddy/memories': [ok([memory(), memory({ _id: 'mem2', text: 'Wants a backend offer', kind: 'aim', pinned: true, byUser: true })]), ok([])], 'GET /api/buddy/chapters': [ok([]), ok([{ period: '2026-03', text: 'March was Rust.' }])] }, { groups: TOOL_GROUP_NAMES });
        const res = await h.call('recall_memory', { query: 'study' });
        expect(h.requests[0]!.query).toEqual({ q: 'study', limit: '20' });
        expect(h.requests[1]!.path).toBe('/api/buddy/chapters');
        expect(res.text).toBe('"Studies best after 9 pm" (fact) · id mem1\n"Wants a backend offer" (aim, pinned, his own) · id mem2');
        expect((await h.call('recall_memory', { query: 'march' })).text).toBe('Month 2026-03: March was Rust.');
    });

    it('forget closes one, with Undo; his own are refused', async () => {
        h = await connect(
            { 'POST /api/buddy/memories/mem1/close': [ok({ memory: memory({ status: 'closed' }), editId: 'e1' }), fail(403, 'Ramin wrote or changed this memory himself: only he can change it (on /you)')] },
            { groups: TOOL_GROUP_NAMES }
        );
        const res = await h.call('forget', { id: 'mem1', reason: 'He stopped' });
        expect(h.requests[0]!.body).toEqual({ reason: 'He stopped' });
        expect(res.text).toBe(`Forgot: "Studies best after 9 pm".\n${UNDO}`);
        const refused = await h.call('forget', { id: 'mem1' });
        expect(refused.isError).toBe(true);
        expect(refused.text).toMatch(/only he can change it/);
    });

    it('get_work_log (B9): the days as text; in a work folder only that project, whatever is asked', async () => {
        const day = {
            day: '2026-11-15',
            projects: [
                { project: 'erp', office: true, minutes: 95, sessions: 2, commits: ['Fix GST rounding'], lines: [{ _id: 'w1', kind: 'did', text: 'Fixed the GST rounding' }, { _id: 'w2', kind: 'next', text: 'Add the credit note export' }] },
            ],
        };
        h = await connect({ 'GET /api/buddy/work': [ok([day]), ok([])] }, { groups: TOOL_GROUP_NAMES });
        const res = await h.call('get_work_log', { project: 'erp', from: '2026-11-15', to: '2026-11-15' });
        expect(h.requests[0]!.query).toEqual({ project: 'erp', from: '2026-11-15', to: '2026-11-15' });
        expect(res.text).toBe('Sun 15 Nov\nerp · 1 h 35 min in 2 sessions\n  - Fixed the GST rounding\n  - next: Add the credit note export\n  commits: Fix GST rounding');
        expect((await h.call('get_work_log', { query: 'rounding' })).text).toBe('Nothing about "rounding" in his work log.');
        await h.close();

        h = await connect({ 'GET /api/buddy/work': [ok([])] }, { groups: TOOL_GROUP_NAMES, workMode: true, workProject: 'erp' });
        await h.call('get_work_log', { project: 'second_brain' });
        expect(h.requests[0]!.query).toEqual({ project: 'erp', work: '1' });
    });

    it("the brief prints the work log: yesterday in his own chats, the project's days in a work folder", () => {
        const base = { now: { day: '2026-11-16', weekday: 'Mon', time: '09:00', timezone: 'Asia/Kolkata' }, profile: null, goals: [], today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] }, next: [], recent: [], recall: { days: 7, finished: 0, weakTopics: [] }, project: null, session: { key: 'k' } } as unknown as Brief;
        const yesterday = briefText({ ...base, work: { days: [{ day: '2026-11-15', projects: [{ project: 'erp', minutes: 95, lines: ['Fixed the GST rounding'] }] }] } });
        expect(yesterday).toContain('His work yesterday:\n- erp (95 min): "Fixed the GST rounding"');
        const lately = briefText({ ...base, work: { days: [{ day: '2026-11-15', projects: [{ project: 'erp', minutes: 0, lines: ['Fixed it'] }] }, { day: '2026-11-13', projects: [{ project: 'erp', minutes: 30, lines: ['Kept the old export'] }] }] } });
        expect(lately).toContain('His work here lately:\n- 2026-11-15 · erp: "Fixed it"\n- 2026-11-13 · erp (30 min): "Kept the old export"');
        expect(briefText(base)).not.toContain('His work');
    });

    it('remember is listed by default; recall_memory and forget only on more_tools', async () => {
        h = await connect({});
        const names = (await h.client.listTools()).tools.map((t) => t.name);
        expect(names).toContain('remember');
        expect(names).not.toContain('recall_memory');
        expect(names).not.toContain('forget');
    });
});

describe('checkpoint learned and the brief', () => {
    it('checkpoint sends learned notes and reports them', async () => {
        h = await connect({
            'PUT /api/sessions/by-key/s_1': ok({
                session: { _id: 's1', key: 's_1', kind: 'build', day: '2026-11-16', minutes: 30, title: 'Memory tables', subject: null, topic: null, project: { key: 'second_brain', name: 'second_brain' }, score: null, outcome: null, nextStep: null, source: 'agent', agentName: 'Claude Code' },
                topic: null,
                weakSpots: [],
                topicEditId: null,
                learned: { saved: 1, seen: 1, skipped: 0, paused: false },
            }),
        });
        const res = await h.call('checkpoint', { key: 's_1', title: 'Memory tables', learned: [{ text: 'Builds late at night' }, { text: 'Wants a buddy', kind: 'aim' }] });
        expect(h.requests[0]!.body.learned).toEqual([{ text: 'Builds late at night' }, { text: 'Wants a buddy', kind: 'aim' }]);
        expect(res.text).toContain('Learned: 1 new memory, 1 already known.');
    });

    it('the brief prints the portrait, the memories and the note when there are any', () => {
        const base: Brief = {
            now: { day: '2026-11-16', weekday: 'Mon', time: '09:00', timezone: 'Asia/Kolkata' },
            profile: null,
            goals: [],
            today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] },
            next: [],
            recent: [],
            recall: { days: 7, finished: 0, weakTopics: [] },
            project: null,
            session: { key: 's_x' },
        };
        expect(briefText(base)).not.toMatch(/buddy|Who he is/);
        const text = briefText({
            ...base,
            buddy: { who: 'A backend engineer who learns at night.', heading: 'A backend offer by May.', now: 'Tired this week.', memories: [{ kind: 'preference', text: 'Bottom line first', pinned: true }], note: 'Ask how the mock went.', followUp: null },
        });
        expect(text).toContain('Who he is: A backend engineer who learns at night.');
        expect(text).toContain('Where he is heading: A backend offer by May.');
        expect(text).toContain('Right now: Tired this week.');
        expect(text).toContain('His buddy knows: Bottom line first (preference)');
        expect(text).toContain('From his buddy (pass it on in a sentence at a natural pause): Ask how the mock went.');
    });
});
