// The buddy's tools (BUDDY_MEMORY_PLAN §3.1 B; MCP_MEMORY_PLAN §4.2, §4.8): remember with when it was said and whose
// word it is, update_memory, recall_memory with provenance, forget; the answers' "Related" and "In motion"; the
// older-server fallbacks; the brief's buddy lines.
import { afterEach, describe, expect, it } from 'vitest';
import { UNDO, connect, fail, ok, type Harness } from './harness.js';
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

const lists = {
    related: { memories: [{ _id: 'mem2', text: 'Walks in the mornings', kind: 'pattern', lastSeenDay: '2026-11-12', app: 'ChatGPT', looksLikeOld: true }], threads: [{ _id: 't1', title: 'Walking habit', stage: 'active', last: { day: '2026-11-18', kind: 'done', text: 'Walked 30 minutes' } }] },
    inMotion: [{ _id: 't1', type: 'thread', text: 'Walking habit', stage: 'active', last: { day: '2026-11-18', kind: 'done', text: 'Walked' } }],
};

describe('remember', () => {
    it('posts one note with whose word it is, and says what became of it', async () => {
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory: memory() }] }, 201) });
        const res = await h.call('remember', { text: 'Studies best after 9 pm', kind: 'fact' });
        expect(h.requests[0]!.body).toEqual({ text: 'Studies best after 9 pm', kind: 'fact', inferred: false });
        expect(res.text).toBe('Saved: "Studies best after 9 pm" (fact) · id mem1');
    });

    it('sends said_on and inferred as the API names them; an inference says so', async () => {
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory: memory({ inferred: true, kind: 'pattern' }) }] }, 201) });
        const res = await h.call('remember', { text: 'Walks after work', kind: 'pattern', said_on: '2026-11-17T18:30', inferred: true });
        expect(h.requests[0]!.body).toEqual({ text: 'Walks after work', kind: 'pattern', saidOn: '2026-11-17T18:30', inferred: true });
        expect(res.text).toBe('Saved: "Studies best after 9 pm" (pattern, inferred) · id mem1\nKept as an inference until they say it themselves.');
        expect((await h.call('remember', { text: 'x', said_on: '17 Nov' })).isError).toBe(true);
    });

    it('seen again, closed (kept as a note), marked wrong or close to it, paused', async () => {
        h = await connect({
            'POST /api/buddy/remember': [
                ok({ paused: false, notes: [{ status: 'seen', memory: memory({ seenCount: 3, sensitivity: 'private', kind: 'state' }) }] }),
                ok({ paused: false, notes: [{ status: 'closed', memory: memory({ status: 'closed', closedDay: '2026-11-10', closeReason: 'Changed: now Studies in the mornings' }), replacedBy: memory({ _id: 'mem9', text: 'Studies in the mornings' }) }] }),
                ok({ paused: false, notes: [{ status: 'closed', memory: memory({ status: 'closed', closedDay: '2026-11-10' }), replacedBy: null }] }),
                ok({ paused: false, notes: [{ status: 'wrong', memory: memory({ status: 'wrong' }) }] }),
                ok({ paused: false, notes: [{ status: 'wrong', memory: memory({ status: 'wrong' }), similar: true }] }),
                ok({ paused: true, notes: [] }),
            ],
        });
        expect((await h.call('remember', { text: 'x y' })).text).toBe('Already known, seen again: "Studies best after 9 pm" (state, private, seen 3×) · id mem1');
        expect((await h.call('remember', { text: 'x y' })).text).toBe(
            'Kept as a note only: "Studies best after 9 pm" was closed on 2026-11-10 ("Changed: now Studies in the mornings") and stays closed. It was replaced by "Studies in the mornings": if they changed back, call update_memory with on mem9 and update changed.'
        );
        expect((await h.call('remember', { text: 'x y' })).text).toBe('Kept as a note only: "Studies best after 9 pm" was closed on 2026-11-10 and stays closed. Said again on a later day, it comes back.');
        expect((await h.call('remember', { text: 'x y' })).text).toBe('Not saved: the user marked "Studies best after 9 pm" wrong.');
        expect((await h.call('remember', { text: 'x y' })).text).toBe('Not saved: it is close to "Studies best after 9 pm", which the user marked wrong.');
        expect((await h.call('remember', { text: 'x y' })).text).toMatch(/paused their buddy/);
    });

    it('answers with what is related (the old version hinted) and what is in motion; a work folder gets neither', async () => {
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory: memory({ text: 'Walks after work', kind: 'pattern' }) }], ...lists }, 201) });
        const text = (await h.call('remember', { text: 'Walks after work', kind: 'pattern' })).text;
        expect(text).toBe(
            [
                'Saved: "Walks after work" (pattern) · id mem1',
                'Related (newest first; another app may have saved or changed these):',
                '- "Walks in the mornings" (pattern, last 2026-11-12, via ChatGPT) · id mem2 · if this replaces it, call update_memory with on mem2 and update changed',
                '- Going on: "Walking habit" (active · 2026-11-18 done: "Walked 30 minutes") · id t1',
                'In motion (pass progress on these with update_memory and the id): "Walking habit" [t1; 2026-11-18 done]',
            ].join('\n')
        );
        await h.close();
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory: memory() }], ...lists }, 201) }, { workMode: true });
        expect((await h.call('remember', { text: 'x' })).text).toBe('Saved: "Studies best after 9 pm" (fact) · id mem1\nSaved quietly: say nothing about it in your reply unless they asked for it.');
    });

    it('an older server refuses the new fields: it saves without them and says so; other refusals stay errors', async () => {
        h = await connect({
            'POST /api/buddy/remember': (req) => (req.body.inferred !== undefined ? fail(400, 'Unrecognized key: "inferred"') : ok({ paused: false, notes: [{ status: 'saved', memory: memory() }] }, 201)),
        });
        const res = await h.call('remember', { text: 'Studies best after 9 pm', said_on: '2026-11-17' });
        expect(h.requests.map((r) => r.body)).toEqual([{ text: 'Studies best after 9 pm', saidOn: '2026-11-17', inferred: false }, { text: 'Studies best after 9 pm' }]);
        expect(res.text).toBe('Saved: "Studies best after 9 pm" (fact) · id mem1\nThis Recollect server is older: saved without when it was said and whose word it is (it takes them from its next release).');
        await h.close();
        h = await connect({ 'POST /api/buddy/remember': fail(400, 'text: Too long') });
        expect((await h.call('remember', { text: 'x' })).isError).toBe(true);
    });
});

describe('update_memory', () => {
    it('a said change replaces the old version, with Undo and the lists', async () => {
        h = await connect({
            'POST /api/buddy/update': ok({
                paused: false,
                target: 'memory',
                outcome: 'replaced',
                memory: memory({ _id: 'mem3', text: 'Walks in the mornings now' }),
                replaced: memory({ text: 'Walks after work', status: 'closed' }),
                editId: 'e1',
                related: { memories: [], threads: [] },
                inMotion: [],
            }),
        });
        const res = await h.call('update_memory', { on: 'mem1', update: 'changed', text: 'Walks in the mornings now' });
        expect(h.requests[0]!.body).toEqual({ on: 'mem1', update: 'changed', text: 'Walks in the mornings now', inferred: false });
        expect(res.text).toBe(`Changed: now "Walks in the mornings now" (id mem3). "Walks after work" is closed and kept as history.\n${UNDO}`);
    });

    it('progress, history, check, a stale id, an inference, a closed one', async () => {
        h = await connect({
            'POST /api/buddy/update': [
                ok({ paused: false, outcome: 'seen', memory: memory({ seenCount: 4, lastSeenDay: '2026-11-19' }) }),
                ok({ paused: false, outcome: 'history', memory: memory(), current: { text: 'Walks in the mornings', day: '2026-11-15', app: 'Claude' } }),
                ok({ paused: false, outcome: 'check', memory: memory({ checkSince: '2026-11-19T10:00:00Z' }), current: { text: 'Walks in the mornings', day: '2026-11-19', app: 'ChatGPT' } }),
                ok({ paused: false, outcome: 'seen', movedFrom: 'mem0', memory: memory({ seenCount: 2 }) }),
                ok({ paused: false, outcome: 'noted', memory: memory() }),
                ok({ paused: false, outcome: 'noted', memory: memory({ status: 'closed' }) }),
                ok({ paused: true }),
            ],
        });
        expect((await h.call('update_memory', { on: 'mem1', update: 'done', text: 'Got my steps in' })).text).toBe('Noted on "Studies best after 9 pm" (seen 4×, last 2026-11-19) · id mem1');
        expect(h.requests[0]!.body).toEqual({ on: 'mem1', update: 'done', text: 'Got my steps in', inferred: false });
        expect((await h.call('update_memory', { on: 'mem1', update: 'changed', text: 'Walks after work', said_on: '2026-11-10' })).text).toBe(
            'Kept as history only: "Walks in the mornings" (Claude, 2026-11-15) was said later, so it stays the current version.'
        );
        expect(h.requests[1]!.body.saidOn).toBe('2026-11-10');
        expect((await h.call('update_memory', { on: 'mem1', update: 'changed', text: 'Walks at lunch', said_on: '2026-11-19' })).text).toBe(
            'Not decided: "Walks in the mornings" (ChatGPT) was said the same day and the order can\'t be known, so it stays and is marked "check". Ask the user which is right, then pass the answer with update_memory (update changed, or said to keep it).'
        );
        expect((await h.call('update_memory', { on: 'mem0', text: 'Still at it' })).text).toBe('That id was an older version: applied to the newest, "Studies best after 9 pm" (id mem1).\nNoted on "Studies best after 9 pm" (seen 2×, last 2026-11-16) · id mem1');
        expect(h.requests[3]!.body.update).toBe('said');
        expect((await h.call('update_memory', { on: 'mem1', text: 'Seems to walk less', inferred: true })).text).toBe('Noted as an inference: nothing changes until they say it themselves.');
        expect((await h.call('update_memory', { on: 'mem1', update: 'done', text: 'Walked' })).text).toBe('Noted: "Studies best after 9 pm" is closed; if they took it up again, call update_memory with update resumed.');
        expect((await h.call('update_memory', { on: 'mem1', text: 'x' })).text).toMatch(/paused their buddy/);
    });

    it('the words checked (newer servers): kept apart when not about the thing; one day named as a change is that day; remember for a day of a followed thing; a changed thread shows its change', async () => {
        h = await connect({
            'POST /api/buddy/update': [
                ok({
                    paused: false,
                    target: 'thread',
                    outcome: 'apart',
                    apart: { from: { _id: 't1', text: 'Walking after work' }, note: { status: 'saved', memory: memory({ _id: 'mem7', text: 'Decided to start learning Spanish', kind: 'pattern' }) } },
                    memory: memory({ _id: 'mem7', text: 'Decided to start learning Spanish', kind: 'pattern' }),
                }),
                ok({ paused: false, target: 'thread', outcome: 'seen', readAs: { from: 'changed', to: 'done' }, thread: { _id: 't1', title: 'Walking after work', stage: 'active' } }),
            ],
            'POST /api/buddy/remember': [
                ok({
                    paused: false,
                    notes: [{ status: 'linked', target: 'thread', update: 'done', label: 'Walking after work', thread: { _id: 't1', title: 'Walking after work', stage: 'active' } }],
                    related: { memories: [], threads: [] },
                    inMotion: [{ _id: 't1', type: 'thread', text: 'Walking after work', stage: 'active', last: { day: '2026-11-19', kind: 'done', text: 'Got my walk in' }, now: { day: '2026-11-19', text: 'Walks in the evenings now' } }],
                }),
                // §12.4 B2: a new memory whose words may replace an older one: that one is named first (marked to check).
                ok({
                    paused: false,
                    notes: [{ status: 'saved', memory: memory({ _id: 'mem8', text: 'Listens to audiobooks on the commute instead of reading before bed', kind: 'pattern' }), mayReplace: { _id: 'mem9', text: 'Reads 20 pages before bed' } }],
                    related: { memories: [], threads: [] },
                    // §12.4 A: In motion lists the habits and aims kept as memories after the threads, in the same shape.
                    inMotion: [
                        { _id: 't1', type: 'thread', text: 'Walking after work', stage: 'active', last: null },
                        { _id: 'mem3', type: 'memory', text: 'Cutting down to one coffee a day', kind: 'aim', last: { day: '2026-11-19', kind: 'progress', text: 'Two coffees today' } },
                    ],
                }),
            ],
        });
        expect((await h.call('update_memory', { on: 't1', update: 'changed', text: 'Decided to start learning Spanish' })).text).toBe(
            'Not about "Walking after work": the words share nothing with it, so it was left as it was and this was kept as its own note.\nSaved: "Decided to start learning Spanish" (pattern) · id mem7'
        );
        expect((await h.call('update_memory', { on: 't1', update: 'changed', text: 'Got a walk in this morning' })).text).toBe(
            'Recorded as done, not changed: the words tell of one day\'s doing, not a new routine or an end.\nAdded to "Walking after work" (active) · id t1'
        );
        expect((await h.call('remember', { text: 'Got my walk in today' })).text).toBe(
            [
                'Counted as done on "Walking after work" (id t1), not saved as a new memory: it is one day\'s news about something already followed.',
                'In motion (pass progress on these with update_memory and the id): "Walking after work" (now: "Walks in the evenings now") [t1; 2026-11-19 done]',
            ].join('\n')
        );
        expect((await h.call('remember', { text: 'Listens to audiobooks on the commute instead of reading before bed', kind: 'pattern' })).text).toBe(
            [
                'This may replace "Reads 20 pages before bed" (id mem9): if it does, call update_memory on it with changed or dropped. Both are kept until then.',
                'Saved: "Listens to audiobooks on the commute instead of reading before bed" (pattern) · id mem8',
                'In motion (pass progress on these with update_memory and the id): "Walking after work" [t1] · "Cutting down to one coffee a day" [mem3; 2026-11-19 progress]',
            ].join('\n')
        );
    });

    it('an older server (no route for tokens) says to use remember; an unknown id stays an error', async () => {
        h = await connect({ 'POST /api/buddy/update': [fail(403, 'Access tokens cannot be used for this endpoint'), fail(404, 'Nothing with that id: look it up with recall_memory')] });
        expect((await h.call('update_memory', { on: 'mem1', text: 'x' })).text).toBe('This Recollect server is older: it takes update_memory from its next release. Save it with remember for now.');
        const unknown = await h.call('update_memory', { on: 'nope', text: 'x' });
        expect(unknown.isError).toBe(true);
        expect(unknown.text).toMatch(/Nothing with that id/);
    });
});

describe('recall_memory and forget', () => {
    it('searches with provenance, lists, and says when nothing is known (with other words to try)', async () => {
        h = await connect({
            'GET /api/buddy/memories': [
                ok([
                    memory({ firstSeenDay: '2026-06-03', lastSeenDay: '2026-11-16', agentName: 'ChatGPT', seenCount: 5 }),
                    memory({ _id: 'mem2', text: 'Wants a backend offer', kind: 'aim', pinned: true, byUser: true, firstSeenDay: '2026-11-16', source: 'app' }),
                    memory({ _id: 'mem0', text: 'Studies after work', status: 'closed', closeReason: 'Changed: now Studies best after 9 pm', replacedBy: { _id: 'mem1', text: 'Studies best after 9 pm' }, firstSeenDay: '2026-05-01', lastSeenDay: '2026-06-01', agentName: 'Claude' }),
                    memory({ _id: 'mem4', text: 'Walks in the mornings', kind: 'pattern', inferred: true, checkSince: '2026-11-19T10:00:00Z' }),
                ]),
                ok([]),
            ],
            'GET /api/buddy/threads': fail(404, 'Not found'),
            'GET /api/buddy/chapters': [ok([]), ok([])],
        });
        const res = await h.call('recall_memory', { query: 'study' });
        expect(h.requests[0]!.query).toEqual({ q: 'study', limit: '20' });
        // A server without threads (an older release) answers 404: the search goes on without them.
        expect(h.requests[1]!.path).toBe('/api/buddy/threads');
        expect(h.requests[2]!.path).toBe('/api/buddy/chapters');
        expect(res.text).toBe(
            [
                '"Studies best after 9 pm" (fact, seen 5×, said 2026-06-03, last 2026-11-16, via ChatGPT) · id mem1',
                '"Wants a backend offer" (aim, pinned, their own, said 2026-11-16, via Recollect) · id mem2',
                '"Studies after work" (fact, closed: "Changed: now Studies best after 9 pm", replaced by "Studies best after 9 pm" (id mem1), said 2026-05-01, last 2026-06-01, via Claude) · id mem0',
                '"Walks in the mornings" (pattern, inferred, check: said two ways, which one holds is not settled) · id mem4',
            ].join('\n')
        );
        expect((await h.call('recall_memory', { query: 'rowing' })).text).toBe('Nothing about "rowing" yet. Try other words for the same thing, or list by kind (pattern for habits, preference, aim).');
    });

    it('also finds what is going on in their life (threads, with ids), private ones marked', async () => {
        const thread = {
            _id: 't1',
            title: 'Wrist strain recovery',
            stage: 'noticed',
            sensitive: true,
            firstDay: '2026-09-08',
            last: [{ day: '2026-09-08', kind: 'said', text: 'At most twenty minutes of tight grip at a time' }],
        };
        h = await connect({ 'GET /api/buddy/memories': ok([]), 'GET /api/buddy/threads': ok([thread]), 'GET /api/buddy/chapters': [ok([]), ok([{ period: '2026-03', text: 'March was Rust.' }])] });
        const res = await h.call('recall_memory', { query: 'wrist' });
        expect(h.requests[1]!.query).toEqual({ q: 'wrist', limit: '5' });
        expect(res.text).toBe('Going on: "Wrist strain recovery" (noticed, private, since 2026-09-08) · 2026-09-08 said: "At most twenty minutes of tight grip at a time" · id t1');
    });

    it('forget closes one, with Undo; their own are refused', async () => {
        h = await connect({ 'POST /api/buddy/memories/mem1/close': [ok({ memory: memory({ status: 'closed' }), editId: 'e1' }), fail(403, 'The user wrote or changed this memory: only they can change it (on /you)')] });
        const res = await h.call('forget', { id: 'mem1', reason: 'They stopped' });
        expect(h.requests[0]!.body).toEqual({ reason: 'They stopped' });
        expect(res.text).toBe(`Forgot: "Studies best after 9 pm".\n${UNDO}`);
        const refused = await h.call('forget', { id: 'mem1' });
        expect(refused.isError).toBe(true);
        expect(refused.text).toMatch(/only they can change it/);
    });

    it('get_work_log (B9): the days as text; in a work folder only that project, whatever is asked', async () => {
        const day = {
            day: '2026-11-15',
            projects: [
                { project: 'erp', office: true, minutes: 95, sessions: 2, commits: ['Fix GST rounding'], lines: [{ _id: 'w1', kind: 'did', text: 'Fixed the GST rounding' }, { _id: 'w2', kind: 'next', text: 'Add the credit note export' }] },
            ],
        };
        h = await connect({ 'GET /api/buddy/work': [ok([day]), ok([])] }, { set: 'all' });
        const res = await h.call('get_work_log', { project: 'erp', from: '2026-11-15', to: '2026-11-15' });
        expect(h.requests[0]!.query).toEqual({ project: 'erp', from: '2026-11-15', to: '2026-11-15' });
        // Stage 12: each line with its id (news on it goes with `on`), and its app when the server says.
        expect(res.text).toBe('Sun 15 Nov\nerp · 1 h 35 min in 2 sessions\n  - Fixed the GST rounding · id w1\n  - next: Add the credit note export · id w2\n  commits: Fix GST rounding');
        expect((await h.call('get_work_log', { query: 'rounding' })).text).toBe('Nothing about "rounding" in their work log.');
        await h.close();

        h = await connect({ 'GET /api/buddy/work': [ok([])] }, { workMode: true, workProject: 'erp' });
        await h.call('get_work_log', { project: 'second_brain' });
        expect(h.requests[0]!.query).toEqual({ project: 'erp', work: '1' });
    });

    it("the brief prints the work log: yesterday in their own chats, the project's days in a work folder", () => {
        const base = { now: { day: '2026-11-16', weekday: 'Mon', time: '09:00', timezone: 'Asia/Kolkata' }, profile: null, goals: [], today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] }, next: [], recent: [], recall: { days: 7, finished: 0, weakTopics: [] }, project: null, session: { key: 'k' } } as unknown as Brief;
        const yesterday = briefText({ ...base, work: { days: [{ day: '2026-11-15', projects: [{ project: 'erp', minutes: 95, lines: ['Fixed the GST rounding'] }] }] } });
        expect(yesterday).toContain('Their work yesterday:\n- erp (95 min): "Fixed the GST rounding"');
        const lately = briefText({ ...base, work: { days: [{ day: '2026-11-15', projects: [{ project: 'erp', minutes: 0, lines: ['Fixed it'] }] }, { day: '2026-11-13', projects: [{ project: 'erp', minutes: 30, lines: ['Kept the old export'] }] }] } });
        expect(lately).toContain('Their work here lately:\n- 2026-11-15 · erp: "Fixed it"\n- 2026-11-13 · erp (30 min): "Kept the old export"');
        expect(briefText(base)).not.toContain('Their work');
    });

    it('saving, finding and correcting are listed together by default (MCP_MEMORY_PLAN §4.1)', async () => {
        h = await connect({});
        const names = (await h.client.listTools()).tools.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(['remember', 'update_memory', 'recall_memory', 'forget']));
    });
});

describe('the brief', () => {
    it('prints the portrait, the memories and the note when there are any', () => {
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
        expect(briefText(base)).not.toMatch(/buddy|Who they are/);
        const text = briefText({
            ...base,
            buddy: { who: 'A backend engineer who learns at night.', heading: 'A backend offer by May.', now: 'Tired this week.', memories: [{ kind: 'preference', text: 'Bottom line first', pinned: true }], note: 'Ask how the mock went.', followUp: null },
        });
        expect(text).toContain('Who they are: A backend engineer who learns at night.');
        expect(text).toContain('Where they are heading: A backend offer by May.');
        expect(text).toContain('Right now: Tired this week.');
        expect(text).toContain('Their buddy knows: Bottom line first (preference)');
        expect(text).toContain('From their buddy (pass it on in a sentence at a natural pause): Ask how the mock went.');
    });

    it('stage 4-5: the buddy’s open questions (the follow-up then stays out) and what is on their mind', () => {
        const base: Brief = {
            now: { day: '2026-11-18', weekday: 'Wed', time: '19:00', timezone: 'Asia/Kolkata' },
            profile: null,
            goals: [],
            today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] },
            next: [],
            recent: [],
            recall: { days: 7, finished: 0, weakTopics: [] },
            project: null,
            buddy: { who: null, heading: null, now: null, memories: [], note: null, followUp: 'Ask about the run.' },
            session: { key: 's_y' },
        };
        expect(briefText(base)).toContain('Ask them at a good moment: Ask about the run.');
        const text = briefText({ ...base, asks: [{ _id: 'a1', text: 'A run tonight?', answers: ['Did it', 'Not today'], until: '2026-11-18T17:00:00Z' }], onMind: [{ title: 'Run three mornings a week', stage: 'active' }] });
        expect(text).toContain("Their buddy's question for them (ask it once, in your words, at a natural pause; if they answer, pass it on with remember, kind thread, naming the question): \"A run tonight?\" (their quick answers: Did it / Not today)");
        expect(text).toContain('On their mind (their buddy follows these): "Run three mornings a week"');
        expect(text).not.toContain('Ask them at a good moment');
    });
});
