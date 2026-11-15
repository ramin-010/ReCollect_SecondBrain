// Claude Code hooks for Recollect (SYNC_SPINE_SPEC 1.4): coding sessions log themselves, and a
// session in an allowed folder starts knowing where Ramin stands. No model has to remember anything.
//
//   node <mcp>/dist/hook.js start    SessionStart       sweep stale sessions; open this one; print the brief
//   node <mcp>/dist/hook.js prompt   UserPromptSubmit   one timestamp (active minutes); in a "full" folder his
//                                                      words go to the session's words file; the buddy's note
//                                                      is printed once (no network)
//   node <mcp>/dist/hook.js stop     Stop               one timestamp; the agent's reply's start joins his last
//                                                      words; when a piece is due, a detached `flush` sends it
//   node <mcp>/dist/hook.js end      SessionEnd         flush, then close: PUT /api/sessions/by-key/cc_<session>
//   node <mcp>/dist/hook.js flush <session>             POST /api/buddy/words, then GET /api/buddy/note
//
// Config: ~/.recollect/hooks.json { url, token, allow, brief: true }; the token needs only read +
// sessions:write. `allow` entries are a folder (today's meaning: logged, briefed, words not read) or
// { path, mode: "full" | "light" | "off", brief } (BUDDY_MEMORY_PLAN §3.1): the longest matching path
// wins, "*" matches any folder; full = his typed words are read for his buddy; brief: false = the
// session is logged (and read) but never shown his brief, portrait or the buddy's notes (a work folder).
// Open sessions: ~/.recollect/open/<session>.json (+ .words.jsonl, .flush.json). Folders no entry
// allows, subagents (their input has agent_id) and RECOLLECT_HOOKS=off do nothing. Never blocks Claude
// Code: every call has a 3 s limit, every failure is one line in ~/.recollect/hook.log, and the exit
// code is always 0. The transcript is never read (its format is internal): his words come from the
// prompt hook's own input, the reply from the Stop hook's last_assistant_message.
// Test knobs: RECOLLECT_HOOKS_HOME (instead of ~/.recollect), RECOLLECT_HOOKS_CONFIG,
// RECOLLECT_HOOKS_MIN_MINUTES (default 2), RECOLLECT_HOOKS_MIN_PROMPTS (default 2),
// RECOLLECT_HOOKS_FLUSH=inline (the stop hook flushes in its own process: tests).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RecollectApi } from './api.js';
import { briefText, type Brief } from './tools/record.js';

export type FolderMode = 'full' | 'light' | 'off';
/** A folder (logged, briefed, words not read) or a rule. */
export type AllowEntry = string | { path: string; mode?: FolderMode; brief?: boolean };

export interface HookConfig {
    url: string;
    token: string;
    allow: AllowEntry[];
    brief: boolean;
}

/** What the hooks do in a folder. */
export interface FolderRule {
    path: string;
    mode: FolderMode;
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
    /** The buddy's notes already shown in this session (each is shown once). */
    notesShown?: string[];
}

/** One line of a session's words file: his words, or the start of the agent's reply to them. */
type WordsLine = { at: string; text: string } | { at: string; reply: string };
/** What the flush has sent of a session's words file. */
interface FlushState {
    sent: number;
    seq: number;
}

/** A note from the buddy for his chats (GET /api/buddy/note), kept in ~/.recollect/note.json. */
export interface BuddyNote {
    id: string;
    text: string;
    day: string;
}

const FIRST_PROMPT_MAX = 120;

type Env = Record<string, string | undefined>;

const GAP_MAX_MS = 5 * 60_000;
const STALE_MS = 30 * 60_000;
const NET_TIMEOUT_MS = 3000;
/** A piece of words is sent when this much is waiting, or when its first words are this old. */
export const FLUSH_CHARS = 2000;
export const FLUSH_AGE_MS = 30 * 60_000;
const WORDS_PER_POST = 50;
const TEXT_MAX = 4000;
const REPLY_MAX = 300;
const LOCK_STALE_MS = 2 * 60_000;
/** A note older than this is not shown mid-session. */
const NOTE_FRESH_MS = 24 * 3600_000;

export const hooksHome = (env: Env = process.env): string => env['RECOLLECT_HOOKS_HOME'] || path.join(os.homedir(), '.recollect');
export const configPath = (env: Env = process.env): string => env['RECOLLECT_HOOKS_CONFIG'] || path.join(hooksHome(env), 'hooks.json');

/** "E:\\A\\b" → "e:/a/b/": compared case-insensitively, as Windows paths are. */
export const normalizePath = (p: string): string => `${p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/`;

const ruleOf = (e: AllowEntry): FolderRule | null => {
    if (typeof e === 'string') return e.trim() ? { path: e, mode: 'light', brief: true } : null;
    if (!e || typeof e.path !== 'string' || !e.path.trim()) return null;
    const mode: FolderMode = e.mode === 'full' || e.mode === 'off' ? e.mode : 'light';
    return { path: e.path, mode, brief: e.brief !== false };
};

/** The rule for a folder: the longest matching entry ("*" matches any folder, last); null = none. */
export function folderRule(cwd: string, allow: readonly AllowEntry[]): FolderRule | null {
    const c = normalizePath(cwd);
    let best: { rule: FolderRule; len: number } | null = null;
    for (const e of allow) {
        const rule = ruleOf(e);
        if (!rule) continue;
        const len = rule.path.trim() === '*' ? 0 : c.startsWith(normalizePath(rule.path)) ? normalizePath(rule.path).length : -1;
        if (len >= 0 && (!best || len > best.len)) best = { rule, len };
    }
    return best?.rule ?? null;
}

/** The hooks act in this folder (a matching entry that is not "off"). */
export function isAllowed(cwd: string, allow: readonly AllowEntry[]): boolean {
    const rule = folderRule(cwd, allow);
    return !!rule && rule.mode !== 'off';
}

/** The folders the entries name (not "*"): the roots a project folder is found under. */
export const allowRoots = (allow: readonly AllowEntry[]): string[] =>
    allow.map(ruleOf).filter((r): r is FolderRule => !!r && r.path.trim() !== '*').map((r) => r.path);

const lineCount = (text: string) => text.split(/\r?\n/).length;

/**
 * His typed prompt as his buddy gets it, or null when it isn't worth reading: a slash command, a
 * reply under 3 words ("yes", "go on"). Pasted blocks and code become a marker with their size; the
 * IDE's attachments go; at most 4,000 characters (the start and the end of a long one).
 */
export function promptWords(prompt: unknown): string | null {
    if (typeof prompt !== 'string') return null;
    let t = prompt
        .replace(/<(system-reminder|ide_selection|ide_opened_file|ide_diagnostics|command-[a-z-]+|local-command-[a-z-]+)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
        .replace(/<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, (_m, body: string) => ` [pasted text, ${lineCount(body.trim())} lines] `)
        .replace(/```[^\n]*\n([\s\S]*?)(```|$)/g, (_m, body: string) => ` [code, ${lineCount(body.trimEnd())} lines] `)
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
    if (!t || t.startsWith('/')) return null;
    if ((t.match(/[\p{L}\p{N}]+/gu) ?? []).length < 3) return null;
    if (t.length > TEXT_MAX) t = `${t.slice(0, 3000)} […] ${t.slice(-800)}`;
    return t;
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
export function projectRoot(cwd: string, allow: readonly AllowEntry[] = []): string {
    const orig = cwd.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    const c = normalizePath(orig);
    const root = allowRoots(allow)
        .filter((a) => a.trim())
        .map(normalizePath)
        .filter((a) => c.startsWith(a))
        .sort((a, b) => b.length - a.length)[0];
    if (!root || c === root) return orig;
    const first = orig.slice(root.length).split('/')[0];
    return first ? `${orig.slice(0, root.length)}${first}` : orig;
}

/** The project of a folder: its project folder's name, lower case (the API finds or makes it). */
export const projectOf = (cwd: string, allow: readonly AllowEntry[] = []): string => path.basename(projectRoot(cwd, allow)).toLowerCase() || 'home';

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

// ─── His words for the buddy (BUDDY_MEMORY_PLAN §3.1) ─────────────────────────

const wordsFile = (dir: string, sessionId: string) => path.join(dir, `${sessionId}.words.jsonl`);
const flushFile = (dir: string, sessionId: string) => path.join(dir, `${sessionId}.flush.json`);
const lockFile = (dir: string, sessionId: string) => path.join(dir, `${sessionId}.flush.lock`);
export const noteFile = (env: Env = process.env) => path.join(hooksHome(env), 'note.json');

function readWords(dir: string, sessionId: string): WordsLine[] {
    try {
        return readFileSync(wordsFile(dir, sessionId), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => {
                try {
                    return JSON.parse(l) as WordsLine;
                } catch {
                    return null;
                }
            })
            .filter((l): l is WordsLine => !!l);
    } catch {
        return [];
    }
}

const appendWords = (dir: string, sessionId: string, line: WordsLine) => appendFileSync(wordsFile(dir, sessionId), `${JSON.stringify(line)}\n`);

/** The lines not sent yet, as messages (a reply joins the words before it). */
export function unsentMessages(lines: readonly WordsLine[], sent: number): Array<{ at: string; text: string; reply?: string }> {
    const out: Array<{ at: string; text: string; reply?: string }> = [];
    for (const l of lines.slice(sent)) {
        if ('text' in l) out.push({ at: l.at, text: l.text });
        else if (out.length && !out[out.length - 1]!.reply) out[out.length - 1]!.reply = l.reply.slice(0, REPLY_MAX);
    }
    return out;
}

/** A piece is due: 2,000 characters waiting, or words waiting for 30 minutes. */
export function flushDue(lines: readonly WordsLine[], sent: number, now: Date): boolean {
    const waiting = unsentMessages(lines, sent);
    if (!waiting.length) return false;
    const chars = waiting.reduce((n, m) => n + m.text.length, 0);
    return chars >= FLUSH_CHARS || now.getTime() - Date.parse(waiting[0]!.at) >= FLUSH_AGE_MS;
}

/** One flush at a time per session (a lock file; a stale one is taken over). */
function takeLock(dir: string, sessionId: string): boolean {
    const file = lockFile(dir, sessionId);
    try {
        closeSync(openSync(file, 'wx'));
        return true;
    } catch {
        try {
            if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) {
                writeFileSync(file, '');
                return true;
            }
        } catch {
            // Gone meanwhile: the other flush finished.
        }
        return false;
    }
}

/**
 * Send the session's waiting words (POST /api/buddy/words, 50 at most per piece), then fetch the
 * buddy's note for his chats. Moves on only after a 2xx; a failure waits for the next flush.
 */
export async function flushWords(api: RecollectApi, dir: string, sessionId: string, env: Env): Promise<void> {
    if (!takeLock(dir, sessionId)) return;
    try {
        const session = readJson<OpenSession>(path.join(dir, `${sessionId}.json`));
        const state = readJson<FlushState>(flushFile(dir, sessionId)) ?? { sent: 0, seq: 0 };
        const lines = readWords(dir, sessionId);
        let { sent, seq } = state;
        while (sent < lines.length) {
            // The lines of one piece: up to 50 messages (their replies come along).
            let end = sent;
            let texts = 0;
            while (end < lines.length && (texts < WORDS_PER_POST || !('text' in lines[end]!))) {
                if ('text' in lines[end]!) texts++;
                end++;
            }
            const messages = unsentMessages(lines.slice(0, end), sent);
            if (messages.length) {
                await api.post('/api/buddy/words', { sessionKey: session?.key ?? `cc_${sessionId}`, seq: seq + 1, project: session?.project ?? null, messages });
                seq++;
            }
            sent = end;
            writeFileSync(flushFile(dir, sessionId), JSON.stringify({ sent, seq }));
        }
        try {
            const note = await api.get<BuddyNote | null>('/api/buddy/note');
            if (note && typeof note.id === 'string' && typeof note.text === 'string') writeFileSync(noteFile(env), JSON.stringify(note));
        } catch {
            // No note (204) or no answer: the last note stays.
        }
    } catch (err) {
        log(env, `flush ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        rmSync(lockFile(dir, sessionId), { force: true });
    }
}

/** Starts a flush that outlives this hook (Claude Code never waits for the network). */
function startFlush(api: RecollectApi, dir: string, sessionId: string, env: Env): Promise<void> | void {
    if (env['RECOLLECT_HOOKS_FLUSH'] === 'inline') return flushWords(api, dir, sessionId, env);
    try {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'flush', sessionId], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
        child.unref();
    } catch (err) {
        log(env, `flush ${sessionId} could not start: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/** The buddy's note for his chats, once per session, while it is fresh. */
function noteToShow(session: OpenSession, env: Env, now: Date): BuddyNote | null {
    const note = readJson<BuddyNote>(noteFile(env));
    if (!note || typeof note.id !== 'string' || typeof note.text !== 'string' || !note.text.trim()) return null;
    if (session.notesShown?.includes(note.id)) return null;
    const at = Date.parse(`${note.day}T12:00:00Z`);
    if (Number.isFinite(at) && now.getTime() - at > NOTE_FRESH_MS + 12 * 3600_000) return null;
    return note;
}

function dropWords(dir: string, sessionId: string): void {
    for (const f of [wordsFile(dir, sessionId), flushFile(dir, sessionId), lockFile(dir, sessionId)]) rmSync(f, { force: true });
}

function apiFor(config: HookConfig): RecollectApi {
    return new RecollectApi({ baseUrl: config.url, token: config.token, agentName: 'Claude Code hook', timeoutMs: NET_TIMEOUT_MS, retryDelayMs: 100, runningDelayMs: 300 });
}

/** Close a session: send its last words, PUT it (when it is worth a line), then drop its files; keep them if the PUT failed. */
async function close(api: RecollectApi, file: string, endedAt: string, env: Env): Promise<void> {
    const dir = path.dirname(file);
    const sessionId = path.basename(file, '.json');
    if (existsSync(wordsFile(dir, sessionId))) {
        await flushWords(api, dir, sessionId, env);
        const left = unsentMessages(readWords(dir, sessionId), readJson<FlushState>(flushFile(dir, sessionId))?.sent ?? 0);
        if (!left.length) dropWords(dir, sessionId);
    }
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
        names = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.flush.json'));
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
function newOpenSession(sessionId: string, cwd: string, allow: readonly AllowEntry[], now: Date, resumed: boolean, stamps: 0 | 1): OpenSession {
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
    const rule = folderRule(cwd, config.allow);
    if (!sessionId || !rule || rule.mode === 'off') return '';

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
        if (!s) return '';
        const firstPrompt = s.firstPrompt ?? (event === 'prompt' ? promptTitle(input['prompt']) ?? undefined : undefined);
        // His words (a "full" folder): what he typed, and the start of the agent's answer to it.
        if (rule.mode === 'full') {
            if (event === 'prompt') {
                const text = promptWords(input['prompt']);
                if (text) appendWords(dir, sessionId, { at, text });
            } else if (typeof input['last_assistant_message'] === 'string' && input['last_assistant_message'].trim()) {
                appendWords(dir, sessionId, { at, reply: input['last_assistant_message'].replace(/\s+/g, ' ').trim().slice(0, REPLY_MAX) });
            }
        }
        // The buddy's note, once, where he gets his brief (never in a work folder).
        const note = event === 'prompt' && rule.brief && config.brief ? noteToShow(s, env, now) : null;
        writeFileSync(
            file,
            JSON.stringify({
                ...s,
                stamps: [...s.stamps, at],
                prompts: s.prompts + (event === 'prompt' ? 1 : 0),
                ...(firstPrompt ? { firstPrompt } : {}),
                ...(sessionTitle ? { sessionTitle } : {}),
                ...(note ? { notesShown: [...(s.notesShown ?? []), note.id].slice(-20) } : {}),
            })
        );
        if (event === 'stop' && rule.mode === 'full') {
            const lines = readWords(dir, sessionId);
            if (flushDue(lines, readJson<FlushState>(flushFile(dir, sessionId))?.sent ?? 0, now)) await startFlush(api, dir, sessionId, env);
        }
        return note ? `Recollect, from Ramin's buddy (pass it on in one sentence at a natural pause; skip it if he is in the middle of something): ${note.text}` : '';
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
    if (!config.brief || !rule.brief) return '';
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
    if (event === 'flush') {
        // A detached flush (started by the stop hook): its own process, no stdin, no output.
        const sessionId = (process.argv[3] ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
        const config = loadHookConfig();
        if (sessionId && config) await flushWords(apiFor(config), path.join(hooksHome(), 'open'), sessionId, process.env);
        process.exit(0);
    }
    try {
        const out = await runHook(event, await readStdin());
        if (out) process.stdout.write(`${out.slice(0, 9000)}\n`);
    } catch (err) {
        log(process.env, `${event}: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main();
