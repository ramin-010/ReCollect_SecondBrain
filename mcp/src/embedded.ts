// The catalogue inside another program: the backend's Ask AI manager (MANAGER_AND_DOCS_PLAN §3.4)
// loads this file and gets the same server and tools an outside chat gets, every group listed, over
// an in-memory transport. No second tool set exists anywhere: the manager calls exactly these, with
// their levels (TOOL_LEVELS), through the same API, token rules and edit log.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { KaagaApi } from './api.js';
import { createKaagaServer, TOOL_LEVELS, type ToolName } from './server.js';
import type { CallStat } from './tool.js';

export interface CatalogueTool {
    name: string;
    title: string;
    description: string;
    /** JSON Schema of the input (as tools/list gives it, without "$schema"). */
    inputSchema: Record<string, unknown>;
    /** 1 reads, 2 changes with an Undo, 3 only asks for the user's tap. */
    level: 1 | 2 | 3;
}

export interface Catalogue {
    tools: CatalogueTool[];
    call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
    close(): Promise<void>;
}

export interface CatalogueOptions {
    /** The API this process serves, e.g. http://localhost:8002. */
    baseUrl: string;
    token: string;
    /** Every write is logged under this name ("Ask AI"). */
    agentName: string;
    timeoutMs?: number;
    /** Stage 5's connector simulation: each tool call on the remote door (off unless the backend passes it). */
    trace?: (call: { tool: string; args: unknown; answer?: string }) => void;
    /** TOOL_ACCESS_PLAN §6.5: each call's tool, path, outcome and time, for the counts. */
    onCall?: (call: CallStat) => void;
}

/**
 * TOOL_ACCESS_PLAN §6.1: the web's tools/list never changes while the process runs, so it is answered from memory:
 * built once, by the same handler a fresh server would run (byte for byte the SDK's answer; a test compares them).
 */
let webList: Promise<unknown> | null = null;
function cachedWebList(): Promise<unknown> {
    webList ??= (async () => {
        const api = new KaagaApi({ baseUrl: 'http://localhost:1', token: `rcl_${'x'.repeat(43)}`, agentName: 'list', log: () => {} });
        const server = createKaagaServer({ api, agentName: 'list', problem: null, set: 'web' });
        const handlers = (server.server as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>> })._requestHandlers;
        const result = await handlers.get('tools/list')!({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} }, {});
        await server.close();
        return result;
    })().catch((err: unknown) => {
        webList = null;
        throw err;
    });
    return webList;
}

type RpcBody = { jsonrpc?: unknown; id?: unknown; method?: unknown };

/** The answer for a body that needs no server: a single tools/list (from memory), or a notification (202). */
export async function quickAnswer(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<boolean> {
    const body = req.body as RpcBody | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') return false;
    // The SDK's transport asks for both types in Accept; a client that doesn't send them gets the SDK's own answer.
    const accept = String(req.headers['accept'] ?? '');
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return false;
    if (body.id === undefined && body.method.startsWith('notifications/')) {
        res.writeHead(202).end();
        return true;
    }
    if (body.method === 'tools/list' && (typeof body.id === 'string' || typeof body.id === 'number')) {
        const result = await cachedWebList();
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result, jsonrpc: '2.0', id: body.id }));
        return true;
    }
    return false;
}

/**
 * Remote MCP (ALWAYS_ON_SPEC 6.5): one Streamable HTTP request, stateless. A fresh server per request
 * on the caller's own token, so the API's token rules, scopes and edit log apply exactly as for the
 * stdio server. It lists the `web` set (MCP_MEMORY_PLAN §4.1) and reaches the rest through find_tools, use_read_tool
 * and use_tool (TOOL_ACCESS_PLAN §3): nothing turned on in one request could last to the next.
 */
export async function handleMcpHttp(
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
    options: CatalogueOptions,
): Promise<void> {
    if (await quickAnswer(req, res)) return;
    const api = new KaagaApi({ baseUrl: options.baseUrl, token: options.token, agentName: options.agentName, timeoutMs: options.timeoutMs ?? 30_000, log: () => {} });
    const server = createKaagaServer({ api, agentName: options.agentName, problem: null, set: 'web', ...(options.trace ? { trace: options.trace } : {}), ...(options.onCall ? { onCall: options.onCall } : {}) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
        void transport.close();
        void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
}

export async function openCatalogue(options: CatalogueOptions): Promise<Catalogue> {
    const api = new KaagaApi({ baseUrl: options.baseUrl, token: options.token, agentName: options.agentName, timeoutMs: options.timeoutMs ?? 30_000, log: () => {} });
    const server = createKaagaServer({ api, agentName: options.agentName, problem: null, set: 'all' });
    const client = new Client({ name: 'kaaga-manager', version: '1.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const { tools } = await client.listTools();
    return {
        // Every tool is listed for the manager (the `all` door): it needs no runner.
        tools: tools
            .map((t) => ({
                name: t.name,
                title: t.title ?? t.name,
                description: t.description ?? '',
                inputSchema: t.inputSchema as Record<string, unknown>,
                level: TOOL_LEVELS[t.name as ToolName] ?? 2,
            })),
        async call(name, args) {
            const result = await client.callTool({ name, arguments: args });
            const content = result.content as Array<{ type: string; text?: string }>;
            return { text: content.map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`)).join('\n'), isError: result.isError === true };
        },
        async close() {
            await client.close();
            await server.close();
        },
    };
}
