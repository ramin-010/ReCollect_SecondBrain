// The MCP server: every tool, wired to one API client. No transport here (index.ts adds stdio;
// tests connect an in-memory client).
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ListToolsRequestSchema, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { RecollectApi } from './api.js';
import { registerPrompts } from './prompts.js';
import { READ_ONLY, defineTool, type ToolContext } from './tool.js';
import { registerContextTools } from './tools/context.js';
import { registerDayTools } from './tools/day.js';
import { registerDocTools } from './tools/docs.js';
import { registerEditTools } from './tools/edits.js';
import { registerGoalTools } from './tools/goals.js';
import { registerPathTools } from './tools/paths.js';
import { registerRecordTools } from './tools/record.js';
import { registerWeekTools } from './tools/week.js';
import { registerMirrorTools } from './tools/mirror.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerDecisionTools } from './tools/decisions.js';
import { registerRevisionTools } from './tools/revision.js';
import { registerSubjectTools } from './tools/subjects.js';
import { registerManageTools } from './tools/manage.js';
import { registerBlockTools } from './tools/blocks.js';

export const SERVER_NAME = 'recollect';
export const SERVER_VERSION = '0.1.0';

export const INSTRUCTIONS = [
    "Recollect is Ramin's personal learning app and the record of his work: Docs (his notes, in Markdown), subjects with paths (topics in course order), spaced revision (reviews 1, 3, 7 and 21 days after a doc is scheduled), goals with dated milestones, a week of up to 5 targets, up to 3 focus lines a day, personal tasks, and work sessions.",
    'Start a working chat with get_brief (where he stands, and a session key), then checkpoint as you go: after each part, not only at the end. search_docs before writing a doc. Plan the week with get_week and add_week_target on his yes; when something is his call and he cannot say yes in the chat, suggest it instead.',
    'Every write is logged with your agent name and Ramin can undo it from Home → From your agent. Docs, goals and subjects are never deleted; a focus line or a milestone can be removed (and Undo brings it back). Answers are compact text with the ids the next call needs.',
    'Docs take GitHub Markdown plus callouts (> [!TIP]), <details> toggles for self-test questions, ```mermaid diagrams and ```canvas diagrams (Mermaid flowchart text that Recollect lays out as a board Ramin can edit; add_canvas draws one, update_canvas changes one in place, preview_diagram shows it): see create_doc.',
].join(' ');

/** Every tool, in the order they are listed. */
export const TOOL_NAMES = [
    'get_brief',
    'checkpoint',
    'list_sessions',
    'get_week',
    'add_week_target',
    'update_week_target',
    'suggest',
    'get_mirror',
    'list_tasks',
    'add_task',
    'update_task',
    'log_decision',
    'list_decisions',
    'get_today',
    'get_learning_overview',
    'search_docs',
    'read_doc',
    'create_doc',
    'update_doc',
    'append_to_doc',
    'replace_section',
    'add_canvas',
    'update_canvas',
    'preview_diagram',
    'list_subjects',
    'create_subject',
    'get_path',
    'plan_topics',
    'update_topic',
    'schedule_revision',
    'list_due',
    'list_goals',
    'create_goal',
    'update_goal',
    'add_milestone',
    'complete_milestone',
    'update_milestone',
    'remove_milestone',
    'add_focus',
    'update_focus',
    'remove_focus',
    'add_pocket_note',
    'recent_agent_edits',
    'more_tools',
    // The "manage" group (MANAGER_AND_DOCS_PLAN §3.3): not listed until more_tools (or
    // RECOLLECT_TOOLS=all); the in-app manager always has it.
    'trash_doc',
    'restore_doc',
    'empty_trash',
    'complete_revision',
    'move_revision',
    'get_settings',
    'update_settings',
    'update_project',
    'list_suggestions',
    'set_reminder',
    'list_reminders',
    'cancel_reminder',
    'get_recall',
    'get_sharing',
    'publish_doc',
    'share_doc',
    'spread_backlog',
    // Block tools (DOCS_EDITOR_V2_PLAN phase 3): the new editor's blocks by id; manage until the switch.
    'get_outline',
    'insert_blocks',
    'update_block',
    'move_blocks',
    'delete_blocks',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Each tool's level (MANAGER_AND_DOCS_PLAN §3.2), the same for every caller: 1 reads; 2 changes at
 * once, logged with an Undo; 3 can't be undone or leaves the app, so the tool only asks and Ramin's
 * tap on Home does it (POST /api/actions). catalogue.test.ts checks each tool has one and that the
 * read-only ones are level 1.
 */
export const TOOL_LEVELS: Readonly<Record<ToolName, 1 | 2 | 3>> = {
    get_brief: 1,
    checkpoint: 2,
    list_sessions: 1,
    get_week: 1,
    add_week_target: 2,
    update_week_target: 2,
    suggest: 2,
    get_mirror: 1,
    list_tasks: 1,
    add_task: 2,
    update_task: 2,
    log_decision: 2,
    list_decisions: 1,
    get_today: 1,
    get_learning_overview: 1,
    search_docs: 1,
    read_doc: 1,
    create_doc: 2,
    update_doc: 2,
    append_to_doc: 2,
    replace_section: 2,
    add_canvas: 2,
    update_canvas: 2,
    preview_diagram: 1,
    list_subjects: 1,
    create_subject: 2,
    get_path: 1,
    plan_topics: 2,
    update_topic: 2,
    schedule_revision: 2,
    list_due: 1,
    list_goals: 1,
    create_goal: 2,
    update_goal: 2,
    add_milestone: 2,
    complete_milestone: 2,
    update_milestone: 2,
    remove_milestone: 2,
    add_focus: 2,
    update_focus: 2,
    remove_focus: 2,
    add_pocket_note: 2,
    recent_agent_edits: 1,
    more_tools: 1,
    trash_doc: 2,
    restore_doc: 2,
    empty_trash: 3,
    complete_revision: 2,
    move_revision: 2,
    get_settings: 1,
    update_settings: 2,
    update_project: 2,
    list_suggestions: 1,
    set_reminder: 2,
    list_reminders: 1,
    cancel_reminder: 2,
    get_recall: 1,
    get_sharing: 1,
    // Sharing leaves the app: both only ask (the publish_doc and share_doc actions).
    publish_doc: 3,
    share_doc: 3,
    // Changes at once (Undo); more than 20 overdue reviews in one go only asks (the spread_backlog action).
    spread_backlog: 2,
    get_outline: 1,
    insert_blocks: 2,
    update_block: 2,
    move_blocks: 2,
    delete_blocks: 2,
};

export const TOOL_GROUP_NAMES = ['core', 'docs', 'plan', 'record', 'manage'] as const;
export type ToolGroup = (typeof TOOL_GROUP_NAMES)[number];
/** What an outside chat lists by default (the catalogue budget holds for these). */
export const DEFAULT_GROUPS: readonly ToolGroup[] = ['core', 'docs', 'plan', 'record'];

/** Each tool's group (the manager gets them all; outside chats DEFAULT_GROUPS, more on request). */
export const TOOL_GROUPS: Readonly<Record<ToolName, ToolGroup>> = {
    get_brief: 'core',
    checkpoint: 'core',
    list_sessions: 'core',
    suggest: 'core',
    get_today: 'core',
    get_learning_overview: 'core',
    add_pocket_note: 'core',
    recent_agent_edits: 'core',
    more_tools: 'core',
    search_docs: 'docs',
    read_doc: 'docs',
    create_doc: 'docs',
    update_doc: 'docs',
    append_to_doc: 'docs',
    replace_section: 'docs',
    add_canvas: 'docs',
    update_canvas: 'docs',
    preview_diagram: 'docs',
    get_week: 'plan',
    add_week_target: 'plan',
    update_week_target: 'plan',
    list_tasks: 'plan',
    add_task: 'plan',
    update_task: 'plan',
    list_subjects: 'plan',
    create_subject: 'plan',
    get_path: 'plan',
    plan_topics: 'plan',
    update_topic: 'plan',
    schedule_revision: 'plan',
    list_due: 'plan',
    list_goals: 'plan',
    create_goal: 'plan',
    update_goal: 'plan',
    add_milestone: 'manage',
    complete_milestone: 'manage',
    update_milestone: 'manage',
    remove_milestone: 'manage',
    add_focus: 'plan',
    update_focus: 'manage',
    remove_focus: 'manage',
    get_mirror: 'record',
    log_decision: 'record',
    list_decisions: 'record',
    trash_doc: 'manage',
    restore_doc: 'manage',
    empty_trash: 'manage',
    complete_revision: 'manage',
    move_revision: 'manage',
    get_settings: 'manage',
    update_settings: 'manage',
    update_project: 'manage',
    list_suggestions: 'manage',
    set_reminder: 'manage',
    list_reminders: 'manage',
    cancel_reminder: 'manage',
    get_recall: 'manage',
    get_sharing: 'manage',
    publish_doc: 'manage',
    share_doc: 'manage',
    spread_backlog: 'manage',
    // Since the switch (2026-11-15) every doc is on the new editor: its block tools are listed with the
    // docs (move_blocks, rarer, on more_tools). To keep the default set under its 40,000-character
    // budget, the milestone and focus edits moved to manage (the in-app manager has every tool).
    get_outline: 'docs',
    insert_blocks: 'docs',
    update_block: 'docs',
    move_blocks: 'manage',
    delete_blocks: 'docs',
};

/** RECOLLECT_TOOLS: "all", or groups separated by commas ("core,docs,manage"); else the default. */
export function groupsFrom(value: string | undefined): ToolGroup[] {
    const raw = (value ?? '').trim().toLowerCase();
    if (raw === 'all') return [...TOOL_GROUP_NAMES];
    const picked = raw.split(/[\s,]+/).filter((g): g is ToolGroup => (TOOL_GROUP_NAMES as readonly string[]).includes(g));
    return picked.length > 0 ? [...new Set<ToolGroup>(['core', ...picked])] : [...DEFAULT_GROUPS];
}

export interface ServerOptions {
    api: RecollectApi;
    agentName: string;
    /** A setup problem every tool reports instead of calling the API (no token, bad URL). */
    problem?: string | null;
    /** Pocket note ids (tests pass a fixed one). */
    newId?: () => string;
    /** The tool groups listed from the start (default DEFAULT_GROUPS; the manager passes them all). */
    groups?: readonly ToolGroup[];
}

export function createRecollectServer(options: ServerOptions): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    const registry = new Map<string, RegisteredTool>();
    const ctx: ToolContext = { api: options.api, problem: options.problem ?? null, registry };
    registerRecordTools(server, ctx);
    registerWeekTools(server, ctx);
    registerMirrorTools(server, ctx);
    registerTaskTools(server, ctx);
    registerDecisionTools(server, ctx);
    registerContextTools(server, ctx);
    registerDocTools(server, ctx);
    registerSubjectTools(server, ctx);
    registerPathTools(server, ctx);
    registerRevisionTools(server, ctx);
    registerGoalTools(server, ctx);
    registerDayTools(server, ctx, options.newId);
    registerEditTools(server, ctx, options.agentName);
    registerMoreTools(server, ctx, registry);
    registerManageTools(server, ctx);
    registerBlockTools(server, ctx);
    registerPrompts(server);
    leanToolList(server);
    const listed = new Set(options.groups ?? DEFAULT_GROUPS);
    for (const [name, tool] of registry) if (!listed.has(TOOL_GROUPS[name as ToolName])) tool.disable();
    return server;
}

/** more_tools: turns a group on for this chat (the client is told the list changed). */
function registerMoreTools(server: McpServer, ctx: ToolContext, registry: Map<string, RegisteredTool>): void {
    defineTool(
        server,
        ctx,
        'more_tools',
        {
            title: 'More tools',
            description: "Turn on the manage tools: the trash, mark a review done or move it, settings, projects, what waits for Ramin's tap.",
            input: { group: z.enum(['manage']).optional() },
            annotations: READ_ONLY,
        },
        async ({ group }) => {
            const wanted = group ?? 'manage';
            const names = [...registry.keys()].filter((n) => TOOL_GROUPS[n as ToolName] === wanted);
            for (const n of names) registry.get(n)!.enable();
            return `Turned on: ${names.join(', ')}. They are in your tool list now.`;
        }
    );
}

/**
 * Every chat loads the tool list, so it carries nothing the model doesn't use: the SDK's JSON Schema
 * says `"$schema": "http://json-schema.org/draft-07/schema#"` in every tool (about 2,000 characters
 * over the catalogue). The SDK's own handler builds the list; this wraps it and drops that line
 * (catalogue.test.ts holds the whole list to its budget).
 */
function leanToolList(server: McpServer): void {
    const handlers = (server.server as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<ListToolsResult>> })._requestHandlers;
    const original = handlers.get('tools/list');
    if (!original) return;
    server.server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
        const result = await original(req, extra);
        return { ...result, tools: result.tools.map((t) => ({ ...t, inputSchema: Object.fromEntries(Object.entries(t.inputSchema).filter(([k]) => k !== '$schema')) as typeof t.inputSchema })) };
    });
}
