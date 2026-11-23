// `npx recollect-setup`, `status`, `remove` (EASY_SETUP_PLAN §3) against a scratch home folder: the sign-in by approval,
// the app's files, Claude Code (its MCP server, the four hooks, the skills), Antigravity, an older setup moved over, and
// everything taken out again. No network (a fake server), no npm (a fake install), nothing outside the scratch folder.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageRoot, pathsOf, runRemove, runSetup, runStatus, type SetupIo } from '../../src/setup.js';
import { fakeFetch, ok, fail } from './harness.js';

const URL_ = 'http://recollect.test';
const OLD = `rcl_${'o'.repeat(43)}`;
const NEW = `rcl_${'n'.repeat(43)}`;

let home = '';
afterEach(() => home && rmSync(home, { recursive: true, force: true }));

function scratch() {
    home = mkdtempSync(path.join(os.tmpdir(), 'rc-setup-'));
    mkdirSync(path.join(home, '.claude', 'skills', 'work'), { recursive: true });
    // Their own /work skill, not ours: setup leaves it alone.
    writeFileSync(path.join(home, '.claude', 'skills', 'work', 'SKILL.md'), '---\nname: work\ndescription: my own\n---\nmine\n');
    writeFileSync(
        path.join(home, '.claude', 'settings.json'),
        JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }, { hooks: [{ type: 'command', command: 'node "E:/old/mcp/dist/hook.js" stop' }] }] } })
    );
    mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
    writeFileSync(path.join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { figma: { command: 'npx', args: ['figma'] } } }));
    // An older hand setup: url, token and folder rules in hooks.json.
    mkdirSync(path.join(home, '.recollect'), { recursive: true });
    writeFileSync(path.join(home, '.recollect', 'hooks.json'), JSON.stringify({ url: URL_, token: OLD, allow: [{ path: 'E:/p/', kind: 'personal' }], brief: true }));
}

function io(routes: Parameters<typeof fakeFetch>[0]) {
    const { fetch, requests } = fakeFetch(routes);
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
                // npm install --prefix <app> recollect-setup@…: this package's dist and skills, as npm would lay them out.
                const app = args[args.indexOf('--prefix') + 1]!;
                const pkg = path.join(app, 'node_modules', 'recollect-setup');
                mkdirSync(path.join(pkg, 'dist'), { recursive: true });
                writeFileSync(path.join(pkg, 'dist', 'index.js'), '');
                writeFileSync(path.join(pkg, 'dist', 'hook.js'), '');
                writeFileSync(path.join(pkg, 'package.json'), '{"name":"recollect-setup","version":"0.2.0"}');
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
    return { io: value, logs, opened, ran, requests };
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

describe('recollect-setup', () => {
    it('signs in by approval, moves the older setup over, and sets up Claude Code and Antigravity; status says so; remove takes it out', async () => {
        scratch();
        const p = pathsOf(home);
        // The old token no longer works: a new sign-in.
        const t = io(server((tok) => (tok === NEW ? { name: 'Asha', tokenName: 'LAPTOP (re-collect setup)' } : null)));
        await runSetup({ home, url: URL_ }, t.io);

        expect(t.opened).toEqual(['http://app.test/connect-pc?code=BCDF-GHJK']);
        expect(t.logs.join('\n')).toContain('Check that the page shows the code BCDF-GHJK');
        expect(t.requests.filter((r) => r.path === '/api/setup/poll')).toHaveLength(2);
        expect(JSON.parse(readFileSync(p.config, 'utf8'))).toMatchObject({ url: URL_, token: NEW, name: 'Asha' });
        // The token is never printed.
        expect(t.logs.join('\n')).not.toContain(NEW);
        // hooks.json keeps its folder rules, not the old url and token.
        expect(JSON.parse(readFileSync(p.hooksJson, 'utf8'))).toEqual({ allow: [{ path: 'E:/p/', kind: 'personal' }], brief: true });

        // The app, then Claude Code: its MCP server reads ~/.recollect/config.json (nothing secret in Claude's config).
        const app = path.join(p.app, 'node_modules', 'recollect-setup').replace(/\\/g, '/');
        expect(t.ran.find((r) => r.includes('install'))).toEqual(expect.arrayContaining(['--prefix', p.app, 'recollect-setup@0.2.0']));
        const claude = JSON.parse(readFileSync(p.claudeJson, 'utf8'));
        expect(claude.mcpServers.recollect).toEqual({ type: 'stdio', command: process.execPath.replace(/\\/g, '/'), args: [`${app}/dist/index.js`], env: {} });
        const settings = JSON.parse(readFileSync(p.claudeSettings, 'utf8'));
        expect(settings.model).toBe('opus');
        const commands = Object.values(settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).flat().flatMap((g) => g.hooks.map((h) => h.command));
        expect(commands).toContain('echo done');
        expect(commands.filter((c) => c.includes('hook.js'))).toEqual([
            `"${process.execPath.replace(/\\/g, '/')}" "${app}/dist/hook.js" stop`,
            `"${process.execPath.replace(/\\/g, '/')}" "${app}/dist/hook.js" start`,
            `"${process.execPath.replace(/\\/g, '/')}" "${app}/dist/hook.js" prompt`,
            `"${process.execPath.replace(/\\/g, '/')}" "${app}/dist/hook.js" end`,
        ]);
        expect(existsSync(path.join(p.claudeSkills, 'study', 'SKILL.md'))).toBe(true);
        expect(readFileSync(path.join(p.claudeSkills, 'work', 'SKILL.md'), 'utf8')).toContain('mine');
        expect(t.logs.join('\n')).toContain('Left your own /work alone');
        // A backup beside each file changed.
        expect(readdirSync(p.claudeDir).some((n) => n.startsWith('settings.json.bak-'))).toBe(true);

        // Antigravity: the tools (no folder assumed there) and the skills; its other servers stay.
        const agy = JSON.parse(readFileSync(p.agyMcp, 'utf8'));
        expect(agy.mcpServers.figma).toEqual({ command: 'npx', args: ['figma'] });
        expect(agy.mcpServers.recollect).toMatchObject({ args: [`${app}/dist/index.js`], env: { RECOLLECT_AGENT_NAME: 'Antigravity', RECOLLECT_FOLDERS: 'off' } });
        expect(existsSync(path.join(p.agySkills, 'work', 'SKILL.md'))).toBe(true);

        // status
        const s = io(server(() => ({ name: 'Asha', tokenName: 'LAPTOP (re-collect setup)' })));
        const report = await runStatus({ home }, s.io);
        expect(report).toMatchObject({ url: URL_, signedInAs: 'Asha', app: '0.2.0' });
        expect(report.tools).toEqual([
            { id: 'claude', name: 'Claude Code', mcp: true, hooks: 4, skills: 5 },
            { id: 'antigravity', name: 'Antigravity', mcp: true, skills: 6 },
        ]);

        // Again with a working sign-in: no new code, no browser.
        const again = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runSetup({ home }, again.io);
        expect(again.opened).toEqual([]);
        expect(again.requests.some((r) => r.path === '/api/setup/start')).toBe(false);
        const commandsAgain = Object.values(JSON.parse(readFileSync(p.claudeSettings, 'utf8')).hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).flat().flatMap((g) => g.hooks.map((h) => h.command));
        expect(commandsAgain.filter((c) => c.includes('hook.js'))).toHaveLength(4);

        // remove: the sign-in ends itself; Recollect's entries go, theirs stay.
        const r = io(server(() => ({ name: 'Asha', tokenName: 'x' })));
        await runRemove({ home }, r.io);
        expect(r.requests.map((q) => `${q.method} ${q.path}`)).toEqual(['POST /api/setup/disconnect']);
        expect(r.requests[0]!.headers['authorization']).toBe(`Bearer ${NEW}`);
        const after = JSON.parse(readFileSync(p.claudeSettings, 'utf8'));
        expect(Object.values(after.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).flat().flatMap((g) => g.hooks.map((h) => h.command))).toEqual(['echo done']);
        expect(JSON.parse(readFileSync(p.claudeJson, 'utf8')).mcpServers.recollect).toBeUndefined();
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
