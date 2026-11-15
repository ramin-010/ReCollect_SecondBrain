import { afterEach, describe, expect, it } from 'vitest';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_GROUPS, INSTRUCTIONS, TOOL_GROUP_NAMES, TOOL_GROUPS, TOOL_LEVELS, TOOL_NAMES } from '../../src/server.js';
import { connect, fail, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const READS = ['get_brief', 'list_sessions', 'get_week', 'get_mirror', 'list_tasks', 'list_decisions', 'get_today', 'get_learning_overview', 'search_docs', 'read_doc', 'preview_diagram', 'list_subjects', 'get_path', 'list_due', 'list_goals', 'recent_agent_edits', 'more_tools', 'get_settings', 'list_suggestions', 'list_reminders', 'get_recall', 'get_sharing', 'get_outline', 'recall_memory'];

describe('the server', () => {
    it('lists every tool in TOOL_NAMES (catalogue.test.ts pins the count to the README), each with a title, a description and an object input schema', async () => {
        h = await connect({}, { groups: TOOL_GROUP_NAMES });
        const { tools } = await h.client.listTools();
        expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
        expect(tools).toHaveLength(TOOL_NAMES.length);
        for (const tool of tools) {
            expect(tool.title, tool.name).toBeTruthy();
            expect(tool.description!.length, tool.name).toBeGreaterThan(40);
            expect(tool.inputSchema.type).toBe('object');
        }
        // Nothing deletes docs, goals or subjects; a focus line or a milestone can be removed (undoable).
        // ...and a doc's blocks (delete_blocks; Undo brings them back).
        expect(tools.filter((t) => /delete|remove/i.test(t.name)).map((t) => t.name)).toEqual(['remove_milestone', 'remove_focus', 'delete_blocks']);
    });

    it('marks reads read-only and writes not; every tool has a level (1 = reads), level 3 only asks', async () => {
        h = await connect({}, { groups: TOOL_GROUP_NAMES });
        const { tools } = await h.client.listTools();
        for (const tool of tools) {
            expect(tool.annotations?.readOnlyHint, tool.name).toBe(READS.includes(tool.name));
            expect(TOOL_LEVELS[tool.name as keyof typeof TOOL_LEVELS] === 1, tool.name).toBe(READS.includes(tool.name));
        }
        const tapped = tools.filter((t) => TOOL_LEVELS[t.name as keyof typeof TOOL_LEVELS] === 3);
        expect(tapped.map((t) => t.name)).toEqual(['empty_trash', 'publish_doc', 'share_doc']);
        for (const t of tapped) expect(t.description, t.name).toMatch(/tap/);
    });

    it('lists the default groups; more_tools turns the manage group on for the chat', async () => {
        h = await connect({});
        const listed = async () => (await h!.client.listTools()).tools.map((t) => t.name);
        expect(await listed()).toEqual(TOOL_NAMES.filter((n) => DEFAULT_GROUPS.includes(TOOL_GROUPS[n])));
        const changed = new Promise<void>((resolve) => h!.client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()));
        const res = await h.call('more_tools', {});
        expect(res.text).toBe('Turned on: update_goal, add_milestone, complete_milestone, update_milestone, remove_milestone, update_focus, remove_focus, trash_doc, restore_doc, empty_trash, complete_revision, move_revision, get_settings, update_settings, update_project, list_suggestions, set_reminder, list_reminders, cancel_reminder, get_recall, get_sharing, publish_doc, share_doc, spread_backlog, move_blocks, recall_memory, forget. They are in your tool list now.');
        await changed;
        expect(await listed()).toEqual([...TOOL_NAMES]);
    });

    it('offers the note recipe as a prompt: the skill’s text, plus the topic', async () => {
        h = await connect({});
        const { prompts } = await h.client.listPrompts();
        expect(prompts.map((p) => p.name)).toEqual(['note_recipe']);
        const got = await h.client.getPrompt({ name: 'note_recipe', arguments: { topic: 'consistent hashing' } });
        const text = (got.messages[0]!.content as { text: string }).text;
        expect(text).toContain('## The canvas language');
        expect(text).toContain('Write a Recollect note on: consistent hashing.');
        expect(text.startsWith('---')).toBe(false);
    });

    it('sends instructions to the client', async () => {
        h = await connect({});
        expect(h.client.getInstructions()).toBe(INSTRUCTIONS);
        expect(INSTRUCTIONS).toContain('From your agent');
    });

    it('with a setup problem every tool answers it and never calls the API', async () => {
        h = await connect({}, { problem: 'RECOLLECT_TOKEN is not set.' });
        for (const name of ['get_today', 'create_doc', 'add_focus']) {
            const args = name === 'create_doc' ? { title: 'T', markdown: 'x' } : name === 'add_focus' ? { text: 'x' } : {};
            expect(await h.call(name, args)).toEqual({ text: 'RECOLLECT_TOKEN is not set.', isError: true });
        }
        expect(h.requests).toHaveLength(0);
    });

    it('never puts the token in an answer, even on errors', async () => {
        h = await connect({ 'GET /api/goals': fail(401, 'Invalid access token'), 'POST /api/focus': fail(500, 'Server Error') });
        const answers = [await h.call('list_goals'), await h.call('add_focus', { text: 'x' })];
        for (const a of answers) {
            expect(a.isError).toBe(true);
            expect(a.text).not.toContain('rcl_');
        }
        expect(h.logs.join('\n')).not.toContain('rcl_');
    });

    it('a bad argument is an error result the agent can read', async () => {
        h = await connect({});
        const res = await h.call('read_doc', {});
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(/docId/);
    });
});
