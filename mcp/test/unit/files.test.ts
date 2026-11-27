// TOOL_ACCESS_PLAN §11.4: files on a note through the tools. A coding tool attaches a file from disk (multipart); the
// web can't use a path and says so; text and base64 go as JSON; list_notes prints a note's files.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PATH_NOT_HERE } from '../../src/tools/files.js';
import { UNDO, UNDO_OF, connect, ok, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const answer = (files: Array<[string, number]>) =>
    ok({ noteId: 'n1', file: { n: files.length, name: files.at(-1)![0], type: 'x', size: files.at(-1)![1] }, files: files.map(([name, size], i) => ({ n: i + 1, name, type: 'x', size })), editId: 'e1' }, 201);

describe('attach_file', () => {
    it('a file from disk (coding tools) goes as multipart with its own name', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'kaaga-files-'));
        const file = path.join(dir, 'budget.xlsx');
        writeFileSync(file, Buffer.alloc(2048, 1));
        h = await connect({ 'POST /api/agent/notes/n1/files': answer([['budget.xlsx', 2048]]) });
        expect((await h.call('attach_file', { noteId: 'n1', path: file })).text).toBe(`Attached "budget.xlsx" (2 KB) to note n1. Its 1 file: 1. budget.xlsx (2 KB).\n${UNDO_OF('e1')}`);
        expect(h.requests[0]!.body).toEqual({ file: { file: 'budget.xlsx', size: 2048 } });
        expect(h.requests[0]!.headers['content-type']).toBeUndefined();
    });

    it('refuses a video, a missing file and a path on the web, before any call', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'kaaga-files-'));
        const clip = path.join(dir, 'clip.mp4');
        writeFileSync(clip, 'x');
        h = await connect({});
        expect((await h.call('attach_file', { noteId: 'n1', path: clip })).text).toBe("Videos can't be attached. Save the link instead.");
        expect((await h.call('attach_file', { noteId: 'n1', path: path.join(dir, 'nope.md') })).text).toMatch(/^Can't read .*nope\.md: ENOENT\.$/);
        expect((await h.call('attach_file', { noteId: 'n1', name: 'a.md' })).text).toBe('Send exactly one of path, text or base64.');
        await h.close();
        h = await connect({}, { set: 'web' });
        expect((await h.call('attach_file', { noteId: 'n1', path: clip })).text).toBe(PATH_NOT_HERE);
        expect(h.requests).toHaveLength(0);
    });

    it('Ask Kaaga (inside the backend) never reads a path: the server’s own files stay out (§12.2 B1)', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'kaaga-files-'));
        const secret = path.join(dir, '.env');
        writeFileSync(secret, 'SECRET=1');
        for (const set of ['all', 'web'] as const) {
            h = await connect({ 'POST /api/agent/notes/n1/files': answer([['.env', 8]]) }, { set });
            expect((await h.call('attach_file', { noteId: 'n1', path: secret })).text).toBe(PATH_NOT_HERE);
            expect(h.requests).toHaveLength(0);
            await h.close();
            h = undefined;
        }
    });

    it('text and base64 go as JSON with the name', async () => {
        h = await connect({ 'POST /api/agent/notes/n1/files': answer([['plan.md', 13]]) }, { set: 'web' });
        await h.call('attach_file', { noteId: 'n1', name: 'plan.md', text: '# Plan\n\n- one' });
        expect(h.requests[0]!.body).toEqual({ name: 'plan.md', text: '# Plan\n\n- one' });
        await h.call('attach_file', { noteId: 'n1', name: 'logo.png', base64: 'iVBORw0KGgo=' });
        expect(h.requests[1]!.body).toEqual({ name: 'logo.png', base64: 'iVBORw0KGgo=' });
    });
});

describe('remove_file, read_note_file, list_notes', () => {
    it('takes one off by name; reads a text file’s text and another’s link; the note lists its files', async () => {
        h = await connect({
            'POST /api/agent/notes/n1/files/remove': ok({ noteId: 'n1', removed: 'plan.md', files: [{ n: 1, name: 'budget.xlsx', type: 'x', size: 49152 }], editId: 'e2' }),
            'GET /api/agent/notes/n1/files/1': ok({ n: 1, name: 'plan.md', type: 'text/markdown', size: 13, url: 'https://cdn.test/plan.md', text: '# Plan', cut: false }),
            'GET /api/agent/notes/n1/files/budget.xlsx': ok({ n: 2, name: 'budget.xlsx', type: 'application/vnd.ms-excel', size: 49152, url: 'https://cdn.test/budget.xlsx', text: null, cut: false }),
            'GET /api/agent/notes': ok({ place: { lesson: { docId: 'd1', title: 'Caching' }, subject: 'System Design' }, notes: [{ id: 'n1', kind: 'note', title: 'Cheat sheet', url: null, text: 'notes', day: '2026-11-20T10:00:00.000Z', by: 'the user', lesson: null, subject: 'System Design', files: [{ n: 1, name: 'budget.xlsx', type: 'x', size: 49152 }, { n: 2, name: 'plan.md', type: 'x', size: 3072 }] }], more: null }),
            'GET /api/learning/settings': ok({ timezone: 'Asia/Kolkata' }),
        });
        expect((await h.call('remove_file', { noteId: 'n1', name: 'plan.md' })).text).toBe(`Took "plan.md" off note n1. Its 1 file: 1. budget.xlsx (48 KB).\n${UNDO_OF('e2')}`);
        expect((await h.call('read_note_file', { noteId: 'n1', file: 1 })).text).toBe('1. plan.md · text/markdown · 13 B\n\n# Plan');
        expect((await h.call('read_note_file', { noteId: 'n1', file: 'budget.xlsx' })).text).toBe('2. budget.xlsx · application/vnd.ms-excel · 48 KB\nNot a text file: its link is https://cdn.test/budget.xlsx');
        expect((await h.call('list_notes', { docId: 'd1' })).text).toContain('2 files: 1. budget.xlsx (48 KB), 2. plan.md (3 KB)');
    });
});
