// The MCP server: every tool, wired to one API client. No transport here (index.ts adds stdio;
// tests connect an in-memory client).
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { RecollectApi } from './api.js';
import { registerPrompts } from './prompts.js';
import { READ_ONLY, defineTool, errorResult, type ToolContext } from './tool.js';
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
import { registerBuddyTools } from './tools/buddy.js';
import { newChatMemory, registerFolderTools } from './tools/folders.js';
import { registerStudyTools } from './tools/study.js';

export const SERVER_NAME = 'recollect';
export const SERVER_VERSION = '0.1.0';

/** Claude Code's instructions (the `code` set) and Ask AI's (`all`). */
export const INSTRUCTIONS = [
    "Recollect is the user's personal learning app and the record of their work: Docs (their notes, in Markdown), subjects with paths (topics in course order), spaced revision (reviews 1, 3, 7 and 21 days after a doc is scheduled), goals with dated milestones, a week of up to 5 targets, up to 3 focus lines a day, personal tasks, and work sessions. Their buddy there follows what is going on in their life.",
    'Start a working chat with get_brief (where they stand, and a session key), then checkpoint as you go: after each part, not only at the end. Pass on quietly, without asking or mentioning it, what the user says about their own life that will still matter after this conversation: something new about them (remember), or progress, a change or an end on something their buddy already knows (update_memory, with its id); a reminder or a dated to-do of their own (set_reminder, add_task); an idea or insight (add_pocket_note). Most turns have nothing. Before you rely on their routine, plans or preferences, look them up with recall_memory. When they ask to log the day’s work, use log_work. search_docs before writing a doc. Plan the week with get_week and add_week_target on their yes; when something is their call and they cannot say yes in the chat, suggest it instead.',
    'Every write is logged with your agent name and the user can undo it from Home → From your agent. Docs, goals and subjects are never deleted; a focus line or a milestone can be removed (and Undo brings it back). Answers are compact text with the ids the next call needs.',
    // EASY_SETUP_PLAN §7: the chat decides, the folder is only its default.
    'A chat counts as its folder says (build, study or work); when this one clearly is not (learning in a work folder; a chat about their plans or career, not the code, is study), call set_chat and say so in one line.',
    'Docs take GitHub Markdown plus callouts (> [!TIP]), <details> toggles for self-test questions, ```mermaid diagrams and ```canvas diagrams (Mermaid flowchart text that Recollect lays out as a board the user can edit; add_canvas draws one, update_canvas changes one in place, preview_diagram shows it): see create_doc.',
].join(' ');

/**
 * claude.ai's and ChatGPT's instructions (the `web` set, MCP_MEMORY_PLAN §4.10): the assistant picks the personally
 * relevant detail and passes just that on; the rest of the chat stays out. Tuned in stage 5 by the measured misses.
 */
export const WEB_INSTRUCTIONS = [
    "Recollect is the user's own memory and planner. Their buddy there follows what is going on in their life and brings things back at a good moment.",
    'At the start of a chat, call get_brief once: it is small and shows what the buddy follows.',
    'While you talk, pass on, without being asked and without mentioning it, what the user says about their own life that will still matter after this conversation: something new about them (remember), or progress, a change or an end on something already known (update_memory, with its id).',
    // ECOSYSTEM_V2_PLAN stage 12: the work log, from every chat; one picture, so nothing is logged twice.
    // Stage 13: one line per result; the "Did that fix it?" ask parked (the owner: a missed accomplishment matters more).
    'When get_brief shows a Work part, their work has its own log: when their own message shows a result they confirm, a decision they reached or a problem left open, log it with log_work, one plain line per result, without mentioning it. News on a line shown there or in a log_work answer goes with its id in on; what is already there is not logged again; nothing while it is still being worked out. A draft, a plan or a fix they are about to try is not an outcome yet; when their own words say it is done (fixed, shipped, sent, merged, works now), log it. Studying or talking through a doc or a topic to understand it is not work (the owner, 11-21); a project decision or something finished still is.',
    // Stage 14: their docs keep what helped them, on their yes (the owner: "so that I have the control over what goes into the doc").
    // Stage 15's live hour: claude.ai answered "my sliding window note" from general knowledge, never reading it (0/3).
    "When they say 'my note' or 'my doc', it is one of their docs here: find it (search_docs with its words) and read it (read_doc) before you explain, and answer from what it says. When explaining a part of it took real work, offer once to add it to that doc under its heading; add only on their yes. A quick answer needs no offer.",
    'Leave the rest in the chat: the task at hand, questions, suggestions not yet tried, the details of the work, other people’s private things. An interest is not a task: add a task or a reminder only when they ask for one. Most messages need nothing.',
    'Before you rely on their routine, plans or preferences, look them up with recall_memory.',
].join(' ');

/**
 * A work folder's instructions (B10, BUDDY_MEMORY_PLAN §12.5): nothing from an office chat reaches
 * Recollect unless the agent saves it; it saves the user's own things quietly and never the company's.
 */
export const OFFICE_INSTRUCTIONS = [
    "Recollect is the user's own notebook, not this company's. This is a work folder: nothing from this chat reaches Recollect unless you save it.",
    'Save quietly what they would want later: something about their own life (remember), a reminder or a dated to-do of their own (set_reminder, add_task), an idea or insight (add_pocket_note). Don’t ask first, and say nothing about it in your reply unless they asked for it. One thing a call; most turns have nothing. Never save company code, data, clients or colleagues’ names.',
    'When they ask to log the day’s work ("log today’s work", /log-work), use log_work. Call get_brief or get_work_log only when they ask what was done here before.',
    // EASY_SETUP_PLAN §7: a chat here that is clearly theirs (study, a side project) is marked; only their own word reads it.
    'If this chat is clearly not work (learning a topic for themselves, their own project), call set_chat with by "agent" and say so in one line; when they say it themselves, by "user".',
].join(' ');

/** EASY_SETUP_PLAN §3.5: a folder nobody has said what it is yet: the one question comes first. */
export const NEW_FOLDER_INSTRUCTIONS = (name: string): string =>
    `This folder ("${name}") is new to Recollect: early in the chat, ask the user once in one line whether it is for building something of their own, for learning, or for their job, or whether Recollect should ignore it, and call set_folder with the answer. Until then nothing from this chat is read.`;

/** A folder the user excluded (MCP_MEMORY_PLAN §4.9, R13): no tools, and this one line. */
export const EXCLUDED_INSTRUCTIONS = 'This folder is excluded by the user: nothing here is saved to Recollect or read from it, so no Recollect tools are listed.';

/** What a work folder lists (B10): the saving tools and this project's work log, nothing else. */
export const OFFICE_TOOLS = ['get_brief', 'remember', 'add_task', 'set_reminder', 'add_pocket_note', 'log_work', 'get_work_log', 'set_folder', 'set_chat'] as const;

/**
 * MCP_MEMORY_PLAN §4.1: what claude.ai and ChatGPT list (the remote door). No more_tools: each request there builds a
 * fresh server, so nothing can be turned on for the next one. Canvas and block editing, goal and week editing stay
 * with Claude Code and Recollect itself.
 */
export const WEB_TOOLS = [
    // The buddy
    'get_brief',
    'remember',
    'update_memory',
    'recall_memory',
    'forget',
    // Tasks and reminders
    'add_task',
    'update_task',
    'list_tasks',
    'set_reminder',
    'list_reminders',
    'cancel_reminder',
    // The lock screen
    'show_on_lock_screen',
    'clear_lock_line',
    // Quick capture
    'add_pocket_note',
    // The plan, to read
    'get_today',
    'get_week',
    'list_goals',
    'list_due',
    'get_learning_overview',
    'list_subjects',
    // Studying
    'get_path',
    'update_topic',
    'schedule_revision',
    'complete_revision',
    'checkpoint',
    // Docs
    'search_docs',
    'read_doc',
    'create_doc',
    'append_to_doc',
    // The work log (ECOSYSTEM_V2_PLAN stage 12): one outcome a call, the app's own line, the picture to read.
    'log_work',
    'update_work_line',
    'get_work_log',
] as const;

/**
 * The tool set of each door (MCP_MEMORY_PLAN §4.1): `web` the remote /mcp (claude.ai, ChatGPT); `code` Claude Code
 * (the default groups, more_tools for the rest); `office` a work folder; `excluded` a folder whose rule is off (no
 * tools); `all` Ask AI, inside the app.
 */
export const TOOL_SETS = ['web', 'code', 'office', 'excluded', 'all'] as const;
export type ToolSet = (typeof TOOL_SETS)[number];

/** A call to a removed field (a host that cached an older list): it still runs, and the answer says to reconnect. */
const REMOVED_FIELDS: Readonly<Record<string, readonly string[]>> = { checkpoint: ['said', 'learned'], get_brief: ['about'] };
const RECONNECT = 'This app’s list of Recollect tools is out of date: reconnect the Recollect connector. What the user says about themselves goes to remember or update_memory.';

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
    'show_on_lock_screen',
    'clear_lock_line',
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
    // The buddy's memory (BUDDY_MEMORY_PLAN; MCP_MEMORY_PLAN §4.1: saving, finding and correcting are listed together).
    'remember',
    'update_memory',
    'recall_memory',
    // The work log (BUDDY_MEMORY_PLAN §11.2, B9): what he did, per project and day; B10: an agent logs it on his word.
    'get_work_log',
    'log_work',
    // Stage 12: an app folds, rewords, links or removes its own work line.
    'update_work_line',
    'forget',
    // EASY_SETUP_PLAN: what a folder is (a new folder's one question) and what a chat is.
    'set_folder',
    'set_chat',
    // STUDY_FLOW_PLAN (11-23): a lesson's revision card; the notes and links on a lesson or a subject.
    'set_revision_card',
    'add_note',
    'list_notes',
    'update_note',
    'remove_note',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Each tool's level (MANAGER_AND_DOCS_PLAN §3.2), the same for every caller: 1 reads; 2 changes at
 * once, logged with an Undo; 3 can't be undone or leaves the app, so the tool only asks and the user's
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
    show_on_lock_screen: 2,
    clear_lock_line: 2,
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
    remember: 2,
    update_memory: 2,
    recall_memory: 1,
    forget: 2,
    get_work_log: 1,
    log_work: 2,
    update_work_line: 2,
    set_folder: 2,
    set_chat: 2,
    set_revision_card: 2,
    add_note: 2,
    list_notes: 1,
    update_note: 2,
    remove_note: 2,
};

export const TOOL_GROUP_NAMES = ['core', 'docs', 'plan', 'record', 'manage'] as const;
export type ToolGroup = (typeof TOOL_GROUP_NAMES)[number];
/** What an outside chat lists by default (the catalogue budget holds for these). */
export const DEFAULT_GROUPS: readonly ToolGroup[] = ['core', 'docs', 'plan', 'record'];

/** Each tool's group (the manager gets them all; outside chats DEFAULT_GROUPS, more on request). */
export const TOOL_GROUPS: Readonly<Record<ToolName, ToolGroup>> = {
    get_brief: 'core',
    checkpoint: 'core',
    // MCP_MEMORY_PLAN §4.1: moved to manage to make room for finding and correcting memories.
    list_sessions: 'manage',
    suggest: 'core',
    get_today: 'core',
    get_learning_overview: 'manage',
    add_pocket_note: 'core',
    recent_agent_edits: 'manage',
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
    update_goal: 'manage',
    add_milestone: 'manage',
    complete_milestone: 'manage',
    update_milestone: 'manage',
    remove_milestone: 'manage',
    add_focus: 'plan',
    update_focus: 'manage',
    remove_focus: 'manage',
    // B10: moved to manage to make room for set_reminder and log_work (the manager has every group).
    get_mirror: 'manage',
    log_decision: 'record',
    list_decisions: 'manage',
    trash_doc: 'manage',
    restore_doc: 'manage',
    empty_trash: 'manage',
    complete_revision: 'manage',
    move_revision: 'manage',
    get_settings: 'manage',
    update_settings: 'manage',
    update_project: 'manage',
    list_suggestions: 'manage',
    // B10 (2026-11-16): every chat can set a reminder without more_tools.
    set_reminder: 'record',
    list_reminders: 'manage',
    cancel_reminder: 'manage',
    // Stage 7 (V1): his words on the lock screen for a window.
    show_on_lock_screen: 'manage',
    clear_lock_line: 'manage',
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
    // The buddy (2026-11-16): remember is listed with the record; update_goal moved to manage to make room.
    // MCP_MEMORY_PLAN §4.1: finding and correcting belong with saving.
    remember: 'record',
    update_memory: 'record',
    recall_memory: 'record',
    forget: 'record',
    // B9 (2026-11-16): the default groups are at their 40,000 characters; the manager has every group.
    get_work_log: 'manage',
    // B10: every chat can log the day's work when he asks (recent_agent_edits and list_decisions moved to manage to make room).
    log_work: 'record',
    // Stage 12: listed on the web; Claude Code rewrites its own list with log_work, so it waits on more_tools.
    update_work_line: 'manage',
    // EASY_SETUP_PLAN: a new folder's question and a chat's own kind are answered without more_tools.
    set_folder: 'core',
    set_chat: 'core',
    // STUDY_FLOW_PLAN: the default groups are at their 40,000 characters; the study skill calls more_tools first.
    set_revision_card: 'manage',
    add_note: 'manage',
    list_notes: 'manage',
    update_note: 'manage',
    remove_note: 'manage',
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
    /** The tool groups listed from the start in the `code` set (default DEFAULT_GROUPS). */
    groups?: readonly ToolGroup[];
    /** The door's tool set (MCP_MEMORY_PLAN §4.1); default `office` with workMode, else `code`. */
    set?: ToolSet;
    /** A work folder: the brief and the buddy's memory stay personal (BUDDY_MEMORY_PLAN §4.3); the `office` set. */
    workMode?: boolean;
    /** The work folder's project key (get_work_log answers for it alone). */
    workProject?: string;
    /** B10: the folder's project when Recollect's hooks act in it (log_work reads the hook's clock for it). */
    clockProject?: string;
    /** MCP_MEMORY_PLAN §4.9: Claude Code's folder, sent with remember and update_memory. */
    project?: string;
    /** Stage 5's connector simulation: each tool call with its answer, in order (never the token). */
    trace?: (call: { tool: string; args: unknown; answer?: string }) => void;
    /** EASY_SETUP_PLAN: the folder this chat runs in (isNew: the account asks what it is). */
    folder?: { key: string; name: string; isNew?: boolean };
}

const INSTRUCTIONS_OF: Readonly<Record<ToolSet, string>> = { web: WEB_INSTRUCTIONS, code: INSTRUCTIONS, office: OFFICE_INSTRUCTIONS, excluded: EXCLUDED_INSTRUCTIONS, all: INSTRUCTIONS };

export function createRecollectServer(options: ServerOptions): McpServer {
    const set: ToolSet = options.set ?? (options.workMode ? 'office' : 'code');
    // A new folder's question comes before everything else (EASY_SETUP_PLAN §3.5).
    const instructions = options.folder?.isNew && set !== 'excluded' && set !== 'web' ? `${NEW_FOLDER_INSTRUCTIONS(options.folder.name)} ${INSTRUCTIONS_OF[set]}` : INSTRUCTIONS_OF[set];
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions });
    const registry = new Map<string, RegisteredTool>();
    const ctx: ToolContext = {
        api: options.api,
        problem: options.problem ?? null,
        registry,
        ...(set === 'office' ? { workMode: true } : {}),
        set,
        ...(options.workProject ? { workProject: options.workProject } : {}),
        ...(options.clockProject ? { clockProject: options.clockProject } : {}),
        ...(options.project ? { project: options.project } : {}),
        ...(options.folder ? { folder: options.folder } : {}),
        chats: newChatMemory(),
    };
    // EASY_SETUP_PLAN §7: their own word on what this chat is moves it between a work folder's set and the full one
    // (the work brief turns into the full brief, and back); the tools list changes, the instructions stay.
    ctx.switchSet = (to) => {
        if ((to !== 'code' && to !== 'office') || to === ctx.set || (ctx.set !== 'code' && ctx.set !== 'office')) return false;
        // Only a work folder's chat goes back to the work set: elsewhere a chat called work keeps its tools (a tool
        // without hooks logs its time through checkpoint, which the work set doesn't list).
        if (to === 'office' && set !== 'office') return false;
        const listed = new Set<string>(to === 'office' ? OFFICE_TOOLS : [...registry.keys()].filter((n) => (options.groups ?? DEFAULT_GROUPS).includes(TOOL_GROUPS[n as ToolName])));
        for (const [name, tool] of registry) {
            if (listed.has(name) && !tool.enabled) tool.enable();
            else if (!listed.has(name) && tool.enabled) tool.disable();
        }
        ctx.set = to;
        if (to === 'office') ctx.workMode = true;
        else delete ctx.workMode;
        return true;
    };
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
    registerBuddyTools(server, ctx);
    registerFolderTools(server, ctx);
    registerStudyTools(server, ctx);
    registerPrompts(server, set);
    leanToolList(server);
    guardCalls(server, registry, () => ctx.set ?? set, options.trace);
    if (set === 'all') {
        // Ask AI runs in no folder and is no coding chat: a folder's kind is update_project's there (EASY_SETUP_PLAN).
        for (const name of ['set_folder', 'set_chat']) registry.get(name)?.disable();
        return server;
    }
    if (set === 'code') {
        const listed = new Set(options.groups ?? DEFAULT_GROUPS);
        for (const [name, tool] of registry) if (!listed.has(TOOL_GROUPS[name as ToolName])) tool.disable();
        return server;
    }
    // A work folder lists the saving tools and its own work log; the web its set; an excluded folder nothing (no more_tools).
    const shown = new Set<string>(set === 'office' ? OFFICE_TOOLS : set === 'web' ? WEB_TOOLS : []);
    for (const [name, tool] of registry) if (!shown.has(name)) tool.disable();
    return server;
}

/**
 * A call to a tool this door doesn't list answers one clear line, never the SDK's "disabled" (MCP_MEMORY_PLAN §4.1);
 * a call that still sends a removed field (a host's cached list) runs, and its answer says to reconnect.
 */
function guardCalls(server: McpServer, registry: Map<string, RegisteredTool>, setNow: () => ToolSet, trace?: ServerOptions['trace']): void {
    const handlers = (server.server as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<CallToolResult>> })._requestHandlers;
    const original = handlers.get('tools/call');
    if (!original) return;
    server.server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
        const name = req.params.name;
        const answer = async (): Promise<CallToolResult> => {
            const tool = registry.get(name);
            const set = setNow();
            if (tool && !tool.enabled) {
                if (set === 'excluded') return errorResult(EXCLUDED_INSTRUCTIONS);
                if (set === 'code') return errorResult(`${name} is in the ${TOOL_GROUPS[name as ToolName]} group: call more_tools first, then call it again.`);
                return errorResult(`${name} is not available in this app: use Recollect itself, or Claude Code.`);
            }
            const removed = (REMOVED_FIELDS[name] ?? []).filter((f) => Object.prototype.hasOwnProperty.call(req.params.arguments ?? {}, f));
            const result = await original(req, extra);
            if (!removed.length) return result;
            return { ...result, content: [...(result.content ?? []), { type: 'text' as const, text: `${removed.join(' and ')} ${removed.length > 1 ? 'were' : 'was'} not passed on. ${RECONNECT}` }] };
        };
        if (!trace) return answer();
        // The simulation's trace keeps each call with the record's answer, so a report can say what was filed and how.
        const args = req.params.arguments ?? {};
        try {
            const result = await answer();
            trace({ tool: name, args, answer: (result.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') });
            return result;
        } catch (err) {
            trace({ tool: name, args, answer: `error: ${err instanceof Error ? err.message : String(err)}` });
            throw err;
        }
    });
}

/** more_tools: turns a group on for this chat (the client is told the list changed). */
function registerMoreTools(server: McpServer, ctx: ToolContext, registry: Map<string, RegisteredTool>): void {
    defineTool(
        server,
        ctx,
        'more_tools',
        {
            title: 'More tools',
            description: "Turn on the manage tools: notes on a lesson or subject, the revision card, the trash, reviews done or moved, settings, projects, goal edits, the mirror, decisions, sessions, reminders, agents' edits.",
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
