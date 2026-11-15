// The catalogue inside another program: the backend's Ask AI manager (MANAGER_AND_DOCS_PLAN §3.4)
// loads this file and gets the same server and tools an outside chat gets, every group listed, over
// an in-memory transport. No second tool set exists anywhere: the manager calls exactly these, with
// their levels (TOOL_LEVELS), through the same API, token rules and edit log.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RecollectApi } from './api.js';
import { createRecollectServer, TOOL_GROUP_NAMES, TOOL_LEVELS, type ToolName } from './server.js';

export interface CatalogueTool {
    name: string;
    title: string;
    description: string;
    /** JSON Schema of the input (as tools/list gives it, without "$schema"). */
    inputSchema: Record<string, unknown>;
    /** 1 reads, 2 changes with an Undo, 3 only asks for Ramin's tap. */
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
}

/**
 * Remote MCP (ALWAYS_ON_SPEC 6.5): one Streamable HTTP request, stateless. A fresh server per request
 * on the caller's own token, so the API's token rules, scopes and edit log apply exactly as for the
 * stdio server. The default tool groups are listed, with more_tools for the rest (as on stdio).
 */
export async function handleMcpHttp(
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
    options: CatalogueOptions,
): Promise<void> {
    const api = new RecollectApi({ baseUrl: options.baseUrl, token: options.token, agentName: options.agentName, timeoutMs: options.timeoutMs ?? 30_000, log: () => {} });
    const server = createRecollectServer({ api, agentName: options.agentName, problem: null });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
        void transport.close();
        void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
}

export async function openCatalogue(options: CatalogueOptions): Promise<Catalogue> {
    const api = new RecollectApi({ baseUrl: options.baseUrl, token: options.token, agentName: options.agentName, timeoutMs: options.timeoutMs ?? 30_000, log: () => {} });
    const server = createRecollectServer({ api, agentName: options.agentName, problem: null, groups: TOOL_GROUP_NAMES });
    const client = new Client({ name: 'recollect-manager', version: '1.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const { tools } = await client.listTools();
    return {
        // Every group is on already: more_tools has nothing to add for the manager.
        tools: tools
            .filter((t) => t.name !== 'more_tools')
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
