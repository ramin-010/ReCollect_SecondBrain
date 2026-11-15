// Claude Code hooks for Recollect (SYNC_SPINE_SPEC 1.4): coding sessions log themselves, and a
// session in an allowed folder starts knowing where Ramin stands. No model has to remember anything.
//
//   node <mcp>/dist/hook.js start    SessionStart       sweep stale sessions; open this one; print the brief
//   node <mcp>/dist/hook.js prompt   UserPromptSubmit   one timestamp (active minutes), no network
//   node <mcp>/dist/hook.js stop     Stop               one timestamp, no network
//   node <mcp>/dist/hook.js end      SessionEnd         close: PUT /api/sessions/by-key/cc_<session>
//
// Config: ~/.recollect/hooks.json { url, token, allow: ["E:/PERSONAL_PROJECTS/"], brief: true }; the
// token needs only read + sessions:write. Open sessions: ~/.recollect/open/<session>.json. Folders
// outside `allow`, subagents (their input has agent_id) and RECOLLECT_HOOKS=off do nothing. Never
// blocks Claude Code: every call has a 3 s limit, every failure is one line in ~/.recollect/hook.log,
// and the exit code is always 0. The transcript is never read (its format is internal).
// Test knobs: RECOLLECT_HOOKS_HOME (instead of ~/.recollect), RECOLLECT_HOOKS_CONFIG,
// RECOLLECT_HOOKS_MIN_MINUTES (default 2), RECOLLECT_HOOKS_MIN_PROMPTS (default 2).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RecollectApi } from './api.js';
import { briefText, type Brief } from './tools/record.js';

export interface HookConfig {
    url: string;
    token: string;
    allow: string[];
    brief: boolean;
}

/** One Claude Code session while it is open (a file per session). */
export interface OpenSession {
    key: string;
    sessionId: string;
    cwd: string;
    project: string;
    startedAt: string;
    stamps: string[];
    prompts: number;
    /** Git repos at the start: the project folder's and its direct child repos, with their HEAD. */
    heads: Array<{ repo: string; head: string }>;
    /** The first real prompt (first line, ≤ 120): the title when there is no commit. */
    firstPrompt?: string;
    /** The session's own title, when Ramin gave it one (`session_title`). */
    sessionTitle?: string;
    /** Set when closing failed (the backend was down): the next sweep sends it. */
    endedAt?: string;
}

const FIRST_PROMPT_MAX = 120;

type Env = Record<string, string | undefined>;

const GAP_MAX_MS = 5 * 60_000;
const STALE_MS = 30 * 60_000;
const NET_TIMEOUT_MS = 3000;

export const hooksHome = (env: Env = process.env): string => env['RECOLLECT_HOOKS_HOME'] || path.join(os.homedir(), '.recollect');
export const configPath = (env: Env = process.env): string => env['RECOLLECT_HOOKS_CONFIG'] || path.join(hooksHome(env), 'hooks.json');

/** "E:\\A\\b" → "e:/a/b/": compared case-insensitively, as Windows paths are. */
export const normalizePath = (p: string): string => `${p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/`;

export function isAllowed(cwd: string, allow: readonly string[]): boolean {
    const c = normalizePath(cwd);
    return allow.some((a) => a.trim() && c.startsWith(normalizePath(a)));
}

/** Active minutes: the gaps between consecutive timestamps, none counted above 5 minutes. */
export function activeMinutes(stamps: readonly string[]): number {
    const t = stamps.map((s) => Date.parse(s)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    let ms = 0;
    for (let i = 1; i < t.length; i++) ms += Math.min(t[i]! - t[i - 1]!, GAP_MAX_MS);
    return Math.round(ms / 60_000);
}

/** Too small to be worth a line: under 2 active minutes, or fewer than 2 prompts. */
export function worthLogging(session: Pick<OpenSession, 'prompts'>, minutes: number, env: Env = process.env): boolean {
    const minMinutes = Number(env['RECOLLECT_HOOKS_MIN_MINUTES'] ?? 2);
    const minPrompts = Number(env['RECOLLECT_HOOKS_MIN_PROMPTS'] ?? 2);
    return minutes >= minMinutes && session.prompts >= minPrompts;
}

/**
 * The project folder of a working folder: the first folder under the allow root it is in
 * (`E:/PERSONAL_PROJECTS/second_brain/backend` → `E:/PERSONAL_PROJECTS/second_brain`); the folder
 * itself when it is a root, or under no root.
 */
export function projectRoot(cwd: string, allow: readonly string[] = []): string {
    const orig = cwd.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    const c = normalizePath(orig);
    const root = allow
        .filter((a) => a.trim())
        .map(normalizePath)
        .filter((a) => c.startsWith(a))
        .sort((a, b) => b.length - a.length)[0];
    if (!root || c === root) return orig;
    const first = orig.slice(root.length).split('/')[0];
    return first ? `${orig.slice(0, root.length)}${first}` : orig;
}

/** The project of a folder: its project folder's name, lower case (the API finds or makes it). */
export const projectOf = (cwd: string, allow: readonly string[] = []): string => path.basename(projectRoot(cwd, allow)).toLowerCase() || 'home';

/** A prompt worth naming a session by: its first line, not a slash command, not "go" or "yes". */
export function promptTitle(prompt: unknown): string | null {
    if (typeof prompt !== 'string') return null;
    const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (line.length < 12 || line.startsWith('/')) return null;
    return line.length > FIRST_PROMPT_MAX ? `${line.slice(0, FIRST_PROMPT_MAX - 1)}…` : line;
}

function log(env: Env, text: string): void {
    try {
        mkdirSync(hooksHome(env), { recursive: true });
        appendFileSync(path.join(hooksHome(env), 'hook.log'), `${new Date().toISOString()} ${text}\n`);
    } catch {
        // Nowhere to write: stay silent.
    }
}

function git(cwd: string, args: string[]): string | null {
    try {
        const out = execFileSync('git', args, { cwd, timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        return out.trim() || null;
    } catch {
        return null;
    }
}

/** The cwd's repo and the repos directly inside it (a workspace of several repos), at most 6. */
function reposOf(cwd: string): string[] {
    const repos = existsSync(path.join(cwd, '.git')) ? [cwd] : [];
    try {
        for (const name of readdirSync(cwd)) {
            if (repos.length >= 6) break;
            const dir = path.join(cwd, name);
            if (existsSync(path.join(dir, '.git')) && statSync(dir).isDirectory()) repos.push(dir);
        }
    } catch {
        // An unreadable folder has no repos for us.
    }
    return repos;
}

function commitsSince(heads: OpenSession['heads']): { branch: string | null; commits: string[] } {
    const commits: string[] = [];
    let branch: string | null = null;
    for (const { repo, head } of heads) {
        branch ??= git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const log = git(repo, ['log', '--format=%s', '-n', '10', `${head}..HEAD`]);
        if (log) commits.push(...log.split('\n').filter(Boolean));
    }
    return { branch, commits: commits.slice(0, 10) };
}

function readJson<T>(file: string): T | null {
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

export function loadHookConfig(env: Env = process.env): HookConfig | null {
    const c = readJson<Partial<HookConfig>>(configPath(env));
    if (!c?.token || !c.url) return null;
    return { url: c.url, token: c.token, allow: Array.isArray(c.allow) ? c.allow : [], brief: c.brief !== false };
}

function apiFor(config: HookConfig): RecollectApi {
    return new RecollectApi({ baseUrl: config.url, token: config.token, agentName: 'Claude Code hook', timeoutMs: NET_TIMEOUT_MS, retryDelayMs: 100, runningDelayMs: 300 });
}

/** Close a session: PUT it (when it is worth a line), then drop its file; keep the file if the PUT failed. */
async function close(api: RecollectApi, file: string, endedAt: string, env: Env): Promise<void> {
    const s = readJson<OpenSession>(file);
    if (!s) {
        rmSync(file, { force: true });
        return;
    }
    const end = s.endedAt ?? endedAt;
    const minutes = activeMinutes([...s.stamps, end]);
    if (!worthLogging(s, minutes, env)) {
        rmSync(file, { force: true });
        return;
    }
    const { branch, commits } = commitsSince(s.heads);
    const titleIfNew = s.sessionTitle ?? s.firstPrompt;
    try {
        await api.put(`/api/sessions/by-key/${encodeURIComponent(s.key)}`, {
            kindIfNew: 'build',
            source: 'hook',
            project: s.project,
            startedAt: s.startedAt,
            endedAt: end,
            minutes,
            ...(titleIfNew ? { titleIfNew } : {}),
            details: { ...(branch ? { branch } : {}), commits },
        });
        rmSync(file, { force: true });
    } catch (err) {
        writeFileSync(file, JSON.stringify({ ...s, endedAt: end }));
        log(env, `could not close ${s.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/** Sessions whose window was closed without SessionEnd: last stamp over 30 minutes ago, or a failed close. */
async function sweep(api: RecollectApi, dir: string, current: string, env: Env, now: Date): Promise<void> {
    let names: string[] = [];
    try {
        names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
        return;
    }
    for (const name of names) {
        const file = path.join(dir, name);
        if (file === current) continue;
        const s = readJson<OpenSession>(file);
        const last = s ? Math.max(...s.stamps.map((x) => Date.parse(x)).filter((n) => Number.isFinite(n)), 0) : 0;
        if (!s || s.endedAt || now.getTime() - last > STALE_MS) await close(api, file, s?.endedAt ?? new Date(last || now.getTime()).toISOString(), env);
    }
}

/**
 * A session file for this Claude Code session. `resumed`: a later part of a session whose first part
 * may already be logged gets a key of its own (`cc_<id>:r<time>`). `stamps`: 1 = the start counts as
 * the first stamp; 0 = the caller adds the first one (a prompt).
 */
function newOpenSession(sessionId: string, cwd: string, allow: readonly string[], now: Date, resumed: boolean, stamps: 0 | 1): OpenSession {
    const at = now.toISOString();
    const root = projectRoot(cwd, allow);
    return {
        key: `cc_${sessionId}${resumed ? `:r${Math.floor(now.getTime() / 1000).toString(36)}` : ''}`,
        sessionId,
        cwd,
        project: projectOf(cwd, allow),
        startedAt: at,
        stamps: stamps ? [at] : [],
        prompts: 0,
        heads: reposOf(root)
            .map((repo) => ({ repo, head: git(repo, ['rev-parse', 'HEAD']) ?? '' }))
            .filter((r) => r.head),
    };
}

async function readStdin(): Promise<Record<string, unknown>> {
    if (process.stdin.isTTY) return {};
    const chunks: Buffer[] = [];
    const read = (async () => {
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    })();
    await Promise.race([read, new Promise((resolve) => setTimeout(resolve, 1000))]);
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

export async function runHook(event: string, input: Record<string, unknown>, env: Env = process.env, now: Date = new Date()): Promise<string> {
    if (/^(off|0|false|no)$/i.test(env['RECOLLECT_HOOKS'] ?? '')) return '';
    if (input['agent_id']) return '';
    const config = loadHookConfig(env);
    if (!config) return '';
    const cwd = typeof input['cwd'] === 'string' && input['cwd'] ? input['cwd'] : process.cwd();
    const sessionId = typeof input['session_id'] === 'string' ? input['session_id'].replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '';
    if (!sessionId || !isAllowed(cwd, config.allow)) return '';

    const dir = path.join(hooksHome(env), 'open');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.json`);
    const at = now.toISOString();
    const api = apiFor(config);
    const sessionTitle = typeof input['session_title'] === 'string' && input['session_title'].trim() ? input['session_title'].trim().slice(0, FIRST_PROMPT_MAX) : undefined;

    if (event === 'prompt' || event === 'stop') {
        let s = readJson<OpenSession>(file);
        // No open file on a prompt: the session was swept (idle over 30 minutes, then another session
        // started) or began before the hooks were installed. The rest of it is a session of its own.
        if (!s && event === 'prompt') s = newOpenSession(sessionId, cwd, config.allow, now, true, 0);
        if (s) {
            const firstPrompt = s.firstPrompt ?? (event === 'prompt' ? promptTitle(input['prompt']) ?? undefined : undefined);
            writeFileSync(
                file,
                JSON.stringify({
                    ...s,
                    stamps: [...s.stamps, at],
                    prompts: s.prompts + (event === 'prompt' ? 1 : 0),
                    ...(firstPrompt ? { firstPrompt } : {}),
                    ...(sessionTitle ? { sessionTitle } : {}),
                })
            );
        }
        return '';
    }
    if (event === 'end') {
        if (existsSync(file)) await close(api, file, at, env);
        return '';
    }
    if (event !== 'start') return '';

    await sweep(api, dir, file, env, now);
    let session = readJson<OpenSession>(file);
    if (!session) {
        // A resumed session whose first part was already logged gets a key of its own.
        const resumed = input['source'] === 'resume' || input['source'] === 'compact';
        session = { ...newOpenSession(sessionId, cwd, config.allow, now, resumed, 1), ...(sessionTitle ? { sessionTitle } : {}) };
        writeFileSync(file, JSON.stringify(session));
    }
    if (!config.brief) return '';
    try {
        const brief = await api.get<Brief>('/api/brief', { project: session.project, key: session.key });
        return [
            `Recollect (session-start hook): where Ramin stands. This Claude Code session is logged by the hook (key ${session.key}, project "${session.project}"). ` +
                `When you finish a piece of work here, call checkpoint once with that key, project "${session.project}", a short title and the nextStep, so the project's next step stays current. ` +
                'If you study or practise with him, checkpoint as the recollect-study skill says, with the same key.',
            briefText(brief),
        ].join('\n');
    } catch (err) {
        log(env, `brief: ${err instanceof Error ? err.message : String(err)}`);
        return '';
    }
}

async function main(): Promise<void> {
    const event = process.argv[2] ?? '';
    try {
        const out = await runHook(event, await readStdin());
        if (out) process.stdout.write(`${out.slice(0, 9000)}\n`);
    } catch (err) {
        log(process.env, `${event}: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main();
