// One place that turns a tool's `run` into an MCP tool: text in, compact text out, every error as
// a plain message with isError: true (never a thrown protocol error the agent can't read).
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { KaagaApi } from './api.js';
import { describeError } from './errors.js';

export interface ToolContext {
    api: KaagaApi;
    /** A setup problem (no token, bad URL): every tool answers with it instead of calling the API. */
    problem: string | null;
    /** Every tool registered, by name (the server turns groups on and off with it). */
    registry?: Map<string, RegisteredTool>;
    /** A work folder (hooks.json brief: false): the brief leaves out his goals, profile and the buddy. */
    workMode?: boolean;
    /** In a work folder: its project key (get_work_log answers for it alone). */
    workProject?: string;
    /** B10: the folder's project when Kaaga's hooks act in it (log_work reads the hook's clock). */
    clockProject?: string;
    /** MCP_MEMORY_PLAN §4.9: Claude Code's folder, sent with remember and update_memory. */
    project?: string;
    /** MCP_MEMORY_PLAN §4.1: the door's tool set (the web's get_brief is the small buddy brief). */
    set?: 'web' | 'code' | 'office' | 'excluded' | 'all';
    /** EASY_SETUP_PLAN: the folder this chat runs in (set_folder's default); isNew: nobody has said what it is yet. */
    folder?: { key: string; name: string; isNew?: boolean };
    /** EASY_SETUP_PLAN §7: what a chat without hooks said it is, until its next checkpoint carries it. */
    chats?: import('./tools/folders.js').ChatMemory;
    /** EASY_SETUP_PLAN §7: on their own word, this chat moves to the full set (theirs) or a work folder's (work). */
    switchSet?: (to: 'code' | 'office') => boolean;
    /** TOOL_ACCESS_PLAN §2: what this door lists and what a call may run (find_tools adds to `listed` on code). */
    policy?: DoorPolicy;
    /** Every tool this door can reach, as tools/list shows it, with its level (find_tools' catalogue). */
    catalogue?: () => Promise<CatalogueEntry[]>;
    /** A call as a host makes it (the door's checks, the inputs, the trace): use_tool and use_read_tool run through it. */
    callTool?: (name: string, args: Record<string, unknown>, extra: unknown, via: Via) => Promise<CallToolResult>;
    /** The listed tools changed: the client is told (it lists again). */
    listChanged?: () => void;
}

/** TOOL_ACCESS_PLAN §2: listed (tools/list) and reachable (what a call may run) are two things. */
export interface DoorPolicy {
    listed: Set<string>;
    reachable: Set<string>;
}

/** How a call arrived: by its own name, or through a runner. */
export type Via = 'direct' | 'use_tool' | 'use_read_tool';

export interface CatalogueEntry {
    name: string;
    title: string;
    description: string;
    /** JSON Schema of the input, as tools/list gives it. */
    inputSchema: Record<string, unknown>;
    level: 1 | 2 | 3;
}

// Each tool's card (TOOL_ACCESS_PLAN §4.1) lives in cards.ts, one record by tool name: the type makes it required.
export interface ToolSpec<S extends z.ZodRawShape> {
    title: string;
    description: string;
    input: S;
    annotations: ToolAnnotations;
}

/** Reads only. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
/** Adds something (the user can undo it). */
export const ADDS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Changes or replaces existing content (the user can undo it). */
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
    // The title once, at the top (the protocol's display name since 2025-06-18; clients fall back to annotations.title
    // only without it): the copy in the annotations cost about 30 characters a tool of both tool budgets (stage 13).
    const handle = server.registerTool(
        name,
        { title: spec.title, description: spec.description, inputSchema, annotations: { ...spec.annotations } },
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
