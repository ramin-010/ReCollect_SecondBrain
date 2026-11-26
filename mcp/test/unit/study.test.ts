// STUDY_FLOW_PLAN (11-23): the study tools (set_revision_card, add_note, list_notes, update_note, remove_note) are in the
// manage group, send what the API takes, and answer in short text with the ids the next call needs.
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_GROUPS } from '../../src/server.js';
import { UNDO, connect, fail, lastLine, ok, type Harness } from './harness.js';

let h: Harness | null = null;
afterEach(async () => {
    await h?.close();
    h = null;
});

const ALL = { groups: ['core', 'docs', 'plan', 'record', 'manage'] as const };

describe('the study tools', () => {
    it('wait for more_tools (the manage group): the default list holds none of them', async () => {
        for (const name of ['set_revision_card', 'add_note', 'list_notes', 'update_note', 'remove_note'] as const) expect(TOOL_GROUPS[name]).toBe('manage');
        h = await connect({});
        const listed = (await h.client.listTools()).tools.map((t) => t.name);
        expect(listed.filter((n) => /note$|notes$|revision_card/.test(n))).toEqual(['add_pocket_note']);
    });

    it('set_revision_card writes the card and says so; a replacement says so too', async () => {
        h = await connect(
            {
                'PUT /api/agent/docs/doc1/card': [
                    ok({ id: 'doc1', heading: 'Revision card', replaced: false, blocks: 4, editId: 'e1', canvases: [{ canvasId: 'cv_1', boxes: 5, arrows: 4, zones: 0, width: 600, height: 300, zoom: 1, warnings: [] }] }),
                    ok({ id: 'doc1', heading: 'Review card', replaced: true, blocks: 1, editId: 'e2' }),
                ],
            },
            ALL
        );
        const first = await h.call('set_revision_card', { docId: 'doc1', markdown: '- point\n\n```canvas\nflowchart\n  a --> b\n```' });
        expect(first.isError).toBe(false);
        expect(first.text).toContain('Wrote the revision card (4 blocks) under "Revision card" at the end of doc doc1. Each review opens it first.');
        expect(first.text).toContain('Canvas cv_1: 5 boxes, 4 arrows');
        expect(lastLine(first.text)).toBe(UNDO);
        expect(h.requests[0]).toMatchObject({ method: 'PUT', path: '/api/agent/docs/doc1/card', body: { markdown: '- point\n\n```canvas\nflowchart\n  a --> b\n```' } });
        expect((await h.call('set_revision_card', { docId: 'doc1', markdown: '- one' })).text).toContain('Replaced the revision card (1 block) under "Review card"');
    });

    it('add_note: a note on a lesson, a link on a subject; one place at a time; a repeat says nothing was added', async () => {
        h = await connect(
            {
                'POST /api/agent/notes': [
                    ok({ id: 'n1', kind: 'note', title: 'Why DNS uses UDP', lesson: { docId: 'doc1', title: 'How DNS works' }, subject: 'Networking', editId: 'e1' }, 201),
                    ok({ id: 'n2', kind: 'link', title: 'DNS in 10 minutes', lesson: null, subject: 'Networking', editId: 'e2' }, 201),
                    ok({ id: 'n1', kind: 'note', title: 'Why DNS uses UDP', lesson: { docId: 'doc1', title: 'How DNS works' }, subject: 'Networking', already: true, editId: null }),
                ],
            },
            ALL
        );
        const note = await h.call('add_note', { docId: 'doc1', title: 'Why DNS uses UDP', markdown: 'No handshake for one small question.' });
        expect(note.text).toBe(`Saved the note "Why DNS uses UDP" on the lesson "How DNS works" (doc doc1) · id n1. attach_file adds a file to it.\n${UNDO}`);
        expect(h.requests[0]!.body).toEqual({ docId: 'doc1', title: 'Why DNS uses UDP', markdown: 'No handshake for one small question.' });
        const link = await h.call('add_note', { subject: 'Networking', title: 'DNS in 10 minutes', url: 'https://www.youtube.com/watch?v=abc' });
        expect(link.text).toBe(`Saved the link "DNS in 10 minutes" on the subject Networking · id n2. attach_file adds a file to it.\n${UNDO}`);
        expect(h.requests[1]!.body).toEqual({ subject: 'Networking', title: 'DNS in 10 minutes', url: 'https://www.youtube.com/watch?v=abc' });
        const again = await h.call('add_note', { docId: 'doc1', title: 'Why DNS uses UDP', markdown: 'x' });
        expect(again.text).toBe('Already saved on the lesson "How DNS works" (doc doc1): "Why DNS uses UDP" · id n1. Nothing added.');
        // Refused before any call: both places, neither, nothing to save.
        expect((await h.call('add_note', { docId: 'doc1', subject: 'Networking', title: 'x', markdown: 'y' })).isError).toBe(true);
        expect((await h.call('add_note', { title: 'x', markdown: 'y' })).isError).toBe(true);
        expect((await h.call('add_note', { subject: 'Networking', title: 'x' })).isError).toBe(true);
        expect(h.requests).toHaveLength(3);
    });

    it('list_notes reads a lesson’s, a subject’s with its lessons, or some by id, with their full text and ids', async () => {
        const note = { id: 'n1', kind: 'note', title: 'Why DNS uses UDP', url: null, text: 'No handshake.', day: '2026-11-23T10:00:00.000Z', by: 'Claude Code', lesson: { docId: 'doc1', title: 'How DNS works' }, subject: 'Networking' };
        const link = { id: 'n2', kind: 'link', title: 'DNS in 10 minutes', url: 'https://youtube.com/watch?v=abc', text: '', day: '2026-11-22T10:00:00.000Z', by: 'the user', lesson: null, subject: 'Networking' };
        h = await connect(
            {
                'GET /api/learning/settings': ok({ timezone: 'Asia/Kolkata' }),
                'GET /api/agent/notes': (req) =>
                    req.query['docId']
                        ? ok({ place: { lesson: note.lesson, subject: 'Networking' }, notes: [note], more: null })
                        : req.query['subject']
                          ? ok({ place: { lesson: null, subject: 'Networking' }, notes: [link, note], more: 2 })
                          : ok({ place: null, notes: [note], more: null }),
            },
            ALL
        );
        const lesson = await h.call('list_notes', { docId: 'doc1' });
        expect(lesson.text).toBe('1 note on the lesson "How DNS works" (doc doc1):\n\n### Why DNS uses UDP\n(id n1 · note · 2026-11-23 · by Claude Code)\nNo handshake.');
        const subject = await h.call('list_notes', { subject: 'Networking', lessons: true });
        expect(h.requests.at(-1)!.query).toEqual({ subject: 'Networking', lessons: '1' });
        expect(subject.text).toContain('2 notes on the subject Networking:');
        expect(subject.text).toContain('### DNS in 10 minutes\n(id n2 · link · 2026-11-22 · theirs)\n<https://youtube.com/watch?v=abc>');
        expect(subject.text).toContain('(id n1 · note · 2026-11-23 · by Claude Code · lesson "How DNS works")');
        expect(subject.text).toMatch(/More: call again with cursor 2\.$/);
        const some = await h.call('list_notes', { ids: ['n1', 'n9'] });
        expect(h.requests.at(-1)!.query).toEqual({ ids: 'n1,n9' });
        expect(some.text.startsWith('1 note of the 2 asked for:')).toBe(true);
        expect((await h.call('list_notes', {})).isError).toBe(true);
    });

    it('update_note and remove_note (a merge names the note that stays); the API’s 404 says what is missing', async () => {
        h = await connect(
            {
                'PATCH /api/agent/notes/n1': ok({ id: 'n1', kind: 'note', title: 'TTL', url: null, text: 'Both texts.', day: '2026-11-23T10:00:00.000Z', by: 'the user', lesson: { docId: 'doc1', title: 'How DNS works' }, subject: 'Networking', editId: 'e3' }),
                'POST /api/agent/notes/n2/remove': ok({ id: 'n2', removed: true, into: 'n1', editId: 'e4' }),
                'POST /api/agent/notes/n3/remove': ok({ id: 'n3', removed: true, into: null, editId: 'e5' }),
                'PATCH /api/agent/notes/n9': fail(404, 'No note with the id n9 on a lesson or a subject (list_notes shows them).'),
            },
            ALL
        );
        const changed = await h.call('update_note', { id: 'n1', markdown: 'Both texts.' });
        expect(changed.text).toBe(`Changed the note "TTL" on the lesson "How DNS works" (doc doc1) · id n1.\n${UNDO}`);
        expect(h.requests[0]!.body).toEqual({ markdown: 'Both texts.' });
        expect((await h.call('remove_note', { id: 'n2', into: 'n1' })).text).toBe(`Merged note n2 into n1.\n${UNDO}`);
        expect(h.requests[1]!.body).toEqual({ into: 'n1' });
        expect((await h.call('remove_note', { id: 'n3' })).text).toBe(`Removed note n3.\n${UNDO}`);
        const missing = await h.call('update_note', { id: 'n9', title: 'x' });
        expect(missing.isError).toBe(true);
        expect(missing.text).toContain('No note with the id n9');
        expect((await h.call('update_note', { id: 'n1' })).isError).toBe(true);
        expect((await h.call('update_note', { id: 'n1', docId: 'doc1', subject: 'Networking' })).isError).toBe(true);
    });

    it("read_doc's header says when a doc has its card and how many notes its lesson holds", async () => {
        h = await connect({
            'GET /api/learning/settings': ok({ timezone: 'UTC' }),
            'GET /api/agent/docs/doc1': ok({ id: 'doc1', title: 'How DNS works', markdown: '## Part 1\n\nText.', subject: { id: 's1', name: 'Networking' }, topicId: 't1', updatedAt: '2026-11-23T10:00:00.000Z', canEdit: true, card: true, notes: 3 }),
        });
        const read = await h.call('read_doc', { docId: 'doc1' });
        expect(read.text.split('\n')[0]).toBe('Doc doc1 · "How DNS works" · subject Networking · updated 2026-11-23 · editable · has its revision card · 3 notes on this lesson');
    });
});
