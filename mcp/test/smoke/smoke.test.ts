// End-to-end smoke test: the BUILT server (dist/index.js) over stdio, driven by the SDK's client,
// against a running Recollect API. Run with `npm run test:smoke` (builds first).
//
// It logs in as the dev user, makes a token with all three scopes, then: reads (search, today,
// due, subjects, overview, goals), creates a doc (callout, toggle, mermaid), reads it, appends,
// adds a canvas (and reads its fence back), replaces a section (and a wrong heading first, to see
// the heading list), lists the agent edits;
// checks that a read-only token is refused writes with the missing scope named. No focus, pocket
// or goal writes (real dev data). Cleanup with the cookie: undo the doc-create edit (archives the
// doc), mark the smoke edits seen, revoke the tokens, and check a revoked token is refused.
//
// Env: RECOLLECT_URL (default http://localhost:8002), RECOLLECT_SMOKE_EMAIL / _PASSWORD (default the
// dev user), SMOKE_TRANSCRIPT (a file to write the transcript to).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../src/server.js';

const API = (process.env['RECOLLECT_URL'] ?? 'http://localhost:8002').replace(/\/+$/, '');
const EMAIL = process.env['RECOLLECT_SMOKE_EMAIL'] ?? 'dev@recollect.local';
const PASSWORD = process.env['RECOLLECT_SMOKE_PASSWORD'] ?? 'devpass123';
const SERVER = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const AGENT = 'MCP smoke test';
const UNDO = 'Undo: the user can undo this from Home → From your agent.';

const TITLE = `MCP smoke test ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
const MARKDOWN = [
    'Postgres row locks in two lines: a writer takes a lock on the row; other writers of that row wait until it commits.',
    '',
    '## Summary',
    '',
    'Row-level locks serialize writers per row. Readers never block (MVCC).',
    '',
    '> [!TIP]',
    '> Keep transactions short: locks are held until commit.',
    '',
    '## How it works',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  participant A as Tx A',
    '  participant B as Tx B',
    '  A->>DB: UPDATE row 1 (takes the lock)',
    '  B->>DB: UPDATE row 1 (waits)',
    '  A->>DB: COMMIT (releases it)',
    '  DB-->>B: goes ahead',
    '```',
    '',
    '## Self-test',
    '',
    '<details><summary>Do readers wait for a row lock?</summary>',
    '',
    'No: with MVCC they read the last committed version.',
    '',
    '</details>',
].join('\n');

const transcript: string[] = [];
let cookie = '';
const tokens: Array<{ id: string; revoked: boolean }> = [];
let client: Client | undefined;
let stderr = '';
let secret = '';
let docId = '';
let docCreateUndone = false;

// ─── Cookie-session helpers (the app's own login; never through the MCP server) ─

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; message?: string }> {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { Cookie: cookie, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string };
    return { status: res.status, data: json.data as T, ...(json.message ? { message: json.message } : {}) };
}

async function login(): Promise<void> {
    const res = await fetch(`${API}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    if (res.status !== 200) throw new Error(`login failed: HTTP ${res.status} ${await res.text()}`);
    const token = res.headers.getSetCookie().find((c) => c.startsWith('token='));
    if (!token) throw new Error('login answered without a token cookie');
    cookie = token.split(';')[0]!;
}

async function makeToken(name: string, scopes: string[]): Promise<string> {
    const res = await api<{ _id: string; token: string; scopes: string[] }>('POST', '/api/tokens', { name, scopes });
    if (res.status !== 201) throw new Error(`token create failed: HTTP ${res.status} ${res.message ?? ''}`);
    tokens.push({ id: res.data._id, revoked: false });
    return res.data.token;
}

async function revoke(id: string): Promise<void> {
    const res = await api('DELETE', `/api/tokens/${id}`);
    expect(res.status).toBe(200);
    tokens.find((t) => t.id === id)!.revoked = true;
}

// ─── The MCP side ──────────────────────────────────────────────────────

async function spawn(token: string): Promise<Client> {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [SERVER],
        env: { ...getDefaultEnvironment(), RECOLLECT_URL: API, RECOLLECT_TOKEN: token, RECOLLECT_AGENT_NAME: AGENT },
        stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    const c = new Client({ name: 'recollect-smoke', version: '1.0.0' });
    await c.connect(transport);
    return c;
}

const shortArgs = (args: Record<string, unknown>) =>
    JSON.stringify(args, (key, value) => (key === 'markdown' && typeof value === 'string' ? `<${value.length} chars of Markdown>` : value));

async function call(c: Client, name: string, args: Record<string, unknown> = {}, previewLines = 8): Promise<{ text: string; isError: boolean }> {
    const started = Date.now();
    const result = await c.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((p) => p.text ?? '').join('\n');
    const isError = result.isError === true;
    const lines = text.split('\n');
    const more = lines.length - previewLines;
    const preview = lines.slice(0, previewLines).join('\n') + (more > 0 ? `\n   … (${more} more line${more === 1 ? '' : 's'})` : '');
    transcript.push(`→ ${name} ${shortArgs(args)}\n← ${isError ? 'ERROR ' : ''}${Date.now() - started} ms, ${text.length} chars\n${preview.replace(/^/gm, '   ')}`);
    return { text, isError };
}

beforeAll(async () => {
    await login();
    secret = await makeToken(`${AGENT} (all scopes)`, ['read', 'docs:write', 'learning:write']);
    client = await spawn(secret);
});

afterAll(async () => {
    // Safety net: whatever failed above, leave no doc, token or open process behind.
    try {
        if (docId && !docCreateUndone) await undoDocCreate();
        for (const t of tokens) if (!t.revoked) await revoke(t.id);
    } finally {
        await client?.close();
        const file = process.env['SMOKE_TRANSCRIPT'];
        if (file) writeFileSync(file, transcript.join('\n\n') + '\n');
        console.log(`\n${transcript.join('\n\n')}\n`);
    }
});

async function undoDocCreate(): Promise<void> {
    const edits = await api<Array<{ id: string; kind: string; docId: string | null; agentName: string; seenAt: string | null; undoneAt: string | null }>>(
        'GET',
        '/api/agent/edits?limit=50'
    );
    const create = edits.data.find((e) => e.kind === 'doc_create' && e.docId === docId);
    expect(create, 'the doc_create edit').toBeTruthy();
    const undo = await api<{ undoneAt: string | null }>('POST', `/api/agent/edits/${create!.id}/undo`);
    expect(undo.status).toBe(200);
    expect(undo.data.undoneAt).toBeTruthy();
    docCreateUndone = true;
    // Home's "From your agent" shows unseen edits: mark the rest of this run's edits seen (Keep).
    const ours = edits.data.filter((e) => e.agentName === AGENT && !e.seenAt && e.id !== create!.id).map((e) => e.id);
    if (ours.length > 0) expect((await api('POST', '/api/agent/edits/seen', { ids: ours })).status).toBe(200);
    transcript.push(`(cookie) undo doc_create edit ${create!.id} → archived doc ${docId}; marked ${ours.length} other smoke edits seen`);
}

describe('recollect-mcp end to end (built server over stdio, live API)', () => {
    it('lists the 20 tools', async () => {
        const { tools } = await client!.listTools();
        expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
        transcript.push(`listTools → ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
    });

    it('reads: search_docs, get_today, list_due, list_subjects, get_learning_overview, list_goals', async () => {
        for (const [name, args] of [
            ['search_docs', { limit: 3 }],
            ['get_today', {}],
            ['list_due', {}],
            ['list_subjects', {}],
            ['get_learning_overview', {}],
            ['list_goals', {}],
        ] as const) {
            const res = await call(client!, name, args, 6);
            expect(res.isError, `${name}: ${res.text}`).toBe(false);
        }
    });

    it('create_doc with a callout, a toggle and a mermaid diagram', async () => {
        const res = await call(client!, 'create_doc', { title: TITLE, markdown: MARKDOWN });
        expect(res.isError, res.text).toBe(false);
        docId = /· id ([A-Za-z0-9]+)\./.exec(res.text)?.[1] ?? '';
        expect(docId).not.toBe('');
        expect(res.text.trimEnd().endsWith(UNDO)).toBe(true);
    });

    it('read_doc returns the header and the Markdown round trip', async () => {
        const res = await call(client!, 'read_doc', { docId }, 40);
        expect(res.isError, res.text).toBe(false);
        expect(res.text.split('\n')[0]).toContain(`Doc ${docId}`);
        expect(res.text).toContain('[!TIP]');
        expect(res.text).toContain('<details>');
        expect(res.text).toContain('```mermaid');
    });

    it('append_to_doc', async () => {
        const res = await call(client!, 'append_to_doc', { docId, markdown: '## Practice\n\n- [ ] Reproduce a lock wait with two psql sessions' });
        expect(res.isError, res.text).toBe(false);
        expect(res.text).toMatch(/^Appended 2 blocks/);
    });

    it('add_canvas: a laid-out board that read_doc shows as a ```canvas fence', async () => {
        const res = await call(client!, 'add_canvas', {
            docId,
            diagram: ['flowchart LR', '  a([Tx A]) -->|UPDATE (lock)| row[(Row 1)]:::blue', '  b(["Tx B (waits)"]):::yellow -.->|UPDATE| row'].join('\n'),
        });
        expect(res.isError, res.text).toBe(false);
        expect(res.text).toMatch(/^Added a canvas to doc \w+\.\nCanvas cv_[A-Za-z0-9_-]{12}: 3 boxes, 2 arrows, \d+×\d+, shows at \d+% in a doc\./);
        const read = await call(client!, 'read_doc', { docId }, 60);
        expect(read.text).toMatch(/```canvas\n%% id: cv_[A-Za-z0-9_-]{12}\nflowchart LR\n/);
        expect(read.text).toContain('b(["Tx B (waits)"]):::yellow');
        expect(read.text).toContain('|UPDATE (lock)|');
    });

    it('replace_section with a wrong heading lists the real headings', async () => {
        const res = await call(client!, 'replace_section', { docId, heading: 'Summray', markdown: 'x' });
        expect(res.isError).toBe(true);
        expect(res.text).toContain('Its headings:');
        expect(res.text).toContain('"Summary"');
    });

    it('replace_section', async () => {
        const res = await call(client!, 'replace_section', {
            docId,
            heading: 'summary',
            markdown: 'Row locks serialize writers of the same row; readers use MVCC snapshots and never wait.',
        });
        expect(res.isError, res.text).toBe(false);
        expect(res.text).toMatch(/^Replaced section "Summary" in doc/);
        const after = await call(client!, 'read_doc', { docId }, 12);
        expect(after.text).toContain('readers use MVCC snapshots');
        expect(after.text).toContain('## Practice');
        expect(after.text).not.toContain('Readers never block (MVCC).');
    });

    it('recent_agent_edits shows this run', async () => {
        const res = await call(client!, 'recent_agent_edits', { limit: 5 });
        expect(res.isError, res.text).toBe(false);
        expect(res.text).toContain(`Created "${TITLE}"`);
        expect(res.text).toMatch(/Appended 2 blocks to/);
        expect(res.text).toMatch(/Rewrote section "Summary"/);
    });

    it('a read-only token is refused writes, with the missing scope named', async () => {
        const readOnly = await makeToken(`${AGENT} (read only)`, ['read']);
        const second = await spawn(readOnly);
        try {
            const doc = await call(second, 'create_doc', { title: `${TITLE} (must not exist)`, markdown: 'x' });
            expect(doc.isError).toBe(true);
            expect(doc.text).toContain('lacks the "docs:write" scope');
            const focus = await call(second, 'add_focus', { text: 'must not exist' });
            expect(focus.isError).toBe(true);
            expect(focus.text).toContain('lacks the "learning:write" scope');
        } finally {
            await second.close();
            await revoke(tokens.at(-1)!.id);
        }
    });

    it('cleanup: undo the doc-create (archives the doc), then search no longer finds it', async () => {
        await undoDocCreate();
        const res = await call(client!, 'search_docs', { query: TITLE });
        expect(res.text).toBe(`No docs match "${TITLE}".`);
    });

    it('a revoked token gets the "invalid or revoked" message', async () => {
        await revoke(tokens[0]!.id);
        const res = await call(client!, 'list_subjects');
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(/^The Recollect token is invalid or revoked: make a new one in Settings → Agents/);
    });

    it('the token never appears in the server log or in any answer', () => {
        expect(stderr).toContain('ready');
        expect(stderr).not.toContain(secret);
        expect(transcript.join('\n')).not.toContain(secret);
        transcript.push(`server stderr:\n${stderr.trim().replace(/^/gm, '   ')}`);
    });
});
