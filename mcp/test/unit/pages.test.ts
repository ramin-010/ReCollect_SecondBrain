// DOC_PAGES_PLAN §6.5: docs inside docs through the tools. create_doc puts a doc inside another as a page; read_doc
// says where a doc sits, the lesson it is revised with and the pages inside it; search_docs names the docs above a hit;
// get_doc_tree shows a tree (with every page's text when asked); move_doc moves one; trash and restore say the pages;
// notes name their page.
import { afterEach, describe, expect, it } from 'vitest';
import { connect, fail, ok, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const ZONE = { 'GET /api/learning/settings': ok({ timezone: 'Asia/Kolkata' }) };
const DAY = '2026-11-27T06:00:00.000Z';

describe('pages inside docs, through the tools', () => {
    it('create_doc with parentId sends it and says how to point to the page from the parent', async () => {
        h = await connect({ 'POST /api/agent/docs': ok({ id: 'p1', title: 'Partitions', subject: null, topicId: null, nextRevision: null, editId: 'e1', parent: { id: 'k1', title: 'Kafka' } }, 201) });
        const text = (await h.call('create_doc', { title: 'Partitions', markdown: 'How a topic splits.', parentId: 'k1' })).text;
        expect(h.requests[0]!.body).toMatchObject({ title: 'Partitions', parentId: 'k1' });
        expect(text).toContain('Created page "Partitions" inside "Kafka" · id p1. It is listed under that doc\'s pages; to point to it from that doc\'s text, write the line [Partitions](/docs/p1) where it belongs.');
    });

    it('read_doc names the docs above it, its lesson, and the pages inside it with their ids', async () => {
        h = await connect({
            'GET /api/agent/docs/b1': ok({
                id: 'b1',
                title: 'Caching',
                markdown: 'Text.',
                subject: null,
                topicId: null,
                updatedAt: DAY,
                canEdit: true,
                notes: 3,
                path: [{ id: 'a1', title: 'System Design' }],
                pages: [{ id: 'c1', title: 'Eviction', pages: 2 }],
                lesson: { docId: 'a1', title: 'System Design' },
            }),
            ...ZONE,
        });
        const text = (await h.call('read_doc', { docId: 'b1' })).text;
        expect(text).toContain('\nInside: "System Design" (a1)\n');
        expect(text).toContain('part of the lesson "System Design" (doc a1), 3 notes on it');
        expect(text).toContain('Pages inside (1; get_doc_tree shows the whole tree, move_doc moves one):\n- "Eviction" · id c1 · 2 pages inside');
    });

    it('search_docs names the docs above each hit', async () => {
        h = await connect({
            'GET /api/agent/docs': ok([
                { id: 'p1', title: 'Practice', subject: null, updatedAt: DAY, snippet: '', path: ['System Design', 'Caching'] },
                { id: 'p2', title: 'Practice', subject: null, updatedAt: DAY, snippet: '', path: [] },
            ]),
            ...ZONE,
        });
        const text = (await h.call('search_docs', { query: 'practice' })).text;
        expect(text).toContain('- "Practice" (in System Design › Caching) · no subject');
        expect(text).toContain('- "Practice" · no subject');
    });

    it('get_doc_tree: indented rows in tree order; with content, each page under a rule and what did not fit', async () => {
        const nodes = [
            { id: 'a1', parentId: null, depth: 0, title: 'Course', pages: 2, chars: 1200, updatedAt: DAY, lesson: true, markdown: 'The overview.' },
            { id: 'b1', parentId: 'a1', depth: 1, title: 'Part one', pages: 1, chars: 50_000, updatedAt: DAY, lesson: false, markdown: 'Alpha.' },
            { id: 'd1', parentId: 'b1', depth: 2, title: 'Deep', pages: 0, chars: 20, updatedAt: DAY, lesson: false },
        ];
        h = await connect({ 'GET /api/agent/docs/tree': ok({ root: { id: 'a1', title: 'Course', path: [{ id: 'h1', title: 'Hub' }] }, nodes, left: [{ id: 'd1', title: 'Deep', chars: 20 }] }), ...ZONE });
        const text = (await h.call('get_doc_tree', { docId: 'a1', content: true })).text;
        expect(h.requests.find((r) => r.path === '/api/agent/docs/tree')!.query).toEqual({ docId: 'a1', content: '1' });
        expect(text).toContain('"Course", inside "Hub" (h1): 2 pages inside.');
        expect(text).toContain('\n- "Course" · id a1 · 1.2k characters · updated 2026-11-27 · 2 pages inside · lesson');
        expect(text).toContain('\n  - "Part one" · id b1 · 50k characters · updated 2026-11-27 · 1 page inside');
        expect(text).toContain('\n    - "Deep" · id d1 · 20 characters · updated 2026-11-27');
        expect(text).toContain('---\n# Course (id a1)\n\nThe overview.');
        expect(text).toContain('---\n# Part one (id b1)\n\nAlpha.');
        expect(text).not.toContain('# Deep (id d1)');
        expect(text).toContain('Not shown (one answer holds 60,000 characters): "Deep" (id d1, 20 characters).');
    });

    it('get_doc_tree without a doc: the top-level docs', async () => {
        h = await connect({ 'GET /api/agent/docs/tree': ok({ root: null, nodes: [{ id: 'a1', parentId: null, depth: 0, title: 'Course', pages: 3, chars: 10, updatedAt: DAY, lesson: false }], left: [] }), ...ZONE });
        const text = (await h.call('get_doc_tree', {})).text;
        expect(text).toContain('1 top-level doc, most recently updated first');
        expect(text).toContain('- "Course" · id a1 · 10 characters · updated 2026-11-27 · 3 pages inside');
    });

    it('move_doc: "top" sends null; neither field is refused; the lesson rule comes back as a plain error', async () => {
        h = await connect({
            'PATCH /api/agent/docs/b1': ok({ id: 'b1', title: 'One', subject: null, topicId: null, changes: ['moved it to the top level'], editId: 'e1', parent: null }),
            'PATCH /api/agent/docs/l1': fail(409, '"L1" is a lesson with its own reviews: it can\'t sit inside the lesson "L2". Move it elsewhere, or take it off its subject first.'),
            'PATCH /api/agent/docs/c1': ok({ id: 'c1', title: 'Two', subject: null, topicId: null, changes: ['moved it inside "Course"'], editId: 'e2', parent: { id: 'a1', title: 'Course' } }),
        });
        const top = await h.call('move_doc', { docId: 'b1', parentId: 'top' });
        expect(h.requests[0]!.body).toEqual({ parentId: null });
        expect(top.text).toContain('Moved "One" to the top level · id b1.');
        const inside = await h.call('move_doc', { docId: 'c1', parentId: 'a1', after: 'start' });
        expect(h.requests[1]!.body).toEqual({ parentId: 'a1', after: 'start' });
        expect(inside.text).toContain('Moved "Two" inside "Course" · id c1. Everything inside it moved with it.');
        const neither = await h.call('move_doc', { docId: 'b1' });
        expect(neither.isError).toBe(true);
        expect(neither.text).toContain('Say where it goes');
        const refused = await h.call('move_doc', { docId: 'l1', parentId: 'l2' });
        expect(refused.isError).toBe(true);
        expect(refused.text).toContain('"L1" is a lesson with its own reviews');
    });

    it('trash_doc and restore_doc say the pages; add_note names the page', async () => {
        h = await connect({
            'POST /api/agent/docs/a1/trash': ok({ id: 'a1', title: 'Kafka', trashedAt: DAY, pages: 3, editId: 'e1' }),
            'POST /api/agent/docs/c1/restore': ok({ id: 'c1', title: 'Leaders', trashedAt: null, pages: 1, detached: true, editId: 'e2' }),
            'POST /api/agent/notes': ok({ id: 'n1', kind: 'note', title: 'LRU', lesson: { docId: 'a1', title: 'Caching' }, page: { docId: 'b1', title: 'Eviction' }, subject: 'System design', editId: 'e3' }, 201),
        });
        expect((await h.call('trash_doc', { docId: 'a1' })).text).toContain('Moved "Kafka" and the 3 pages inside it to the trash (30 days).');
        expect((await h.call('restore_doc', { docId: 'c1' })).text).toContain('Restored "Leaders" and 1 page. It came back at the top level: the doc it was in is still in the trash.');
        expect((await h.call('add_note', { docId: 'b1', title: 'LRU', markdown: 'Least recently used first.' })).text).toContain(
            'Saved the note "LRU" on the lesson "Caching" (doc a1), on its page "Eviction" (doc b1) · id n1.'
        );
    });
});
