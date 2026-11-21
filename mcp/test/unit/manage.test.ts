// The manage group (MANAGER_AND_DOCS_PLAN §3.3): what each tool sends and how it answers; the level-3
// tool only asks.
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_GROUP_NAMES } from '../../src/server.js';
import { connect, fail, ok, type Harness, type Routes } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const DOC = 'cmwdoc000000000000000001';
const all = (routes: Routes) => connect(routes, { groups: TOOL_GROUP_NAMES });

describe('manage tools', () => {
    it('trash_doc and restore_doc move a doc, say when nothing changed, and end with the Undo line', async () => {
        h = await all({
            [`POST /api/agent/docs/${DOC}/trash`]: [ok({ id: DOC, title: 'Old draft', trashedAt: '2026-11-14T10:00:00Z', editId: 'e1' }), ok({ id: DOC, title: 'Old draft', trashedAt: '2026-11-14T10:00:00Z', editId: null })],
            [`POST /api/agent/docs/${DOC}/restore`]: ok({ id: DOC, title: 'Old draft', trashedAt: null, editId: 'e2' }),
        });
        expect((await h.call('trash_doc', { docId: DOC })).text).toBe('Moved "Old draft" to the trash (30 days).\nUndo: the user can undo this from Home → From your agent.');
        expect((await h.call('trash_doc', { docId: DOC })).text).toBe('"Old draft" was already in the trash.');
        expect((await h.call('restore_doc', { docId: DOC })).text).toContain('Restored "Old draft".');
    });

    it('publish_doc and share_doc only ask: the action with its input, and what the card says', async () => {
        h = await all({
            'POST /api/actions': [
                ok({ _id: 's1', kind: 'action', text: 'Publish "Heaps" to the web: anyone with the link can read it (never edit)', reason: null, proposedBy: 'agent', agentName: 'Claude Code' }),
                ok({ _id: 's2', kind: 'action', text: 'Share "Heaps" with Asha (asha@example.com): they can edit', reason: null, proposedBy: 'agent', agentName: 'Claude Code' }),
            ],
        });
        const pub = await h.call('publish_doc', { docId: DOC });
        expect(pub.text).toBe('Asked: Publish "Heaps" to the web: anyone with the link can read it (never edit). Waiting for the user’s tap: it shows under Suggested on their Home with "Do it"; nothing happens until they tap it.');
        expect(h.requests[0]).toMatchObject({ method: 'POST', path: '/api/actions', body: { action: 'publish_doc', input: { docId: DOC, on: true } } });
        await h.call('share_doc', { docId: DOC, email: 'asha@example.com' });
        expect(h.requests[1]).toMatchObject({ body: { action: 'share_doc', input: { docId: DOC, email: 'asha@example.com', role: 'editor' } } });
        expect((await h.call('share_doc', { docId: DOC, email: 'not an email' })).isError).toBe(true);
    });

    it('empty_trash only asks: it posts the action and says it waits for his tap', async () => {
        h = await all({ 'POST /api/actions': ok({ _id: 's1', kind: 'action', text: 'Empty the trash: delete 2 docs for good ("A", "B")', reason: null, proposedBy: 'agent', agentName: 'Claude Code' }, 201) });
        const res = await h.call('empty_trash', { reason: 'he asked' });
        expect(res.text).toBe('Asked: Empty the trash: delete 2 docs for good ("A", "B"). Waiting for the user’s tap: it shows under Suggested on their Home with "Do it"; nothing happens until they tap it.');
        expect(h.requests[0]).toMatchObject({ method: 'POST', path: '/api/actions', body: { action: 'empty_trash', reason: 'he asked' } });
    });

    it('complete_revision names the next review; update_project finds the project by key', async () => {
        h = await all({
            'POST /api/revisions/r1/complete': ok({ item: { title: 'Heaps', cycleNumber: 1 }, chain: [{ cycleNumber: 1, scheduledFor: '2026-11-14', status: 'done' }, { cycleNumber: 2, scheduledFor: '2026-11-17', status: 'pending' }], mastered: false }),
            'GET /api/projects': ok([{ _id: 'p1', key: 'second_brain', name: 'second_brain', nextStep: null, isArchived: false, goal: null }]),
            'PATCH /api/projects/p1': ok({ _id: 'p1', key: 'second_brain', name: 'Recollect', nextStep: 'build the manager', isArchived: false, goal: null }),
        });
        expect((await h.call('complete_revision', { revisionId: 'r1' })).text).toContain('Done: "Heaps", review 1. Next review 2026-11-17.');
        expect((await h.call('update_project', { project: 'Second_Brain', nextStep: 'build the manager' })).text).toContain('Project "Recollect": next "build the manager".');
        expect(h.requests.at(-1)).toMatchObject({ method: 'PATCH', path: '/api/projects/p1', body: { nextStep: 'build the manager' } });
        const missing = await h.call('update_project', { project: 'nope', name: 'x' });
        expect([missing.isError, missing.text]).toEqual([true, 'No project "nope". Projects: second_brain.']);
    });

    it('list_suggestions marks what needs his tap', async () => {
        h = await all({
            'GET /api/suggestions': ok([
                { _id: 's1', kind: 'action', text: 'Empty the trash: delete 1 doc for good ("A")', reason: null, proposedBy: 'ask_ai', agentName: 'Ask AI' },
                { _id: 's2', kind: 'week_target', text: 'Finish 7. Message queues', reason: null, proposedBy: 'app', agentName: null },
            ]),
        });
        expect((await h.call('list_suggestions', {})).text).toBe(
            '2 items waiting:\n- [needs their tap] Empty the trash: delete 1 doc for good ("A") · from Ask AI\n- Finish 7. Message queues · from the app'
        );
    });

    it('set_reminder (on a task, or with a title that makes one), list_reminders and cancel_reminder', async () => {
        const at = '2026-11-15T13:30:00.000Z';
        const when = 'Sat 15 Nov, 19:00';
        h = await all({
            'POST /api/reminders': [ok({ _id: 'm1', taskId: 't1', task: 'Book the mock', at, when, status: 'pending', createdTask: false }, 201), ok({ _id: 'm2', taskId: 't2', task: 'Call the bank', at, when, status: 'pending', createdTask: true }, 201)],
            'GET /api/reminders': ok([{ _id: 'm1', taskId: 't1', task: 'Book the mock', at, when, status: 'pending' }]),
            'POST /api/reminders/m1/cancel': ok({ _id: 'm1', taskId: 't1', task: 'Book the mock', at, when, status: 'cancelled' }),
        });
        // An older server (no `ring` in its answer): every reminder rings there, and the reply says so.
        expect((await h.call('set_reminder', { at: '19:00', taskId: 't1' })).text).toBe(
            `Reminder set: "Book the mock" at ${when} (this Recollect server rings every reminder, once: silent and repeating ones come with its next release) · id m1.\nUndo: the user can undo this from Home → From your agent.`
        );
        expect(h.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/reminders', body: { at: '19:00', taskId: 't1' } });
        expect((await h.call('set_reminder', { at: '19:00', title: 'Call the bank' })).text).toContain('(a new task)');
        const both = await h.call('set_reminder', { at: '19:00', taskId: 't1', title: 'x' });
        expect([both.isError, both.text]).toEqual([true, 'Give taskId (an existing task) or title (a new task), one of them.']);
        expect((await h.call('list_reminders', {})).text).toBe(`1 reminder:\n- ${when} · "Book the mock" · id m1`);
        expect((await h.call('cancel_reminder', { reminderId: 'm1' })).text).toContain(`Cancelled the reminder for "Book the mock" (${when}).`);
    });

    it('an older server refuses ring and repeat: the reminder is set without them (it rings there, once), and says so', async () => {
        const at = '2026-11-16T12:00:00.000Z';
        const when = 'Mon 16 Nov, 17:30';
        h = await all({ 'POST /api/reminders': [fail(400, 'Unrecognized keys: "ring", "repeat"'), ok({ _id: 'm5', taskId: 't5', task: 'Stretch', at, when, status: 'pending', createdTask: true }, 201)] });
        const res = await h.call('set_reminder', { at: '17:30', title: 'Stretch', ring: true, repeat: 'daily' });
        expect(h.requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
            { at: '17:30', title: 'Stretch', ring: true, repeat: 'daily' },
            { at: '17:30', title: 'Stretch' },
        ]);
        expect(res.isError).toBeFalsy();
        expect(res.text).toContain('(this Recollect server rings every reminder, once: silent and repeating ones come with its next release)');
    });

    it('stage 7: set_reminder is silent unless he asks for a ring, and may repeat; show_on_lock_screen and clear_lock_line', async () => {
        const at = '2026-11-16T12:00:00.000Z';
        const when = 'Mon 16 Nov, 17:30';
        h = await all({
            'POST /api/reminders': [ok({ _id: 'm3', taskId: 't3', task: 'Stand up and stretch', at, when, status: 'pending', ring: false, repeat: 'weekdays', createdTask: true }, 201), ok({ _id: 'm4', taskId: 't4', task: 'Catch the train', at, when, status: 'pending', ring: true, repeat: null, createdTask: true }, 201)],
            'POST /api/lock-pins': ok({ _id: 'p1', text: 'Ship the invoice fix', from: '14:00', to: '18:00', days: [], until: '2026-11-16', setBy: 'agent', now: true }, 201),
            'POST /api/lock-pins/clear': [ok({ cleared: 1 }), ok({ cleared: 0 })],
        });
        const silent = await h.call('set_reminder', { at: '17:30', title: 'Stand up and stretch', repeat: 'weekdays' });
        expect(silent.text).toContain('(silent, every weekday)');
        expect(h.requests.at(-1)).toMatchObject({ body: { at: '17:30', title: 'Stand up and stretch', repeat: 'weekdays' } });
        expect(h.requests.at(-1)!.body).not.toHaveProperty('ring');
        expect((await h.call('set_reminder', { at: '06:30', title: 'Catch the train', ring: true })).text).toContain('(rings)');
        expect(h.requests.at(-1)).toMatchObject({ body: { ring: true } });
        const pin = await h.call('show_on_lock_screen', { text: 'Ship the invoice fix', to: '18:00' });
        expect(pin.text).toBe('On their lock screen: "Ship the invoice fix" 14:00-18:00 until 2026-11-16 (showing now) · id p1. clear_lock_line takes it off.');
        expect(h.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/lock-pins', body: { text: 'Ship the invoice fix', to: '18:00' } });
        expect((await h.call('clear_lock_line', {})).text).toBe('Cleared 1 pinned line from their lock screen.');
        expect((await h.call('clear_lock_line', { all: true })).text).toBe('Nothing pinned was showing.');
        expect(h.requests.at(-1)).toMatchObject({ body: { all: true } });
    });

    it('get_recall lists the sessions, the missed questions and the weak spots; get_sharing says who can see a doc', async () => {
        h = await all({
            'GET /api/topics/top1/recall': ok({
                topic: { _id: 'top1', title: 'Heaps', docId: DOC },
                sets: [{ finishedAt: '2026-11-13T09:00:00Z', cycle: 2, result: 'partial', counts: { strong: 2, partial: 1, weak: 1 }, missed: [{ question: 'Why is heapify O(n)?', grade: 'weak', feedback: 'Most nodes sit near the bottom.' }] }],
                weakSpots: [{ _id: 'w1', text: 'heapify cost' }],
            }),
            [`GET /api/agent/docs/${DOC}/sharing`]: ok({
                _id: DOC,
                title: 'Heaps',
                published: { url: 'http://localhost:3005/p/heaps-k7m2x9q4hz3a', since: '2026-11-15T09:00:00Z' },
                people: [{ name: 'Asha', role: 'editor', addedAt: '2026-11-01T00:00:00Z' }],
                requests: [{ name: 'Ravi', requestedAt: '2026-11-15T10:00:00Z' }],
            }),
        });
        expect((await h.call('get_recall', { topicId: 'top1' })).text).toBe(
            'Recall on "Heaps":\n- 2026-11-13 · review 2 · partial (2 strong, 1 partial, 1 weak)\n  - weak: "Why is heapify O(n)?" · Most nodes sit near the bottom.\nOpen weak spots: "heapify cost"'
        );
        expect((await h.call('get_sharing', { docId: DOC })).text).toBe('"Heaps": published since 2026-11-15 (http://localhost:3005/p/heaps-k7m2x9q4hz3a) · Asha (can edit) · asking to edit: Ravi.');
    });

    it('spread_backlog spreads at once (Undo), only asks over 20, and says when nothing is overdue', async () => {
        h = await all({
            'POST /api/revisions/spread': [
                ok({ moved: 6, spreadDays: 3, changes: [], asked: false, card: null }),
                ok({ moved: 34, spreadDays: 0, changes: [], asked: true, card: { _id: 's9', text: 'Spread 34 overdue reviews over the next 6 days, as your daily budget allows' } }),
                ok({ moved: 0, spreadDays: 0, changes: [], asked: false, card: null }),
            ],
        });
        expect((await h.call('spread_backlog', {})).text).toBe('Spread 6 overdue reviews over 3 days.\nUndo: the user can undo this from Home → From your agent.');
        expect((await h.call('spread_backlog', { reason: 'he is back' })).text).toMatch(/^Asked: Spread 34 overdue reviews over the next 6 days, as your daily budget allows\. Waiting for the user’s tap/);
        expect(h.requests.at(-1)).toMatchObject({ body: { reason: 'he is back' } });
        expect((await h.call('spread_backlog', {})).text).toBe('Nothing is overdue: nothing to spread.');
    });
});
