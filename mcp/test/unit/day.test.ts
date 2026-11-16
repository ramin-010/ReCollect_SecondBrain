import { afterEach, describe, expect, it } from 'vitest';
import { NOTE_ID, UNDO, UUID_RE, connect, fail, ok, refused, type Harness } from './harness.js';
import { TOOL_GROUP_NAMES } from '../../src/server.js';
/** Every group: the focus and milestone edits are on more_tools (the manage group) since 2026-11-15. */
const all = (routes: Parameters<typeof connect>[0]) => connect(routes, { groups: TOOL_GROUP_NAMES });

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

describe('add_focus', () => {
    it('POSTs the text and reports the day and id', async () => {
        h = await connect({ 'POST /api/focus': ok({ _id: 'f9', day: '2026-11-14', text: 'Finish 2 graph problems', done: false, sortOrder: 1 }, 201) });
        const res = await h.call('add_focus', { text: '  Finish 2 graph problems ' });
        expect(h.requests[0]).toMatchObject({ method: 'POST', path: '/api/focus', body: { text: 'Finish 2 graph problems' } });
        expect(h.requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text).toBe(`Added focus "Finish 2 graph problems" for 2026-11-14 · id f9.\n${UNDO}`);
    });

    it('over 140 characters is refused before the API', async () => {
        h = await connect({});
        const res = await h.call('add_focus', { text: 'x'.repeat(141) });
        expect(res.isError).toBe(true);
        expect(h.requests).toHaveLength(0);
    });

    it('a 4th line: the API says so', async () => {
        h = await connect({ 'POST /api/focus': fail(409, 'Up to 3 focus lines a day', 'FOCUS_LIMIT') });
        expect(await h.call('add_focus', { text: 'one more' })).toEqual({ text: 'Up to 3 focus lines a day', isError: true });
    });

    it('the tool description says up to 3 a day', async () => {
        h = await connect({});
        const { tools } = await h.client.listTools();
        expect(tools.find((t) => t.name === 'add_focus')!.description).toContain('Up to 3 a day');
    });
});

describe('add_pocket_note', () => {
    it('PUTs a new uuid with content, category PRIMARY and isPinned', async () => {
        h = await connect({ 'PUT /api/quick-notes/*': ok({ _id: NOTE_ID, isPinned: true }, 201) });
        const res = await h.call('add_pocket_note', { text: 'Look at pg_locks view', pinned: true });
        expect(h.requests[0]).toMatchObject({
            method: 'PUT',
            path: `/api/quick-notes/${NOTE_ID}`,
            body: { content: 'Look at pg_locks view', category: 'PRIMARY', isPinned: true },
        });
        expect(h.requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text).toBe(`Added a pocket note (pinned).\n${UNDO}`);
    });

    it('unpinned notes send no isPinned', async () => {
        h = await connect({ 'PUT /api/quick-notes/*': ok({ _id: NOTE_ID, isPinned: false }, 201) });
        const res = await h.call('add_pocket_note', { text: 'idea' });
        expect(h.requests[0]!.body).toEqual({ content: 'idea', category: 'PRIMARY' });
        expect(res.text).toBe(`Added a pocket note.\n${UNDO}`);
    });

    it('a retry after a network error reuses the same note id and Idempotency-Key', async () => {
        h = await connect({ 'PUT /api/quick-notes/*': [refused(), ok({ _id: NOTE_ID, isPinned: false }, 201)] });
        const res = await h.call('add_pocket_note', { text: 'idea' });
        expect(res.isError).toBe(false);
        expect(h.requests).toHaveLength(2);
        expect(h.requests[1]!.path).toBe(h.requests[0]!.path);
        expect(h.requests[1]!.headers['idempotency-key']).toBe(h.requests[0]!.headers['idempotency-key']);
    });
});

describe('recent_agent_edits', () => {
    const edit = (over: Record<string, unknown>) => ({
        id: 'e1',
        kind: 'doc_create',
        agentName: 'Claude Code',
        summary: 'Created "Postgres locks"',
        docId: 'docA',
        entityId: 'docA',
        createdAt: '2026-11-14T09:30:12.000Z',
        seenAt: null,
        undoneAt: null,
        canUndo: true,
        ...over,
    });

    it('asks for 10 by default and shows state, doc and other agents, in Ramin’s time zone', async () => {
        h = await connect({
            'GET /api/learning/settings': ok({ dailyBudgetMin: 25, busyUntil: null, timezone: 'Asia/Kolkata' }),
            'GET /api/agent/edits': ok([
                edit({}),
                edit({ id: 'e2', kind: 'focus_add', summary: 'Added focus "Graphs"', docId: null, agentName: 'Cursor', seenAt: '2026-11-14T10:00:00Z', createdAt: '2026-11-13T18:00:00Z' }),
                edit({ id: 'e3', kind: 'doc_append', summary: 'Appended 2 blocks to "MVCC"', docId: 'docB', undoneAt: '2026-11-13T12:00:00Z', seenAt: '2026-11-13T12:00:00Z', createdAt: '2026-11-13T11:00:00Z' }),
            ]),
        }, { groups: TOOL_GROUP_NAMES });
        const res = await h.call('recent_agent_edits');
        expect(h.requests.find((r) => r.path === '/api/agent/edits')).toMatchObject({ method: 'GET', query: { limit: '10' } });
        expect(res.text).toBe(
            [
                '3 edits by agents, newest first (times in Asia/Kolkata):',
                '- 2026-11-14 15:00 · Created "Postgres locks" · doc docA · not reviewed yet',
                '- 2026-11-13 23:30 · Added focus "Graphs" · by Cursor · kept',
                '- 2026-11-13 16:30 · Appended 2 blocks to "MVCC" · doc docB · undone by Ramin',
            ].join('\n')
        );
    });

    it('passes a limit; none yet', async () => {
        h = await connect({ 'GET /api/agent/edits': ok([]) }, { groups: TOOL_GROUP_NAMES });
        expect((await h.call('recent_agent_edits', { limit: 3 })).text).toBe('No agent edits yet.');
        expect(h.requests[0]!.query).toEqual({ limit: '3' });
    });

    it('cannot reach the API: a clear message', async () => {
        h = await connect({ 'GET /api/agent/edits': refused() }, { groups: TOOL_GROUP_NAMES });
        const res = await h.call('recent_agent_edits');
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(/^Can't reach Recollect at http:\/\/recollect\.test \(connection refused\)\. Is the backend running\?/);
        expect(h.requests.filter((r) => r.path === '/api/agent/edits')).toHaveLength(2);
    });
});

describe('update_focus and remove_focus', () => {
    it('changes the words or ticks a line', async () => {
        h = await all({ 'PATCH /api/focus/f1': ok({ _id: 'f1', day: '2026-11-14', text: 'Three graph problems', done: true, sortOrder: 1 }) });
        const res = await h.call('update_focus', { focusId: 'f1', text: 'Three graph problems', done: true });
        expect(h.requests[0]).toMatchObject({ method: 'PATCH', path: '/api/focus/f1', body: { text: 'Three graph problems', done: true } });
        expect(res.text).toBe(`Focus "Three graph problems" is now done · id f1.\n${UNDO}`);
    });

    it('needs text or done; an unknown id says which', async () => {
        h = await all({ 'PATCH /api/focus/x1': fail(404, 'Not found', 'NOT_FOUND') });
        expect((await h.call('update_focus', { focusId: 'f1' })).text).toBe('Send text, done, or both.');
        expect((await h.call('update_focus', { focusId: 'x1', done: true })).text).toBe('No focus line with id x1 (get_today shows them).');
    });

    it('removes a line (Undo brings it back)', async () => {
        h = await all({ 'DELETE /api/focus/f1': ok({ deleted: true }) });
        const res = await h.call('remove_focus', { focusId: 'f1' });
        expect(h.requests[0]).toMatchObject({ method: 'DELETE', path: '/api/focus/f1' });
        expect(res.text).toBe(`Removed focus line f1.\n${UNDO}`);
    });
});
