import { afterEach, describe, expect, it } from 'vitest';
import { TOKEN, UNDO, UUID_RE, connect, fail, lastLine, ok, type Harness } from './harness.js';
import { subjects } from './fixtures.js';
import { STUDY_NOTE_LINE } from '../../src/tools/docs.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const created = (over: Record<string, unknown> = {}) =>
    ok({ id: 'docNew1', title: 'Postgres locks', subject: null, topicId: null, nextRevision: null, editId: 'edit1', ...over }, 201);

describe('search_docs', () => {
    it('passes query and limit, and lists id, subject, date and snippet compactly', async () => {
        h = await connect({
            'GET /api/agent/docs': ok([
                { id: 'docA', title: 'Postgres locks', subject: 'Backend', updatedAt: '2026-11-10T08:00:00.000Z', snippet: '…row-level locks block writers…' },
                { id: 'docB', title: 'MVCC', subject: null, updatedAt: '2026-11-01T08:00:00.000Z', snippet: '' },
            ]),
        });
        const res = await h.call('search_docs', { query: 'locks', limit: 5 });
        expect(res.isError).toBe(false);
        expect(h.requests[0]).toMatchObject({ method: 'GET', path: '/api/agent/docs', query: { query: 'locks', limit: '5' } });
        expect(h.requests[0]!.headers['authorization']).toBe(`Bearer ${TOKEN}`);
        expect(res.text).toBe(
            [
                '2 docs matching "locks", best first:',
                '- "Postgres locks" · Backend · updated 2026-11-10 · id docA',
                '  …row-level locks block writers…',
                '- "MVCC" · no subject · updated 2026-11-01 · id docB',
            ].join('\n')
        );
    });

    it('without a query: the most recent docs; no results is one short line', async () => {
        h = await connect({ 'GET /api/agent/docs': [ok([{ id: 'd1', title: 'A', subject: null, updatedAt: '2026-11-10T00:00:00Z', snippet: '' }]), ok([])] });
        expect((await h.call('search_docs')).text).toMatch(/^1 doc, most recently updated first:/);
        expect(h.requests[0]!.query).toEqual({});
        expect((await h.call('search_docs', { query: 'zzz' })).text).toBe('No docs match "zzz".');
    });

    it('rejects a limit over 50 before calling the API', async () => {
        h = await connect({});
        const res = await h.call('search_docs', { limit: 500 });
        expect(res.isError).toBe(true);
        expect(h.requests).toHaveLength(0);
    });
});

describe('read_doc', () => {
    it('returns a one-line header and the Markdown', async () => {
        h = await connect({
            'GET /api/agent/docs/docA': ok({
                id: 'docA',
                title: 'Postgres locks',
                markdown: '## Summary\n\nRow locks.',
                subject: { id: 'subjB', name: 'Backend' },
                topicId: 't9',
                updatedAt: '2026-11-10T08:00:00.000Z',
                canEdit: true,
            }),
        });
        const res = await h.call('read_doc', { docId: 'docA' });
        // Stage 14: a doc they can edit ends with the rule for offering a note (the moment it matters).
        expect(res.text).toBe(`Doc docA · "Postgres locks" · subject Backend · updated 2026-11-10 · editable\n\n## Summary\n\nRow locks.\n\n---\n${STUDY_NOTE_LINE}`);
    });

    it('stage 14: append_to_doc with a heading adds a note inside that section; a repeat, an older server and after alone said plainly', async () => {
        h = await connect({
            'POST /api/agent/docs/docA/append': [
                ok({ id: 'docA', heading: 'Why it works', placed: 'after', appended: 2, editId: 'e1' }),
                ok({ id: 'docA', heading: 'Why it works', placed: 'section_end', appended: 2, editId: 'e2' }),
                ok({ id: 'docA', heading: 'Why it works', already: true, placed: null, appended: 0, editId: null }),
                ok({ id: 'docA', appended: 2, editId: 'e3' }),
            ],
        });
        const add = (args: Record<string, unknown>) => h!.call('append_to_doc', { docId: 'docA', markdown: '**Conveyor belt:** a worker at each end.', ...args });
        const first = await add({ heading: 'Why it works', after: 'start one pointer' });
        expect(h.requests[0]!.body).toEqual({ markdown: '**Conveyor belt:** a worker at each end.', heading: 'Why it works', after: 'start one pointer' });
        expect(first.text).toMatch(/^Added a note under "Why it works" in doc docA, right after the paragraph you quoted, with the day and your app under it\./);
        expect((await add({ heading: 'Why it works' })).text).toMatch(/at the end of that section/);
        expect((await add({ heading: 'Why it works' })).text).toBe('Already in that section ("Why it works"): not added again.');
        expect((await add({ heading: 'Why it works' })).text).toMatch(/^Appended 2 blocks to the end of doc docA \(this Recollect server is older/);
        expect((await add({ after: 'start one pointer' })).isError).toBe(true);
        expect(h.requests).toHaveLength(4);
    });

    it('says when the doc is read-only or empty', async () => {
        h = await connect({
            'GET /api/agent/docs/docV': ok({ id: 'docV', title: 'Shared', markdown: '', subject: null, topicId: null, updatedAt: '2026-11-10T08:00:00Z', canEdit: false }),
        });
        const res = await h.call('read_doc', { docId: 'docV' });
        expect(res.text).toContain('no subject');
        expect(res.text).toContain('read-only');
        expect(res.text).toContain('(empty doc)');
    });

    it('refuses an id that is not a doc id, without calling the API', async () => {
        h = await connect({});
        const res = await h.call('read_doc', { docId: '../tokens' });
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(/doc id/);
        expect(h.requests).toHaveLength(0);
    });

    it('passes a 404 through', async () => {
        h = await connect({ 'GET /api/agent/docs/docX': fail(404, 'Doc not found') });
        expect(await h.call('read_doc', { docId: 'docX' })).toEqual({ text: 'Doc not found', isError: true });
    });
});

describe('create_doc', () => {
    it('creates a doc without a subject: title and markdown only, with an Idempotency-Key', async () => {
        h = await connect({ 'POST /api/agent/docs': created() });
        const res = await h.call('create_doc', { title: 'Postgres locks', markdown: '## Summary\n\n> [!TIP]\n> Keep transactions short.' });
        expect(res.isError).toBe(false);
        const [req] = h.requests;
        expect(req).toMatchObject({ method: 'POST', path: '/api/agent/docs', body: { title: 'Postgres locks', markdown: '## Summary\n\n> [!TIP]\n> Keep transactions short.' } });
        expect(req!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(req!.headers['x-agent-name']).toBe('Claude Code');
        expect(res.text).toBe(`Created doc "Postgres locks" · id docNew1.\n${UNDO}`);
    });

    it('finds the subject by name (case-insensitive) and schedules revision', async () => {
        h = await connect({
            'GET /api/subjects': ok(subjects()),
            'POST /api/agent/docs': created({ subject: { id: 'subjSys2', name: 'System Design' }, topicId: 'tNew', nextRevision: '2026-11-15' }),
        });
        const res = await h.call('create_doc', { title: 'Rate limiter', markdown: 'x', subject: '  system   DESIGN ', revise: true });
        expect(h.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/subjects', 'POST /api/agent/docs']);
        expect(h.requests[1]!.body).toEqual({ title: 'Rate limiter', markdown: 'x', subjectId: 'subjSys2', revise: true });
        expect(res.text).toContain('in System Design · id docNew1.');
        expect(res.text).toContain('Revision scheduled: first review 2026-11-15');
        expect(lastLine(res.text)).toBe(UNDO);
    });

    it("topicId: the doc becomes a planned topic's note (revise needs no subject then)", async () => {
        h = await connect({
            'POST /api/agent/docs': created({ title: 'Caching', subject: { id: 'subjSys2', name: 'System Design' }, topicId: 't5', topicStatus: 'done', nextRevision: '2026-11-15' }),
        });
        const res = await h.call('create_doc', { title: 'Caching', markdown: 'x', topicId: 't5', revise: true });
        expect(h.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/agent/docs']);
        expect(h.requests[0]!.body).toEqual({ title: 'Caching', markdown: 'x', topicId: 't5', revise: true });
        expect(res.text.split('\n')[0]).toBe('Created doc "Caching" in System Design, the note of topic t5 (now done) · id docNew1.');
        expect(res.text).toContain('Revision scheduled: first review 2026-11-15');
    });

    it('revise without a subject or a topic is refused before any call', async () => {
        h = await connect({});
        const res = await h.call('create_doc', { title: 'X', markdown: 'x', revise: true });
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(/^revise needs a subject or a topicId/);
        expect(h.requests).toHaveLength(0);
    });

    it('a subject without revise says how to schedule it later', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()), 'POST /api/agent/docs': created({ subject: { id: 'subjDsa1', name: 'DSA' }, topicId: 'tNew' }) });
        const res = await h.call('create_doc', { title: 'Heaps', markdown: 'x', subject: 'dsa' });
        expect(h.requests[1]!.body).toEqual({ title: 'Heaps', markdown: 'x', subjectId: 'subjDsa1' });
        expect(res.text).toContain('schedule_revision starts it');
    });

    it('revise without a subject fails before any call', async () => {
        h = await connect({});
        const res = await h.call('create_doc', { title: 'T', markdown: 'x', revise: true });
        expect(res).toMatchObject({ isError: true });
        expect(res.text).toMatch(/revise needs a subject/);
        expect(h.requests).toHaveLength(0);
    });

    it('an unknown subject lists the subjects and the two ways out; nothing is created', async () => {
        h = await connect({ 'GET /api/subjects': ok(subjects()) });
        const res = await h.call('create_doc', { title: 'T', markdown: 'x', subject: 'AI' });
        expect(res.isError).toBe(true);
        expect(res.text).toBe('No subject named "AI". Subjects: "DSA", "System Design". Call create_subject first, or pass create_subject_if_missing: true.');
        expect(h.requests.map((r) => r.method)).toEqual(['GET']);
    });

    it('create_subject_if_missing creates the subject first, each write with its own key', async () => {
        h = await connect({
            'GET /api/subjects': ok(subjects()),
            'POST /api/subjects': ok({ _id: 'subjAi3', name: 'AI', description: null }, 201),
            'POST /api/agent/docs': created({ subject: { id: 'subjAi3', name: 'AI' }, topicId: 'tNew' }),
        });
        const res = await h.call('create_doc', { title: 'Transformers', markdown: 'x', subject: 'AI', create_subject_if_missing: true });
        const writes = h.requests.filter((r) => r.method === 'POST');
        expect(writes.map((r) => r.path)).toEqual(['/api/subjects', '/api/agent/docs']);
        expect(writes[0]!.body).toEqual({ name: 'AI' });
        expect(writes[1]!.body).toMatchObject({ subjectId: 'subjAi3' });
        expect(writes[0]!.headers['idempotency-key']).not.toBe(writes[1]!.headers['idempotency-key']);
        expect(res.text).toMatch(/^Created subject "AI" \(id subjAi3\)\.\nCreated doc "Postgres locks" in AI/);
    });

    it('if the doc fails after create_subject_if_missing made the subject, the error says the subject exists now', async () => {
        h = await connect({
            'GET /api/subjects': ok(subjects()),
            'POST /api/subjects': ok({ _id: 'subjAi3', name: 'AI', description: null }, 201),
            'POST /api/agent/docs': fail(400, 'A title is at most 200 characters'),
        });
        const res = await h.call('create_doc', { title: 'T', markdown: 'x', subject: 'AI', create_subject_if_missing: true });
        expect(res).toEqual({ text: 'A title is at most 200 characters (The subject "AI" was created first and stays: id subjAi3.)', isError: true });
    });

    it('a 400 from the Markdown converter is passed through', async () => {
        h = await connect({ 'POST /api/agent/docs': fail(400, 'The Markdown does not fit a doc: block 3 (taskList): …') });
        expect(await h.call('create_doc', { title: 'T', markdown: '- [ ]' })).toEqual({ text: 'The Markdown does not fit a doc: block 3 (taskList): …', isError: true });
    });

    it('a token without docs:write gets the missing scope named', async () => {
        h = await connect({ 'POST /api/agent/docs': fail(403, 'This access token lacks the "docs:write" scope') });
        const res = await h.call('create_doc', { title: 'T', markdown: 'x' });
        expect(res.isError).toBe(true);
        expect(res.text).toBe('The Recollect token lacks the "docs:write" scope this tool needs. Make a token with "docs:write" in Settings → Agents.');
    });

    it('describes the Markdown dialect in short; guide: true answers the whole guide and creates nothing (MCP_MEMORY_PLAN §4.10)', async () => {
        h = await connect({});
        const { tools } = await h.client.listTools();
        const description = tools.find((t) => t.name === 'create_doc')!.description!;
        for (const part of ['[!TIP]', '<details>', '```mermaid', '```canvas', 'guide: true']) expect(description).toContain(part);
        const guide = await h.call('create_doc', { guide: true });
        for (const part of ['[!NOTE]', '[!CAUTION]', '<details><summary>', '```mermaid', '```canvas', 'flowchart LR', 'subgraph api [API tier]', ':::blue', 'note for db:', '@{ kind: queue }', 'gateway, lb, auth', 'sequence, ER, state', '- [ ]', '###', 'note_recipe']) {
            expect(guide.text).toContain(part);
        }
        expect(h.requests).toHaveLength(0);
        const missing = await h.call('create_doc', { title: 'T' });
        expect(missing).toEqual({ text: 'Send title and markdown (or only guide: true for the writing guide).', isError: true });
    });

    it('answers with a line per canvas it made: size, zoom in a doc, and what to check', async () => {
        const report = (over: object) => ({ canvasId: 'cv_Ab3dE6gH9jK0', boxes: 12, arrows: 14, zones: 2, width: 980, height: 520, zoom: 0.734, warnings: [], ...over });
        h = await connect({
            'POST /api/agent/docs': created({
                canvases: [report({ warnings: ['2 arrows cross (lb→a1 × cache→db)', 'box "x" has no arrows'] }), report({ canvasId: 'cv_Zz3dE6gH9jK1', boxes: 1, arrows: 0, zones: 0, width: 160, height: 64, zoom: 1 })],
            }),
        });
        const res = await h.call('create_doc', { title: 'Design', markdown: '```canvas\na --> b\n```' });
        expect(res.text).toBe(
            [
                'Created doc "Postgres locks" · id docNew1.',
                'Canvas cv_Ab3dE6gH9jK0: 12 boxes, 14 arrows, 2 zones, 980×520, shows at 73% in a doc. Check: 2 arrows cross (lb→a1 × cache→db); box "x" has no arrows.',
                'Canvas cv_Zz3dE6gH9jK1: 1 box, 0 arrows, 160×64, shows at 100% in a doc. No problems found.',
                UNDO,
            ].join('\n')
        );
    });
});

describe('update_doc', () => {
    it('renames and files a doc by subject name, and says what changed', async () => {
        h = await connect({
            'GET /api/subjects': ok(subjects()),
            'PATCH /api/agent/docs/docA': ok({
                id: 'docA',
                title: 'Rate limiter',
                subject: { id: 'subjSys2', name: 'System Design' },
                topicId: 'tNew',
                changes: ['renamed it "Rate limiter"', 'filed it under System Design'],
                editId: 'e9',
            }),
        });
        const res = await h.call('update_doc', { docId: 'docA', title: 'Rate limiter', subject: 'system design' });
        expect(h.requests[1]).toMatchObject({ method: 'PATCH', path: '/api/agent/docs/docA', body: { title: 'Rate limiter', subjectId: 'subjSys2' } });
        expect(res.text).toBe(
            ['Updated doc docA: renamed it "Rate limiter", filed it under System Design.', 'Now "Rate limiter" · in System Design · topic tNew', UNDO].join('\n').replace('topic tNew\n', 'topic tNew.\n')
        );
    });

    it('nothing to change, and nothing to send', async () => {
        h = await connect({
            'PATCH /api/agent/docs/docA': ok({ id: 'docA', title: 'Heaps', subject: null, topicId: null, changes: [], editId: null }),
        });
        expect((await h.call('update_doc', { docId: 'docA', title: 'Heaps' })).text).toBe('Nothing to change: doc docA is "Heaps" · no subject.');
        expect((await h.call('update_doc', { docId: 'docA' })).text).toBe('Send title, subject or topicId.');
    });
});

describe('append_to_doc', () => {
    it('posts the Markdown to the doc and ends with the Undo line', async () => {
        h = await connect({ 'POST /api/agent/docs/docA/append': ok({ id: 'docA', appended: 3, editId: 'e2' }) });
        const res = await h.call('append_to_doc', { docId: 'docA', markdown: '## Practice\n\n- [ ] Two sum' });
        expect(h.requests[0]).toMatchObject({ method: 'POST', path: '/api/agent/docs/docA/append', body: { markdown: '## Practice\n\n- [ ] Two sum' } });
        expect(h.requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(res.text).toBe(`Appended 3 blocks to the end of doc docA.\n${UNDO}`);
    });

    it('rejects empty Markdown', async () => {
        h = await connect({});
        expect((await h.call('append_to_doc', { docId: 'docA', markdown: '' })).isError).toBe(true);
        expect(h.requests).toHaveLength(0);
    });

    it('a canvas in the Markdown adds its report line', async () => {
        const canvases = [{ canvasId: 'cv_Ab3dE6gH9jK0', boxes: 3, arrows: 2, zones: 0, width: 520, height: 64, zoom: 1, warnings: [] }];
        h = await connect({ 'POST /api/agent/docs/docA/append': ok({ id: 'docA', appended: 2, editId: 'e2', canvases }) });
        const res = await h.call('append_to_doc', { docId: 'docA', markdown: '## Flow\n\n```canvas\na --> b --> c\n```' });
        expect(res.text).toBe(`Appended 2 blocks to the end of doc docA.\nCanvas cv_Ab3dE6gH9jK0: 3 boxes, 2 arrows, 520×64, shows at 100% in a doc. No problems found.\n${UNDO}`);
    });

    it('a viewer-only doc: the 403 message passes through', async () => {
        h = await connect({ 'POST /api/agent/docs/docV/append': fail(403, 'Viewers cannot edit this document') });
        expect(await h.call('append_to_doc', { docId: 'docV', markdown: 'x' })).toEqual({ text: 'Viewers cannot edit this document', isError: true });
    });
});

describe('replace_section', () => {
    it('sends heading and markdown, reports removed and inserted blocks', async () => {
        h = await connect({ 'POST /api/agent/docs/docA/replace-section': ok({ id: 'docA', heading: 'Complexity', removed: 2, inserted: 1, editId: 'e3' }) });
        const res = await h.call('replace_section', { docId: 'docA', heading: '## Complexity', markdown: 'O(n log n) time.' });
        expect(h.requests[0]!.body).toEqual({ heading: '## Complexity', markdown: 'O(n log n) time.' });
        expect(res.text).toBe(`Replaced section "Complexity" in doc docA: removed 2 blocks, inserted 1 block.\n${UNDO}`);
    });

    it("an unknown heading: the API's list of the doc's headings reaches the agent", async () => {
        const message = 'Heading "Complexty" not found in this doc. Its headings: "Summary", "Complexity", "Self-test".';
        h = await connect({ 'POST /api/agent/docs/docA/replace-section': fail(404, message) });
        expect(await h.call('replace_section', { docId: 'docA', heading: 'Complexty', markdown: 'x' })).toEqual({ text: message, isError: true });
    });

    it('a rewritten canvas reports on the new board', async () => {
        const canvases = [{ canvasId: 'cv_New3dE6gH9jK', boxes: 4, arrows: 3, zones: 1, width: 900, height: 300, zoom: 0.71, warnings: ['shows at 55% in a doc (too wide): try flowchart TB, or split it'] }];
        h = await connect({ 'POST /api/agent/docs/docA/replace-section': ok({ id: 'docA', heading: 'Design', removed: 1, inserted: 1, editId: 'e3', canvases }) });
        const res = await h.call('replace_section', { docId: 'docA', heading: 'Design', markdown: '```canvas\nflowchart LR\na --> b\n```' });
        expect(res.text.split('\n')[1]).toBe('Canvas cv_New3dE6gH9jK: 4 boxes, 3 arrows, 1 zone, 900×300, shows at 71% in a doc. Check: shows at 55% in a doc (too wide): try flowchart TB, or split it.');
    });
});

describe('add_canvas', () => {
    const DIAGRAM = 'flowchart LR\n  web([Web app]) -->|HTTPS| api[API]\n  api -.->|SQL| db[(Postgres)]:::blue';
    const report = { canvasId: 'cv_Ab3dE6gH9jK0', boxes: 3, arrows: 2, zones: 0, width: 520, height: 96, zoom: 1, warnings: [] };
    const appended = ok({ id: 'docA', appended: 1, editId: 'e9', canvases: [report] });

    it('appends the diagram as a ```canvas fence and answers with what the API drew', async () => {
        h = await connect({ 'POST /api/agent/docs/docA/append': appended });
        const res = await h.call('add_canvas', { docId: 'docA', diagram: DIAGRAM });
        expect(res).toEqual({
            text: `Added a canvas to doc docA.\nCanvas cv_Ab3dE6gH9jK0: 3 boxes, 2 arrows, 520×96, shows at 100% in a doc. No problems found.\n${UNDO}`,
            isError: false,
        });
        const [req] = h.requests;
        expect(req).toMatchObject({ method: 'POST', path: '/api/agent/docs/docA/append' });
        expect(req!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(req!.body.markdown).toBe(`\`\`\`canvas\n${DIAGRAM}\n\`\`\``);
    });

    it('a height goes in as %% height; a fence the agent wrapped around it is taken off; backticks inside get a longer fence', async () => {
        h = await connect({ 'POST /api/agent/docs/docA/append': [appended, appended, appended] });
        await h.call('add_canvas', { docId: 'docA', diagram: DIAGRAM, height: 600 });
        expect(h.requests[0]!.body.markdown).toBe(`\`\`\`canvas\n%% height: 600\n${DIAGRAM}\n\`\`\``);
        await h.call('add_canvas', { docId: 'docA', diagram: `\`\`\`canvas\n${DIAGRAM}\n\`\`\`` });
        expect(h.requests[1]!.body.markdown).toBe(`\`\`\`canvas\n${DIAGRAM}\n\`\`\``);
        await h.call('add_canvas', { docId: 'docA', diagram: 'a["use ``` here"] --> b' });
        expect(h.requests[2]!.body.markdown).toBe('````canvas\na["use ``` here"] --> b\n````');
    });

    it.each([
        ['an empty diagram', { diagram: '   ' }],
        ['a diagram over 20 000 characters', { diagram: `a --> b\n${'%%'.repeat(10_001)}` }],
        ['the old JSON input', { nodes: [{ text: 'x' }] }],
        ['a height too small', { diagram: 'a --> b', height: 100 }],
    ])('rejects %s before calling the API', async (_name, args) => {
        h = await connect({});
        const res = await h.call('add_canvas', { docId: 'docA', ...args });
        expect(res.isError).toBe(true);
        expect(h.requests).toHaveLength(0);
    });

    it("a diagram the API can't read: its message (with the line) reaches the agent", async () => {
        const message = 'line 2: "->" is not an arrow. Arrows: --> (or --->), --- (no head), -.-> (dashed), -.- , ==> , <--> and <-.-> (both ways); a label goes in -->|label| or -- label -->';
        h = await connect({ 'POST /api/agent/docs/docA/append': fail(400, message) });
        const res = await h.call('add_canvas', { docId: 'docA', diagram: 'flowchart LR\n  a -> b' });
        expect(res).toEqual({ text: message, isError: true });
    });

    it('points to the canvas syntax in create_doc (said once), tells when to use mermaid, and how to read and change a board', async () => {
        h = await connect({});
        const { tools } = await h.client.listTools();
        const tool = tools.find((t) => t.name === 'add_canvas')!;
        for (const part of ['system-design', "create_doc's Markdown guide", '```mermaid', 'read_doc', '```canvas', 'update_canvas', 'preview_diagram', 'Undo', 'problems to fix']) {
            expect(tool.description).toContain(part);
        }
        expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    });
});

describe('update_canvas', () => {
    const CANVAS = 'cv_Ab3dE6gH9jK0';
    const report = { canvasId: CANVAS, boxes: 6, arrows: 5, zones: 0, width: 900, height: 300, zoom: 0.71, warnings: [] };
    const updated = (over: object = {}) => ok({ id: 'docA', canvasId: CANVAS, editId: 'e7', canvases: [report], ...over });

    it('sends add / remove / rename to the board by id and answers with its report line and Undo', async () => {
        h = await connect({ [`POST /api/agent/docs/docA/canvas/${CANVAS}`]: updated() });
        const res = await h.call('update_canvas', { docId: 'docA', canvasId: CANVAS, add: 'api --> cache[(Redis)]', remove: ['db', 'a --> b'], rename: { lb: 'L7 LB' } });
        expect(res).toEqual({
            text: `Updated canvas ${CANVAS} in doc docA.\nCanvas ${CANVAS}: 6 boxes, 5 arrows, 900×300, shows at 71% in a doc. No problems found.\n${UNDO}`,
            isError: false,
        });
        expect(h.requests[0]).toMatchObject({ method: 'POST', path: `/api/agent/docs/docA/canvas/${CANVAS}`, body: { add: 'api --> cache[(Redis)]', remove: ['db', 'a --> b'], rename: { lb: 'L7 LB' } } });
        expect(h.requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
    });

    it('a whole diagram goes on its own (a fence around it is taken off); a change that changes nothing says so, without Undo', async () => {
        h = await connect({ [`POST /api/agent/docs/docA/canvas/${CANVAS}`]: updated({ editId: null }) });
        const res = await h.call('update_canvas', { docId: 'docA', canvasId: CANVAS, diagram: '```canvas\nflowchart LR\n  a --> b\n```' });
        expect(h.requests[0]!.body).toEqual({ diagram: 'flowchart LR\n  a --> b' });
        expect(res.text).toBe(`Canvas ${CANVAS} in doc docA is unchanged: the change gives the board it already has.\nCanvas ${CANVAS}: 6 boxes, 5 arrows, 900×300, shows at 71% in a doc. No problems found.`);
    });

    it.each([
        ['nothing to do', {}],
        ['a diagram with edits', { diagram: 'a --> b', add: 'c' }],
        ['a canvas id that is none', { canvasId: 'board-1', add: 'a' }],
        ['an empty remove list', { remove: [] }],
    ])('rejects %s before calling the API', async (_name, args) => {
        h = await connect({});
        const res = await h.call('update_canvas', { docId: 'docA', canvasId: CANVAS, ...args });
        expect(res.isError).toBe(true);
        expect(h.requests).toHaveLength(0);
    });

    it("the API's 400 (with the line of add) reaches the agent", async () => {
        const message = 'add line 2: "->" is not an arrow. Arrows: --> (or --->), …';
        h = await connect({ [`POST /api/agent/docs/docA/canvas/${CANVAS}`]: fail(400, message) });
        expect(await h.call('update_canvas', { docId: 'docA', canvasId: CANVAS, add: 'a --> b\nb -> c' })).toEqual({ text: message, isError: true });
    });

    it('read_doc and replace_section tell the agent about it', async () => {
        h = await connect({});
        const { tools } = await h.client.listTools();
        expect(tools.find((t) => t.name === 'read_doc')!.description).toContain('update_canvas');
        expect(tools.find((t) => t.name === 'replace_section')!.description).toContain('update_canvas');
        expect(tools.find((t) => t.name === 'update_canvas')!.description).toContain('keeping everything the user arranged');
    });
});

describe('preview_diagram', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

    it('answers the PNG as an image and the report as text', async () => {
        const report = { canvasId: 'cv_Ab3dE6gH9jK0', boxes: 3, arrows: 2, zones: 1, width: 520, height: 200, zoom: 1, warnings: ['2 arrows cross (a→b × c→d)'] };
        h = await connect({ 'GET /api/agent/docs/docA/preview': ok({ canvasId: 'cv_Ab3dE6gH9jK0', width: 1136, height: 496, png: PNG, report }) });
        const result = await h.client.callTool({ name: 'preview_diagram', arguments: { docId: 'docA', theme: 'dark' } });
        expect(result.isError).toBeFalsy();
        expect(result.content).toEqual([
            { type: 'image', data: PNG, mimeType: 'image/png' },
            { type: 'text', text: 'Canvas cv_Ab3dE6gH9jK0: 3 boxes, 2 arrows, 1 zone, 520×200, shows at 100% in a doc. Check: 2 arrows cross (a→b × c→d). (PNG 1136×496)' },
        ]);
        expect(h.requests[0]).toMatchObject({ method: 'GET', path: '/api/agent/docs/docA/preview', query: { theme: 'dark' } });
    });

    it('a doc whose diagrams are Mermaid: the API says the server does not draw them yet', async () => {
        const message = 'This doc has no canvas. Its diagram is a Mermaid block: the server does not draw Mermaid yet (the browser does).';
        h = await connect({ 'GET /api/agent/docs/docM/preview': fail(404, message) });
        expect(await h.call('preview_diagram', { docId: 'docM' })).toEqual({ text: message, isError: true });
    });
});
