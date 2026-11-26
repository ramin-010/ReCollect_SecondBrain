// `npx kaaga-setup` and friends (EASY_SETUP_PLAN §3, 11-23): one command for anyone.
//
//   setup    sign this computer in by approval (a code checked in the browser, no token to copy), install the app in
//            ~/.kaaga/app (so a hook never waits for npx), and add Kaaga to each AI tool found here:
//              Claude Code   the MCP server (user scope), the four hooks, the skills (/log-work, /study, …)
//              Antigravity   the MCP server (~/.gemini/config/mcp_config.json), the skills
//              Cursor        the MCP server (~/.cursor/mcp.json)
//            Safe to run again (it repairs); a working sign-in is kept unless --login.
//   status   what is set up, who it is signed in as, and what this folder is
//   remove   takes it all out again (the sign-in ends itself on the server)
//   update   the newest app, then the same steps as setup
//
// Every file it changes gets a backup beside it first (<file>.bak-<time>); only Kaaga's own entries are touched.
// The token is written to ~/.kaaga/config.json only (never printed, never in a tool's config).
//
// KAAGA_REBRAND_PLAN D7 (11-26): the app was called Recollect before. A PC that recollect-setup set up moves over in
// one run, and stays as it was until the new app is in place:
//   1. its sign-in comes from ~/.recollect/config.json (while ~/.kaaga has none) and is saved in ~/.kaaga;
//   2. the old address (https://api.re-collect.in) becomes https://api.kaaga.in when that one answers;
//   3. each tool's old `recollect` server, the hooks and the recollect-* skills give way to the new ones, each only
//      when it is ours;
//   4. then, when no tool runs the old app any more, everything else in ~/.recollect moves to ~/.kaaga (folder rules,
//      open sessions and their words, the day's clock, held words, the log; nothing overwritten), and the old app
//      (~/.recollect/app) goes, with the old folder when nothing is left in it.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, KaagaApi } from './api.js';
import { HOME_DIR, OLD_HOME_DIR } from './config.js';

export const PACKAGE = 'kaaga-setup';
export const DEFAULT_SERVER = 'https://api.kaaga.in';
/** KAAGA_REBRAND_PLAN D7: the package and the address before the rename (the old address works until 22 Jan 2027). */
export const OLD_PACKAGE = 'recollect-setup';
export const OLD_SERVER = 'https://api.re-collect.in';
/** Our skills (skills/<name>/SKILL.md beside dist/). */
export const SKILLS = ['kaaga-study', 'kaaga-notes', 'log-work', 'study', 'build', 'work'] as const;
/**
 * Our skills of older versions, taken out when they are still ours (STUDY_FLOW_PLAN §4.5: /personal became /build;
 * KAAGA_REBRAND_PLAN D7: recollect-study and recollect-notes became kaaga-study and kaaga-notes).
 */
export const OLD_SKILLS = ['personal', 'recollect-study', 'recollect-notes'] as const;
/** The MCP server's name in every tool, and its name before the rename. */
const SERVER_NAME = 'kaaga';
const OLD_SERVER_NAME = 'recollect';
/** The mark at the end of our skills, and the one older versions wrote. */
const MARK = '<!-- installed by kaaga -->';
const OLD_MARK = '<!-- installed by re-collect -->';
/** How long the new address has to answer before this PC stays on the old one. */
const NEW_ADDRESS_TIMEOUT_MS = 5000;

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
    /** Install the app from this folder or .tgz (a build not on npm yet), instead of npm's kaaga-setup. */
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
    /** KAAGA_REBRAND_PLAN D7: the folder before the rename (~/.recollect), with its sign-in, hooks.json and app. */
    oldRc: string;
    oldConfig: string;
    oldHooksJson: string;
    oldApp: string;
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
    const rc = path.join(home, HOME_DIR);
    const oldRc = path.join(home, OLD_HOME_DIR);
    return {
        home,
        rc,
        config: path.join(rc, 'config.json'),
        hooksJson: path.join(rc, 'hooks.json'),
        rules: path.join(rc, 'rules.json'),
        app: path.join(rc, 'app'),
        oldRc,
        oldConfig: path.join(oldRc, 'config.json'),
        oldHooksJson: path.join(oldRc, 'hooks.json'),
        oldApp: path.join(oldRc, 'app'),
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
/** An API origin without a trailing slash or /api. */
const origin = (url: string) => url.replace(/\/+$/, '').replace(/\/api$/i, '');
/** The old and the new address are one server: a sign-in made at either holds at both. */
const sameServer = (a: string, b: string) => a === b || [a, b].every((u) => u === OLD_SERVER || u === DEFAULT_SERVER);

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

/** The sign-in: ~/.kaaga/config.json, else (a PC not moved over yet) ~/.recollect/config.json. */
export const readSaved = (p: Paths): SavedConfig | null => {
    const c = readJson<Partial<SavedConfig>>(existsSync(p.config) ? p.config : p.oldConfig);
    return c?.url && c.token ? (c as SavedConfig) : null;
};

const platformName = (): string => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[process.platform as string] ?? process.platform;

/** Who a token is signed in as (null: it doesn't work any more). Throws for an older server without the easy setup. */
export async function whoAmI(url: string, token: string, io: SetupIo, timeoutMs = 15_000): Promise<{ name: string; tokenName: string | null } | null> {
    const api = new KaagaApi({ baseUrl: url, token, agentName: PACKAGE, timeoutMs, ...(io.fetch ? { fetch: io.fetch } : {}) });
    try {
        return await api.get<{ name: string; tokenName: string | null }>('/api/setup/me');
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
    }
}

/**
 * KAAGA_REBRAND_PLAN D7: does the new address answer (the sign-in check, a few seconds at most)? `me`: who the token is
 * there (null: the server answered, but the token doesn't work). null: no answer, so the PC stays on the old address.
 */
async function newAddressAnswers(token: string | undefined, io: SetupIo): Promise<{ me: { name: string; tokenName: string | null } | null } | null> {
    try {
        return { me: await whoAmI(DEFAULT_SERVER, token ?? '', io, NEW_ADDRESS_TIMEOUT_MS) };
    } catch {
        return null;
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
        if (res.status === 404 || res.status === 403) throw new Error('This Kaaga server doesn’t offer the easy setup yet (it is an older release).');
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

/** Installs (or updates) the app in ~/.kaaga/app: npm's kaaga-setup, or a build from --from. */
export function installApp(p: Paths, opts: Pick<SetupOptions, 'from' | 'version'>, io: SetupIo): void {
    mkdirSync(p.app, { recursive: true });
    if (!existsSync(path.join(p.app, 'package.json'))) writeFileSync(path.join(p.app, 'package.json'), `{ "private": true, "description": "Kaaga on this computer (${PACKAGE})" }\n`);
    const what = opts.from ? path.resolve(opts.from) : `${PACKAGE}@${opts.version ?? packageVersion()}`;
    // A named version never changes, so npm's cache may answer; "latest" (update) asks the registry, or a cached
    // list of versions would install the old one again (`--prefer-offline` trusts any cached list).
    const cache = opts.version === 'latest' && !opts.from ? '--prefer-online' : '--prefer-offline';
    const { cmd, pre } = npmCommand();
    const r = io.run(cmd, [...pre, 'install', '--no-audit', '--no-fund', '--omit=dev', cache, '--prefix', p.app, what], { cwd: p.app });
    if (r.status !== 0) throw new Error(`Installing the app failed (npm install ${what}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
}

// ─── What is ours ─────────────────────────────────────────────────────

/** Our hooks: their command runs our hook.js (this setup's, an older setup's, or a hand install's mcp/dist/hook.js). */
export const isOurHook = (command: unknown): boolean => {
    const c = String(command ?? '').replace(/\\/g, '/');
    return /dist\/hook\.js/.test(c) && /kaaga|re-collect|recollect|\/mcp\/dist\//i.test(c);
};

/** The settings a setup writes into a tool's server entry itself; an entry with any other (a url, a token) was made by hand. */
const OUR_ENV = /^(KAAGA|RECOLLECT)_(AGENT_NAME|FOLDERS)$/;

/**
 * An MCP server entry that is ours: it runs our dist/index.js (this setup's, an older setup's, or a hand install's
 * mcp/dist/index.js) the way a setup writes it, with the sign-in left to the config file. A remote one, one with a url
 * or a token of its own, or anything else is theirs.
 */
export const isOurServer = (entry: unknown): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as { command?: unknown; args?: unknown; env?: unknown };
    const line = [e.command, ...(Array.isArray(e.args) ? e.args : [])].map((x) => String(x ?? '')).join(' ').replace(/\\/g, '/');
    const env = e.env && typeof e.env === 'object' ? Object.keys(e.env) : [];
    return /dist\/index\.js/.test(line) && /kaaga|re-collect|recollect|\/mcp\/dist\//i.test(line) && env.every((k) => OUR_ENV.test(k));
};

type Servers = { mcpServers?: Record<string, unknown> };

/** A server under the old name in this file that isn't ours (they set it up by hand): it stays, and the setup says so. */
export const theirOldServer = (file: string): boolean => {
    const e = readJson<Servers>(file)?.mcpServers?.[OLD_SERVER_NAME];
    return !!e && !isOurServer(e);
};

// ─── Claude Code ──────────────────────────────────────────────────────

const HOOK_EVENTS: Array<[string, string, Record<string, unknown>, number]> = [
    ['SessionStart', 'start', { matcher: 'startup|resume|clear|compact' }, 10],
    ['UserPromptSubmit', 'prompt', {}, 5],
    ['Stop', 'stop', {}, 5],
    ['SessionEnd', 'end', {}, 10],
];

type HookGroup = { matcher?: string; hooks?: Array<{ type?: string; command?: string; timeout?: number }> };

/** Merges the four hooks into Claude Code's settings (ours replaced, older ones too, nothing else touched); remove: ours out. */
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
 * The server reads the url and token from ~/.kaaga/config.json: nothing secret goes into Claude Code's config.
 * The server under its old name goes too when it is ours (KAAGA_REBRAND_PLAN D7); one of theirs by that name stays.
 */
export function writeClaudeMcp(p: Paths, entry: string | null, io: SetupIo, useCli: boolean): 'cli' | 'file' {
    const oldOurs = isOurServer(readJson<Servers>(p.claudeJson)?.mcpServers?.[OLD_SERVER_NAME]);
    if (useCli && claudeCli(io)) {
        io.run('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user']);
        if (oldOurs) io.run('claude', ['mcp', 'remove', OLD_SERVER_NAME, '-s', 'user']);
        if (entry) {
            const r = io.run('claude', ['mcp', 'add', '-s', 'user', SERVER_NAME, '--', slash(process.execPath), slash(entry)]);
            if (r.status !== 0) throw new Error(`claude mcp add failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`);
        }
        return 'cli';
    }
    const json = readJson<Servers>(p.claudeJson);
    if (!json && !entry) return 'file';
    const servers = { ...(json?.mcpServers ?? {}) };
    if (oldOurs) delete servers[OLD_SERVER_NAME];
    if (entry) servers[SERVER_NAME] = { type: 'stdio', command: slash(process.execPath), args: [slash(entry)], env: {} };
    else delete servers[SERVER_NAME];
    writeJsonWithBackup(p.claudeJson, { ...(json ?? {}), mcpServers: servers }, io.now());
    return 'file';
}

/** Kaaga's MCP server in Claude Code's user config (as the file shows it). */
export function claudeHasMcp(p: Paths, io: SetupIo, useCli: boolean): boolean {
    if (useCli && claudeCli(io)) {
        const r = io.run('claude', ['mcp', 'get', SERVER_NAME]);
        return r.status === 0;
    }
    return !!readJson<Servers>(p.claudeJson)?.mcpServers?.[SERVER_NAME];
}

/** Their own permission rules still name the old tools (mcp__recollect__…): a hint, nothing is changed. */
const permissionsNameOldTools = (p: Paths): boolean => JSON.stringify(readJson<{ permissions?: unknown }>(p.claudeSettings)?.permissions ?? null).includes(`mcp__${OLD_SERVER_NAME}`);

// ─── Skills ───────────────────────────────────────────────────────────

const hasMark = (text: string) => text.includes(MARK) || text.includes(OLD_MARK);

/** A skill folder that is ours: our mark (either one), or one of our names whose text is about us (an older install). */
function isOurSkill(file: string): boolean {
    try {
        const t = readFileSync(file, 'utf8');
        return hasMark(t) || /Kaaga|Recollect/.test(t);
    } catch {
        return true; // nothing there yet
    }
}

/** Copies our skills into a tool's skills folder; one of the same name that isn't ours is left alone (named in `skipped`). */
export function writeSkills(dir: string, root: string): { written: string[]; skipped: string[]; removed: string[] } {
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
    return { written, skipped, removed: removeOldSkills(dir) };
}

/**
 * Our retired skills: a copy with our mark goes (one of theirs by that name stays). The recollect-* skills were
 * installed without a mark, so for those names (no one else's) a text about Recollect says it is ours.
 */
function removeOldSkills(dir: string): string[] {
    const removed: string[] = [];
    for (const name of OLD_SKILLS) {
        let text: string;
        try {
            text = readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
        } catch {
            continue;
        }
        if (!hasMark(text) && !(name.startsWith(`${OLD_SERVER_NAME}-`) && /Recollect/.test(text))) continue;
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

/**
 * Adds (or with entry null removes) Kaaga in an `mcpServers` file, and the server under its old name when it is ours; a
 * tool without hooks says no folder is assumed.
 */
export function writeMcpFile(file: string, entry: string | null, agentName: string, now: Date): void {
    const json = readJson<Servers>(file) ?? {};
    const servers = { ...(json.mcpServers ?? {}) };
    if (isOurServer(servers[OLD_SERVER_NAME])) delete servers[OLD_SERVER_NAME];
    if (entry) servers[SERVER_NAME] = { command: slash(process.execPath), args: [slash(entry)], env: { KAAGA_AGENT_NAME: agentName, KAAGA_FOLDERS: 'off' } };
    else delete servers[SERVER_NAME];
    writeJsonWithBackup(file, { ...json, mcpServers: servers }, now);
}

export const fileHasMcp = (file: string): boolean => !!readJson<Servers>(file)?.mcpServers?.[SERVER_NAME];
/** Ours in the file, under its name or the older one. */
const fileHasOurs = (file: string): boolean => fileHasMcp(file) || isOurServer(readJson<Servers>(file)?.mcpServers?.[OLD_SERVER_NAME]);

// ─── The tools found here ─────────────────────────────────────────────

export type ToolId = 'claude' | 'antigravity' | 'cursor';
export const TOOL_NAMES: Record<ToolId, string> = { claude: 'Claude Code', antigravity: 'Antigravity', cursor: 'Cursor' };

export function toolsFound(p: Paths, io: SetupIo, wanted?: string[]): ToolId[] {
    const all: ToolId[] = ['claude', 'antigravity', 'cursor'];
    if (wanted?.length) return all.filter((t) => wanted.includes(t));
    return all.filter((t) => (t === 'claude' ? existsSync(p.claudeDir) || existsSync(p.claudeJson) || !!claudeCli(io) : t === 'antigravity' ? existsSync(p.agyDir) : existsSync(p.cursorDir)));
}

// ─── The folder before the rename (KAAGA_REBRAND_PLAN D7) ─────────────

/** The tools whose config still runs the old app (one this run left alone, e.g. with --tools): it stays until they move. */
export function oldAppUsers(p: Paths): string[] {
    const old = slash(p.oldApp).toLowerCase();
    const runs = (value: unknown) => JSON.stringify(value ?? null).replace(/\\\\/g, '/').toLowerCase().includes(old);
    const users = new Set<string>();
    if (runs(readJson<{ hooks?: unknown }>(p.claudeSettings)?.hooks) || runs(readJson<Servers>(p.claudeJson)?.mcpServers)) users.add(TOOL_NAMES.claude);
    if (runs(readJson<Servers>(p.agyMcp)?.mcpServers)) users.add(TOOL_NAMES.antigravity);
    if (runs(readJson<Servers>(p.cursorMcp)?.mcpServers)) users.add(TOOL_NAMES.cursor);
    return [...users];
}

/** Moves each entry of `from` into `to`; a folder both have is merged, a file `to` already has stays where it is (`left`). */
function moveInto(from: string, to: string, counts: { moved: number; left: number }, skip: readonly string[] = []): void {
    let names: string[];
    try {
        names = readdirSync(from);
    } catch {
        return;
    }
    mkdirSync(to, { recursive: true });
    for (const name of names) {
        if (skip.includes(name)) continue;
        const src = path.join(from, name);
        const dst = path.join(to, name);
        try {
            if (!existsSync(dst)) {
                try {
                    renameSync(src, dst);
                    counts.moved++;
                    continue;
                } catch {
                    // Busy (Windows): piece by piece below.
                }
            }
            if (statSync(src).isDirectory()) {
                if (existsSync(dst) && !statSync(dst).isDirectory()) {
                    counts.left++;
                    continue;
                }
                moveInto(src, dst, counts);
                if (!readdirSync(src).length) rmdirSync(src);
            } else if (!existsSync(dst)) {
                copyFileSync(src, dst);
                rmSync(src, { force: true });
                counts.moved++;
            } else counts.left++;
        } catch {
            counts.left++;
        }
    }
}

/**
 * What ~/.recollect holds moves to ~/.kaaga: the folder rules, open sessions with their words and parts (so no logged
 * time is lost), the day's clock, held words, the buddy's note, the log, older backups. Nothing in ~/.kaaga is
 * overwritten. The sign-in was saved in ~/.kaaga/config.json before this, so the old copy goes; the old app is not
 * moved (see retireOldHome).
 */
export function moveOldHome(p: Paths): { moved: number; left: number } {
    const counts = { moved: 0, left: 0 };
    if (!existsSync(p.oldRc)) return counts;
    if (existsSync(p.config)) rmSync(p.oldConfig, { force: true });
    moveInto(p.oldRc, p.rc, counts, ['app']);
    return counts;
}

/**
 * The server's answers kept on the PC (the folder rules, what it speaks) came from the old address: the same server
 * answers at the new one, so they hold for it (a known folder doesn't ask again while the PC is offline).
 */
function carryAnswers(p: Paths, from: string, to: string): void {
    for (const file of [p.rules, path.join(p.rc, 'server.json')]) {
        const c = readJson<{ url?: string }>(file);
        if (c?.url === from) writeFileSync(file, JSON.stringify({ ...c, url: to }));
    }
}

/** The old app goes once no tool runs it, and the old folder with it when nothing else is left there. */
function retireOldHome(p: Paths, io: SetupIo): void {
    try {
        rmSync(p.oldApp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
        io.log(`  Couldn’t remove the older app in ${slash(p.oldApp)} (in use?): delete it once no chat runs it.`);
        return;
    }
    try {
        rmdirSync(p.oldRc);
    } catch {
        // Something stayed in it.
    }
    if (existsSync(p.oldRc)) io.log(`  Some older files stay in ${slash(p.oldRc)} (${slash(p.rc)} has its own): delete that folder once you don’t need them.`);
}

// ─── setup / status / remove ──────────────────────────────────────────

/** The real home uses Claude Code's CLI for its config; a scratch home (tests) writes the file. */
const usesCli = (p: Paths) => path.resolve(p.home) === path.resolve(os.homedir());

export async function runSetup(opts: SetupOptions, io: SetupIo): Promise<void> {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) throw new Error(`Kaaga needs Node.js 22 or newer (this is ${process.versions.node}). Install it from nodejs.org, then run this again.`);
    const p = pathsOf(opts.home);
    const saved = readSaved(p);
    const oldHooks = readJson<{ url?: string; token?: string; allow?: unknown[] }>(existsSync(p.hooksJson) ? p.hooksJson : p.oldHooksJson);
    let url = origin(opts.url ?? saved?.url ?? oldHooks?.url ?? DEFAULT_SERVER);
    // The token saved for that server (an older setup's in hooks.json moves over).
    const candidate = saved && sameServer(origin(saved.url), url) ? saved.token : oldHooks?.url && sameServer(origin(oldHooks.url), url) ? oldHooks.token : undefined;
    io.log(`Kaaga setup (${url})`);

    // KAAGA_REBRAND_PLAN D7: the old address gives way to the new one when that one answers (the old works until 22 Jan 2027).
    let me: { name: string; tokenName: string | null } | null | undefined;
    if (!opts.url && url === OLD_SERVER) {
        const there = await newAddressAnswers(candidate, io);
        if (there) {
            url = DEFAULT_SERVER;
            me = there.me;
            io.log(`✓ This PC now uses Kaaga’s new address, ${DEFAULT_SERVER}.`);
        } else io.log(`  ${DEFAULT_SERVER} didn’t answer, so this PC stays on ${OLD_SERVER} for now (it works until 22 Jan 2027): run this again later.`);
    }

    // 1. Signed in: a saved sign-in that still works is kept.
    let config: SavedConfig | null = null;
    if (candidate && !opts.login) {
        const who = me !== undefined ? me : await whoAmI(url, candidate, io);
        if (who) config = { url, token: candidate, name: who.name, at: saved?.at ?? io.now().toISOString() };
    }
    if (!config) config = await signIn(url, { noOpen: opts.noOpen === true }, io);
    saveConfig(p, config);
    io.log(`✓ Signed in${config.name ? ` as ${config.name}` : ''}.`);

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

    // 3. Each AI tool found here (the older server, hooks and skills give way, each only when ours).
    const tools = toolsFound(p, io, opts.tools);
    if (!tools.length) io.log('  No AI coding tool found here (Claude Code, Antigravity, Cursor): install one, then run this again.');
    const theirs = (file: string) => (theirOldServer(file) ? ` Left your own "${OLD_SERVER_NAME}" server alone.` : '');
    const gone = (removed: string[]) => (removed.length ? ` Took out the older ${removed.map((n) => `/${n}`).join(', ')}.` : '');
    for (const t of tools) {
        if (t === 'claude') {
            writeClaudeMcp(p, entry, io, usesCli(p));
            writeClaudeHooks(p, hookJs, io.now());
            const s = writeSkills(p.claudeSkills, root);
            io.log(
                `✓ Claude Code: tools, hooks (time and folders logged by themselves), skills ${s.written.map((n) => `/${n}`).join(' ')}.${s.skipped.length ? ` Left your own ${s.skipped.map((n) => `/${n}`).join(', ')} alone.` : ''}${gone(s.removed)}${theirs(p.claudeJson)}`
            );
            if (permissionsNameOldTools(p)) io.log(`  Your Claude Code permissions still name mcp__${OLD_SERVER_NAME}__… tools: they are mcp__${SERVER_NAME}__… now.`);
        } else if (t === 'antigravity') {
            writeMcpFile(p.agyMcp, entry, 'Antigravity', io.now());
            const s = writeSkills(p.agySkills, root);
            io.log(`✓ Antigravity: tools and skills (${s.written.length}); no hooks there, so its chats log themselves through the tools.${gone(s.removed)}${theirs(p.agyMcp)}`);
        } else {
            writeMcpFile(p.cursorMcp, entry, 'Cursor', io.now());
            io.log(`✓ Cursor: tools; its chats log themselves through the tools.${theirs(p.cursorMcp)}`);
        }
    }

    // 4. KAAGA_REBRAND_PLAN D7: the folder before the rename moves over once no tool runs the old app.
    if (existsSync(p.oldRc)) {
        const users = oldAppUsers(p);
        if (users.length) io.log(`  ${slash(p.oldRc)} stays as it is for now: ${users.join(' and ')} still ${users.length > 1 ? 'run' : 'runs'} the older app there (run this for every tool to move it over).`);
        else {
            if (moveOldHome(p).moved) io.log(`✓ Moved this PC’s files from ${slash(p.oldRc)} to ${slash(p.rc)} (folder rules, open chats, the day’s clock).`);
            retireOldHome(p, io);
        }
    }
    if (config.url === DEFAULT_SERVER) carryAnswers(p, OLD_SERVER, DEFAULT_SERVER);
    // The older setup kept the url and token in hooks.json: config.json holds them now; its folder rules stay.
    const hooks = readJson<{ url?: string; token?: string }>(p.hooksJson);
    if (hooks && (hooks.url || hooks.token)) {
        const { url: _u, token: _t, ...rest } = hooks;
        void _u;
        void _t;
        writeJsonWithBackup(p.hooksJson, rest, io.now());
    }
    io.log('');
    io.log('Done. Start a new chat in your AI tool. The first chat in a new folder asks once what the folder is');
    io.log('(building, learning or work); change it any time in Kaaga › Settings › Tracking.');
    if (oldHooks?.allow?.length) io.log(`Your folder rules in ${slash(existsSync(p.hooksJson) ? p.hooksJson : p.oldHooksJson)} still apply on this PC.`);
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
            if (!me) problem = 'its sign-in ended: run `npx kaaga-setup` again';
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
    io.log('Kaaga on this computer');
    io.log(`  Signed in: ${saved ? (me ? `yes, as ${me.name}${me.tokenName ? ` (${me.tokenName})` : ''}` : `no (${problem})`) : 'no: run `npx kaaga-setup`'}${saved ? ` · ${saved.url}` : ''}`);
    io.log(`  App: ${report.app ? `${report.app} in ${slash(p.app)}` : 'not installed'}`);
    for (const t of report.tools) io.log(`  ${t.name}: tools ${t.mcp ? '✓' : '✗'}${t.hooks !== undefined ? ` · hooks ${t.hooks === 4 ? '✓' : `${t.hooks} of 4`}` : ''}${t.id !== 'cursor' ? ` · skills ${t.skills}` : ''}`);
    if (!report.tools.length) io.log('  No AI coding tool found here.');
    // KAAGA_REBRAND_PLAN D7: a setup from before the rename, or the old address.
    if (existsSync(p.oldApp) || existsSync(p.oldConfig)) io.log(`  An older ${OLD_PACKAGE} install is still in ${slash(p.oldRc)}: \`npx kaaga-setup\` moves it over.`);
    else if (saved && origin(saved.url) === OLD_SERVER) io.log(`  Kaaga has a new address: \`npx kaaga-setup@latest update\` moves this PC to ${DEFAULT_SERVER}.`);
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
    if (fileHasOurs(p.agyMcp)) writeMcpFile(p.agyMcp, null, 'Antigravity', io.now());
    if (fileHasOurs(p.cursorMcp)) writeMcpFile(p.cursorMcp, null, 'Cursor', io.now());
    if (saved && !opts.keepToken) {
        try {
            const api = new KaagaApi({ baseUrl: saved.url, token: saved.token, agentName: PACKAGE, timeoutMs: 15_000, ...(io.fetch ? { fetch: io.fetch } : {}) });
            await api.post('/api/setup/disconnect', {});
            io.log('✓ This computer’s sign-in ended (Settings › Agents shows it as ended).');
        } catch {
            io.log('  Couldn’t reach the server to end the sign-in: end it in Kaaga › Settings › Agents.');
        }
    }
    // This folder, and the one from before the rename (KAAGA_REBRAND_PLAN D7).
    for (const rc of [p.rc, p.oldRc]) {
        for (const f of ['config.json', 'rules.json']) rmSync(path.join(rc, f), { force: true });
        for (const d of ['app', 'asked']) rmSync(path.join(rc, d), { recursive: true, force: true });
    }
    io.log(`✓ Removed Kaaga's tools, hooks${skills.length ? ` and skills (${[...new Set(skills)].join(', ')})` : ''} from this computer.`);
    for (const rc of [p.rc, p.oldRc]) {
        const left = existsSync(rc) ? readdirSync(rc) : [];
        if (left.length) io.log(`  Your local data stays in ${slash(rc)} (the day's clock, unsent words, logs): delete the folder to remove it too.`);
    }
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
