// `npx recollect-setup` and friends (EASY_SETUP_PLAN §3, 11-23): one command for anyone.
//
//   setup    sign this computer in by approval (a code checked in the browser, no token to copy), install the app in
//            ~/.recollect/app (so a hook never waits for npx), and add Recollect to each AI tool found here:
//              Claude Code   the MCP server (user scope), the four hooks, the skills (/log-work, /study, …)
//              Antigravity   the MCP server (~/.gemini/config/mcp_config.json), the skills
//              Cursor        the MCP server (~/.cursor/mcp.json)
//            Safe to run again (it repairs); a working sign-in is kept unless --login.
//   status   what is set up, who it is signed in as, and what this folder is
//   remove   takes it all out again (the sign-in ends itself on the server)
//   update   the newest app, then the same steps as setup
//
// Every file it changes gets a backup beside it first (<file>.bak-<time>); only Recollect's own entries are touched.
// The token is written to ~/.recollect/config.json only (never printed, never in a tool's config).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, RecollectApi } from './api.js';

export const PACKAGE = 'recollect-setup';
export const DEFAULT_SERVER = 'https://api.re-collect.in';
/** Our skills (skills/<name>/SKILL.md beside dist/). */
export const SKILLS = ['recollect-study', 'recollect-notes', 'log-work', 'study', 'build', 'work'] as const;
/** Our skills of older versions, taken out when they still carry our mark (STUDY_FLOW_PLAN §4.5: /personal became /build). */
export const OLD_SKILLS = ['personal'] as const;
/** The MCP server's name in every tool. */
const SERVER_NAME = 'recollect';
const MARK = '<!-- installed by re-collect -->';

export interface SetupIo {
    log: (line: string) => void;
    /** Opens a page in the browser (tests: records it). */
    open: (url: string) => void;
    /** Runs a program; null status = it could not start. */
    run: (cmd: string, args: string[], opts?: { cwd?: string }) => { status: number | null; stdout: string; stderr: string };
    sleep: (ms: number) => Promise<void>;
    fetch?: typeof globalThis.fetch;
    now: () => Date;
}

export interface SetupOptions {
    /** The home folder everything goes under (tests: a scratch one). */
    home: string;
    url?: string;
    /** Sign in again even when the saved sign-in works. */
    login?: boolean;
    /** Only these tools (claude, antigravity, cursor); default: every one found. */
    tools?: string[];
    noOpen?: boolean;
    /** Install the app from this folder or .tgz (a build not on npm yet), instead of npm's recollect-setup. */
    from?: string;
    /** Use this package's own files where they are (a developer's checkout), no app install. */
    here?: boolean;
    /** The version to install from npm (default: this package's). */
    version?: string;
}

// ─── Paths ────────────────────────────────────────────────────────────

export interface Paths {
    home: string;
    rc: string;
    config: string;
    hooksJson: string;
    rules: string;
    app: string;
    claudeDir: string;
    claudeJson: string;
    claudeSettings: string;
    claudeSkills: string;
    agyDir: string;
    agyMcp: string;
    agySkills: string;
    cursorDir: string;
    cursorMcp: string;
}

export function pathsOf(home: string): Paths {
    const rc = path.join(home, '.recollect');
    return {
        home,
        rc,
        config: path.join(rc, 'config.json'),
        hooksJson: path.join(rc, 'hooks.json'),
        rules: path.join(rc, 'rules.json'),
        app: path.join(rc, 'app'),
        claudeDir: path.join(home, '.claude'),
        claudeJson: path.join(home, '.claude.json'),
        claudeSettings: path.join(home, '.claude', 'settings.json'),
        claudeSkills: path.join(home, '.claude', 'skills'),
        agyDir: path.join(home, '.gemini', 'config'),
        agyMcp: path.join(home, '.gemini', 'config', 'mcp_config.json'),
        agySkills: path.join(home, '.gemini', 'config', 'skills'),
        cursorDir: path.join(home, '.cursor'),
        cursorMcp: path.join(home, '.cursor', 'mcp.json'),
    };
}

/** This package's root (dist/ is one level down). */
export const packageRoot = (): string => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const packageVersion = (): string => {
    try {
        return (JSON.parse(readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
};

/** Where the app's files are: the installed copy, or this package in place (--here). */
export const appRoot = (p: Paths, here?: boolean): string => (here ? packageRoot() : path.join(p.app, 'node_modules', PACKAGE));
const slash = (p: string) => p.replace(/\\/g, '/');

// ─── Small file helpers ───────────────────────────────────────────────

function readJson<T>(file: string): T | null {
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, '-');

/** Writes JSON, after a backup of what was there. */
function writeJsonWithBackup(file: string, value: unknown, now: Date): void {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) copyFileSync(file, `${file}.bak-${stamp(now)}`);
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// ─── The sign-in ──────────────────────────────────────────────────────

export interface SavedConfig {
    url: string;
    token: string;
    /** Their first name, as the server said at the sign-in. */
    name?: string;
    at?: string;
}

export const readSaved = (p: Paths): SavedConfig | null => {
    const c = readJson<Partial<SavedConfig>>(p.config);
    return c?.url && c.token ? (c as SavedConfig) : null;
};

const platformName = (): string => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[process.platform as string] ?? process.platform;

/** Who a token is signed in as (null: it doesn't work any more). Throws for an older server without the easy setup. */
export async function whoAmI(url: string, token: string, io: SetupIo): Promise<{ name: string; tokenName: string | null } | null> {
    const api = new RecollectApi({ baseUrl: url, token, agentName: 'recollect-setup', timeoutMs: 15_000, ...(io.fetch ? { fetch: io.fetch } : {}) });
    try {
        return await api.get<{ name: string; tokenName: string | null }>('/api/setup/me');
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
    }
}

async function post<T>(url: string, body: unknown, io: SetupIo): Promise<T> {
    const f = io.fetch ?? globalThis.fetch;
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': `${PACKAGE}/${packageVersion()}` }, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed: { data?: T; message?: string } | null = null;
    try {
        parsed = JSON.parse(text) as { data?: T; message?: string };
    } catch {
        // Not JSON: an older server, a proxy page.
    }
    if (!res.ok || !parsed?.data) {
        if (res.status === 404 || res.status === 403) throw new Error('This Recollect server doesn’t offer the easy setup yet (it is an older release).');
        throw new Error(parsed?.message || `The server answered ${res.status}.`);
    }
    return parsed.data;
}

/** Signs this computer in by approval: shows the code, opens the page, waits for their answer (10 minutes at most). */
export async function signIn(url: string, opts: { noOpen?: boolean }, io: SetupIo): Promise<SavedConfig> {
    const start = await post<{ deviceCode: string; userCode: string; verifyUrl: string; verifyUrlComplete: string; interval: number; expiresIn: number }>(
        `${url}/api/setup/start`,
        { device: `${os.hostname()} (${platformName()})` },
        io
    );
    io.log('');
    io.log('  To connect this computer, approve it in your browser:');
    io.log(`    ${start.verifyUrlComplete}`);
    io.log(`  Check that the page shows the code ${start.userCode}, then press Approve.`);
    io.log('');
    if (!opts.noOpen) io.open(start.verifyUrlComplete);
    let wait = Math.max(1, start.interval) * 1000;
    const until = io.now().getTime() + start.expiresIn * 1000;
    while (io.now().getTime() < until) {
        await io.sleep(wait);
        const r = await post<{ status: string; message?: string; token?: string; account?: { name: string } }>(`${url}/api/setup/poll`, { deviceCode: start.deviceCode }, io);
        if (r.status === 'approved' && r.token) {
            const name = r.account?.name;
            return { url, token: r.token, ...(name ? { name } : {}), at: io.now().toISOString() };
        }
        if (r.status === 'slow_down') wait += 2000;
        else if (r.status === 'denied') throw new Error(r.message ? `Not connected: ${r.message}` : 'Not connected: it was denied in the browser.');
        else if (r.status === 'expired') throw new Error(r.message ?? 'The code ran out. Run the command again.');
    }
    throw new Error('The code ran out (10 minutes). Run the command again.');
}

export function saveConfig(p: Paths, c: SavedConfig): void {
    mkdirSync(p.rc, { recursive: true });
    writeFileSync(p.config, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
}

// ─── The app's files ──────────────────────────────────────────────────

/** npm's own script beside this node (no shell needed), else `npm` on the PATH. */
function npmCommand(): { cmd: string; pre: string[] } {
    const candidates = [
        process.env['npm_execpath'],
        path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].filter((c): c is string => !!c && /npm-cli\.js$/.test(c) && existsSync(c));
    return candidates[0] ? { cmd: process.execPath, pre: [candidates[0]] } : { cmd: 'npm', pre: [] };
}

/** Installs (or updates) the app in ~/.recollect/app: npm's recollect-setup, or a build from --from. */
export function installApp(p: Paths, opts: Pick<SetupOptions, 'from' | 'version'>, io: SetupIo): void {
    mkdirSync(p.app, { recursive: true });
    if (!existsSync(path.join(p.app, 'package.json'))) writeFileSync(path.join(p.app, 'package.json'), '{ "private": true, "description": "Recollect on this computer (recollect-setup)" }\n');
    const what = opts.from ? path.resolve(opts.from) : `${PACKAGE}@${opts.version ?? packageVersion()}`;
    // A named version never changes, so npm's cache may answer; "latest" (update) asks the registry, or a cached
    // list of versions would install the old one again (`--prefer-offline` trusts any cached list).
    const cache = opts.version === 'latest' && !opts.from ? '--prefer-online' : '--prefer-offline';
    const { cmd, pre } = npmCommand();
    const r = io.run(cmd, [...pre, 'install', '--no-audit', '--no-fund', '--omit=dev', cache, '--prefix', p.app, what], { cwd: p.app });
    if (r.status !== 0) throw new Error(`Installing the app failed (npm install ${what}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
}

// ─── Claude Code ──────────────────────────────────────────────────────

/** Our hooks: their command runs Recollect's hook.js (this setup's, or an older hand install's mcp/dist/hook.js). */
export const isOurHook = (command: unknown): boolean => {
    const c = String(command ?? '').replace(/\\/g, '/');
    return /dist\/hook\.js/.test(c) && /re-collect|recollect|\/mcp\/dist\//i.test(c);
};

const HOOK_EVENTS: Array<[string, string, Record<string, unknown>, number]> = [
    ['SessionStart', 'start', { matcher: 'startup|resume|clear|compact' }, 10],
    ['UserPromptSubmit', 'prompt', {}, 5],
    ['Stop', 'stop', {}, 5],
    ['SessionEnd', 'end', {}, 10],
];

type HookGroup = { matcher?: string; hooks?: Array<{ type?: string; command?: string; timeout?: number }> };

/** Merges the four hooks into Claude Code's settings (ours replaced, nothing else touched); remove: ours out. */
export function writeClaudeHooks(p: Paths, hookJs: string | null, now: Date): void {
    const settings = readJson<{ hooks?: Record<string, HookGroup[]> }>(p.claudeSettings) ?? {};
    const hooks: Record<string, HookGroup[]> = { ...(settings.hooks ?? {}) };
    for (const [event] of HOOK_EVENTS) {
        const groups = (hooks[event] ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurHook(h.command)) })).filter((g) => g.hooks.length > 0);
        if (groups.length) hooks[event] = groups;
        else delete hooks[event];
    }
    if (hookJs) {
        const node = slash(process.execPath);
        for (const [event, arg, extra, timeout] of HOOK_EVENTS) (hooks[event] ??= []).push({ ...extra, hooks: [{ type: 'command', command: `"${node}" "${slash(hookJs)}" ${arg}`, timeout }] });
    }
    const next: Record<string, unknown> = { ...settings };
    if (Object.keys(hooks).length) next['hooks'] = hooks;
    else delete next['hooks'];
    writeJsonWithBackup(p.claudeSettings, next, now);
}

export const countOurHooks = (p: Paths): number =>
    Object.values(readJson<{ hooks?: Record<string, HookGroup[]> }>(p.claudeSettings)?.hooks ?? {})
        .flatMap((g) => g)
        .flatMap((g) => g.hooks ?? [])
        .filter((h) => isOurHook(h.command)).length;

/** `claude` on this PC (the CLI); null when it isn't on the PATH. */
function claudeCli(io: SetupIo): string | null {
    const r = io.run('claude', ['--version']);
    return r.status === 0 ? 'claude' : null;
}

/**
 * Claude Code's MCP server, at the user scope: with its CLI (`claude mcp add`), else written into ~/.claude.json.
 * The server reads the url and token from ~/.recollect/config.json: nothing secret goes into Claude Code's config.
 */
export function writeClaudeMcp(p: Paths, entry: string | null, io: SetupIo, useCli: boolean): 'cli' | 'file' {
    if (useCli && claudeCli(io)) {
        io.run('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user']);
        if (entry) {
            const r = io.run('claude', ['mcp', 'add', '-s', 'user', SERVER_NAME, '--', slash(process.execPath), slash(entry)]);
            if (r.status !== 0) throw new Error(`claude mcp add failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`);
        }
        return 'cli';
    }
    const json = readJson<{ mcpServers?: Record<string, unknown> }>(p.claudeJson);
    if (!json && !entry) return 'file';
    const servers = { ...(json?.mcpServers ?? {}) };
    if (entry) servers[SERVER_NAME] = { type: 'stdio', command: slash(process.execPath), args: [slash(entry)], env: {} };
    else delete servers[SERVER_NAME];
    writeJsonWithBackup(p.claudeJson, { ...(json ?? {}), mcpServers: servers }, io.now());
    return 'file';
}

/** Recollect's MCP server in Claude Code's user config (as the file shows it). */
export function claudeHasMcp(p: Paths, io: SetupIo, useCli: boolean): boolean {
    if (useCli && claudeCli(io)) {
        const r = io.run('claude', ['mcp', 'get', SERVER_NAME]);
        return r.status === 0;
    }
    return !!readJson<{ mcpServers?: Record<string, unknown> }>(p.claudeJson)?.mcpServers?.[SERVER_NAME];
}

// ─── Skills ───────────────────────────────────────────────────────────

/** A skill folder that is ours: our mark, or one of our names whose text is about Recollect (an older install). */
function isOurSkill(file: string): boolean {
    try {
        const t = readFileSync(file, 'utf8');
        return t.includes(MARK) || /Recollect/.test(t);
    } catch {
        return true; // nothing there yet
    }
}

/** Copies our skills into a tool's skills folder; one of the same name that isn't ours is left alone (named in `skipped`). */
export function writeSkills(dir: string, root: string): { written: string[]; skipped: string[] } {
    const written: string[] = [];
    const skipped: string[] = [];
    for (const name of SKILLS) {
        const source = path.join(root, 'skills', name, 'SKILL.md');
        if (!existsSync(source)) continue;
        const target = path.join(dir, name, 'SKILL.md');
        if (existsSync(target) && !isOurSkill(target)) {
            skipped.push(name);
            continue;
        }
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(source, target);
        written.push(name);
    }
    removeOldSkills(dir);
    return { written, skipped };
}

/** Our retired skills: only a copy with our mark goes (one of theirs by that name stays). */
function removeOldSkills(dir: string): string[] {
    const removed: string[] = [];
    for (const name of OLD_SKILLS) {
        const target = path.join(dir, name, 'SKILL.md');
        try {
            if (!readFileSync(target, 'utf8').includes(MARK)) continue;
        } catch {
            continue;
        }
        rmSync(path.join(dir, name), { recursive: true, force: true });
        removed.push(name);
    }
    return removed;
}

export function removeSkills(dir: string): string[] {
    const removed: string[] = [];
    for (const name of SKILLS) {
        const target = path.join(dir, name, 'SKILL.md');
        if (!existsSync(target) || !isOurSkill(target)) continue;
        rmSync(path.join(dir, name), { recursive: true, force: true });
        removed.push(name);
    }
    return [...removed, ...removeOldSkills(dir)];
}

export const countSkills = (dir: string): number => SKILLS.filter((n) => existsSync(path.join(dir, n, 'SKILL.md')) && isOurSkill(path.join(dir, n, 'SKILL.md'))).length;

// ─── Antigravity and Cursor (a JSON file of MCP servers each) ─────────

/** Adds (or with entry null removes) Recollect in an `mcpServers` file; a tool without hooks says no folder is assumed. */
export function writeMcpFile(file: string, entry: string | null, agentName: string, now: Date): void {
    const json = readJson<{ mcpServers?: Record<string, unknown> }>(file) ?? {};
    const servers = { ...(json.mcpServers ?? {}) };
    if (entry) servers[SERVER_NAME] = { command: slash(process.execPath), args: [slash(entry)], env: { RECOLLECT_AGENT_NAME: agentName, RECOLLECT_FOLDERS: 'off' } };
    else delete servers[SERVER_NAME];
    writeJsonWithBackup(file, { ...json, mcpServers: servers }, now);
}

export const fileHasMcp = (file: string): boolean => !!readJson<{ mcpServers?: Record<string, unknown> }>(file)?.mcpServers?.[SERVER_NAME];

// ─── The tools found here ─────────────────────────────────────────────

export type ToolId = 'claude' | 'antigravity' | 'cursor';
export const TOOL_NAMES: Record<ToolId, string> = { claude: 'Claude Code', antigravity: 'Antigravity', cursor: 'Cursor' };

export function toolsFound(p: Paths, io: SetupIo, wanted?: string[]): ToolId[] {
    const all: ToolId[] = ['claude', 'antigravity', 'cursor'];
    if (wanted?.length) return all.filter((t) => wanted.includes(t));
    return all.filter((t) => (t === 'claude' ? existsSync(p.claudeDir) || existsSync(p.claudeJson) || !!claudeCli(io) : t === 'antigravity' ? existsSync(p.agyDir) : existsSync(p.cursorDir)));
}

// ─── setup / status / remove ──────────────────────────────────────────

/** The real home uses Claude Code's CLI for its config; a scratch home (tests) writes the file. */
const usesCli = (p: Paths) => path.resolve(p.home) === path.resolve(os.homedir());

export async function runSetup(opts: SetupOptions, io: SetupIo): Promise<void> {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) throw new Error(`Recollect needs Node.js 22 or newer (this is ${process.versions.node}). Install it from nodejs.org, then run this again.`);
    const p = pathsOf(opts.home);
    const saved = readSaved(p);
    const oldHooks = readJson<{ url?: string; token?: string; allow?: unknown[] }>(p.hooksJson);
    const url = (opts.url ?? saved?.url ?? oldHooks?.url ?? DEFAULT_SERVER).replace(/\/+$/, '').replace(/\/api$/i, '');

    // 1. Signed in: a saved sign-in that still works is kept (an older setup's token moves over).
    io.log(`Recollect setup (${url})`);
    let config: SavedConfig | null = null;
    const candidate = saved?.url === url ? saved.token : oldHooks?.url === url ? oldHooks.token : undefined;
    if (candidate && !opts.login) {
        const me = await whoAmI(url, candidate, io);
        if (me) config = { url, token: candidate, name: me.name, at: saved?.at ?? io.now().toISOString() };
    }
    if (!config) config = await signIn(url, { noOpen: opts.noOpen === true }, io);
    saveConfig(p, config);
    io.log(`✓ Signed in${config.name ? ` as ${config.name}` : ''}.`);
    // The older setup kept the url and token in hooks.json: config.json holds them now; its folder rules stay.
    if (oldHooks && (oldHooks.url || oldHooks.token)) {
        const { url: _u, token: _t, ...rest } = oldHooks;
        void _u;
        void _t;
        writeJsonWithBackup(p.hooksJson, rest, io.now());
    }

    // 2. The app's files, where the hooks and the tools run them.
    if (!opts.here) {
        io.log('  Installing the app…');
        installApp(p, opts, io);
    }
    const root = appRoot(p, opts.here);
    const entry = path.join(root, 'dist', 'index.js');
    const hookJs = path.join(root, 'dist', 'hook.js');
    if (!existsSync(entry) || !existsSync(hookJs)) throw new Error(`The app's files are missing in ${root}.`);
    io.log(`✓ App ${opts.here ? 'in place' : 'installed'} (${slash(root)}).`);

    // 3. Each AI tool found here.
    const tools = toolsFound(p, io, opts.tools);
    if (!tools.length) io.log('  No AI coding tool found here (Claude Code, Antigravity, Cursor): install one, then run this again.');
    for (const t of tools) {
        if (t === 'claude') {
            writeClaudeMcp(p, entry, io, usesCli(p));
            writeClaudeHooks(p, hookJs, io.now());
            const s = writeSkills(p.claudeSkills, root);
            io.log(`✓ Claude Code: tools, hooks (time and folders logged by themselves), skills ${s.written.map((n) => `/${n}`).join(' ')}.${s.skipped.length ? ` Left your own ${s.skipped.map((n) => `/${n}`).join(', ')} alone.` : ''}`);
        } else if (t === 'antigravity') {
            writeMcpFile(p.agyMcp, entry, 'Antigravity', io.now());
            const s = writeSkills(p.agySkills, root);
            io.log(`✓ Antigravity: tools and skills (${s.written.length}); no hooks there, so its chats log themselves through the tools.`);
        } else {
            writeMcpFile(p.cursorMcp, entry, 'Cursor', io.now());
            io.log('✓ Cursor: tools; its chats log themselves through the tools.');
        }
    }
    io.log('');
    io.log('Done. Start a new chat in your AI tool. The first chat in a new folder asks once what the folder is');
    io.log('(building, learning or work); change it any time in Recollect › Settings › Tracking.');
    if (oldHooks?.allow?.length) io.log('Your folder rules in ~/.recollect/hooks.json still apply on this PC.');
}

export interface StatusReport {
    url: string | null;
    signedInAs: string | null;
    tokenName: string | null;
    app: string | null;
    tools: Array<{ id: ToolId; name: string; mcp: boolean; hooks?: number; skills: number }>;
}

export async function runStatus(opts: Pick<SetupOptions, 'home'>, io: SetupIo): Promise<StatusReport> {
    const p = pathsOf(opts.home);
    const saved = readSaved(p);
    let me: { name: string; tokenName: string | null } | null = null;
    let problem: string | null = null;
    if (saved) {
        try {
            me = await whoAmI(saved.url, saved.token, io);
            if (!me) problem = 'its sign-in ended: run `npx recollect-setup` again';
        } catch (err) {
            problem = err instanceof Error ? err.message : String(err);
        }
    }
    const appPkg = readJson<{ version?: string }>(path.join(p.app, 'node_modules', PACKAGE, 'package.json'));
    const report: StatusReport = {
        url: saved?.url ?? null,
        signedInAs: me?.name ?? null,
        tokenName: me?.tokenName ?? null,
        app: appPkg?.version ?? null,
        tools: toolsFound(p, io).map((id) =>
            id === 'claude'
                ? { id, name: TOOL_NAMES[id], mcp: claudeHasMcp(p, io, usesCli(p)), hooks: countOurHooks(p), skills: countSkills(p.claudeSkills) }
                : id === 'antigravity'
                  ? { id, name: TOOL_NAMES[id], mcp: fileHasMcp(p.agyMcp), skills: countSkills(p.agySkills) }
                  : { id, name: TOOL_NAMES[id], mcp: fileHasMcp(p.cursorMcp), skills: 0 }
        ),
    };
    io.log('Recollect on this computer');
    io.log(`  Signed in: ${saved ? (me ? `yes, as ${me.name}${me.tokenName ? ` (${me.tokenName})` : ''}` : `no (${problem})`) : 'no: run `npx recollect-setup`'}${saved ? ` · ${saved.url}` : ''}`);
    io.log(`  App: ${report.app ? `${report.app} in ${slash(p.app)}` : 'not installed'}`);
    for (const t of report.tools) io.log(`  ${t.name}: tools ${t.mcp ? '✓' : '✗'}${t.hooks !== undefined ? ` · hooks ${t.hooks === 4 ? '✓' : `${t.hooks} of 4`}` : ''}${t.id !== 'cursor' ? ` · skills ${t.skills}` : ''}`);
    if (!report.tools.length) io.log('  No AI coding tool found here.');
    return report;
}

export async function runRemove(opts: Pick<SetupOptions, 'home'> & { keepToken?: boolean }, io: SetupIo): Promise<void> {
    const p = pathsOf(opts.home);
    const saved = readSaved(p);
    if (existsSync(p.claudeSettings) && countOurHooks(p) > 0) writeClaudeHooks(p, null, io.now());
    if (existsSync(p.claudeDir) || existsSync(p.claudeJson)) {
        try {
            writeClaudeMcp(p, null, io, usesCli(p));
        } catch {
            // Not registered.
        }
    }
    const skills = [...removeSkills(p.claudeSkills), ...removeSkills(p.agySkills)];
    if (fileHasMcp(p.agyMcp)) writeMcpFile(p.agyMcp, null, 'Antigravity', io.now());
    if (fileHasMcp(p.cursorMcp)) writeMcpFile(p.cursorMcp, null, 'Cursor', io.now());
    if (saved && !opts.keepToken) {
        try {
            const api = new RecollectApi({ baseUrl: saved.url, token: saved.token, agentName: 'recollect-setup', timeoutMs: 15_000, ...(io.fetch ? { fetch: io.fetch } : {}) });
            await api.post('/api/setup/disconnect', {});
            io.log('✓ This computer’s sign-in ended (Settings › Agents shows it as ended).');
        } catch {
            io.log('  Couldn’t reach the server to end the sign-in: end it in Recollect › Settings › Agents.');
        }
    }
    for (const f of [p.config, p.rules]) rmSync(f, { force: true });
    rmSync(p.app, { recursive: true, force: true });
    rmSync(path.join(p.rc, 'asked'), { recursive: true, force: true });
    io.log(`✓ Removed Recollect's tools, hooks${skills.length ? ` and skills (${[...new Set(skills)].join(', ')})` : ''} from this computer.`);
    const left = existsSync(p.rc) ? readdirSync(p.rc) : [];
    if (left.length) io.log(`  Your local data stays in ${slash(p.rc)} (the day's clock, unsent words, logs): delete the folder to remove it too.`);
}

/** The real side effects (the CLI). */
export const realIo = (): SetupIo => ({
    log: (line) => process.stdout.write(`${line}\n`),
    open: (url) => {
        const win = process.platform === 'win32';
        const [cmd, args] = win ? ['cmd', ['/c', 'start', '""', `"${url}"`]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        try {
            spawnSync(cmd as string, args as string[], { stdio: 'ignore', windowsHide: true, timeout: 10_000, windowsVerbatimArguments: win });
        } catch {
            // The link is printed above.
        }
    },
    run: (cmd, args, opts) => {
        // On Windows `claude` and `npm` are .cmd shims: run through the shell with each argument quoted.
        const win = process.platform === 'win32' && !/node(\.exe)?$/i.test(cmd);
        const quoted = win ? args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)) : args;
        const r = spawnSync(cmd, quoted, { encoding: 'utf8', shell: win, windowsHide: true, timeout: 180_000, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
        return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
});
