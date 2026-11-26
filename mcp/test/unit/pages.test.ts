// DOC_PAGES_PLAN §6.5 (stage 1): create_doc puts a doc inside another as a page; read_doc says where a doc sits and
// the pages inside it.
import { afterEach, describe, expect, it } from 'vitest';
import { connect, ok, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

describe('pages inside docs, through the tools', () => {
    it('create_doc with parentId sends it and says so', async () => {
        h = await connect({ 'POST /api/agent/docs': ok({ id: 'p1', title: 'Partitions', subject: null, topicId: null, nextRevision: null, editId: 'e1' }, 201) });
        const text = (await h.call('create_doc', { title: 'Partitions', markdown: 'How a topic splits.', parentId: 'k1' })).text;
        expect(h.requests[0]!.body).toMatchObject({ title: 'Partitions', parentId: 'k1' });
        expect(text).toContain('Created doc "Partitions", a page inside doc k1 · id p1.');
    });

    it('read_doc names the docs above it and the pages inside it, with their ids', async () => {
        h = await connect({
            'GET /api/agent/docs/b1': ok({ id: 'b1', title: 'Caching', markdown: 'Text.', subject: null, topicId: null, updatedAt: '2026-11-27T00:00:00.000Z', canEdit: true, path: [{ id: 'a1', title: 'System Design' }], pages: [{ id: 'c1', title: 'Eviction', pages: 2 }] }),
            'GET /api/learning/settings': ok({ timezone: 'Asia/Kolkata' }),
        });
        const text = (await h.call('read_doc', { docId: 'b1' })).text;
        expect(text).toContain('\nInside: "System Design" (a1)\n');
        expect(text).toContain('Pages inside (1): "Eviction" · id c1 · 2 pages inside');
    });
});
