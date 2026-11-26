// The remote door (MCP_MEMORY_PLAN §4.1, stage 1): claude.ai and ChatGPT reach Kaaga through the stateless
// POST /mcp, a fresh server for every request. This drives handleMcpHttp over real HTTP, one request at a time,
// against a fake Kaaga API: every tool the web set lists can be called, no answer says "disabled", and
// more_tools is not listed (nothing turned on in one request could last to the next).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMcpHttp } from '../../src/embedded.js';
import { RUNNERS, WEB_INSTRUCTIONS, WEB_TOOLS, createKaagaServer } from '../../src/server.js';
import { KaagaApi } from '../../src/api.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallStat } from '../../src/tool.js';
import { connect } from './harness.js';

const TOKEN = `rcl_${'b'.repeat(43)}`;
const memory = { _id: 'm1', text: 'Walks after work', kind: 'pattern', sensitivity: 'open', status: 'active', pinned: false, byUser: false, seenCount: 1, lastSeenDay: '2026-11-19' };
const brief = {
    now: { day: '2026-11-19', weekday: 'Thu', time: '09:00', timezone: 'Asia/Kolkata' },
    profile: null,
    goals: [],
    today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] },
    next: [],
    recent: [],
    recall: { days: 7, finished: 0, weakTopics: [] },
    project: null,
    session: { key: 's_web' },
};

/** What the fake API answers: the buddy's routes in full, anything else an empty success (a tool may still find it too empty). */
function reply(method: string, path: string): unknown {
    if (path === '/api/brief') return brief;
    if (path === '/api/buddy/remember') return { paused: false, notes: [{ status: 'saved', memory }], related: { memories: [], threads: [] }, inMotion: [] };
    if (path === '/api/buddy/update') return { paused: false, outcome: 'seen', memory: { ...memory, seenCount: 2 }, related: { memories: [], threads: [] }, inMotion: [] };
    if (path === '/api/buddy/memories') return [memory];
    if (path.startsWith('/api/buddy/memories/') && path.endsWith('/close')) return { memory: { ...memory, status: 'closed' }, editId: 'e1' };
    // Two tools the web reaches through its runners (TOOL_ACCESS_PLAN §2).
    if (path === '/api/sessions') return { sessions: [], days: [] };
    if (path === '/api/revisions/r1/reschedule') return { item: { title: 'Heaps', cycleNumber: 2 } };
    return method === 'GET' ? [] : {};
}

let api: Server;
let door: Server;
let url: URL;
const apiCalls: string[] = [];
let doorRequests = 0;

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const body = (req: IncomingMessage) => new Promise<string>((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
});

beforeAll(async () => {
    api = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        await body(req);
        const path = new URL(req.url ?? '/', 'http://x').pathname;
        apiCalls.push(`${req.method} ${path}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: reply(req.method ?? 'GET', path) }));
    });
    const apiPort = await listen(api);
    // The backend's router: POST only (stateless), the body parsed, one fresh server per request.
    door = createServer(async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
        if (req.method !== 'POST') {
            res.writeHead(405, { Allow: 'POST' }).end();
            return;
        }
        doorRequests++;
        req.body = JSON.parse((await body(req)) || '{}');
        await handleMcpHttp(req, res, { baseUrl: `http://127.0.0.1:${apiPort}`, token: TOKEN, agentName: 'ChatGPT' });
    });
    url = new URL(`http://127.0.0.1:${await listen(door)}/mcp`);
});

afterAll(async () => {
    await new Promise((r) => door.close(r));
    await new Promise((r) => api.close(r));
});

async function connected(): Promise<Client> {
    const client = new Client({ name: 'remote-door-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    return client;
}

/** Arguments that satisfy each web tool's schema (its required fields). */
const ARGS: Record<string, Record<string, unknown>> = {
    checkpoint: { key: 's_web', title: 'Read about heaps' },
    add_task: { title: 'Book the dentist' },
    update_task: { taskId: 't1', status: 'complete' },
    read_doc: { docId: 'd1' },
    create_doc: { guide: true },
    append_to_doc: { docId: 'd1', markdown: 'More.' },
    get_path: { subject: 'DSA' },
    update_topic: { topicId: 'tp1', status: 'done' },
    schedule_revision: { docId: 'd1' },
    add_pocket_note: { text: 'An idea' },
    complete_revision: { revisionId: 'r1' },
    set_reminder: { at: '2026-11-20T09:00', title: 'Call home' },
    show_on_lock_screen: { text: 'Breathe' },
    cancel_reminder: { reminderId: 'rm1' },
    remember: { text: 'Walks after work', kind: 'pattern' },
    update_memory: { on: 'm1', update: 'done', text: 'Got my steps in today' },
    recall_memory: { query: 'walk' },
    forget: { id: 'm1' },
    search_docs: { query: 'heaps' },
    log_work: { text: 'Fixed the export timeout' },
    update_work_line: { id: 'w1', remove: true },
};

describe('the remote door (POST /mcp, a fresh server per request)', () => {
    it('lists the web set with the three runners, and its instructions', async () => {
        const client = await connected();
        const before = doorRequests;
        const { tools } = await client.listTools();
        expect(doorRequests).toBeGreaterThan(before);
        expect(tools.map((t) => t.name).sort()).toEqual([...WEB_TOOLS, ...RUNNERS].sort());
        expect(client.getInstructions()).toBe(WEB_INSTRUCTIONS);
        await client.close();
    });

    it('every tool it lists can be called, each in its own request; none answers "disabled"', async () => {
        const client = await connected();
        for (const name of WEB_TOOLS) {
            const before = doorRequests;
            const result = await client.callTool({ name, arguments: ARGS[name] ?? {} });
            const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n');
            expect(doorRequests, name).toBe(before + 1);
            expect(text, name).not.toMatch(/disabled|not available in this app|Tool \w+ not found/);
        }
        // The buddy's tools in full: saved, updated, found, forgotten (the last two in later requests).
        const said = await client.callTool({ name: 'remember', arguments: ARGS['remember']! });
        expect((said.content as Array<{ text: string }>)[0]!.text).toBe('Saved: "Walks after work" (pattern) · id m1');
        const progress = await client.callTool({ name: 'update_memory', arguments: ARGS['update_memory']! });
        expect((progress.content as Array<{ text: string }>)[0]!.text).toBe('Noted on "Walks after work" (seen 2×, last 2026-11-19) · id m1');
        const found = await client.callTool({ name: 'recall_memory', arguments: ARGS['recall_memory']! });
        expect((found.content as Array<{ text: string }>)[0]!.text).toContain('"Walks after work" (pattern) · id m1');
        expect(apiCalls).toEqual(expect.arrayContaining(['POST /api/buddy/remember', 'POST /api/buddy/update', 'GET /api/buddy/memories', 'POST /api/buddy/memories/m1/close']));
        await client.close();
        // About 35 requests over real HTTP: alone ~3 s, beside the other files ~6 s (stage 12 made the set 32 tools).
    }, 20_000);

    it('every tool is reachable request after request (TOOL_ACCESS_PLAN §2): found in one request, run in the next', async () => {
        const client = await connected();
        const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as Array<{ text: string }>).map((c) => c.text).join('\n');
        const found = await client.callTool({ name: 'find_tools', arguments: { query: 'how much time did I spend this week' } });
        expect(text(found)).toMatch(/^list_sessions · .* · reads · run with use_read_tool$/m);
        // The next request is a fresh server: nothing had to be turned on.
        const ran = await client.callTool({ name: 'use_read_tool', arguments: { name: 'list_sessions', args: { days: 3 } } });
        expect(ran.isError, text(ran)).toBeFalsy();
        expect(apiCalls).toContain('GET /api/sessions');
        // A changing tool is refused by the reading runner, and runs through use_tool; args may come as a JSON string.
        const refused = await client.callTool({ name: 'use_read_tool', arguments: { name: 'move_revision', args: { revisionId: 'r1', day: '2026-12-01' } } });
        expect(text(refused)).toBe('move_revision changes something: call use_tool with the same name and args.');
        const moved = await client.callTool({ name: 'use_tool', arguments: { name: 'move_revision', args: '{"revisionId":"r1","day":"2026-12-01"}' } });
        expect(moved.isError, text(moved)).toBeFalsy();
        // No such tool, and one the web can't reach: one clear line each, with where to look.
        for (const name of ['more_tools', 'set_folder']) {
            const result = await client.callTool({ name, arguments: {} });
            expect(result.isError, name).toBe(true);
            expect(text(result)).toMatch(new RegExp(`^No tool named "${name}" here\\..*find_tools\\("<the job>"\\) shows what exists\\.$`));
        }
        await client.close();
    });

    it('answers tools/list from memory, the same list the SDK answers; a notification is 202; calls are counted (TOOL_ACCESS_PLAN §6.1, §6.5)', async () => {
        const raw = async (body: unknown) =>
            fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
        const before = doorRequests;
        const cached = (await (await raw({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} })).json()) as { id: number; result: { tools: unknown[] } };
        expect(doorRequests).toBe(before + 1);
        expect(cached.id).toBe(7);
        const sdk = await connect({}, { set: 'web' });
        const { tools } = await sdk.client.listTools();
        await sdk.close();
        expect(cached.result.tools).toEqual(JSON.parse(JSON.stringify(tools)));
        expect((await raw({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
        // The counts: what each call came to, by its path (no user, no arguments).
        const seen: CallStat[] = [];
        const api = new KaagaApi({ baseUrl: 'http://127.0.0.1:9', token: TOKEN, agentName: 'ChatGPT', retryDelayMs: 0, log: () => {} });
        const server = createKaagaServer({ api, agentName: 'ChatGPT', set: 'web', onCall: (c) => seen.push(c) });
        const client = new Client({ name: 'count', version: '1' });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await Promise.all([server.connect(b), client.connect(a)]);
        await client.callTool({ name: 'find_tools', arguments: { query: 'zzqx' } });
        await client.callTool({ name: 'use_tool', arguments: { name: 'move_revision', args: { revisionId: 'r1', day: 'Friday' } } });
        await client.callTool({ name: 'use_tool', arguments: { name: 'trash', args: {} } });
        await client.close();
        expect(seen.map(({ tool, via, outcome }) => [tool, via, outcome])).toEqual([
            ['find_tools', 'direct', 'no_match'],
            ['move_revision', 'use_tool', 'bad_args'],
            ['trash', 'use_tool', 'unknown_tool'],
        ]);
    });
});
