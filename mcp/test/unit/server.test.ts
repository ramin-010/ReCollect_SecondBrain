import { afterEach, describe, expect, it } from 'vitest';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_GROUPS, EXCLUDED_INSTRUCTIONS, INSTRUCTIONS, OFFICE_INSTRUCTIONS, OFFICE_TOOLS, RUNNERS, TOOL_GROUP_NAMES, TOOL_GROUPS, TOOL_LEVELS, TOOL_NAMES, WEB_INSTRUCTIONS, WEB_RULES, WEB_TOOLS, doorPolicy } from '../../src/server.js';
import { CATCH_UP } from '../../src/prompts.js';
import { PLAYBOOKS } from '../../src/playbooks.js';
import { DESTRUCTIVE, IDEMPOTENT } from '../../src/hints.js';
import { capAnswer } from '../../src/tool.js';
import { connect, fail, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

const READS = ['get_brief', 'list_sessions', 'get_week', 'get_standing', 'list_tasks', 'list_decisions', 'get_today', 'get_learning_overview', 'search_docs', 'read_doc', 'preview_diagram', 'list_subjects', 'get_path', 'list_due', 'list_goals', 'recent_agent_edits', 'get_settings', 'list_suggestions', 'list_reminders', 'get_quiz_results', 'get_sharing', 'get_outline', 'recall_memory', 'get_work_log', 'list_notes', 'list_pocket_notes', 'read_note_file', 'find_tools', 'use_read_tool'];
/** What the code door can run (use_read_tool is the web's: a coding tool runs a read through use_tool). */
const CODE_NAMES = TOOL_NAMES.filter((n) => n !== 'use_read_tool');

describe('the server', () => {
    it('lists every tool in TOOL_NAMES (catalogue.test.ts pins the count to the README), each with a title, a description and an object input schema', async () => {
        h = await connect({}, { groups: TOOL_GROUP_NAMES });
        const { tools } = await h.client.listTools();
        expect(tools.map((t) => t.name)).toEqual(CODE_NAMES);
        for (const tool of tools) {
            expect(tool.title, tool.name).toBeTruthy();
            expect(tool.description!.length, tool.name).toBeGreaterThan(40);
            expect(tool.inputSchema.type).toBe('object');
        }
        // Nothing deletes docs or goals; a focus line or a milestone can be removed (undoable), a doc's blocks
        // (delete_blocks), a note on a lesson or a subject (remove_note), a pocket note while they allow it, and a subject
        // (empty at once with Undo, else only on their tap): TOOL_ACCESS_PLAN §4.7.
        expect(tools.filter((t) => /delete|remove/i.test(t.name)).map((t) => t.name)).toEqual(['remove_milestone', 'remove_focus', 'delete_blocks', 'remove_note', 'delete_pocket_note', 'delete_subject', 'remove_file']);
    });

    it('marks reads read-only and writes not; every tool has a level (1 = reads), level 3 only asks', async () => {
        h = await connect({}, { groups: TOOL_GROUP_NAMES });
        const { tools } = await h.client.listTools();
        for (const tool of tools) {
            // A hint MCP assumes anyway is left out of the list (readOnlyHint false): read-only says true, a change says nothing.
            expect(tool.annotations?.readOnlyHint === true, tool.name).toBe(READS.includes(tool.name));
            expect(TOOL_LEVELS[tool.name as keyof typeof TOOL_LEVELS] === 1, tool.name).toBe(READS.includes(tool.name));
        }
        // TOOL_ACCESS_PLAN §4.5: destructive only where existing content is removed or replaced (plus use_tool, which may run one).
        const { createKaagaServer } = await import('../../src/server.js');
        const { KaagaApi } = await import('../../src/api.js');
        const raw = createKaagaServer({ api: new KaagaApi({ baseUrl: 'http://kaaga.test', token: `rcl_${'a'.repeat(43)}`, agentName: 't', log: () => {} }), agentName: 't' });
        const registered = (raw as unknown as { _registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean } }> })._registeredTools;
        const destructive = Object.entries(registered).filter(([, t]) => !t.annotations?.readOnlyHint && t.annotations?.destructiveHint === true).map(([n]) => n).sort();
        expect(destructive).toEqual([...DESTRUCTIVE, 'use_tool'].sort());
        for (const n of IDEMPOTENT) expect(registered[n]?.annotations?.idempotentHint, n).toBe(true);
        const tapped = tools.filter((t) => TOOL_LEVELS[t.name as keyof typeof TOOL_LEVELS] === 3);
        expect(tapped.map((t) => t.name)).toEqual(['empty_trash', 'publish_doc', 'share_doc']);
        for (const t of tapped) expect(t.description, t.name).toMatch(/tap/);
    });

    it('lists the default groups; find_tools turns what it found on for the chat (TOOL_ACCESS_PLAN §3.1)', async () => {
        h = await connect({ 'GET /api/suggestions': { status: 200, data: [] } });
        const listed = async () => (await h!.client.listTools()).tools.map((t) => t.name);
        expect(await listed()).toEqual(CODE_NAMES.filter((n) => DEFAULT_GROUPS.includes(TOOL_GROUPS[n])));
        expect(await listed()).toEqual(expect.arrayContaining(['find_tools', 'use_tool']));
        const changed = new Promise<void>((resolve) => h!.client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()));
        const res = await h.call('find_tools', { query: 'move a review to another day', limit: 3 });
        expect(res.text).toMatch(/^move_revision · Move a review · changes \(Undo\) · in your list now$/m);
        await changed;
        expect(await listed()).toContain('move_revision');
        // Listed or not, every tool runs by its name on this door.
        expect((await h.call('list_suggestions', {})).text).not.toMatch(/No tool named/);
    });

    it('offers the note recipe as a prompt: the skill’s text, plus the topic', async () => {
        h = await connect({});
        const { prompts } = await h.client.listPrompts();
        // TOOL_ACCESS_PLAN §5.3: the jobs with steps are prompts too (a host's prompt menu shows them as commands).
        expect(prompts.map((p) => p.name)).toEqual(['study', 'build', 'work', ...PLAYBOOKS.map((p) => p.id), 'catch_up', 'note_recipe']);
        // E4: the catch-up for a chat with no hooks names the tools it uses.
        const catchUp = await h.client.getPrompt({ name: 'catch_up', arguments: {} });
        const words = (catchUp.messages[0]!.content as { text: string }).text;
        for (const tool of ['get_brief', 'remember', 'update_memory', 'said_on', 'checkpoint']) expect(words).toContain(tool);
        const got = await h.client.getPrompt({ name: 'note_recipe', arguments: { topic: 'consistent hashing' } });
        const text = (got.messages[0]!.content as { text: string }).text;
        expect(text).toContain('## The canvas language');
        expect(text).toContain('Write a Kaaga note on: consistent hashing.');
        expect(text.startsWith('---')).toBe(false);
    });

    it('sends instructions to the client', async () => {
        h = await connect({});
        expect(h.client.getInstructions()).toBe(INSTRUCTIONS);
        expect(INSTRUCTIONS).toContain('From your agent');
    });

    it('with a setup problem every tool answers it and never calls the API', async () => {
        h = await connect({}, { problem: 'KAAGA_TOKEN is not set.' });
        for (const name of ['get_today', 'create_doc', 'add_focus']) {
            const args = name === 'create_doc' ? { title: 'T', markdown: 'x' } : name === 'add_focus' ? { text: 'x' } : {};
            expect(await h.call(name, args)).toEqual({ text: 'KAAGA_TOKEN is not set.', isError: true });
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

describe('a tool set per door (MCP_MEMORY_PLAN §4.1)', () => {
    const names = async () => (await h!.client.listTools()).tools.map((t) => t.name);

    it('web (claude.ai, ChatGPT): its 32 tools and the three runners, its own instructions; every other tool but set_folder runs', async () => {
        h = await connect({ 'GET /api/suggestions': { status: 200, data: [] } }, { set: 'web' });
        expect((await names()).sort()).toEqual([...WEB_TOOLS, ...RUNNERS].sort());
        expect(WEB_TOOLS).toHaveLength(32);
        expect(h.client.getInstructions()).toBe(WEB_INSTRUCTIONS);
        // Not listed, still reachable: by its own name, or through a runner.
        expect((await h.call('list_suggestions', {})).isError).toBe(false);
        expect((await h.call('use_read_tool', { name: 'list_suggestions', args: {} })).isError).toBe(false);
        const folder = await h.call('set_folder', { kind: 'build' });
        expect(folder).toEqual({ text: 'No tool named "set_folder" here. Closest: set_chat, set_reminder, set_revision_card. find_tools("<the job>") shows what exists.', isError: true });
        expect(folder.text).not.toMatch(/disabled/);
    });

    it('code (Claude Code): the default groups with saving, finding and correcting; the rest through find_tools', async () => {
        h = await connect({});
        const listed = await names();
        expect(listed).toEqual(expect.arrayContaining(['remember', 'update_memory', 'recall_memory', 'forget', 'find_tools', 'use_tool']));
        expect(listed).not.toContain('use_read_tool');
        expect(listed).not.toContain('list_sessions');
        expect(listed).not.toContain('get_learning_overview');
        expect(h.client.getInstructions()).toBe(INSTRUCTIONS);
    });

    it('office (a work folder): the seven saving tools; excluded: none, and one line', async () => {
        h = await connect({}, { set: 'office' });
        expect((await names()).sort()).toEqual([...OFFICE_TOOLS].sort());
        expect(h.client.getInstructions()).toBe(OFFICE_INSTRUCTIONS);
        await h.close();
        h = await connect({}, { set: 'excluded' });
        expect(await names()).toEqual([]);
        expect(h.client.getInstructions()).toBe(EXCLUDED_INSTRUCTIONS);
        expect(await h.call('remember', { text: 'x' })).toEqual({ text: EXCLUDED_INSTRUCTIONS, isError: true });
        expect(h.requests).toHaveLength(0);
    });

    it('all (Ask AI): every tool but set_folder and set_chat (it runs in no folder: EASY_SETUP_PLAN) and the runners', async () => {
        h = await connect({}, { set: 'all' });
        expect((await names()).sort()).toEqual(TOOL_NAMES.filter((n) => n !== 'set_folder' && n !== 'set_chat' && !(RUNNERS as readonly string[]).includes(n)).sort());
    });
});

describe('built for many at once (TOOL_ACCESS_PLAN §6)', () => {
    it('a web answer over 60,000 characters is cut at a line end, saying how to ask for less', () => {
        const long = Array.from({ length: 4000 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
        const cut = capAnswer(long);
        expect(cut.length).toBeLessThan(60_200);
        expect(cut).toMatch(/\n\(cut: \d+ more characters\. Ask for less: a smaller limit, one doc, one subject\.\)$/);
        expect(capAnswer('short')).toBe('short');
    });

    it('serverInfo says the package version and which list the door holds', async () => {
        h = await connect({}, { set: 'web' });
        expect(h.client.getServerVersion()?.version).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
        const web = h.client.getServerVersion()!.version;
        await h.close();
        h = await connect({});
        expect(h.client.getServerVersion()!.version).not.toBe(web);
    });
});

describe('what the model is told (TOOL_ACCESS_PLAN §5)', () => {
    it('the web’s first 512 characters are its three rules, standing on their own (ChatGPT reads only those as such)', () => {
        expect(WEB_INSTRUCTIONS.startsWith(WEB_RULES)).toBe(true);
        expect(WEB_RULES.length).toBeLessThanOrEqual(512);
        for (const part of ['(1) Start each chat with get_brief', 'remember', 'update_memory', '(3)', 'find_tools']) expect(WEB_RULES).toContain(part);
        expect(WEB_INSTRUCTIONS.length).toBeLessThanOrEqual(2700);
    });

    it('every tool a playbook or an instruction names exists, and the web reaches it', () => {
        const web = doorPolicy('web');
        const texts = [WEB_INSTRUCTIONS, INSTRUCTIONS, ...PLAYBOOKS.map((p) => p.steps)];
        for (const text of texts) {
            for (const name of text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
                if (['said_on', 'session_key'].includes(name)) continue;
                expect((TOOL_NAMES as readonly string[]).includes(name), name).toBe(true);
                if (text !== INSTRUCTIONS) expect(web.reachable.has(name), name).toBe(true);
            }
        }
        for (const p of PLAYBOOKS) expect(p.steps.length, p.id).toBeLessThanOrEqual(1400);
    });
});

describe('the wording, for anyone (MCP_MEMORY_PLAN §4.10)', () => {
    // Stage 1: the instructions and the tools it touched; stage 4 widens this to every text.
    const TOUCHED = ['get_brief', 'remember', 'update_memory', 'recall_memory', 'forget', 'checkpoint', 'get_work_log', 'log_work', 'create_doc'];

    it('says "the user" and "they": never he, him or his', async () => {
        h = await connect({}, { set: 'all' });
        const { tools } = await h.client.listTools();
        const texts = [INSTRUCTIONS, WEB_INSTRUCTIONS, OFFICE_INSTRUCTIONS, EXCLUDED_INSTRUCTIONS, CATCH_UP, ...tools.filter((t) => TOUCHED.includes(t.name)).map((t) => JSON.stringify(t))];
        for (const text of texts) expect(text, text.slice(0, 80)).not.toMatch(/\b(he|him|his|himself)\b/i);
    });
});
