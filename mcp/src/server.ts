// The MCP server: every tool, wired to one API client. No transport here (index.ts adds stdio;
// tests connect an in-memory client).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ListToolsResult, type ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { KaagaApi } from './api.js';
import { registerPrompts } from './prompts.js';
import { errorResult, type CallOutcome, type CallStat, type CatalogueEntry, type DoorPolicy, type ToolContext, type Via } from './tool.js';
import { closestNames } from './find.js';
import { signatureOf } from './card.js';
import { CARDS, WEB_CARDS } from './cards.js';
import { registerFindTools } from './tools/find.js';
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
import { registerPocketTools } from './tools/pocket.js';
import { registerFileTools } from './tools/files.js';

export const SERVER_NAME = 'kaaga';

/** The package's version (package.json beside src/ and dist/). */
export const SERVER_VERSION: string = (() => {
    try {
        return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
})();

/**
 * TOOL_ACCESS_PLAN §6.2: `<package version>+<8 hex of the door's listed tools>`, so "which list does your app hold"
 * has an answer (a host keeps the list it saw when it connected).
 */
export function versionOf(listed: ReadonlySet<string>): string {
    return `${SERVER_VERSION}+${createHash('sha256').update([...listed].sort().join(',')).digest('hex').slice(0, 8)}`;
}

/** TOOL_ACCESS_PLAN §5.1: where things go, one line each (the web and code instructions share it). */
export const WHERE_THINGS_GO =
    'Where things go: their own life → remember (news on it: update_memory; wrong: forget); a to-do → add_task; a nudge at a time → set_reminder; a thought or link with no home → add_pocket_note; something beside a lesson → add_note; the lesson’s own text → append_to_doc; a work result → log_work; a study part with you → checkpoint.';

/** The product's words, once (TOOL_ACCESS_PLAN §5.1). */
export const GLOSSARY =
    'Words: a subject is a course, its path the topics in order, a topic’s doc its lesson; a review is one spaced-revision sitting; the buddy follows the user’s life; the pocket holds their quick private notes.';

/** Claude Code's instructions (the `code` set) and Ask AI's (`all`). */
export const INSTRUCTIONS = [
    "Kaaga is the user's personal learning app and the record of their work: Docs (their notes, in Markdown), subjects with paths (topics in course order), spaced revision (reviews 1, 3, 7 and 21 days after a doc is scheduled), goals with dated milestones, a week of up to 5 targets, up to 3 focus lines a day, personal tasks, and work sessions. Their buddy there follows what is going on in their life.",
    'Start a working chat with get_brief (where they stand, and a session key), then checkpoint as you go: after each part, not only at the end. Pass on quietly, without asking or mentioning it, what the user says about their own life that will still matter after this conversation: something new about them (remember), or progress, a change or an end on something their buddy already knows (update_memory, with its id); a reminder or a dated to-do of their own (set_reminder, add_task); an idea or insight (add_pocket_note). Most turns have nothing. Before you rely on their routine, plans or preferences, look them up with recall_memory. When they ask to log the day’s work, use log_work. search_docs before writing a doc. Plan the week with get_week and add_week_target on their yes; when something is their call and they cannot say yes in the chat, suggest_to_user instead.',
    // TOOL_ACCESS_PLAN §5.2: the rest of the catalogue is a search away; any tool runs by its name.
    'The listed tools are the everyday ones: find_tools with the job in plain words answers the rest (goals, reviews, notes on a lesson, the trash, sharing, settings…) and adds them to your list; any Kaaga tool runs by its name. For a study session, a quiz, a lesson to write, a week or a course to plan, find_tools with those words answers the steps.',
    'Every write is logged with your agent name and the user can undo it from Home → From your agent. Docs go to the trash (30 days), goals are never deleted, and a subject that holds anything is deleted only on their tap; a focus line or a milestone can be removed (and Undo brings it back). Answers are compact text with the ids the next call needs.',
    // EASY_SETUP_PLAN §7: the chat decides, the folder is only its default.
    'A chat counts as its folder says (build, study or work); when this one clearly is not (learning in a work folder; a chat about their plans or career, not the code, is study), call set_chat and say so in one line.',
    'Docs take GitHub Markdown plus callouts (> [!TIP]), <details> toggles for self-test questions, ```mermaid diagrams and ```canvas diagrams (Mermaid flowchart text that Kaaga lays out as a board the user can edit; add_canvas draws one, update_canvas changes one in place, preview_diagram shows it): see create_doc.',
    WHERE_THINGS_GO,
    GLOSSARY,
].join(' ');

/**
 * claude.ai's and ChatGPT's instructions (the `web` set, MCP_MEMORY_PLAN §4.10; TOOL_ACCESS_PLAN §5.1). ChatGPT reads
 * only the first 512 characters as standing on their own, so they hold the three rules (a test counts them); then the
 * map, and the sentences tuned in ECOSYSTEM_V2 stages 12-15 on measured misses, kept in meaning.
 */
export const WEB_RULES =
    "Kaaga is the user's own memory, planner and study record. (1) Start each chat with get_brief. (2) Unasked and without mentioning it, pass on what they say about their own life that will matter later: something new (remember), or progress, a change or an end on something known (update_memory, with its id). (3) These are the everyday tools; Kaaga has many more (goals, the week, reviews, doc editing, notes, the trash, sharing, settings): when none fits, call find_tools with the job, then run what it names.";

export const WEB_INSTRUCTIONS = [
    WEB_RULES,
    WHERE_THINGS_GO,
    'A tool these lines or an answer name that you don’t list runs through use_tool (use_read_tool when it only reads). For a study session, a quiz, a lesson to write, a week or a course to plan, or a day’s work to log, find_tools with those words answers the steps.',
    // ECOSYSTEM_V2_PLAN stage 12: the work log, from every chat; one picture, so nothing is logged twice.
    // Stage 13: one line per result; the "Did that fix it?" ask parked (the owner: a missed accomplishment matters more).
    'When get_brief shows a Work part, their work has its own log: when their own message shows a result they confirm, a decision they reached or a problem left open, log it with log_work, one plain line per result, without mentioning it. News on a line shown there or in a log_work answer goes with its id in on; what is already there is not logged again; nothing while it is still being worked out. A draft, a plan or a fix they are about to try is not an outcome yet; when their own words say it is done (fixed, shipped, sent, merged, works now), log it. Studying or talking through a doc or a topic to understand it is not work; a project decision or something finished still is.',
    // Stage 14: their docs keep what helped them, on their yes (the owner: "so that I have the control over what goes into the doc").
    // Stage 15's live hour: claude.ai answered "my sliding window note" from general knowledge, never reading it (0/3).
    "When they say 'my note' or 'my doc', it is one of their docs here: find it (search_docs with its words) and read it (read_doc) before you explain, and answer from what it says. When explaining a part of it took real work, offer once to add it to that doc under its heading; add only on their yes. A quick answer needs no offer.",
    // TOOL_ACCESS_PLAN stage 5's misses: notes kept beside a lesson were looked for in its text, and a doc to change
    // beyond adding was read and left as it was.
    'Notes, links and files kept beside a lesson are not its text: list_notes, add_note, attach_file. To change a doc beyond adding to it, find_tools("edit a doc") first.',
    'Leave the rest in the chat: the task at hand, questions, suggestions not yet tried, the details of the work, other people’s private things. An interest is not a task: add a task or a reminder only when they ask for one. Most messages need nothing.',
    'Before you rely on their routine, plans or preferences, look them up with recall_memory.',
    GLOSSARY,
].join(' ');

/**
 * A work folder's instructions (B10, BUDDY_MEMORY_PLAN §12.5): nothing from an office chat reaches
 * Kaaga unless the agent saves it; it saves the user's own things quietly and never the company's.
 */
export const OFFICE_INSTRUCTIONS = [
    "Kaaga is the user's own notebook, not this company's. This is a work folder: nothing from this chat reaches Kaaga unless you save it.",
    'Save quietly what they would want later: something about their own life (remember), a reminder or a dated to-do of their own (set_reminder, add_task), an idea or insight (add_pocket_note). Don’t ask first, and say nothing about it in your reply unless they asked for it. One thing a call; most turns have nothing. Never save company code, data, clients or colleagues’ names.',
    'When they ask to log the day’s work ("log today’s work", /log-work), use log_work. Call get_brief or get_work_log only when they ask what was done here before.',
    // EASY_SETUP_PLAN §7: a chat here that is clearly theirs (study, a side project) is marked; only their own word reads it.
    'If this chat is clearly not work (learning a topic for themselves, their own project), call set_chat with by "agent" and say so in one line; when they say it themselves, by "user".',
].join(' ');

/** EASY_SETUP_PLAN §3.5: a folder nobody has said what it is yet: the one question comes first. */
export const NEW_FOLDER_INSTRUCTIONS = (name: string): string =>
    `This folder ("${name}") is new to Kaaga: early in the chat, ask the user once in one line whether it is for building something of their own, for learning, or for their job, or whether Kaaga should ignore it, and call set_folder with the answer. Until then nothing from this chat is read.`;

/** A folder the user excluded (MCP_MEMORY_PLAN §4.9, R13): no tools, and this one line. */
export const EXCLUDED_INSTRUCTIONS = 'This folder is excluded by the user: nothing here is saved to Kaaga or read from it, so no Kaaga tools are listed.';

/** What a work folder lists (B10): the saving tools and this project's work log, nothing else. */
export const OFFICE_TOOLS = ['get_brief', 'remember', 'add_task', 'set_reminder', 'add_pocket_note', 'log_work', 'get_work_log', 'set_folder', 'set_chat'] as const;

/**
 * MCP_MEMORY_PLAN §4.1: what claude.ai and ChatGPT list (the remote door). No more_tools: each request there builds a
 * fresh server, so nothing can be turned on for the next one. Canvas and block editing, goal and week editing stay
 * with Claude Code and Kaaga itself.
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
const RECONNECT = 'This app’s list of Kaaga tools is out of date: reconnect the Kaaga connector. What the user says about themselves goes to remember or update_memory.';

/** Every tool, in the order they are listed. */
export const TOOL_NAMES = [
    'get_brief',
    'checkpoint',
    'list_sessions',
    'get_week',
    'add_week_target',
    'update_week_target',
    'suggest_to_user',
    'get_standing',
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
    // The "manage" group (MANAGER_AND_DOCS_PLAN §3.3): not listed on the code door (find_tools turns them on, or
    // KAAGA_TOOLS=all); the in-app manager always has it.
    'trash_doc',
    'restore_doc',
    // DOC_PAGES_PLAN §6.2: a doc's pages as a tree, and moving a doc inside another.
    'get_doc_tree',
    'move_doc',
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
    'get_quiz_results',
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
    // TOOL_ACCESS_PLAN §4.7: their pocket (only while they allow it) and subjects.
    'list_pocket_notes',
    'update_pocket_note',
    'delete_pocket_note',
    'update_subject',
    'delete_subject',
    // TOOL_ACCESS_PLAN §11: files on a note.
    'attach_file',
    'remove_file',
    'read_note_file',
    // TOOL_ACCESS_PLAN §3: find any tool by the job, and run one that isn't listed.
    'find_tools',
    'use_read_tool',
    'use_tool',
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
    suggest_to_user: 2,
    get_standing: 1,
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
    trash_doc: 2,
    restore_doc: 2,
    get_doc_tree: 1,
    move_doc: 2,
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
    get_quiz_results: 1,
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
    list_pocket_notes: 1,
    update_pocket_note: 2,
    delete_pocket_note: 2,
    update_subject: 2,
    // An empty subject goes at once (Undo); one that holds anything only asks (the delete_subject action, their tap).
    delete_subject: 2,
    attach_file: 2,
    remove_file: 2,
    read_note_file: 1,
    find_tools: 1,
    use_read_tool: 1,
    // Runs any tool: the level of what it runs is that tool's own.
    use_tool: 2,
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
    suggest_to_user: 'core',
    get_today: 'core',
    get_learning_overview: 'manage',
    add_pocket_note: 'core',
    recent_agent_edits: 'manage',
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
    get_standing: 'manage',
    log_decision: 'record',
    list_decisions: 'manage',
    trash_doc: 'manage',
    restore_doc: 'manage',
    get_doc_tree: 'manage',
    move_doc: 'manage',
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
    get_quiz_results: 'manage',
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
    list_pocket_notes: 'manage',
    update_pocket_note: 'manage',
    delete_pocket_note: 'manage',
    update_subject: 'manage',
    delete_subject: 'manage',
    attach_file: 'manage',
    remove_file: 'manage',
    read_note_file: 'manage',
    find_tools: 'core',
    use_read_tool: 'core',
    use_tool: 'core',
};

/** KAAGA_TOOLS: "all", or groups separated by commas ("core,docs,manage"); else the default. */
export function groupsFrom(value: string | undefined): ToolGroup[] {
    const raw = (value ?? '').trim().toLowerCase();
    if (raw === 'all') return [...TOOL_GROUP_NAMES];
    const picked = raw.split(/[\s,]+/).filter((g): g is ToolGroup => (TOOL_GROUP_NAMES as readonly string[]).includes(g));
    return picked.length > 0 ? [...new Set<ToolGroup>(['core', ...picked])] : [...DEFAULT_GROUPS];
}

export interface ServerOptions {
    api: KaagaApi;
    agentName: string;
    /** A setup problem every tool reports instead of calling the API (no token, bad URL). */
    problem?: string | null;
    /** Pocket note ids (tests pass a fixed one). */
    newId?: () => string;
    /** The tool groups listed from the start in the `code` set (default DEFAULT_GROUPS). */
    groups?: readonly ToolGroup[];
    /** The `web` door's everyday set instead of WEB_TOOLS (TOOL_ACCESS_PLAN §7.3: the picking test's candidates). */
    listed?: readonly string[];
    /** The door's tool set (MCP_MEMORY_PLAN §4.1); default `office` with workMode, else `code`. */
    set?: ToolSet;
    /** A work folder: the brief and the buddy's memory stay personal (BUDDY_MEMORY_PLAN §4.3); the `office` set. */
    workMode?: boolean;
    /** The work folder's project key (get_work_log answers for it alone). */
    workProject?: string;
    /** B10: the folder's project when Kaaga's hooks act in it (log_work reads the hook's clock for it). */
    clockProject?: string;
    /** MCP_MEMORY_PLAN §4.9: Claude Code's folder, sent with remember and update_memory. */
    project?: string;
    /** Stage 5's connector simulation: each tool call with its answer, in order (never the token). */
    trace?: (call: { tool: string; args: unknown; answer?: string }) => void;
    /** TOOL_ACCESS_PLAN §6.5: each call's tool, path, outcome and time (the backend counts them; no user data). */
    onCall?: (call: CallStat) => void;
    /** EASY_SETUP_PLAN: the folder this chat runs in (isNew: the account asks what it is). */
    folder?: { key: string; name: string; isNew?: boolean };
}

const INSTRUCTIONS_OF: Readonly<Record<ToolSet, string>> = { web: WEB_INSTRUCTIONS, code: INSTRUCTIONS, office: OFFICE_INSTRUCTIONS, excluded: EXCLUDED_INSTRUCTIONS, all: INSTRUCTIONS };

/** The three tools that find and run the rest (TOOL_ACCESS_PLAN §3). */
export const RUNNERS = ['find_tools', 'use_read_tool', 'use_tool'] as const;

/**
 * TOOL_ACCESS_PLAN §2: what each door lists and what a call may run there. One catalogue: every door can run every tool
 * its policy allows, listed or not (a host that sends an unlisted name loses nothing); it lists a short set.
 *   web       its everyday set + the three runners; reaches every tool but set_folder (no folder on the web)
 *   code      the default groups + find_tools and use_tool (find_tools adds what it finds); reaches every tool
 *   office    its 9 (the work-folder privacy line: nothing else is reachable)
 *   excluded  nothing
 *   all       Ask Kaaga: every tool listed, without the runners and the folder tools
 */
export function doorPolicy(set: ToolSet, opts: { groups?: readonly ToolGroup[]; listed?: readonly string[] } = {}): DoorPolicy {
    const all = TOOL_NAMES as readonly string[];
    if (set === 'web') return { listed: new Set([...(opts.listed ?? WEB_TOOLS), ...RUNNERS]), reachable: new Set(all.filter((n) => n !== 'set_folder')) };
    if (set === 'code') {
        const groups = opts.groups ?? DEFAULT_GROUPS;
        const reachable = all.filter((n) => n !== 'use_read_tool');
        return { listed: new Set(reachable.filter((n) => groups.includes(TOOL_GROUPS[n as ToolName]))), reachable: new Set(reachable) };
    }
    if (set === 'office') return { listed: new Set(OFFICE_TOOLS), reachable: new Set(OFFICE_TOOLS) };
    if (set === 'excluded') return { listed: new Set(), reachable: new Set() };
    const names = all.filter((n) => n !== 'set_folder' && n !== 'set_chat' && !(RUNNERS as readonly string[]).includes(n));
    return { listed: new Set(names), reachable: new Set(names) };
}

export function createKaagaServer(options: ServerOptions): McpServer {
    const set: ToolSet = options.set ?? (options.workMode ? 'office' : 'code');
    // A new folder's question comes before everything else (EASY_SETUP_PLAN §3.5).
    const instructions = options.folder?.isNew && set !== 'excluded' && set !== 'web' ? `${NEW_FOLDER_INSTRUCTIONS(options.folder.name)} ${INSTRUCTIONS_OF[set]}` : INSTRUCTIONS_OF[set];
    const policy = doorPolicy(set, { ...(options.groups ? { groups: options.groups } : {}), ...(options.listed ? { listed: options.listed } : {}) });
    const server = new McpServer({ name: SERVER_NAME, version: versionOf(policy.listed) }, { instructions });
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
        policy,
        listChanged: () => server.sendToolListChanged(),
    };
    // EASY_SETUP_PLAN §7: their own word on what this chat is moves it between a work folder's set and the full one
    // (the work brief turns into the full brief, and back); the tools list changes, the instructions stay.
    ctx.switchSet = (to) => {
        if ((to !== 'code' && to !== 'office') || to === ctx.set || (ctx.set !== 'code' && ctx.set !== 'office')) return false;
        // Only a work folder's chat goes back to the work set: elsewhere a chat called work keeps its tools (a tool
        // without hooks logs its time through checkpoint, which the work set doesn't list).
        if (to === 'office' && set !== 'office') return false;
        const next = doorPolicy(to, options.groups ? { groups: options.groups } : {});
        policy.listed = next.listed;
        policy.reachable = next.reachable;
        ctx.set = to;
        if (to === 'office') ctx.workMode = true;
        else delete ctx.workMode;
        server.sendToolListChanged();
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
    registerManageTools(server, ctx);
    registerBlockTools(server, ctx);
    registerBuddyTools(server, ctx);
    registerFolderTools(server, ctx);
    registerStudyTools(server, ctx);
    registerPocketTools(server, ctx);
    registerFileTools(server, ctx);
    if (set === 'web' || set === 'code' || set === 'office') registerFindTools(server, ctx);
    registerPrompts(server, set);
    const everything = leanToolList(server, policy);
    ctx.catalogue = () => catalogueOf(set, everything, policy);
    guardCalls(server, ctx, registry, () => ctx.set ?? set, options.trace, options.onCall);
    return server;
}

/**
 * Every tool registered here, as tools/list shows it, with its level: find_tools' catalogue and the inputs a refused
 * call is told about. Built once per process per door (the texts never change while it runs), reachable tools only.
 */
const CATALOGUES = new Map<string, Promise<CatalogueEntry[]>>();
function catalogueOf(set: ToolSet, everything: () => Promise<ListToolsResult['tools']>, policy: DoorPolicy): Promise<CatalogueEntry[]> {
    let built = CATALOGUES.get(set);
    if (!built) {
        built = everything().then((tools) =>
            tools.map((t) => ({
                name: t.name,
                title: t.title ?? t.name,
                description: t.description ?? '',
                inputSchema: t.inputSchema as Record<string, unknown>,
                level: TOOL_LEVELS[t.name as ToolName] ?? 2,
            }))
        );
        built.catch(() => CATALOGUES.delete(set));
        CATALOGUES.set(set, built);
    }
    return built.then((list) => list.filter((t) => policy.reachable.has(t.name)));
}

/** A tool's card on this door (the web's log_work has its own inputs, so its own card). */
export const cardOf = (name: string, set: ToolSet | undefined) => (set === 'web' ? WEB_CARDS[name as ToolName] : undefined) ?? CARDS[name as ToolName];

/** A zod issue in words a model can act on: `day must be a date 'YYYY-MM-DD' (got "Friday")`. */
function issueWords(issue: { path: PropertyKey[]; message: string; code?: string }, args: Record<string, unknown>): string {
    const where = issue.path.map(String).join('.') || 'the input';
    let value: unknown = args;
    for (const k of issue.path) value = value && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[k] : undefined;
    if (value === undefined && issue.code === 'invalid_type') return `${where} is missing`;
    const message = issue.message.replace(/^Invalid input: /, '');
    const got = value === undefined ? '' : ` (got ${JSON.stringify(value).slice(0, 60)})`;
    return /^(must|should|is|needs) /.test(message) ? `${where} ${message}${got}` : `${where}: ${message}${got}`;
}

type Issue = { path: PropertyKey[]; message: string; code?: string };

/** What is wrong with a call's inputs, with the tool's inputs and its example (TOOL_ACCESS_PLAN §3.4); null when they fit. */
async function inputProblem(name: string, tool: RegisteredTool, args: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
    const schema = tool.inputSchema as { safeParse?: (v: unknown) => { success: boolean; error?: { issues: Issue[] } } } | undefined;
    if (!schema?.safeParse) return null;
    const parsed = schema.safeParse(args);
    if (parsed.success) return null;
    // One line per input (a date that is no date fails two checks: the first says enough).
    const seen = new Set<string>();
    const issues = (parsed.error?.issues ?? [])
        .filter((i) => {
            const key = i.path.map(String).join('.');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 3)
        .map((i) => issueWords(i, args));
    const entry = (await ctx.catalogue?.().catch(() => []))?.find((t) => t.name === name);
    const card = cardOf(name, ctx.set);
    const inputs = entry ? ` Inputs: ${signatureOf(entry.inputSchema)}.` : '';
    const example = card ? ` Example: ${JSON.stringify(card.example)}.` : '';
    return `${name}: ${issues.join('; ') || 'the inputs don’t fit'}.${inputs}${example}`;
}

/**
 * Every call, direct or through use_tool / use_read_tool, passes here (MCP_MEMORY_PLAN §4.1, TOOL_ACCESS_PLAN §3.4): a
 * tool the door can't reach answers one clear line; inputs that don't fit say how to fix them; a call that still sends
 * a removed field (a host's cached list) runs, and its answer says to reconnect.
 */
function guardCalls(server: McpServer, ctx: ToolContext, registry: Map<string, RegisteredTool>, setNow: () => ToolSet, trace?: ServerOptions['trace'], onCall?: ServerOptions['onCall']): void {
    const handlers = (server.server as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<CallToolResult>> })._requestHandlers;
    const original = handlers.get('tools/call');
    if (!original) return;
    // TOOL_ACCESS_PLAN §6.5: what each call came to, for the counts (the runners' own envelopes are not counted: the
    // tool they ran is, with how it was reached).
    const answer = async (name: string, args: Record<string, unknown>, extra: unknown, box: { outcome: CallOutcome } = { outcome: 'ok' }): Promise<CallToolResult> => {
        const set = setNow();
        const tool = registry.get(name);
        if (!tool || !ctx.policy?.reachable.has(name)) {
            box.outcome = tool ? 'not_reachable' : 'unknown_tool';
            if (set === 'excluded') return errorResult(EXCLUDED_INSTRUCTIONS);
            if (set === 'office') return errorResult(`${name} is not available in this app: use Kaaga itself, or Claude Code.`);
            const near = closestNames([...(ctx.policy?.reachable ?? [])], name);
            const find = set === 'web' || set === 'code' ? ' find_tools("<the job>") shows what exists.' : '';
            return errorResult(`No tool named "${name}" here.${near.length ? ` Closest: ${near.join(', ')}.` : ''}${find}`);
        }
        const bad = await inputProblem(name, tool, args, ctx);
        if (bad) {
            box.outcome = 'bad_args';
            return errorResult(bad);
        }
        const removed = (REMOVED_FIELDS[name] ?? []).filter((f) => Object.prototype.hasOwnProperty.call(args, f));
        const result = await original({ method: 'tools/call', params: { name, arguments: args } }, extra);
        if (!removed.length) return result;
        return { ...result, content: [...(result.content ?? []), { type: 'text' as const, text: `${removed.join(' and ')} ${removed.length > 1 ? 'were' : 'was'} not passed on. ${RECONNECT}` }] };
    };
    const counted = async (name: string, args: Record<string, unknown>, extra: unknown, via: Via): Promise<CallToolResult> => {
        if (!onCall || (via === 'direct' && (name === 'use_tool' || name === 'use_read_tool'))) return answer(name, args, extra);
        const started = Date.now();
        const box: { outcome: CallOutcome } = { outcome: 'ok' };
        const result = await answer(name, args, extra, box);
        if (box.outcome === 'ok' && result.isError) box.outcome = 'tool_error';
        if (box.outcome === 'ok' && name === 'find_tools' && (result.content ?? []).some((c) => c.type === 'text' && c.text.startsWith('Nothing matches'))) box.outcome = 'no_match';
        try {
            onCall({ tool: name, via, outcome: box.outcome, ms: Date.now() - started });
        } catch {
            // Counting never fails a call.
        }
        return result;
    };
    const traced = async (name: string, args: Record<string, unknown>, extra: unknown, via: Via): Promise<CallToolResult> => {
        if (!trace) return counted(name, args, extra, via);
        // The simulation's trace keeps each call with the record's answer, so a report can say what was filed and how.
        try {
            const result = await counted(name, args, extra, via);
            trace({ tool: name, args, answer: (result.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') });
            return result;
        } catch (err) {
            trace({ tool: name, args, answer: `error: ${err instanceof Error ? err.message : String(err)}` });
            throw err;
        }
    };
    ctx.callTool = (name, args, extra, via) => traced(name, args, extra, via);
    server.server.setRequestHandler(CallToolRequestSchema, async (req, extra) => traced(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>, extra, 'direct'));
}

/**
 * tools/list shows the door's listed set only (TOOL_ACCESS_PLAN §2: every reachable tool stays registered and
 * enabled). Every chat loads the list, so it carries nothing the model doesn't use: the SDK's JSON Schema says
 * `"$schema": "http://json-schema.org/draft-07/schema#"` in every tool (about 2,000 characters over the catalogue), so
 * that line goes (catalogue.test.ts holds the list to its budget). Answers the whole list, unfiltered, for the catalogue.
 */
/**
 * TOOL_ACCESS_PLAN stage 1: a hint that says what MCP assumes anyway goes (readOnlyHint false, idempotentHint false,
 * destructiveHint true on a tool that changes something, openWorldHint true): about 50 characters a changing tool.
 */
export function leanAnnotations(a: ToolAnnotations): ToolAnnotations {
    const out: ToolAnnotations = { ...a };
    if (out.readOnlyHint === false) delete out.readOnlyHint;
    if (out.idempotentHint === false) delete out.idempotentHint;
    if (out.openWorldHint === true) delete out.openWorldHint;
    if (out.destructiveHint === true && !a.readOnlyHint) delete out.destructiveHint;
    return out;
}

function leanToolList(server: McpServer, policy: DoorPolicy): () => Promise<ListToolsResult['tools']> {
    const handlers = (server.server as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<ListToolsResult>> })._requestHandlers;
    const original = handlers.get('tools/list');
    const lean = (tools: ListToolsResult['tools']) =>
        tools.map((t) => ({
            ...t,
            inputSchema: Object.fromEntries(Object.entries(t.inputSchema).filter(([k]) => k !== '$schema')) as typeof t.inputSchema,
            ...(t.annotations ? { annotations: leanAnnotations(t.annotations) } : {}),
        }));
    if (!original) return async () => [];
    server.server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
        const result = await original(req, extra);
        return { ...result, tools: lean(result.tools.filter((t) => policy.listed.has(t.name))) };
    });
    return async () => lean((await original({ method: 'tools/list', params: {} }, {})).tools);
}
