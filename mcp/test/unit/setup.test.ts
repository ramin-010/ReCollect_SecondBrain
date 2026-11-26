// `npx kaaga-setup`, `status`, `remove` (EASY_SETUP_PLAN §3) against a scratch home folder: the sign-in by approval,
// the app's files, Claude Code (its MCP server, the four hooks, the skills), Antigravity, an older setup moved over, and
// everything taken out again. KAAGA_REBRAND_PLAN D7: a PC that recollect-setup set up moves over (its folder, each
// tool's entries, the old address), only what is ours; until then the new code still finds ~/.recollect. No network
// (a fake server), no npm (a fake install), nothing outside the scratch folder.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kaagaHome, loadConfig } from '../../src/config.js';
import { loadHookConfig, runHook } from '../../src/hook.js';
import { DEFAULT_SERVER, OLD_SERVER, packageRoot, packageVersion, pathsOf, runRemove, runSetup, runStatus, type SetupIo } from '../../src/setup.js';
import { fakeFetch, ok, fail, refused, type Routes } from './harness.js';

const URL_ = 'http://kaaga.test';
const OLD = `rcl_${'o'.repeat(43)}`;
const NEW = `rcl_${'n'.repeat(43)}`;
const slash = (p: string) => p.replace(/\\/g, '/');
const NODE = slash(process.execPath);

let home = '';
afterEach(() => {
    vi.unstubAllEnvs();
    if (home) rmSync(home, { recursive: true, force: true });
    home = '';
});

function scratch() {
    home = mkdtempSync(path.join(os.tmpdir(), 'kaaga-setup-'));
    mkdirSync(path.join(home, '.claude', 'skills', 'work'), { recursive: true });
    // Their own /work skill, not ours: setup leaves it alone.
    writeFileSync(path.join(home, '.claude', 'skills', 'work', 'SKILL.md'), '---\nname: work\ndescription: my own\n---\nmine\n');
    // Our /personal of 0.2.0 (STUDY_FLOW_PLAN §4.5: now /build): it carries our older mark, so it goes.
    mkdirSync(path.join(home, '.claude', 'skills', 'personal'), { recursive: true });
    writeFileSync(path.join(home, '.claude', 'skills', 'personal', 'SKILL.md'), '---\nname: personal\n---\nset_chat personal\n<!-- installed by re-collect -->\n');
    writeFileSync(
        path.join(home, '.claude', 'settings.json'),
        JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }, { hooks: [{ type: 'command', command: 'node "E:/old/mcp/dist/hook.js" stop' }] }] } })
    );
    mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
    writeFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { figma: { command: 'npx', args: ['figma'] } } }));
    // An older hand setup: url, token and folder rules in hooks.json (in the folder from before the rename).
    mkdirSync(path.join(home, '.recollect'), { recursive: true });
    writeFileSync(path.join(home, '.recollect', 'hooks.json'), JSON.stringify({ url: URL_, token: OLD, allow: [{ path: 'E:/p/', kind: 'personal' }], brief: true }));
}

function skill(dir: string, name: string, text: string) {
    mkdirSync(path.join(dir, name), { recursive: true });
    writeFileSync(path.join(dir, name, 'SKILL.md'), text);
}

/** A PC that recollect-setup 0.3 set up: ~/.recollect (sign-in, rules, open chats, the clock, held words, the log, the app) and each tool's entries. */
function oldPc(url = URL_) {
    home = mkdtempSync(path.join(os.tmpdir(), 'kaaga-move-'));
    const rc = path.join(home, '.recollect');
    const oldApp = path.join(rc, 'app', 'node_modules', 'recollect-setup');
    mkdirSync(path.join(oldApp, 'dist'), { recursive: true });
    writeFileSync(path.join(oldApp, 'dist', 'index.js'), '');
    writeFileSync(path.join(oldApp, 'dist', 'hook.js'), '');
    writeFileSync(path.join(oldApp, 'package.json'), '{"name":"recollect-setup","version":"0.3.1"}');
    writeFileSync(path.join(rc, 'app', 'package.json'), '{ "private": true }\n');
    writeFileSync(path.join(rc, 'config.json'), JSON.stringify({ url, token: OLD, name: 'Asha', at: '2026-11-20T10:00:00.000Z' }));
    writeFileSync(path.join(rc, 'rules.json'), JSON.stringify({ url, at: '2026-11-26T09:00:00.000Z', newFolders: 'ask', folders: { notes: { name: 'notes', kind: 'study', tracking: 'full', decided: true } } }));
    writeFileSync(path.join(rc, 'server.json'), JSON.stringify({ url, capture: 2 }));
    mkdirSync(path.join(rc, 'open'), { recursive: true });
    writeFileSync(
        path.join(rc, 'open', 's1.json'),
        JSON.stringify({ key: 'cc_s1', sessionId: 's1', cwd: 'E:/p/notes', project: 'notes', startedAt: '2026-11-26T08:00:00.000Z', stamps: ['2026-11-26T08:00:00.000Z', '2026-11-26T08:20:00.000Z'], prompts: 4, heads: [], pending: true })
    );
    writeFileSync(path.join(rc, 'open', 's1.words.jsonl'), '{"at":"2026-11-26T08:01:00.000Z","text":"how does raft elect a leader"}\n');
    writeFileSync(path.join(rc, 'open', 's1.kind.jsonl'), '{"at":"2026-11-26T08:00:00.000Z","kind":"study","by":"chat"}\n');
    mkdirSync(path.join(rc, 'times', 'notes'), { recursive: true });
    writeFileSync(path.join(rc, 'times', 'notes', '2026-11-26.jsonl'), '{"at":"2026-11-26T08:01:00.000Z","sid":"s1"}\n');
    mkdirSync(path.join(rc, 'held'), { recursive: true });
    writeFileSync(path.join(rc, 'held', 's0.words.jsonl'), '{"at":"2026-11-25T08:01:00.000Z","text":"held words"}\n');
    writeFileSync(path.join(rc, 'hook.log'), '2026-11-25T08:00:00.000Z an old line\n');
    // Claude Code: the server, the four hooks (beside one of theirs), an allow rule of theirs, the 0.3 skills (no mark on recollect-*).
    const appJs = (f: string) => `${slash(oldApp)}/dist/${f}`;
    writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ numStartups: 3, mcpServers: { recollect: { type: 'stdio', command: NODE, args: [appJs('index.js')], env: {} }, figma: { type: 'http', url: 'https://figma.test/mcp' } } }));
    const hook = (arg: string) => ({ hooks: [{ type: 'command', command: `"${NODE}" "${appJs('hook.js')}" ${arg}`, timeout: 5 }] });
    mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
    writeFileSync(
        path.join(home, '.claude', 'settings.json'),
        JSON.stringify({
            permissions: { allow: ['mcp__recollect__get_brief'] },
            hooks: { SessionStart: [{ matcher: 'startup|resume|clear|compact', ...hook('start') }], UserPromptSubmit: [hook('prompt')], Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }, hook('stop')], SessionEnd: [hook('end')] },
        })
    );
    const claudeSkills = path.join(home, '.claude', 'skills');
    skill(claudeSkills, 'recollect-study', '---\nname: recollect-study\n---\nStudy with the user through Recollect.\n');
    skill(claudeSkills, 'recollect-notes', '---\nname: recollect-notes\n---\nWriting notes in Recollect.\n');
    skill(claudeSkills, 'study', '---\nname: study\n---\nset_chat study\n<!-- installed by re-collect -->\n');
    // Antigravity and Cursor: the server as the older setup wrote it.
    const entry = (agent: string) => ({ command: NODE, args: [appJs('index.js')], env: { RECOLLECT_AGENT_NAME: agent, RECOLLECT_FOLDERS: 'off' } });
    mkdirSync(path.join(home, '.gemini', 'config', 'skills'), { recursive: true });
    writeFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { recollect: entry('Antigravity') } }));
    skill(path.join(home, '.gemini', 'config', 'skills'), 'recollect-study', '---\nname: recollect-study\n---\nStudy with the user through Recollect.\n');
    mkdirSync(path.join(home, '.cursor'), { recursive: true });
    writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { recollect: entry('Cursor') } }));
    return { rc, oldApp };
}

/** The setup's side effects, recorded; `atNew`: what https://api.kaaga.in answers (else the routes answer every host). */
function io(routes: Routes, atNew?: Routes) {
    const old = fakeFetch(routes);
    const next = atNew ? fakeFetch(atNew) : null;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) =>
        (next && String(input).startsWith(DEFAULT_SERVER) ? next.fetch : old.fetch)(input, init)) as typeof globalThis.fetch;
    const logs: string[] = [];
    const opened: string[] = [];
    const ran: string[][] = [];
    let clock = Date.parse('2026-11-23T10:00:00Z');
    const value: SetupIo = {
        log: (l) => logs.push(l),
        open: (u) => opened.push(u),
        run: (cmd, args) => {
            ran.push([cmd, ...args]);
            if (args.includes('install')) {
                // npm install --prefix <app> kaaga-setup@…: this package's dist and skills, as npm would lay them out.
                const app = args[args.indexOf('--prefix') + 1]!;
                const pkg = path.join(app, 'node_modules', 'kaaga-setup');
                mkdirSync(path.join(pkg, 'dist'), { recursive: true });
                writeFileSync(path.join(pkg, 'dist', 'index.js'), '');
                writeFileSync(path.join(pkg, 'dist', 'hook.js'), '');
                writeFileSync(path.join(pkg, 'package.json'), '{"name":"kaaga-setup","version":"0.4.0"}');
                cpSync(path.join(packageRoot(), 'skills'), path.join(pkg, 'skills'), { recursive: true });
                return { status: 0, stdout: '', stderr: '' };
            }
            return { status: null, stdout: '', stderr: '' }; // no `claude` on this PATH
        },
        sleep: async (ms) => {
            clock += ms;
        },
        fetch,
        now: () => new Date(clock),
    };
    return { io: value, logs, opened, ran, requests: old.requests, atNew: next?.requests ?? [] };
}

const server = (meFor: (token: string) => unknown) => ({
    'POST /api/setup/start': ok({ deviceCode: 'dev-secret', userCode: 'BCDF-GHJK', verifyUrl: 'http://app.test/connect-pc', verifyUrlComplete: 'http://app.test/connect-pc?code=BCDF-GHJK', interval: 3, expiresIn: 600 }, 201),
    'POST /api/setup/poll': [ok({ status: 'pending' }), ok({ status: 'approved', token: NEW, scopes: ['read'], account: { name: 'Asha' } })],
    'GET /api/setup/me': (req: { headers: Record<string, string> }) => {
        const me = meFor((req.headers['authorization'] ?? '').replace('Bearer ', ''));
        return me ? ok(me) : fail(401, 'Not authorized');
    },
    'POST /api/setup/disconnect': ok({ ended: true }),
});

const hookCommands = (settings: { hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>> }) =>
    Object.values(settings.hooks ?? {})
        .flat()
        .flatMap((g) => g.hooks.map((h) => h.command));

describe('kaaga-setup', () => {
    it('signs in by approval, moves the older setup over, and sets up Claude Code and Antigravity; status says so; remove takes it out', async () => {
        scratch();
        const p = pathsOf(home);
        // The old token no longer works: a new sign-in.
        const t = io(server((tok) => (tok === NEW ? { name: 'Asha', tokenName: 'LAPTOP (Windows) · kaaga-setup' } : null)));
        await runSetup({ home, url: URL_ }, t.io);

        expect(t.opened).toEqual(['http://app.test/connect-pc?code=BCDF-GHJK']);
        expect(t.logs.join('\n')).toContain('Check that the page shows the code BCDF-GHJK');
        expect(t.requests.filter((r) => r.path === '/api/setup/poll')).toHaveLength(2);
        expect(JSON.parse(readFileSync(p.config, 'utf8'))).toMatchObject({ url: URL_, token: NEW, name: 'Asha' });
        // The token is never printed.
        expect(t.logs.join('\n')).not.toContain(NEW);
        // hooks.json (moved to ~/.kaaga) keeps its folder rules, not the old url and token; ~/.recollect is gone.
        expect(JSON.parse(readFileSync(p.hooksJson, 'utf8'))).toEqual({ allow: [{ path: 'E:/p/', kind: 'personal' }], brief: true });
        expect(existsSync(p.oldRc)).toBe(false);
        expect(t.logs.join('\n')).toContain(`Your folder rules in ${slash(p.hooksJson)} still apply`);

        // The app, then Claude Code: its MCP server reads ~/.kaaga/config.json (nothing secret in Claude's config).
        const app = slash(path.join(p.app, 'node_modules', 'kaaga-setup'));
        expect(t.ran.find((r) => r.includes('install'))).toEqual(expect.arrayContaining(['--prefix', p.app, `kaaga-setup@${packageVersion()}`, '--prefer-offline']));
        const claude = JSON.parse(readFileSync(p.claudeJson, 'utf8'));
        expect(claude.mcpServers.kaaga).toEqual({ type: 'stdio', command: NODE, args: [`${app}/dist/index.js`], env: {} });
        const settings = JSON.parse(readFileSync(p.claudeSettings, 'utf8'));
        expect(settings.model).toBe('opus');
        const commands = hookCommands(settings);
        expect(commands).toContain('echo done');
        expect(commands.filter((c) => c.includes('hook.js'))).toEqual([`"${NODE}" "${app}/dist/hook.js" stop`, `"${NODE}" "${app}/dist/hook.js" start`, `"${NODE}" "${app}/dist/hook.js" prompt`, `"${NODE}" "${app}/dist/hook.js" end`]);
        expect(existsSync(path.join(p.claudeSkills, 'study', 'SKILL.md'))).toBe(true);
        expect(existsSync(path.join(p.claudeSkills, 'build', 'SKILL.md'))).toBe(true);
        expect(readFileSync(path.join(p.claudeSkills, 'kaaga-study', 'SKILL.md'), 'utf8')).toMatch(/^---\nname: kaaga-study\n/);
        expect(existsSync(path.join(p.claudeSkills, 'personal'))).toBe(false);
        expect(readFileSync(path.join(p.claudeSkills, 'work', 'SKILL.md'), 'utf8')).toContain('mine');
        expect(t.logs.join('\n')).toContain('Left your own /work alone');
        // A backup beside each file changed.
        expect(readdirSync(p.claudeDir).some((n) => n.startsWith('settings.json.bak-'))).toBe(true);

        // Antigravity: the tools (no folder assumed there) and the skills; its other servers stay.
        const agy = JSON.parse(readFileSync(p.agyMcp, 'utf8'));
        expect(agy.mcpServers.figma).toEqual({ command: 'npx', args: ['figma'] });
        expect(agy.mcpServers.kaaga).toMatchObject({ args: [`${app}/dist/index.js`], env: { KAAGA_AGENT_NAME: 'Antigravity', KAAGA_FOLDERS: 'off' } });
        expect(existsSync(path.join(p.agySkills, 'work', 'SKILL.md'))).toBe(true);

        // status
        const s = io(server(() => ({ name: 'Asha', tokenName: 'LAPTOP (Windows) · kaaga-setup' })));
        const report = await runStatus({ home }, s.io);
        expect(report).toMatchObject({ url: URL_, signedInAs: 'Asha', app: '0.4.0' });
        expect(report.tools).toEqual([
            { id: 'claude', name: 'Claude Code', mcp: true, hooks: 4, skills: 5 },
            { id: 'antigravity', name: 'Antigravity', mcp: true, skills: 6 },
        ]);
        expect(s.logs.join('\n')).not.toContain('recollect-setup');

        // Again with a working sign-in, as `update`: no new code, no browser; npm is asked for the newest version, so a
        // cached list of versions can't install the old one again.
        const again = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runSetup({ home, version: 'latest' }, again.io);
        const update = again.ran.find((r) => r.includes('install'));
        expect(update).toEqual(expect.arrayContaining(['--prefer-online', 'kaaga-setup@latest']));
        expect(update).not.toContain('--prefer-offline');
        expect(again.opened).toEqual([]);
        expect(again.requests.some((r) => r.path === '/api/setup/start')).toBe(false);
        expect(hookCommands(JSON.parse(readFileSync(p.claudeSettings, 'utf8'))).filter((c) => c.includes('hook.js'))).toHaveLength(4);

        // remove: the sign-in ends itself; Kaaga's entries go, theirs stay.
        const r = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runRemove({ home }, r.io);
        expect(r.requests.map((q) => `${q.method} ${q.path}`)).toEqual(['POST /api/setup/disconnect']);
        expect(r.requests[0]!.headers['authorization']).toBe(`Bearer ${NEW}`);
        expect(hookCommands(JSON.parse(readFileSync(p.claudeSettings, 'utf8')))).toEqual(['echo done']);
        expect(JSON.parse(readFileSync(p.claudeJson, 'utf8')).mcpServers.kaaga).toBeUndefined();
        expect(JSON.parse(readFileSync(p.agyMcp, 'utf8')).mcpServers).toEqual({ figma: { command: 'npx', args: ['figma'] } });
        expect(existsSync(path.join(p.claudeSkills, 'study'))).toBe(false);
        expect(readFileSync(path.join(p.claudeSkills, 'work', 'SKILL.md'), 'utf8')).toContain('mine');
        expect(existsSync(p.config)).toBe(false);
        expect(existsSync(p.app)).toBe(false);
    });

    it('a denied sign-in or an older server stops with one plain line; nothing is written', async () => {
        scratch();
        rmSync(path.join(home, '.recollect', 'hooks.json'));
        const denied = io({ ...server(() => null), 'POST /api/setup/poll': ok({ status: 'denied', message: 'Denied on the web page.' }) });
        await expect(runSetup({ home, url: URL_ }, denied.io)).rejects.toThrow('Not connected: Denied on the web page.');
        expect(existsSync(pathsOf(home).config)).toBe(false);
        const old = io({ 'POST /api/setup/start': fail(403, 'Access tokens cannot be used for this endpoint') });
        await expect(runSetup({ home, url: URL_ }, old.io)).rejects.toThrow('doesn’t offer the easy setup yet');
    });
});

describe('a PC that recollect-setup set up (KAAGA_REBRAND_PLAN D7)', () => {
    it('moves over in one run: the sign-in and every file, then each tool’s server, hooks and skills; the old app and folder go last', async () => {
        const { rc } = oldPc();
        const p = pathsOf(home);
        const t = io(server((tok) => (tok === OLD ? { name: 'Asha', tokenName: 'x' } : null)));
        await runSetup({ home }, t.io);

        // The sign-in moved over: no new code, no browser.
        expect(t.requests.some((r) => r.path === '/api/setup/start')).toBe(false);
        expect(JSON.parse(readFileSync(p.config, 'utf8'))).toMatchObject({ url: URL_, token: OLD, name: 'Asha', at: '2026-11-20T10:00:00.000Z' });
        // Everything in ~/.recollect is in ~/.kaaga, as it was: the open chat (its time, words and parts), the clock, held words, the log, the rules.
        expect(JSON.parse(readFileSync(path.join(p.rc, 'open', 's1.json'), 'utf8'))).toMatchObject({ key: 'cc_s1', prompts: 4, pending: true, stamps: ['2026-11-26T08:00:00.000Z', '2026-11-26T08:20:00.000Z'] });
        expect(readFileSync(path.join(p.rc, 'open', 's1.words.jsonl'), 'utf8')).toContain('raft');
        expect(readFileSync(path.join(p.rc, 'open', 's1.kind.jsonl'), 'utf8')).toContain('"study"');
        expect(readFileSync(path.join(p.rc, 'times', 'notes', '2026-11-26.jsonl'), 'utf8')).toContain('"s1"');
        expect(readFileSync(path.join(p.rc, 'held', 's0.words.jsonl'), 'utf8')).toContain('held words');
        expect(readFileSync(path.join(p.rc, 'hook.log'), 'utf8')).toContain('an old line');
        expect(JSON.parse(readFileSync(p.rules, 'utf8'))).toMatchObject({ url: URL_, folders: { notes: { kind: 'study' } } });
        // The new app is in; the old one went after it, and the old folder with it.
        const app = slash(path.join(p.app, 'node_modules', 'kaaga-setup'));
        expect(existsSync(path.join(p.app, 'node_modules', 'kaaga-setup', 'dist', 'hook.js'))).toBe(true);
        expect(existsSync(rc)).toBe(false);

        // Claude Code: kaaga in, our recollect out (their other servers stay), one set of hooks on the new app.
        const claude = JSON.parse(readFileSync(p.claudeJson, 'utf8'));
        expect(Object.keys(claude.mcpServers).sort()).toEqual(['figma', 'kaaga']);
        expect(claude.mcpServers.kaaga.args).toEqual([`${app}/dist/index.js`]);
        expect(claude.numStartups).toBe(3);
        const settings = JSON.parse(readFileSync(p.claudeSettings, 'utf8'));
        const ours = hookCommands(settings).filter((c) => c.includes('hook.js'));
        expect(ours).toHaveLength(4);
        expect(ours.every((c) => c.includes(`"${app}/dist/hook.js"`))).toBe(true);
        expect(hookCommands(settings)).toContain('echo done');
        // Their permission rules are theirs: unchanged, with a hint.
        expect(settings.permissions).toEqual({ allow: ['mcp__recollect__get_brief'] });
        // The skills: the new names in, the older ones out (they had no mark: their names and text say they are ours).
        for (const n of ['kaaga-study', 'kaaga-notes', 'study', 'log-work']) expect(readFileSync(path.join(p.claudeSkills, n, 'SKILL.md'), 'utf8')).toContain('<!-- installed by kaaga -->');
        for (const dir of [p.claudeSkills, p.agySkills]) for (const n of ['recollect-study', 'recollect-notes']) expect(existsSync(path.join(dir, n))).toBe(false);
        expect(existsSync(path.join(p.agySkills, 'kaaga-study', 'SKILL.md'))).toBe(true);

        // Antigravity and Cursor: the same swap; the new entries name the new settings.
        expect(JSON.parse(readFileSync(p.agyMcp, 'utf8')).mcpServers).toEqual({ kaaga: { command: NODE, args: [`${app}/dist/index.js`], env: { KAAGA_AGENT_NAME: 'Antigravity', KAAGA_FOLDERS: 'off' } } });
        expect(JSON.parse(readFileSync(p.cursorMcp, 'utf8')).mcpServers).toEqual({ kaaga: { command: NODE, args: [`${app}/dist/index.js`], env: { KAAGA_AGENT_NAME: 'Cursor', KAAGA_FOLDERS: 'off' } } });

        const out = t.logs.join('\n');
        expect(out).toContain('Took out the older /recollect-study, /recollect-notes.');
        expect(out).toContain(`Moved this PC’s files from ${slash(rc)} to ${slash(p.rc)}`);
        expect(out).toContain('Your Claude Code permissions still name mcp__recollect__… tools: they are mcp__kaaga__… now.');
        expect(out).not.toContain(OLD);

        // Again: nothing left to move, nothing doubled.
        const again = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runSetup({ home }, again.io);
        expect(hookCommands(JSON.parse(readFileSync(p.claudeSettings, 'utf8'))).filter((c) => c.includes('hook.js'))).toHaveLength(4);
        expect(again.logs.join('\n')).not.toContain('Moved this PC');
    });

    it('what isn’t ours stays: their own server by the old name, a skill of theirs by an old name; a run for one tool leaves ~/.recollect as it was', async () => {
        const { rc, oldApp } = oldPc();
        const p = pathsOf(home);
        // Their own entries under the old name: a remote connector in Claude Code, a hand setup with its own token in Cursor.
        const claudeJson = JSON.parse(readFileSync(p.claudeJson, 'utf8'));
        claudeJson.mcpServers.recollect = { type: 'http', url: 'https://api.re-collect.in/mcp' };
        writeFileSync(p.claudeJson, JSON.stringify(claudeJson));
        const hand = { command: 'node', args: ['E:/code/mcp/dist/index.js'], env: { RECOLLECT_URL: 'http://localhost:8002', RECOLLECT_TOKEN: 'rcl_hand' } };
        writeFileSync(p.cursorMcp, JSON.stringify({ mcpServers: { recollect: hand } }));
        // A skill of theirs by an old name, not about us; their own /personal without our mark.
        writeFileSync(path.join(p.claudeSkills, 'recollect-notes', 'SKILL.md'), '---\nname: recollect-notes\n---\nMy own reading notes.\n');
        skill(p.claudeSkills, 'personal', '---\nname: personal\n---\nMy own.\n');

        // Only Antigravity first: Claude Code's hooks still run the old app, so ~/.recollect stays as it is (the old app needs it).
        const one = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runSetup({ home, tools: ['antigravity'] }, one.io);
        expect(existsSync(path.join(oldApp, 'dist', 'hook.js'))).toBe(true);
        expect(existsSync(path.join(rc, 'config.json'))).toBe(true);
        expect(existsSync(path.join(rc, 'open', 's1.json'))).toBe(true);
        expect(existsSync(path.join(p.rc, 'open'))).toBe(false);
        expect(one.logs.join('\n')).toContain(`${slash(rc)} stays as it is for now: Claude Code still runs the older app there`);
        expect(JSON.parse(readFileSync(p.agyMcp, 'utf8')).mcpServers.recollect).toBeUndefined();

        // Then every tool: the rest moves; theirs stays.
        const all = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runSetup({ home }, all.io);
        const claude = JSON.parse(readFileSync(p.claudeJson, 'utf8')).mcpServers;
        expect(claude.recollect).toEqual({ type: 'http', url: 'https://api.re-collect.in/mcp' });
        expect(claude.kaaga).toBeDefined();
        expect(JSON.parse(readFileSync(p.cursorMcp, 'utf8')).mcpServers).toMatchObject({ recollect: hand, kaaga: { env: { KAAGA_AGENT_NAME: 'Cursor' } } });
        expect(readFileSync(path.join(p.claudeSkills, 'recollect-notes', 'SKILL.md'), 'utf8')).toContain('My own reading notes.');
        expect(readFileSync(path.join(p.claudeSkills, 'personal', 'SKILL.md'), 'utf8')).toContain('My own.');
        expect(existsSync(path.join(p.claudeSkills, 'recollect-study'))).toBe(false);
        expect(all.logs.join('\n')).toContain('Left your own "recollect" server alone.');
        expect(existsSync(path.join(p.rc, 'open', 's1.json'))).toBe(true);
        expect(existsSync(rc)).toBe(false);

        // remove takes out ours only: their entries by the old name stay.
        await runRemove({ home }, io(server(() => ({ name: 'Asha', tokenName: 'x' }))).io);
        expect(JSON.parse(readFileSync(p.claudeJson, 'utf8')).mcpServers).toEqual({ recollect: { type: 'http', url: 'https://api.re-collect.in/mcp' }, figma: { type: 'http', url: 'https://figma.test/mcp' } });
        expect(JSON.parse(readFileSync(p.cursorMcp, 'utf8')).mcpServers).toEqual({ recollect: hand });
    });

    it('the old address moves to https://api.kaaga.in when that answers: the same sign-in, and the server’s answers on the PC come along', async () => {
        oldPc(OLD_SERVER);
        const p = pathsOf(home);
        const t = io({}, server((tok) => (tok === OLD ? { name: 'Asha', tokenName: 'x' } : null)));
        await runSetup({ home }, t.io);
        expect(t.atNew.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/setup/me']);
        expect(t.requests).toEqual([]);
        expect(JSON.parse(readFileSync(p.config, 'utf8'))).toMatchObject({ url: DEFAULT_SERVER, token: OLD, name: 'Asha' });
        expect(t.logs.join('\n')).toContain(`✓ This PC now uses Kaaga’s new address, ${DEFAULT_SERVER}.`);
        // The folder rules and what the server speaks hold for the new address (a known folder doesn't ask again).
        expect(JSON.parse(readFileSync(p.rules, 'utf8')).url).toBe(DEFAULT_SERVER);
        expect(JSON.parse(readFileSync(path.join(p.rc, 'server.json'), 'utf8'))).toEqual({ url: DEFAULT_SERVER, capture: 2 });
    });

    it('the old address stays, with one line, while https://api.kaaga.in doesn’t answer; an address they name is never changed', async () => {
        oldPc(OLD_SERVER);
        const p = pathsOf(home);
        const t = io(server((tok) => (tok === OLD ? { name: 'Asha', tokenName: 'x' } : null)), { 'GET /api/setup/me': refused() });
        await runSetup({ home }, t.io);
        expect(t.atNew.length).toBeGreaterThan(0);
        expect(JSON.parse(readFileSync(p.config, 'utf8'))).toMatchObject({ url: OLD_SERVER, token: OLD });
        expect(t.logs.filter((l) => l.includes('didn’t answer'))).toEqual([`  ${DEFAULT_SERVER} didn’t answer, so this PC stays on ${OLD_SERVER} for now (it works until 22 Jan 2027): run this again later.`]);
        expect(JSON.parse(readFileSync(p.rules, 'utf8')).url).toBe(OLD_SERVER);
        // status says there is a new address.
        const s = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runStatus({ home }, s.io);
        expect(s.logs.join('\n')).toContain('Kaaga has a new address');

        const named = io(server(() => ({ name: 'Asha', tokenName: 'x' })), server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runSetup({ home, url: OLD_SERVER }, named.io);
        expect(named.atNew).toEqual([]);
        expect(JSON.parse(readFileSync(p.config, 'utf8')).url).toBe(OLD_SERVER);
    });

    it('before the move, the new code still finds ~/.recollect: the MCP server’s sign-in, the hooks’ rules and open sessions', async () => {
        home = mkdtempSync(path.join(os.tmpdir(), 'kaaga-before-'));
        const rc = path.join(home, '.recollect');
        mkdirSync(rc);
        writeFileSync(path.join(rc, 'config.json'), JSON.stringify({ url: URL_, token: OLD }));
        writeFileSync(path.join(rc, 'hooks.json'), JSON.stringify({ allow: ['E:/p/'] }));
        expect(kaagaHome({}, home)).toBe(rc);
        expect(kaagaHome({ RECOLLECT_HOOKS_HOME: 'X:/h' }, home)).toBe('X:/h');
        expect(kaagaHome({ KAAGA_HOOKS_HOME: 'Y:/h', RECOLLECT_HOOKS_HOME: 'X:/h' }, home)).toBe('Y:/h');

        // From here os.homedir() is the scratch folder (checked first: nothing below may reach the real home).
        vi.stubEnv('USERPROFILE', home);
        vi.stubEnv('HOME', home);
        expect(path.resolve(os.homedir())).toBe(path.resolve(home));
        expect(loadConfig({})).toMatchObject({ baseUrl: URL_, token: OLD, problem: null });
        expect(loadHookConfig({})).toMatchObject({ url: URL_, token: OLD, allow: ['E:/p/'] });
        await runHook('prompt', { session_id: 's9', cwd: 'E:/p/app', prompt: 'carry on with the export screen' }, {}, new Date('2026-11-26T10:00:00Z'));
        expect(JSON.parse(readFileSync(path.join(rc, 'open', 's9.json'), 'utf8'))).toMatchObject({ project: 'app', prompts: 1 });
        expect(existsSync(path.join(home, '.kaaga'))).toBe(false);

        // Once a setup has saved the sign-in in ~/.kaaga, that folder is the one.
        mkdirSync(path.join(home, '.kaaga'));
        writeFileSync(path.join(home, '.kaaga', 'config.json'), JSON.stringify({ url: URL_, token: NEW }));
        expect(kaagaHome({}, home)).toBe(path.join(home, '.kaaga'));
        expect(loadConfig({}).token).toBe(NEW);
    });
});
