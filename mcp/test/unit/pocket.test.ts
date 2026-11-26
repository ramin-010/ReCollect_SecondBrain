// TOOL_ACCESS_PLAN §4.7: the pocket (only while they allow it) and subjects, through the tools.
import { afterEach, describe, expect, it } from 'vitest';
import { UNDO, connect, fail, ok, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const PRIVATE = 'Their pocket notes are private. They can allow it in Settings › Agents.';

describe('the pocket', () => {
    it('private until they allow it: the API’s words, nothing changed', async () => {
        h = await connect({ 'GET /api/agent/pocket': fail(403, PRIVATE, 'POCKET_PRIVATE'), 'PATCH /api/agent/pocket/*': fail(403, PRIVATE, 'POCKET_PRIVATE') });
        expect(await h.call('list_pocket_notes', {})).toEqual({ text: PRIVATE, isError: true });
        expect(await h.call('update_pocket_note', { id: 'pn1', pinned: true })).toEqual({ text: PRIVATE, isError: true });
    });

    it('lists pinned first with ids and says how to read one in full; one in full; change and delete with Undo', async () => {
        h = await connect({
            'GET /api/agent/pocket': (req) =>
                req.query['id']
                    ? ok({ notes: [{ id: 'pn1', text: 'a long idea in full', cut: false, pinned: false, day: '2026-11-20', files: [] }], total: 1 })
                    : ok({ notes: [{ id: 'pn2', text: 'link: a talk', cut: false, pinned: true, day: '2026-11-21', files: ['slides.pdf'] }, { id: 'pn1', text: 'a long idea…', cut: true, pinned: false, day: '2026-11-20', files: [] }], total: 2 }),
            'PATCH /api/agent/pocket/pn1': ok({ id: 'pn1', text: 'shorter', cut: false, pinned: true, day: '2026-11-20', files: [], editId: 'e1' }),
            'POST /api/agent/pocket/pn1/delete': ok({ id: 'pn1', deleted: true, editId: 'e2' }),
        });
        expect((await h.call('list_pocket_notes', {})).text).toBe(
            ['Their pocket: 2 notes.', '- "link: a talk" · pinned · 2026-11-21 · 1 file · id pn2', '- "a long idea…" · 2026-11-20 · id pn1', 'A note cut at 300 characters reads in full with its id.'].join('\n')
        );
        expect((await h.call('list_pocket_notes', { id: 'pn1' })).text).toBe('Pocket note pn1 · 2026-11-20\na long idea in full');
        expect((await h.call('update_pocket_note', { id: 'pn1', text: 'shorter', pinned: true })).text).toBe(`Changed. Pocket note pn1: "shorter" (pinned)\n${UNDO}`);
        expect((await h.call('delete_pocket_note', { id: 'pn1' })).text).toBe(`Deleted the pocket note pn1.\n${UNDO}`);
    });
});

describe('subjects', () => {
    it('renamed by name with Undo; an empty one deleted, one that holds topics waits for their tap', async () => {
        h = await connect({
            'PATCH /api/agent/subjects/DSA': ok({ id: 's1', name: 'Algorithms', description: null, editId: 'e1' }),
            'POST /api/agent/subjects/Scratch/delete': ok({ id: 's2', name: 'Scratch', deleted: true, asked: false, editId: 'e2' }),
            'POST /api/agent/subjects/DSA/delete': ok({ id: 's1', name: 'DSA', deleted: false, asked: true, text: 'Delete the subject "DSA" with 2 topics, 1 doc and 0 notes (undo for 7 days)' }),
        });
        expect((await h.call('update_subject', { subject: 'DSA', name: 'Algorithms' })).text).toBe(`Subject "Algorithms" · id s1.\n${UNDO}`);
        expect((await h.call('update_subject', { subject: 'DSA' })).text).toBe('Nothing to change: send name, description, or both.');
        expect((await h.call('delete_subject', { subject: 'Scratch' })).text).toBe(`Deleted the empty subject "Scratch".\n${UNDO}`);
        expect((await h.call('delete_subject', { subject: 'DSA', reason: 'done with it' })).text).toBe(
            '"DSA" holds topics, notes or docs, so it waits for their tap: a card on Home says "Delete the subject "DSA" with 2 topics, 1 doc and 0 notes (undo for 7 days)". Nothing is deleted until they tap "Do it".'
        );
        expect(h.requests.at(-1)!.body).toEqual({ reason: 'done with it' });
    });
});
