// Drift guards for the tool catalogue (SYNC_SPINE_SPEC 0.4):
//   - the README names every tool and says how many there are;
//   - the tool definitions every chat loads stay under a budget. When a new tool would break it,
//     shorten descriptions; raise the number only with the owner's say-so.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_GROUPS, TOOL_GROUPS, TOOL_NAMES } from '../../src/server.js';
import { connect, type Harness } from './harness.js';

/** Characters of JSON for the default tool definitions, as tools/list returns them (the manage group is listed on request). */
// TOOL_ACCESS_PLAN §2 (11-27): 40,000 → 42,000 for find_tools and use_tool. Claude Code now defers large MCP lists on its
// own; the cap protects Cursor and Antigravity, which load every listed tool into every chat.
export const TOOL_JSON_BUDGET = 42_000;

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

describe('the catalogue', () => {
    it('the README names every tool in backticks', () => {
        const missing = TOOL_NAMES.filter((name) => !readme.includes(`\`${name}\``));
        expect(missing, 'add these tools to mcp/README.md').toEqual([]);
    });

    it("the README's tool count is the real one", () => {
        const stated = /^(\d+) tools\b/m.exec(readme)?.[1];
        expect(stated, 'mcp/README.md must have a line starting "<n> tools"').toBeDefined();
        expect(Number(stated)).toBe(TOOL_NAMES.length);
    });

    it('lists the default groups of TOOL_NAMES, and their definitions stay under the budget', async () => {
        h = await connect({});
        const { tools } = await h.client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES.filter((n) => n !== 'use_read_tool' && DEFAULT_GROUPS.includes(TOOL_GROUPS[n])).sort());
        const size = JSON.stringify(tools).length;
        expect(size, `tool definitions are ${size} characters; the budget is ${TOOL_JSON_BUDGET}`).toBeLessThanOrEqual(TOOL_JSON_BUDGET);
    });

    it('the web set (claude.ai, ChatGPT) stays under its own budget (MCP_MEMORY_PLAN §4.1)', async () => {
        h = await connect({}, { set: 'web' });
        const { tools } = await h.client.listTools();
        const size = JSON.stringify(tools).length;
        expect(size, `the web set's definitions are ${size} characters; its budget is ${WEB_TOOL_JSON_BUDGET}`).toBeLessThanOrEqual(WEB_TOOL_JSON_BUDGET);
    });
});

/** The web set's budget: a host with no tool search loads all of it into every chat. */
export const WEB_TOOL_JSON_BUDGET = 24_000;

/**
 * TOOL_ACCESS_PLAN §12.1 (11-27): what an AI can add, it can change and take back. One row a kind of thing; every name
 * exists; every tool that adds something sits in a row's `adds`, so a new adding tool without a way back fails here.
 */
export const LIFECYCLE: ReadonlyArray<{ thing: string; adds: readonly string[]; changes: readonly string[]; removes: readonly string[] }> = [
    { thing: 'memory', adds: ['remember'], changes: ['update_memory'], removes: ['forget'] },
    { thing: 'task', adds: ['add_task'], changes: ['update_task'], removes: ['delete_task'] },
    { thing: 'reminder', adds: ['set_reminder'], changes: ['set_reminder'], removes: ['cancel_reminder'] },
    { thing: 'lock line', adds: ['show_on_lock_screen'], changes: ['show_on_lock_screen'], removes: ['clear_lock_line'] },
    { thing: 'pocket note', adds: ['add_pocket_note'], changes: ['update_pocket_note'], removes: ['delete_pocket_note'] },
    { thing: 'doc', adds: ['create_doc', 'append_to_doc', 'insert_blocks', 'add_canvas'], changes: ['update_doc', 'replace_section', 'edit_doc_part', 'update_block', 'move_blocks', 'update_canvas', 'move_doc'], removes: ['trash_doc', 'delete_blocks'] },
    { thing: 'revision card', adds: ['set_revision_card'], changes: ['set_revision_card'], removes: ['edit_doc_part'] },
    { thing: 'subject', adds: ['create_subject'], changes: ['update_subject'], removes: ['delete_subject'] },
    { thing: 'topic on a path', adds: ['plan_topics'], changes: ['update_topic'], removes: ['remove_topic'] },
    { thing: 'review schedule', adds: ['schedule_revision'], changes: ['move_revision', 'spread_backlog'], removes: ['stop_revision'] },
    { thing: 'a review done', adds: ['complete_revision'], changes: [], removes: ['uncomplete_revision'] },
    { thing: 'goal', adds: ['create_goal'], changes: ['update_goal'], removes: ['update_goal'] },
    { thing: 'milestone', adds: ['add_milestone'], changes: ['update_milestone', 'complete_milestone'], removes: ['remove_milestone'] },
    { thing: 'week target', adds: ['add_week_target'], changes: ['update_week_target'], removes: ['update_week_target'] },
    { thing: 'focus line', adds: ['add_focus'], changes: ['update_focus'], removes: ['remove_focus'] },
    { thing: 'decision', adds: ['log_decision'], changes: ['update_decision'], removes: ['update_decision'] },
    { thing: 'work line', adds: ['log_work'], changes: ['update_work_line'], removes: ['update_work_line'] },
    { thing: 'time entry', adds: ['checkpoint'], changes: ['update_session'], removes: ['update_session'] },
    { thing: 'lesson note', adds: ['add_note'], changes: ['update_note'], removes: ['remove_note'] },
    { thing: 'file on a note', adds: ['attach_file'], changes: [], removes: ['remove_file'] },
    { thing: 'sharing', adds: ['publish_doc', 'share_doc'], changes: ['share_doc'], removes: ['publish_doc', 'share_doc'] },
    { thing: 'any change of this app', adds: [], changes: [], removes: ['undo_edit'] },
];

/** Writes that add nothing a person would take back (settings, a folder's or a chat's kind, a suggestion that waits for their tap, the trash). */
const NOT_ADDING = new Set(['update_settings', 'update_project', 'set_folder', 'set_chat', 'suggest_to_user', 'empty_trash', 'restore_doc', 'use_tool']);

describe('what an AI adds it can take back (TOOL_ACCESS_PLAN §12.1)', () => {
    it('every row names real tools, each kind of thing has a way back, and every adding tool is in a row', async () => {
        const { TOOL_LEVELS } = await import('../../src/server.js');
        const names = new Set<string>(TOOL_NAMES);
        for (const row of LIFECYCLE) {
            for (const t of [...row.adds, ...row.changes, ...row.removes]) expect(names.has(t), `${row.thing}: ${t}`).toBe(true);
            expect(row.removes.length, row.thing).toBeGreaterThan(0);
        }
        const covered = new Set(LIFECYCLE.flatMap((r) => [...r.adds, ...r.changes, ...r.removes]));
        const adding = TOOL_NAMES.filter((n) => TOOL_LEVELS[n] >= 2 && /^(add|create|log|set|plan|schedule|attach|show|publish|share|remember|checkpoint|append|insert|complete)/.test(n) && !NOT_ADDING.has(n));
        expect(adding.filter((n) => !covered.has(n)), 'an adding tool with no row (no way to take it back)').toEqual([]);
    });
});
