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
