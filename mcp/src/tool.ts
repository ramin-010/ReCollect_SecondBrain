// One place that turns a tool's `run` into an MCP tool: text in, compact text out, every error as
// a plain message with isError: true (never a thrown protocol error the agent can't read).
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { RecollectApi } from './api.js';
import { describeError } from './errors.js';

export interface ToolContext {
    api: RecollectApi;
    /** A setup problem (no token, bad URL): every tool answers with it instead of calling the API. */
    problem: string | null;
    /** Every tool registered, by name (the server turns groups on and off with it). */
    registry?: Map<string, RegisteredTool>;
    /** A work folder (hooks.json brief: false): the brief leaves out his goals, profile and the buddy. */
    workMode?: boolean;
    /** In a work folder: its project key (get_work_log answers for it alone). */
    workProject?: string;
    /** B10: the folder's project when Recollect's hooks act in it (log_work reads the hook's clock). */
    clockProject?: string;
}

export interface ToolSpec<S extends z.ZodRawShape> {
    title: string;
    description: string;
    input: S;
    annotations: ToolAnnotations;
}

/** Reads only. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
/** Adds something (Ramin can undo it). */
export const ADDS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Changes or replaces existing content (Ramin can undo it). */
export const CHANGES: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export const textResult = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });
export const errorResult = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });

/** A tool's answer: text, or content blocks (an image with its text, for preview_diagram). */
export type ToolAnswer = string | CallToolResult;

export function defineTool<S extends z.ZodRawShape>(
    server: McpServer,
    ctx: ToolContext,
    name: string,
    spec: ToolSpec<S>,
    run: (args: z.output<z.ZodObject<S>>) => Promise<ToolAnswer>
): void {
    // The SDK validates the arguments against this shape before the callback runs.
    const inputSchema: ZodRawShapeCompat = spec.input;
    const handle = server.registerTool(
        name,
        { title: spec.title, description: spec.description, inputSchema, annotations: { title: spec.title, ...spec.annotations } },
        async (args: unknown): Promise<CallToolResult> => {
            if (ctx.problem) return errorResult(ctx.problem);
            try {
                const answer = await run(args as z.output<z.ZodObject<S>>);
                return typeof answer === 'string' ? textResult(answer) : answer;
            } catch (err) {
                return errorResult(describeError(err, ctx.api.baseUrl));
            }
        }
    );
    ctx.registry?.set(name, handle);
}
