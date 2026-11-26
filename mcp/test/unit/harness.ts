// Test harness: the real MCP server, a real MCP client over an in-memory transport, and a fake
// fetch that answers from a route table and records every request.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KaagaApi } from '../../src/api.js';
import { createKaagaServer, type ToolGroup, type ToolSet } from '../../src/server.js';

export const BASE = 'http://kaaga.test';
export const TOKEN = `rcl_${'a'.repeat(43)}`;
export const NOTE_ID = '11111111-2222-4333-8444-555555555555';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface Recorded {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** `data` is wrapped as { success: true, data }; `body` is sent as is (errors). */
export type Reply = { status?: number; data?: unknown; body?: unknown; headers?: Record<string, string> } | Error;
/** One reply, replies in turn (the last repeats), or a function of the request and its count. */
export type Route = Reply | Reply[] | ((req: Recorded, n: number) => Reply);
/** Keys: "GET /api/today"; a trailing * matches any rest of the path. */
export type Routes = Record<string, Route>;

export const ok = (data: unknown, status = 200): Reply => ({ status, data });
export const fail = (status: number, message: string, code?: string): Reply => ({ status, body: code ? { message, code } : { message } });

export function fakeFetch(routes: Routes) {
    const requests: Recorded[] = [];
    const counts = new Map<string, number>();
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));
        const method = (init?.method ?? 'GET').toUpperCase();
        const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        const req: Recorded = { method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body };
        requests.push(req);

        const key = `${method} ${url.pathname}`;
        const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
        if (route === undefined) return new Response(JSON.stringify({ message: `No mock for ${key}` }), { status: 599 });
        const n = counts.get(key) ?? 0;
        counts.set(key, n + 1);
        const reply = typeof route === 'function' ? route(req, n) : Array.isArray(route) ? route[Math.min(n, route.length - 1)]! : route;
        if (reply instanceof Error) throw reply;
        // A string body goes out as raw text (an HTML error page); anything else as JSON.
        if (typeof reply.body === 'string') return new Response(reply.body, { status: reply.status ?? 200, headers: { 'content-type': 'text/html', ...reply.headers } });
        const payload = reply.body !== undefined ? reply.body : { success: true, data: reply.data ?? null };
        return new Response(JSON.stringify(payload), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers } });
    };
    return { fetch: fetch as typeof globalThis.fetch, requests };
}

/** A network failure as Node's fetch reports it. */
export function refused(): Error {
    return new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8002'), { code: 'ECONNREFUSED' }) });
}

export interface Harness {
    requests: Recorded[];
    logs: string[];
    call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
    client: Client;
    close(): Promise<void>;
}

export async function connect(
    routes: Routes,
    options: { problem?: string | null; groups?: readonly ToolGroup[]; set?: ToolSet; workMode?: boolean; workProject?: string; clockProject?: string; folder?: { key: string; name: string; isNew?: boolean } } = {}
): Promise<Harness> {
    const { fetch, requests } = fakeFetch(routes);
    const logs: string[] = [];
    const api = new KaagaApi({
        baseUrl: BASE,
        token: TOKEN,
        agentName: 'Claude Code',
        fetch,
        retryDelayMs: 0,
        runningDelayMs: 0,
        log: (m) => logs.push(m),
    });
    const server = createKaagaServer({
        api,
        agentName: 'Claude Code',
        problem: options.problem ?? null,
        newId: () => NOTE_ID,
        ...(options.groups ? { groups: options.groups } : {}),
        ...(options.set ? { set: options.set } : {}),
        ...(options.workMode ? { workMode: true } : {}),
        ...(options.workProject ? { workProject: options.workProject } : {}),
        ...(options.clockProject ? { clockProject: options.clockProject } : {}),
        ...(options.folder ? { folder: options.folder } : {}),
    });
    const client = new Client({ name: 'unit-test', version: '1.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return {
        requests,
        logs,
        client,
        async call(name, args = {}) {
            const result = await client.callTool({ name, arguments: args });
            const content = result.content as Array<{ type: string; text?: string }>;
            return { text: content.map((c) => c.text ?? '').join('\n'), isError: result.isError === true };
        },
        async close() {
            await client.close();
            await server.close();
        },
    };
}

export const UNDO = 'Undo: the user can undo this from Home → From your agent.';

/** The last line of a tool answer. */
export const lastLine = (text: string): string => text.trimEnd().split('\n').at(-1) ?? '';
