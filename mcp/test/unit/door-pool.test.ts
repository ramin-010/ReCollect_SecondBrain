// TOOL_ACCESS_PLAN §6.6 (1): the web door reuses built servers. Nothing of one request may reach another: each call
// to the API carries its own request's token and agent name, a cache keyed by the client (the time zone) stays the
// person's own, many requests at once each keep theirs, and a request its client left drops its server.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMcpHttp, idleServers } from '../../src/embedded.js';

const ANA = `rcl_${'a'.repeat(43)}`;
const BEN = `rcl_${'b'.repeat(43)}`;
const SLOW = `rcl_${'s'.repeat(43)}`;
const ZONE: Record<string, string> = { [ANA]: 'Asia/Kolkata', [BEN]: 'Europe/London', [SLOW]: 'America/New_York' };

let api: Server;
let door: Server;
let url: URL;
/** Every API call: its path, the token and the agent name it carried. */
const calls: Array<{ path: string; token: string; agent: string }> = [];

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => resolve(raw));
    });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
    api = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        await read(req);
        const path = new URL(req.url ?? '/', 'http://x').pathname;
        const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        calls.push({ path, token, agent: String(req.headers['x-agent-name'] ?? '') });
        if (token === SLOW) await wait(400);
        const data =
            path === '/api/learning/settings'
                ? { timezone: ZONE[token] ?? 'UTC' }
                : path === '/api/agent/edits'
                  ? [{ _id: 'e1', summary: 'Added a note', agentName: 'Claude', createdAt: '2026-11-27T04:00:00.000Z', docId: null, undoneAt: null, seenAt: null }]
                  : {};
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true, data }));
    });
    const apiPort = await listen(api);
    // The backend's router, with the token and the agent's name from each request.
    door = createServer(async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
        req.body = JSON.parse((await read(req)) || '{}');
        await handleMcpHttp(req, res, {
            baseUrl: `http://127.0.0.1:${apiPort}`,
            token: String(req.headers['x-test-token']),
            agentName: String(req.headers['x-test-agent'] ?? 'ChatGPT'),
        });
    });
    url = new URL(`http://127.0.0.1:${await listen(door)}/mcp`);
});

afterAll(async () => {
    await new Promise((r) => door.close(r));
    await new Promise((r) => api.close(r));
});

async function clientFor(token: string, agent: string): Promise<Client> {
    const client = new Client({ name: 'pool-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { 'x-test-token': token, 'x-test-agent': agent } } }));
    return client;
}

async function edits(client: Client): Promise<string> {
    const res = await client.callTool({ name: 'use_read_tool', arguments: { name: 'recent_agent_edits', args: {} } });
    return (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
}

describe('the web door reuses its servers (TOOL_ACCESS_PLAN §6.6)', () => {
    it("one after another: a reused server carries the second person's token, agent and time zone", async () => {
        const ana = await clientFor(ANA, 'ChatGPT');
        const ben = await clientFor(BEN, 'Claude');
        calls.length = 0;
        const first = await edits(ana);
        await wait(50);
        expect(idleServers()).toBeGreaterThanOrEqual(1);
        const second = await edits(ben);
        expect(first).toContain('times in Asia/Kolkata');
        expect(first).toContain('by Claude');
        expect(second).toContain('times in Europe/London');
        // Ben's agent is Claude: its own edit has no "by".
        expect(second).not.toContain('by Claude');
        expect(calls.filter((c) => c.token === ANA).every((c) => c.agent === 'ChatGPT')).toBe(true);
        expect(calls.filter((c) => c.token === BEN).every((c) => c.agent === 'Claude')).toBe(true);
        expect(calls.filter((c) => c.token === BEN)).toHaveLength(2);
        await Promise.all([ana.close(), ben.close()]);
    });

    it('many at once: each answer is its own', async () => {
        const ana = await clientFor(ANA, 'ChatGPT');
        const ben = await clientFor(BEN, 'Claude');
        const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => edits(i % 2 ? ben : ana).then((text) => ({ i, text }))));
        for (const { i, text } of answers) expect(text).toContain(i % 2 ? 'times in Europe/London' : 'times in Asia/Kolkata');
        await Promise.all([ana.close(), ben.close()]);
        await wait(50);
        expect(idleServers()).toBeLessThanOrEqual(32);
    });

    it('a request its client left keeps its own token to the end, and its server is not reused', async () => {
        const ben = await clientFor(BEN, 'Claude');
        await edits(ben);
        await wait(50);
        const before = idleServers();
        calls.length = 0;
        const gone = new AbortController();
        const left = fetch(url, {
            method: 'POST',
            signal: gone.signal,
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-test-token': SLOW, 'x-test-agent': 'Cursor' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'use_read_tool', arguments: { name: 'recent_agent_edits', args: {} } } }),
        }).catch(() => 'aborted');
        await wait(100);
        gone.abort();
        expect(await left).toBe('aborted');
        // Meanwhile someone else's call runs on whatever server is free.
        expect(await edits(ben)).toContain('times in Europe/London');
        await wait(1000);
        // The slow request's calls all carried its own token and agent.
        const slow = calls.filter((c) => c.token === SLOW);
        expect(slow.length).toBeGreaterThanOrEqual(1);
        expect(slow.every((c) => c.agent === 'Cursor')).toBe(true);
        expect(calls.filter((c) => c.agent === 'Cursor').every((c) => c.token === SLOW)).toBe(true);
        // Its server was dropped: no more idle than before (Ben's own came back).
        expect(idleServers()).toBeLessThanOrEqual(before);
        await ben.close();
    });
});
