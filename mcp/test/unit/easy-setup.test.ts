// EASY_SETUP_PLAN (11-23) on the PC: the folder's key, the server's rules kept 10 minutes, a new folder that asks once
// (its time waits on the PC until the answer), the chat that says what it is (a typed /study, set_chat) and its time
// split where it changed, set_folder and set_chat as tools.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addPart, folderOf, partAt, projectFolder, readParts, readRules, refreshRules, slashKind, workFolderAbove } from '../../src/folders.js';
import { chatMode, resolveRule, runHook, splitSession, type HookConfig, type ResolvedRule } from '../../src/hook.js';
import { KaagaApi } from '../../src/api.js';
import { connect, fail, ok, type Harness } from './harness.js';

const TOKEN = `rcl_${'a'.repeat(43)}`;
const URL_ = 'http://kaaga.test';

describe('the folder’s key (server mode)', () => {
    const repos = new Set(['E:/p/app/.git', 'E:/p/app/backend/.git', 'C:/Users/me/.git', 'C:/Users/me/code/tool/.git']);
    const has = (p: string) => repos.has(p);
    it('the outermost repo it is in, below the home folder; else the folder itself', () => {
        expect(projectFolder('E:\\p\\app\\backend\\src', 'C:/Users/me', has)).toBe('E:/p/app');
        expect(folderOf('E:/p/App/backend', 'C:/Users/me', (p) => has(p.replace('App', 'app')))).toEqual({ name: 'App', key: 'app' });
        expect(folderOf('D:/erp-workspace', 'C:/Users/me', has)).toEqual({ name: 'erp-workspace', key: 'erp-workspace' });
        // A home kept in git never swallows a project in it.
        expect(projectFolder('C:/Users/me/code/tool/src', 'C:/Users/me', has)).toBe('C:/Users/me/code/tool');
        expect(folderOf('C:/Users/me', 'C:/Users/me', has).key).toBe('me');
    });

    it('a project inside a work folder is part of it; a personal or study folder doesn’t take in what is inside it', () => {
        const f = (kind: 'personal' | 'study' | 'work', decided = true) => ({ name: '', kind, tracking: 'light' as const, decided });
        const work = { folders: { 'erp-workspace': { ...f('work'), name: 'erp-workspace' } } };
        expect(workFolderAbove('D:/erp-workspace/beta/rbpu-erp', work, 'C:/Users/me')).toEqual({ name: 'erp-workspace', key: 'erp-workspace' });
        expect(workFolderAbove('D:/erp-workspace', work, 'C:/Users/me')).toBeNull();
        // The nearest decided folder above it says: a personal one in between stops the climb.
        expect(workFolderAbove('D:/erp-workspace/notes/x', { folders: { ...work.folders, notes: f('personal') } }, 'C:/Users/me')).toBeNull();
        // One nobody decided is passed over.
        expect(workFolderAbove('D:/erp-workspace/beta/rbpu-erp', { folders: { ...work.folders, beta: f('work', false) } }, 'C:/Users/me')?.key).toBe('erp-workspace');
        expect(workFolderAbove('C:/Users/me/code/tool', { folders: { code: f('study') } }, 'C:/Users/me')).toBeNull();
        // Never the home folder or above it.
        expect(workFolderAbove('C:/Users/me/tool', { folders: { me: f('work'), users: f('work') } }, 'C:/Users/me')).toBeNull();
        expect(workFolderAbove('D:/x', null)).toBeNull();
    });
});

describe('a typed /study, /build, /work', () => {
    it('says what the chat is, from now; "all" after it, from its start; anything else is not one', () => {
        expect(slashKind('/study')).toEqual({ kind: 'study', whole: false });
        expect(slashKind('  /work all')).toEqual({ kind: 'work', whole: true });
        // STUDY_FLOW_PLAN §4.5: /build says the chat is building (stored as personal); a typed /personal is no longer one.
        expect(slashKind('<command-message>build</command-message>\n<command-name>/build</command-name>\n<command-args>the whole chat</command-args>')).toEqual({ kind: 'personal', whole: true });
        expect(slashKind('/personal')).toBeNull();
        expect(slashKind('/studying')).toBeNull();
        expect(slashKind('let us study graphs')).toBeNull();
        expect(slashKind('/compact')).toBeNull();
    });
});

describe('a chat’s parts', () => {
    let dir = '';
    afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
    it('a second word for the same thing adds nothing; the agent can’t take back their word for the time before', () => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'rc-parts-'));
        expect(addPart(dir, 's', { at: '2026-11-23T10:10:00Z', kind: 'study', by: 'chat' }).added).toBe(true);
        expect(addPart(dir, 's', { at: '2026-11-23T10:20:00Z', kind: 'study', by: 'agent' }).added).toBe(false);
        // The agent marks work "from the start": it only counts from now, after their word.
        addPart(dir, 's', { at: '2026-11-23T09:00:00Z', kind: 'work', by: 'agent' });
        const parts = readParts(dir, 's');
        expect(parts.map((p) => [p.kind, p.by, p.at])).toEqual([
            ['study', 'chat', '2026-11-23T10:10:00Z'],
            ['work', 'agent', '2026-11-23T10:10:00Z'],
        ]);
        expect(partAt(parts, Date.parse('2026-11-23T10:00:00Z'))).toBeNull();
    });

    it('the time splits where it changed; the same thing twice is one part', () => {
        const at = (m: number) => new Date(Date.UTC(2026, 10, 23, 10, m)).toISOString();
        const stamps = [0, 2, 4, 6, 8, 10, 12, 14].map(at);
        const pieces = splitSession(stamps, at(0), at(16), [{ at: at(7), kind: 'study', by: 'chat' }, { at: at(11), kind: 'study', by: 'agent' }], 'work');
        expect(pieces).toEqual([
            { from: at(0), to: at(7), minutes: 6, part: null },
            { from: at(7), to: at(16), minutes: 10, part: { at: at(7), kind: 'study', by: 'chat' } },
        ]);
        // Past midnight (this computer's clock): the day's time is the day's, in a part of its own (11-26).
        const loc = (m: number) => new Date(2026, 10, 23, 23, 50 + m).toISOString();
        const night = splitSession([0, 2, 4, 6, 8, 10, 12, 14, 16, 18].map(loc), loc(0), loc(20), [{ at: loc(-5), kind: 'study', by: 'chat' }], 'work');
        expect(night.map((p) => [p.from, p.to, p.minutes, p.part?.kind])).toEqual([
            [loc(0), loc(10), 10, 'study'],
            [loc(10), loc(20), 10, 'study'],
        ]);
        // From the start: the whole chat is one part of that kind.
        expect(splitSession(stamps, at(0), at(16), [{ at: at(-5), kind: 'study', by: 'agent' }], 'work')).toHaveLength(1);
    });
});

describe('what is read in a chat', () => {
    const work: ResolvedRule = { path: 'D:/erp', kind: 'work', mode: 'light', brief: false, nudge: true, commits: false, key: 'erp', name: 'erp', root: 'D:/erp', ask: false, office: true, trackingSet: false };
    const mine: ResolvedRule = { ...work, kind: 'personal', mode: 'full', brief: true, nudge: false, commits: true, office: false };
    it('their own word reads a work folder’s chat; an agent’s guess never; a chat marked work reads no words', () => {
        expect(chatMode(work, null)).toBe('light');
        expect(chatMode(work, { at: '', kind: 'study', by: 'chat' })).toBe('full');
        expect(chatMode(work, { at: '', kind: 'study', by: 'agent' })).toBe('light');
        expect(chatMode({ ...work, trackingSet: true }, { at: '', kind: 'study', by: 'chat' })).toBe('light');
        expect(chatMode(mine, { at: '', kind: 'work', by: 'agent' })).toBe('light');
        expect(chatMode({ ...work, mode: 'full', trackingSet: true }, { at: '', kind: 'work', by: 'chat' })).toBe('full');
    });
});

describe('the rules', () => {
    let home = '';
    afterEach(() => home && rmSync(home, { recursive: true, force: true }));
    const config = (allow: HookConfig['allow'] = []): HookConfig => ({ url: URL_, token: TOKEN, allow, brief: true });
    const rules = (folders: Record<string, { kind: 'personal' | 'study' | 'work'; tracking: 'full' | 'light' | 'off'; decided: boolean; trackingSet?: boolean }>, newFolders: 'ask' | 'personal' | 'work' | 'off' = 'ask') => ({
        url: URL_,
        at: new Date().toISOString(),
        newFolders,
        folders: Object.fromEntries(Object.entries(folders).map(([k, f]) => [k, { name: k, ...f }])),
    });

    it('server mode: a decided folder’s rule; an unknown one asks, or follows the default; an older server: nothing', () => {
        const r = rules({ erp: { kind: 'work', tracking: 'light', decided: true }, notes: { kind: 'personal', tracking: 'full', decided: false } });
        expect(resolveRule('D:/erp', config(), r, 'C:/Users/me')).toMatchObject({ key: 'erp', kind: 'work', mode: 'light', brief: false, nudge: true, commits: false, office: true, ask: false });
        expect(resolveRule('D:/notes', config(), r, 'C:/Users/me')).toMatchObject({ key: 'notes', ask: true, mode: 'light', brief: false });
        expect(resolveRule('D:/fresh', config(), null, 'C:/Users/me')).toMatchObject({ ask: true });
        expect(resolveRule('D:/fresh', config(), rules({}, 'work'), 'C:/Users/me')).toMatchObject({ kind: 'work', hint: 'work', ask: false, office: true });
        expect(resolveRule('D:/fresh', config(), rules({}, 'off'), 'C:/Users/me')).toMatchObject({ mode: 'off' });
        expect(resolveRule('D:/fresh', config(), { ...rules({}), unsupported: true }, 'C:/Users/me')).toBeNull();
    });

    it('server mode: a repo inside a work folder (no repo itself) is that folder, unless it was decided on its own', () => {
        home = mkdtempSync(path.join(os.tmpdir(), 'rc-inside-'));
        const repo = path.join(home, 'erp-ws', 'beta', 'rbpu-erp');
        mkdirSync(path.join(repo, '.git'), { recursive: true });
        mkdirSync(path.join(repo, 'src'), { recursive: true });
        const cwd = path.join(repo, 'src');
        const work = { 'erp-ws': { kind: 'work' as const, tracking: 'light' as const, decided: true } };
        const rule = resolveRule(cwd, config(), rules(work));
        expect(rule).toMatchObject({ key: 'erp-ws', name: 'erp-ws', kind: 'work', mode: 'light', office: true, ask: false });
        // Its repos are still its own (the heads for commits).
        expect(rule?.root).toBe(repo.replace(/\\/g, '/'));
        // Decided on its own: its own rule.
        expect(resolveRule(cwd, config(), rules({ ...work, 'rbpu-erp': { kind: 'personal', tracking: 'full', decided: true } }))).toMatchObject({ key: 'rbpu-erp', kind: 'personal', office: false });
        // Inside a personal folder a new repo still asks.
        expect(resolveRule(cwd, config(), rules({ 'erp-ws': { kind: 'personal', tracking: 'full', decided: true } }))).toMatchObject({ key: 'rbpu-erp', ask: true });
    });

    it('the PC’s own list: only what it names; the server’s word on a folder it knows, the stricter of the two', () => {
        const allow = [{ path: 'E:/p/', kind: 'personal' as const }];
        const r = rules({ app: { kind: 'work', tracking: 'light', decided: true }, site: { kind: 'study', tracking: 'off', decided: true, trackingSet: true } });
        expect(resolveRule('F:/elsewhere', config(allow), r)).toBeNull();
        expect(resolveRule('E:/p/app/src', config(allow), r)).toMatchObject({ key: 'app', kind: 'work', mode: 'light', brief: false, office: true, hint: 'personal' });
        expect(resolveRule('E:/p/site', config(allow), r)).toMatchObject({ kind: 'study', mode: 'off' });
        expect(resolveRule('E:/p/new-one', config(allow), r)).toMatchObject({ kind: 'personal', mode: 'full', office: false, hint: 'personal' });
    });

    it('kept 10 minutes; an older server is remembered as such; no answer keeps what the PC had', async () => {
        home = mkdtempSync(path.join(os.tmpdir(), 'rc-rules-'));
        const env = { KAAGA_HOOKS_HOME: home };
        let answer: () => Response = () => new Response(JSON.stringify({ success: true, data: { newFolders: 'ask', folders: [{ key: 'erp', name: 'ERP', kind: 'work', tracking: 'light', decided: true }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
        let calls = 0;
        const api = new KaagaApi({ baseUrl: URL_, token: TOKEN, agentName: 't', retryDelayMs: 0, fetch: (async () => (calls++, answer())) as typeof fetch });
        const t0 = new Date('2026-11-23T10:00:00Z');
        expect((await refreshRules(api, URL_, env, t0))?.folders['erp']).toMatchObject({ name: 'ERP', kind: 'work' });
        await refreshRules(api, URL_, env, new Date(t0.getTime() + 9 * 60_000));
        expect(calls).toBe(1);
        answer = () => new Response('{"message":"x"}', { status: 503 });
        expect((await refreshRules(api, URL_, env, new Date(t0.getTime() + 11 * 60_000)))?.folders['erp']).toBeTruthy();
        answer = () => new Response(JSON.stringify({ success: false, message: 'Access tokens cannot be used here' }), { status: 403 });
        expect(await refreshRules(api, URL_, env, new Date(t0.getTime() + 30 * 60_000))).toMatchObject({ unsupported: true });
        expect(readRules('http://other.test', env)).toBeNull();
    });
});

describe('the hooks in server mode', () => {
    let home = '';
    afterEach(() => {
        vi.unstubAllGlobals();
        if (home) rmSync(home, { recursive: true, force: true });
    });

    function setup(folders: Array<{ key: string; kind: string; tracking: string; decided: boolean }>, newFolders = 'ask') {
        home = mkdtempSync(path.join(os.tmpdir(), 'rc-server-'));
        // The easy setup: config.json only, no hooks.json.
        writeFileSync(path.join(home, 'config.json'), JSON.stringify({ url: URL_, token: TOKEN }));
        const calls: Array<{ method: string; url: string; body: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        const state = { folders, newFolders };
        vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ method: init?.method ?? 'GET', url: String(url), body });
            const u = String(url);
            const data = u.includes('/api/projects/rules')
                ? { newFolders: state.newFolders, folders: state.folders.map((f) => ({ name: f.key, ...f })) }
                : u.includes('/api/brief')
                  ? { now: { day: '2026-11-23', weekday: 'Mon', time: '10:00', timezone: 'Asia/Kolkata' }, profile: null, goals: [], today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] }, next: [], recent: [], recall: { days: 7, finished: 0, weakTopics: [] }, project: null, session: { key: 'cc_k' }, capture: 2 }
                  : u.includes('/api/buddy/words')
                    ? { queued: 1, read: Math.max(...(body?.messages ?? []).map((m: { n?: number }) => m.n ?? 0)), capture: 2 }
                    : { session: {} };
            return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        return { env: { KAAGA_HOOKS_HOME: home, KAAGA_HOOKS_FLUSH: 'inline' }, calls, state };
    }
    const t = (m: number) => new Date(Date.UTC(2026, 10, 23, 5, m));
    const input = (cwd: string, over: Record<string, unknown> = {}) => ({ session_id: 'k1', cwd, source: 'startup', ...over });

    it('a new folder asks once (a day); its time waits on the PC; the answer (set_folder) logs it at the next start', async () => {
        const { env, calls, state } = setup([]);
        const cwd = path.join(home, 'Side-Project');
        mkdirSync(cwd);
        const out = await runHook('start', input(cwd), env, t(0));
        expect(out).toContain('this folder, "Side-Project", is new to Kaaga');
        expect(out).toContain('call set_folder');
        await runHook('prompt', input(cwd, { prompt: 'I want to understand how consensus works in raft' }), env, t(1));
        await runHook('prompt', input(cwd, { prompt: 'and now the log replication part please' }), env, t(4));
        await runHook('end', input(cwd), env, t(8));
        // Nothing sent: no words, no session; the session waits, pending.
        expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
        expect(JSON.parse(readFileSync(path.join(home, 'open', 'k1.json'), 'utf8'))).toMatchObject({ pending: true, project: 'side-project' });
        // Asked already today: the next chat there says nothing about it.
        expect(await runHook('start', input(cwd, { session_id: 'k2' }), env, t(20))).toBe('');

        // Their answer (set_folder writes the PC's rules at once; the server's rules say so at the next fetch).
        state.folders = [{ key: 'side-project', kind: 'study', tracking: 'full', decided: true }];
        writeFileSync(path.join(home, 'rules.json'), JSON.stringify({ url: URL_, at: t(21).toISOString(), newFolders: 'ask', folders: { 'side-project': { name: 'Side-Project', kind: 'study', tracking: 'full', decided: true } } }));
        await runHook('start', input(cwd, { session_id: 'k3' }), env, t(40));
        const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/cc_k1'));
        expect(put?.body).toMatchObject({ project: 'side-project', minutes: 8, source: 'hook' });
        expect(existsSync(path.join(home, 'open', 'k1.json'))).toBe(false);
    });

    it('a work folder: time only; a typed /study reads the rest as theirs; the time splits there; the parts say what they are', async () => {
        const { env, calls } = setup([{ key: 'erp-workspace', kind: 'work', tracking: 'light', decided: true }]);
        const cwd = path.join(home, 'erp-workspace');
        mkdirSync(cwd);
        expect(await runHook('start', input(cwd), env, t(0))).toBe('');
        await runHook('prompt', input(cwd, { prompt: 'fix the GST rounding in the invoice report' }), env, t(1));
        await runHook('stop', input(cwd, { last_assistant_message: 'Fixed.' }), env, t(3));
        await runHook('prompt', input(cwd, { prompt: 'thanks, now the export for the client' }), env, t(5));
        // The first part's words are never read.
        expect(calls.filter((c) => c.url.includes('/api/buddy/words'))).toEqual([]);
        await runHook('prompt', input(cwd, { prompt: '/study' }), env, t(10));
        await runHook('prompt', input(cwd, { prompt: 'explain how consistent hashing spreads keys over servers' }), env, t(12));
        await runHook('stop', input(cwd, { last_assistant_message: 'Picture a ring of hash values.' }), env, t(16));
        await runHook('prompt', input(cwd, { prompt: 'and how virtual nodes even out the load' }), env, t(18));
        await runHook('end', input(cwd), env, t(22));
        const words = calls.filter((c) => c.url.includes('/api/buddy/words'));
        expect(words.length).toBeGreaterThan(0);
        // Their own word: their words, not office ones.
        expect(words[0]!.body).toMatchObject({ project: 'erp-workspace', chat: { kind: 'study', by: 'chat' } });
        expect(words[0]!.body.office).toBeUndefined();
        expect(words.flatMap((w) => w.body.messages.map((m: { text: string }) => m.text))).toEqual(['explain how consistent hashing spreads keys over servers', 'and how virtual nodes even out the load']);
        const puts = calls.filter((c) => c.method === 'PUT');
        expect(puts.map((p) => p.url.split('/').pop())).toEqual(['cc_k1', 'cc_k1%3Ak1']);
        expect(puts[0]!.body).toMatchObject({ project: 'erp-workspace', minutes: 10, titleIfNew: 'erp-workspace', details: {} });
        expect(puts[0]!.body.chatKind).toBeUndefined();
        expect(puts[1]!.body).toMatchObject({ project: 'erp-workspace', minutes: 12, chatKind: 'study', kindBy: 'chat', startedAt: t(10).toISOString(), endedAt: t(22).toISOString() });
    });

    it('a personal folder: the brief and their words; a chat they call work stops the words', async () => {
        const { env, calls } = setup([{ key: 'notes', kind: 'personal', tracking: 'full', decided: true }]);
        const cwd = path.join(home, 'notes');
        mkdirSync(cwd);
        expect(await runHook('start', input(cwd), env, t(0))).toContain('Kaaga (session-start hook): where the user stands');
        await runHook('prompt', input(cwd, { prompt: 'I am finally learning to cook on weekends' }), env, t(1));
        await runHook('prompt', input(cwd, { prompt: '/work' }), env, t(3));
        await runHook('prompt', input(cwd, { prompt: 'the ACME client wants the export by friday' }), env, t(5));
        const texts = calls.filter((c) => c.url.includes('/api/buddy/words')).flatMap((w) => w.body.messages.map((m: { text: string }) => m.text));
        expect(texts).toEqual(['I am finally learning to cook on weekends']);
    });

    it('the account’s default for new folders: off is never heard', async () => {
        const { env, calls } = setup([], 'off');
        const cwd = path.join(home, 'secret');
        mkdirSync(cwd);
        expect(await runHook('start', input(cwd), env, t(0))).toBe('');
        await runHook('prompt', input(cwd, { prompt: 'anything at all here' }), env, t(1));
        await runHook('end', input(cwd), env, t(5));
        expect(calls.filter((c) => !c.url.endsWith('/api/projects/rules'))).toEqual([]);
    });
});

describe('set_folder and set_chat', () => {
    let home = '';
    let h: Harness | undefined;
    afterEach(async () => {
        await h?.close();
        h = undefined;
        vi.unstubAllEnvs();
        if (home) rmSync(home, { recursive: true, force: true });
    });
    const scratch = () => {
        home = mkdtempSync(path.join(os.tmpdir(), 'rc-tools-'));
        vi.stubEnv('KAAGA_HOOKS_HOME', home);
        writeFileSync(path.join(home, 'config.json'), JSON.stringify({ url: 'http://kaaga.test', token: TOKEN }));
    };

    it('set_folder: this folder by default, ignore = nothing logged; this PC’s hooks follow it at once', async () => {
        scratch();
        h = await connect(
            { 'PUT /api/projects/by-key/*': (req) => ok({ key: req.path.split('/').pop(), name: req.body.name, kind: req.body.kind ?? 'personal', tracking: req.body.tracking ?? (req.body.kind === 'work' ? 'light' : 'full'), trackingSet: !!req.body.tracking }) },
            { folder: { key: 'side-project', name: 'Side-Project', isNew: true } }
        );
        const r = await h.call('set_folder', { kind: 'work' });
        expect(r.text).toContain('Side-Project is work');
        expect(h.requests[0]).toMatchObject({ method: 'PUT', path: '/api/projects/by-key/side-project', body: { kind: 'work', name: 'Side-Project' } });
        expect(readRules('http://kaaga.test', { KAAGA_HOOKS_HOME: home })?.folders['side-project']).toMatchObject({ kind: 'work', tracking: 'light', decided: true });
        expect((await h.call('set_folder', { kind: 'ignore', folder: 'Old Stuff' })).text).toContain('ignores Old Stuff');
        expect(h.requests[1]).toMatchObject({ path: '/api/projects/by-key/old%20stuff', body: { tracking: 'off' } });
        // build is stored as personal (an older personal still means build).
        expect((await h.call('set_folder', { kind: 'build', folder: 'notes' })).text).toContain('notes is for building something of their own');
        expect(h.requests[2]).toMatchObject({ body: { kind: 'personal', name: 'notes' } });
        await h.call('set_folder', { kind: 'personal', folder: 'notes' });
        expect(h.requests[3]).toMatchObject({ body: { kind: 'personal' } });
        expect((await h.call('set_folder', { kind: 'study', folder: 'dsa' })).text).toContain('dsa is for learning');
    });

    it('set_chat with the hooks: the chat’s parts on the PC; without them: the session by key, or its next checkpoint', async () => {
        scratch();
        mkdirSync(path.join(home, 'open'), { recursive: true });
        writeFileSync(path.join(home, 'open', 'abc.json'), JSON.stringify({ key: 'cc_abc', sessionId: 'abc', cwd: 'D:/erp', project: 'erp', startedAt: '2026-11-23T05:00:00.000Z', stamps: [new Date().toISOString()], prompts: 2, heads: [] }));
        h = await connect(
            {
                'PATCH /api/sessions/by-key/s_known/kind': ok({ changed: true, session: {} }),
                'PATCH /api/sessions/by-key/s_new/kind': fail(404, 'No session has that key yet', 'NO_SESSION'),
                'PUT /api/sessions/by-key/*': (req) => ok({ session: { title: 'T', minutes: 5, kind: req.body.chatKind === 'study' ? 'study' : 'build', topic: null, subject: null, project: null, score: null }, topic: null, weakSpots: [], topicEditId: null }),
            },
            { folder: { key: 'erp', name: 'erp' } }
        );
        const hooked = await h.call('set_chat', { kind: 'study', by: 'user' });
        expect(hooked.text).toContain('logged as learning from now on');
        expect(readParts(path.join(home, 'open'), 'abc')).toEqual([expect.objectContaining({ kind: 'study', by: 'chat' })]);
        expect((await h.call('set_chat', { kind: 'study', by: 'agent' })).text).toContain('already logged as learning');
        expect(h.requests).toEqual([]);

        // No hooks for these keys: the session by key; a key not on the server yet waits for its checkpoint.
        expect((await h.call('set_chat', { kind: 'study', by: 'agent', key: 's_known', from: 'start' })).text).toContain('logged as learning');
        expect((await h.call('set_chat', { kind: 'study', by: 'user', key: 's_new', from: 'start' })).text).toContain('next checkpoint carries it');
        await h.call('checkpoint', { key: 's_new', title: 'Raft' });
        const cp = h.requests.find((r) => r.method === 'PUT')!;
        expect(cp).toMatchObject({ path: '/api/sessions/by-key/s_new', body: { title: 'Raft', chatKind: 'study', kindBy: 'chat' } });

        // From now on: the later checkpoints go under a new key with the new kind; the agent keeps its key.
        await h.call('set_chat', { kind: 'work', by: 'user', key: 's_new' });
        await h.call('checkpoint', { key: 's_new', title: 'The export' });
        const later = h.requests.filter((r) => r.method === 'PUT').at(-1)!;
        expect(later.path).toMatch(/^\/api\/sessions\/by-key\/s_[0-9a-z]{12}$/);
        expect(later.path).not.toBe('/api/sessions/by-key/s_new');
        expect(later.body).toMatchObject({ chatKind: 'work', kindBy: 'chat' });
    });

    it('their own word in a work folder turns its work set into the full one, the brief with it; an agent’s guess does not; work turns it back', async () => {
        scratch();
        const brief = { now: { day: '2026-11-23', weekday: 'Mon', time: '10:00', timezone: 'Asia/Kolkata' }, profile: null, goals: [], today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] }, next: [], recent: [], recall: { days: 7, finished: 0, weakTopics: [] }, project: null, session: { key: 's_k' } };
        h = await connect({ 'GET /api/brief': ok(brief), 'PATCH /api/sessions/by-key/*': fail(404, 'No session has that key yet', 'NO_SESSION') }, { set: 'office', workMode: true, workProject: 'erp', folder: { key: 'erp', name: 'erp' } });
        const tools = async () => (await h!.client.listTools()).tools.map((t) => t.name);
        expect(await tools()).not.toContain('create_doc');
        expect((await h.call('set_chat', { kind: 'study', by: 'agent', key: 's_k' })).text).not.toContain('full Kaaga tools');
        expect(await tools()).not.toContain('create_doc');
        expect((await h.call('set_chat', { kind: 'study', by: 'user', key: 's_k' })).text).toContain('Their full Kaaga tools are on now');
        expect(await tools()).toEqual(expect.arrayContaining(['create_doc', 'get_week', 'set_chat']));
        await h.call('get_brief', { key: 's_k' });
        expect(h.requests.filter((r) => r.path === '/api/brief').at(-1)!.query).not.toHaveProperty('work');
        // Work again, on their word: the work folder's tools only.
        expect((await h.call('set_chat', { kind: 'work', by: 'user', key: 's_k' })).text).toContain('a work folder’s tools only');
        expect(await tools()).not.toContain('create_doc');
        await h.call('get_brief', { key: 's_k' });
        expect(h.requests.filter((r) => r.path === '/api/brief').at(-1)!.query).toMatchObject({ work: '1' });
    });

    it('a new folder’s instructions ask the question first', async () => {
        h = await connect({}, { folder: { key: 'x', name: 'X-Repo', isNew: true } });
        expect(h.client.getInstructions()).toMatch(/^This folder \("X-Repo"\) is new to Kaaga/);
    });
});
