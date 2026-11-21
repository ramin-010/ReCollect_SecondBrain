// Claude Code hooks for Recollect (SYNC_SPINE_SPEC 1.4): coding sessions log themselves, and a
// session in an allowed folder starts knowing where the user stands. No model has to remember anything.
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
// Stage 4 (ECOSYSTEM_V2_PLAN §4.11, §4.15): a server that says `capture: 2` (in the brief or in a words
// answer; kept in ~/.recollect/server.json) gets every message with its own number in the session, sent
// at each prompt by a detached flush, the last message already read coming along as context with the end
// of the agent's reply; it answers how far it has read, so a lost answer loses and doubles nothing. While
// the person's AI is paused it answers 503 AI_PAUSED and the words wait on the PC; words a failed close
// left are sent at the next start; nothing older than 14 days is sent. While one of the buddy's questions
// is open in the session, a reply under 3 words is read too. An older server gets exactly today's pieces.
// Test knobs: RECOLLECT_HOOKS_HOME (instead of ~/.recollect), RECOLLECT_HOOKS_CONFIG,
// RECOLLECT_HOOKS_MIN_MINUTES (default 2), RECOLLECT_HOOKS_MIN_PROMPTS (default 2),
// RECOLLECT_HOOKS_FLUSH=inline (the stop hook flushes in its own process: tests).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ApiError, RecollectApi } from './api.js';
import { briefText, type Brief } from './tools/record.js';

export type FolderMode = 'full' | 'light' | 'off';
/** A folder (logged, briefed, words not read) or a rule. */
/**
 * `nudge` (B10): each prompt reminds the agent, with the clock, to save quietly what the user would want
 * later (a work folder: nothing else leaves the PC). `commits: false`: the session goes without its
 * branch and commit subjects (office repos: company text).
 */
export type AllowEntry = string | { path: string; mode?: FolderMode; brief?: boolean; nudge?: boolean; commits?: boolean };

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
    /** B10: the per-prompt reminder to save (with the clock). */
    nudge: boolean;
    /** The branch and commit subjects go with the session (default true). */
    commits: boolean;
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
    /** The session's own title, when the user gave it one (`session_title`). */
    sessionTitle?: string;
    /** Set when closing failed (the backend was down): the next sweep sends it. */
    endedAt?: string;
    /** The buddy's notes already shown in this session (each is shown once). */
    notesShown?: string[];
    /** Stage 4: the buddy's open questions in this session's brief (a short reply is read while one is open). */
    asks?: Array<{ id: string; until: string }>;
    /** Stage 4: the session line is logged; only its words still wait to be sent (the next start sends them). */
    logged?: boolean;
}

/** One line of a session's words file: his words, or the agent's reply to them (its start, and its end when longer). */
type WordsLine = { at: string; text: string } | { at: string; reply: string; tail?: string };
/** What the flush has sent of a session's words file (`read`: how far the server has read, by message number). */
interface FlushState {
    sent: number;
    seq: number;
    read?: number;
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
/** The most minutes the server takes for one session (backend MINUTES_MAX). */
export const SESSION_MINUTES_MAX = 600;
/** Stage 4: a server that speaks the second protocol takes a whole day. */
export const SESSION_MINUTES_DAY = 1440;
/** Words wait on the PC at most this long (a paused AI, a failed close). */
export const HOLD_MS = 14 * 86_400_000;
/** The protocol of message numbers. */
export const CAPTURE_V2 = 2;
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
    if (typeof e === 'string') return e.trim() ? { path: e, mode: 'light', brief: true, nudge: false, commits: true } : null;
    if (!e || typeof e.path !== 'string' || !e.path.trim()) return null;
    const mode: FolderMode = e.mode === 'full' || e.mode === 'off' ? e.mode : 'light';
    return { path: e.path, mode, brief: e.brief !== false, nudge: e.nudge === true, commits: e.commits !== false };
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
export function promptWords(prompt: unknown, opts: { short?: boolean } = {}): string | null {
    if (typeof prompt !== 'string') return null;
    let t = prompt
        .replace(/<(system-reminder|ide_selection|ide_opened_file|ide_diagnostics|command-[a-z-]+|local-command-[a-z-]+)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
        .replace(/<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, (_m, body: string) => ` [pasted text, ${lineCount(body.trim())} lines] `)
        .replace(/```[^\n]*\n([\s\S]*?)(```|$)/g, (_m, body: string) => ` [code, ${lineCount(body.trimEnd())} lines] `)
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
    if (!t || t.startsWith('/')) return null;
    // A short reply ("yes", "did it") is read only while one of the buddy's questions is open (stage 4).
    if ((t.match(/[\p{L}\p{N}]+/gu) ?? []).length < (opts.short ? 1 : 3)) return null;
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

// ─── The day's clock (B10, BUDDY_MEMORY_PLAN §12.4) ───────────────────────────
// ~/.recollect/times/<project>/<YYYY-MM-DD>.jsonl, by the PC's local day: a line per prompt
// { at, sid, head } (head: its first 60 characters, so a time can be matched to its turn after a
// compaction) and per reply's end { at, sid, end: true }. Local only: no code path sends it. log_work
// reads it for the turn times; <day>.logged marks a day logged; <day>.asked-evening and
// <day>.asked-morning keep the reminders to log to once a day.

export interface ClockLine {
    at: string;
    sid: string;
    head?: string;
    end?: true;
}

const CLOCK_KEEP_DAYS = 14;
/** Stamps no further apart than this are one stretch of work. */
const SPAN_GAP_MS = 30 * 60_000;
/** The evening reminder to log: after 17:30 local, with an hour of work today. */
const EVENING_AT_MIN = 17 * 60 + 30;
const EVENING_WORK_MIN = 60;
/** The next morning's reminder: the last day with work, within 3 days, with half an hour of it. */
const MORNING_DAYS = 3;
const MORNING_WORK_MIN = 30;
const HEAD_MAX = 60;

const pad2 = (n: number) => String(n).padStart(2, '0');
/** The PC's local day of a moment (YYYY-MM-DD). */
export const localDay = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** The PC's local time (HH:mm). */
export const localTime = (d: Date): string => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
/** "Mon 16 Nov" (the PC's zone). */
export const dayLabel = (d: Date): string => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const safeName = (project: string) => project.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 80) || 'home';
export const clockDir = (project: string, env: Env = process.env): string => path.join(hooksHome(env), 'times', safeName(project));
export const clockFile = (project: string, day: string, env: Env = process.env): string => path.join(clockDir(project, env), `${day}.jsonl`);
type Mark = 'logged' | 'asked-evening' | 'asked-morning';
const markFile = (project: string, day: string, what: Mark, env: Env) => path.join(clockDir(project, env), `${day}.${what}`);
const hasMark = (project: string, day: string, what: Mark, env: Env) => existsSync(markFile(project, day, what, env));
function setMark(project: string, day: string, what: Mark, env: Env): void {
    mkdirSync(clockDir(project, env), { recursive: true });
    writeFileSync(markFile(project, day, what, env), new Date().toISOString());
}
/** log_work marks a day logged (the reminders to log stop for it). */
export const markLogged = (project: string, day: string, env: Env = process.env): void => setMark(project, day, 'logged', env);
export const isLogged = (project: string, day: string, env: Env = process.env): boolean => hasMark(project, day, 'logged', env);

function appendClock(project: string, day: string, line: ClockLine, env: Env): void {
    mkdirSync(clockDir(project, env), { recursive: true });
    appendFileSync(clockFile(project, day, env), `${JSON.stringify(line)}\n`);
}

export function readClock(project: string, day: string, env: Env = process.env): ClockLine[] {
    let text = '';
    try {
        text = readFileSync(clockFile(project, day, env), 'utf8');
    } catch {
        return [];
    }
    return text.split('\n').flatMap((l) => {
        if (!l.trim()) return [];
        try {
            const v = JSON.parse(l) as ClockLine;
            return typeof v.at === 'string' && Number.isFinite(Date.parse(v.at)) ? [v] : [];
        } catch {
            return [];
        }
    });
}

/** A prompt's first words for the clock: the first real line, tags and pasted blocks left out. */
export function promptHead(prompt: unknown): string | undefined {
    if (typeof prompt !== 'string') return undefined;
    const t = prompt
        .replace(/<(system-reminder|ide_selection|ide_opened_file|ide_diagnostics|command-[a-z-]+|local-command-[a-z-]+|pasted_content)\b[^>]*>[\s\S]*?<\/\1[^>]*>/g, ' ')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (!t) return undefined;
    return t.length > HEAD_MAX ? `${t.slice(0, HEAD_MAX - 1)}…` : t;
}

/**
 * The day's stretches of work: each turn runs from his prompt to the agent's last stop (however long
 * the agent worked), and turns no more than 30 minutes apart form one stretch.
 */
export function clockSpans(lines: readonly ClockLine[]): Array<{ from: Date; to: Date; minutes: number }> {
    const turns = clockTurns(lines)
        .map((t) => ({ from: t.at.getTime(), to: (t.end ?? t.at).getTime() }))
        .sort((a, b) => a.from - b.from);
    const spans: Array<{ from: number; to: number }> = [];
    for (const t of turns) {
        const last = spans[spans.length - 1];
        if (last && t.from - last.to <= SPAN_GAP_MS) last.to = Math.max(last.to, t.to);
        else spans.push({ ...t });
    }
    return spans.map((s) => ({ from: new Date(s.from), to: new Date(s.to), minutes: Math.round((s.to - s.from) / 60_000) }));
}

const workMinutes = (lines: readonly ClockLine[]) => clockSpans(lines).reduce((a, s) => a + s.minutes, 0);
const hoursText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

/** The day's turns: when he wrote, its first words, and when the agent last stopped before his next prompt in that chat. */
export function clockTurns(lines: readonly ClockLine[]): Array<{ at: Date; head?: string; end?: Date }> {
    const sorted = [...lines].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const turns: Array<{ at: Date; head?: string; end?: Date }> = [];
    const open = new Map<string, number>();
    for (const l of sorted) {
        if (l.end) {
            const i = open.get(l.sid);
            if (i !== undefined) turns[i]!.end = new Date(l.at);
        } else {
            open.set(l.sid, turns.length);
            turns.push({ at: new Date(l.at), ...(l.head ? { head: l.head } : {}) });
        }
    }
    return turns;
}

/** The day's clock as log_work answers it (the PC's time). */
export function clockText(project: string, day: string, lines: readonly ClockLine[]): string {
    const turns = clockTurns(lines);
    const shown = turns.slice(-60);
    const spans = clockSpans(lines);
    return [
        `${project}, ${dayLabel(new Date(`${day}T12:00:00`))} (the hook's clock, this PC's time; each turn: when they wrote → when the reply ended):`,
        ...(turns.length > shown.length ? [`(${turns.length - shown.length} earlier turns left out)`] : []),
        ...shown.map((t) => `${localTime(t.at)}${t.head ? ` "${t.head}"` : ''}${t.end ? ` → ${localTime(t.end)}` : ''}`),
        spans.length ? `Worked ${spans.map((s) => `${localTime(s.from)}–${localTime(s.to)} (${hoursText(s.minutes)})`).join(', ')}.` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

/** Deletes clock files older than two weeks (at a session's start). */
function pruneClocks(env: Env, now: Date): void {
    const root = path.join(hooksHome(env), 'times');
    const oldest = new Date(now);
    oldest.setDate(oldest.getDate() - CLOCK_KEEP_DAYS);
    const cut = localDay(oldest);
    try {
        for (const project of readdirSync(root)) {
            const dir = path.join(root, project);
            for (const name of readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\./.test(name) && name.slice(0, 10) < cut) rmSync(path.join(dir, name), { force: true });
        }
    } catch {
        // No clock yet.
    }
}

/** The reminder to save, with the clock (a `nudge` folder's every prompt). */
export function nudgeText(now: Date): string {
    return (
        `Recollect [${dayLabel(now)}, ${localTime(now)}]: before you finish this turn, if their message or your answer holds something the user would want later ` +
        "(something about their own life, a reminder or dated to-do, an idea or insight), save it quietly with the recollect tools and say nothing about it in your reply. " +
        'Most turns have nothing. Never save company code, data or client names.'
    );
}

/**
 * The reminders to log the day, each at most once a day per project: the day's first prompt, when the
 * last earlier day with work here (within 3 days, half an hour or more) has no log; after 17:30, with
 * an hour of work today and no log yet. `firstToday`: no prompt was stamped here today before this one.
 */
export function logReminders(project: string, now: Date, firstToday: boolean, env: Env = process.env): string[] {
    const out: string[] = [];
    const today = localDay(now);
    if (firstToday && !hasMark(project, today, 'asked-morning', env)) {
        for (let back = 1; back <= MORNING_DAYS; back++) {
            const d = new Date(now);
            d.setDate(d.getDate() - back);
            const day = localDay(d);
            const lines = readClock(project, day, env);
            if (!lines.length) continue;
            if (!isLogged(project, day, env) && workMinutes(lines) >= MORNING_WORK_MIN) {
                out.push(`Work here on ${dayLabel(d)} was not logged: if this chat still holds it, offer once to log it for that day (log_work with day ${day}).`);
                setMark(project, today, 'asked-morning', env);
            }
            break;
        }
    }
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    if (minuteOfDay >= EVENING_AT_MIN && !isLogged(project, today, env) && !hasMark(project, today, 'asked-evening', env) && workMinutes(readClock(project, today, env)) >= EVENING_WORK_MIN) {
        out.push("It is past 5:30 pm and today's work here is not logged: at a natural pause, ask them once if they want it logged (/log-work).");
        setMark(project, today, 'asked-evening', env);
    }
    return out;
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

/** What the server speaks (stage 4): ~/.recollect/server.json { url, capture }, for the configured url only. */
const capFile = (env: Env) => path.join(hooksHome(env), 'server.json');
export function serverCapture(config: Pick<HookConfig, 'url'>, env: Env = process.env): number {
    const c = readJson<{ url?: string; capture?: number }>(capFile(env));
    return c?.url === config.url && typeof c.capture === 'number' ? c.capture : 0;
}
export function noteCapture(config: Pick<HookConfig, 'url'>, env: Env, capture: unknown): void {
    const n = typeof capture === 'number' && Number.isInteger(capture) ? capture : 0;
    if (serverCapture(config, env) === n) return;
    try {
        writeFileSync(capFile(env), JSON.stringify({ url: config.url, capture: n }));
    } catch {
        // The next answer says it again.
    }
}

/** His messages with their numbers in the session (1, 2, …) and the end of the agent's reply to each. */
export function numberedMessages(lines: readonly WordsLine[]): Array<{ n: number; at: string; text: string; tail?: string }> {
    const out: Array<{ n: number; at: string; text: string; tail?: string }> = [];
    for (const l of lines) {
        if ('text' in l) out.push({ n: out.length + 1, at: l.at, text: l.text });
        else if (out.length && !out[out.length - 1]!.tail) out[out.length - 1]!.tail = (l.tail ?? l.reply).slice(-REPLY_MAX);
    }
    return out;
}

/** The text lines among the first `sent` lines (a session that moves to message numbers midway). */
const textsIn = (lines: readonly WordsLine[], sent: number) => lines.slice(0, sent).filter((l) => 'text' in l).length;

/** What still waits to be sent: by number (the second protocol) or by line. */
export function leftover(lines: readonly WordsLine[], state: FlushState | null, v2: boolean): number {
    if (!v2) return unsentMessages(lines, state?.sent ?? 0).length;
    const read = state?.read ?? textsIn(lines, state?.sent ?? 0);
    return numberedMessages(lines).filter((m) => m.n > read).length;
}

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
export async function flushWords(api: RecollectApi, dir: string, sessionId: string, env: Env, now: Date = new Date()): Promise<void> {
    if (!(await waitForLock(dir, sessionId, env))) return;
    try {
        const session = readJson<OpenSession>(path.join(dir, `${sessionId}.json`));
        const state = readJson<FlushState>(flushFile(dir, sessionId)) ?? { sent: 0, seq: 0 };
        // A work folder (brief: false): its words are office work (B9: the work log keeps them apart).
        const config = loadHookConfig(env);
        const office = !!session && !!config && folderRule(session.cwd, config.allow)?.brief === false;
        const lines = readWords(dir, sessionId);
        if (config && serverCapture(config, env) >= CAPTURE_V2) {
            await sendNumbered(api, dir, sessionId, session, config, env, lines, state, office, now);
            return;
        }
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
                const answer = await api.post<{ capture?: number }>('/api/buddy/words', { sessionKey: session?.key ?? `cc_${sessionId}`, seq: seq + 1, project: session?.project ?? null, ...(office ? { office: true } : {}), messages });
                // A server that speaks message numbers says so: the next sends use them.
                if (config) noteCapture(config, env, answer?.capture);
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

/** The lock, waited for a little in a detached flush (two prompts close together); at once in a test. */
async function waitForLock(dir: string, sessionId: string, env: Env): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
        if (takeLock(dir, sessionId)) return true;
        if (env['RECOLLECT_HOOKS_FLUSH'] === 'inline') return false;
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}

/**
 * The second protocol (stage 4): the messages past what the server has read, each with its number, the
 * last one it read as context (with the end of the agent's reply); 50 at most per send. The server's
 * answer says how far it has read. 503 AI_PAUSED: the words wait. A server that refuses the fields
 * (an older release came back) is forgotten, and the next flush sends today's pieces.
 */
async function sendNumbered(
    api: RecollectApi,
    dir: string,
    sessionId: string,
    session: OpenSession | null,
    config: HookConfig,
    env: Env,
    lines: readonly WordsLine[],
    state: FlushState,
    office: boolean,
    now: Date
): Promise<void> {
    const all = numberedMessages(lines);
    let read = state.read ?? textsIn(lines, state.sent);
    let seq = state.seq;
    const save = () => writeFileSync(flushFile(dir, sessionId), JSON.stringify({ sent: lines.length, seq, read }));
    // Nothing older than 14 days is sent (held words, a close that failed long ago).
    const stale = all.filter((m) => m.n > read && now.getTime() - Date.parse(m.at) > HOLD_MS);
    if (stale.length) {
        read = Math.max(read, ...stale.map((m) => m.n));
        log(env, `dropped ${stale.length} words of ${sessionId} older than 14 days`);
        save();
    }
    while (true) {
        const fresh = all.filter((m) => m.n > read).slice(0, WORDS_PER_POST);
        if (!fresh.length) break;
        const before = [...all].reverse().find((m) => m.n <= read);
        const messages = [...(before ? [{ ...msgOf(before), context: true }] : []), ...fresh.map(msgOf)];
        let answer: { read?: number; capture?: number } | null;
        try {
            answer = await api.post<{ read?: number; capture?: number }>('/api/buddy/words', {
                sessionKey: session?.key ?? `cc_${sessionId}`,
                seq: fresh[0]!.n,
                project: session?.project ?? null,
                ...(office ? { office: true } : {}),
                v: CAPTURE_V2,
                canHold: true,
                messages,
            });
        } catch (err) {
            if (err instanceof ApiError && err.code === 'AI_PAUSED') {
                log(env, `held ${fresh.length} words of ${sessionId}: the AI is paused`);
                return;
            }
            if (err instanceof ApiError && err.status === 400) noteCapture(config, env, 0);
            throw err;
        }
        noteCapture(config, env, answer?.capture ?? CAPTURE_V2);
        seq++;
        read = Math.max(read, typeof answer?.read === 'number' ? answer.read : fresh[fresh.length - 1]!.n);
        save();
    }
}

const msgOf = (m: { n: number; at: string; text: string; tail?: string }) => ({ n: m.n, at: m.at, text: m.text, ...(m.tail ? { reply: m.tail } : {}) });

/** Starts a flush that outlives this hook (Claude Code never waits for the network). */
function startFlush(api: RecollectApi, dir: string, sessionId: string, env: Env, now: Date = new Date()): Promise<void> | void {
    if (env['RECOLLECT_HOOKS_FLUSH'] === 'inline') return flushWords(api, dir, sessionId, env, now);
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

/**
 * A folder no longer read in full (B10: a rule changed while a session was open): its waiting words
 * are moved to ~/.recollect/held/, never sent; one line in hook.log.
 */
function holdWords(dir: string, sessionId: string, env: Env): void {
    if (!existsSync(wordsFile(dir, sessionId))) return;
    const held = path.join(hooksHome(env), 'held');
    mkdirSync(held, { recursive: true });
    for (const f of [wordsFile(dir, sessionId), flushFile(dir, sessionId)]) if (existsSync(f)) renameSync(f, path.join(held, path.basename(f)));
    log(env, `held the waiting words of ${sessionId}: its folder is no longer read in full`);
}

/**
 * Close a session: send its last words (a folder still read in full), PUT it (when it is worth a
 * line), then drop its files; keep them if the PUT failed. The folder's rule is read now, so a rule
 * changed mid-session holds: a work folder (`brief: false`) is titled by its project, never his
 * words; `commits: false` sends no branch or commit subjects; a folder no longer allowed sends nothing.
 */
async function close(api: RecollectApi, file: string, endedAt: string, env: Env, now: Date = new Date()): Promise<void> {
    const dir = path.dirname(file);
    const sessionId = path.basename(file, '.json');
    const opened = readJson<OpenSession>(file);
    const config = loadHookConfig(env);
    const rule = opened && config ? folderRule(opened.cwd, config.allow) : null;
    let wordsLeft = false;
    if (existsSync(wordsFile(dir, sessionId))) {
        if (!rule || rule.mode !== 'full') holdWords(dir, sessionId, env);
        else {
            await flushWords(api, dir, sessionId, env, now);
            const v2 = !!config && serverCapture(config, env) >= CAPTURE_V2;
            if (!leftover(readWords(dir, sessionId), readJson<FlushState>(flushFile(dir, sessionId)), v2)) dropWords(dir, sessionId);
            else if (now.getTime() - Date.parse(opened?.endedAt ?? endedAt) > HOLD_MS) {
                // Waited 14 days (a server that never answered): dropped, one line in the log.
                dropWords(dir, sessionId);
                log(env, `dropped the words of ${sessionId}: unsent for 14 days`);
            } else wordsLeft = true;
        }
    }
    const s = readJson<OpenSession>(file);
    if (!s || (opened && (!rule || rule.mode === 'off'))) {
        rmSync(file, { force: true });
        return;
    }
    // Logged already (a close whose words could not all be sent): only the words wait, for the next start.
    if (s.logged) {
        if (!wordsLeft) rmSync(file, { force: true });
        return;
    }
    // Words left unsent: the session file stays (marked logged once its line is in) so the next start sends them.
    const keep = (logged: boolean) => (wordsLeft ? writeFileSync(file, JSON.stringify({ ...s, endedAt: s.endedAt ?? endedAt, ...(logged ? { logged: true } : {}) })) : rmSync(file, { force: true }));
    const end = s.endedAt ?? endedAt;
    // The server takes at most SESSION_MINUTES_MAX (600) a session: a longer one was refused at every start and never
    // logged (two in his hook log on 11-17). It is logged with the most the server takes (ECOSYSTEM_V2_PLAN stage 4).
    const most = config && serverCapture(config, env) >= CAPTURE_V2 ? SESSION_MINUTES_DAY : SESSION_MINUTES_MAX;
    const minutes = Math.min(most, activeMinutes([...s.stamps, end]));
    if (!worthLogging(s, minutes, env)) {
        keep(true);
        return;
    }
    const withCommits = rule?.commits !== false;
    const { branch, commits } = withCommits ? commitsSince(s.heads) : { branch: null, commits: [] as string[] };
    const titleIfNew = rule && !rule.brief ? s.project : (s.sessionTitle ?? s.firstPrompt);
    try {
        await api.put(`/api/sessions/by-key/${encodeURIComponent(s.key)}`, {
            kindIfNew: 'build',
            source: 'hook',
            project: s.project,
            startedAt: s.startedAt,
            endedAt: end,
            minutes,
            ...(titleIfNew ? { titleIfNew } : {}),
            details: withCommits ? { ...(branch ? { branch } : {}), commits } : {},
        });
        keep(true);
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
        if (!s || s.endedAt || now.getTime() - last > STALE_MS) await close(api, file, s?.endedAt ?? new Date(last || now.getTime()).toISOString(), env, now);
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
        // The day's clock (B10): every folder the hooks act in; local only, never sent.
        const clockProject = projectOf(cwd, config.allow);
        const today = localDay(now);
        const firstToday = event === 'prompt' && !readClock(clockProject, today, env).some((l) => !l.end);
        try {
            const head = event === 'prompt' ? promptHead(input['prompt']) : undefined;
            appendClock(clockProject, today, event === 'prompt' ? { at, sid: sessionId, ...(head ? { head } : {}) } : { at, sid: sessionId, end: true }, env);
        } catch (err) {
            log(env, `clock: ${err instanceof Error ? err.message : String(err)}`);
        }
        // A folder no longer read in full (its rule changed mid-session): whatever words wait are held, never sent.
        if (rule.mode !== 'full') holdWords(dir, sessionId, env);
        let s = readJson<OpenSession>(file);
        // No open file on a prompt: the session was swept (idle over 30 minutes, then another session
        // started) or began before the hooks were installed. The rest of it is a session of its own.
        if (!s && event === 'prompt') s = newOpenSession(sessionId, cwd, config.allow, now, true, 0);
        if (!s) return '';
        const firstPrompt = s.firstPrompt ?? (event === 'prompt' ? promptTitle(input['prompt']) ?? undefined : undefined);
        // His words (a "full" folder): what he typed, and the start of the agent's answer to it.
        if (rule.mode === 'full') {
            if (event === 'prompt') {
                const askOpen = (s.asks ?? []).some((a) => Date.parse(a.until) > now.getTime());
                const text = promptWords(input['prompt'], { short: askOpen });
                if (text) appendWords(dir, sessionId, { at, text });
            } else if (typeof input['last_assistant_message'] === 'string' && input['last_assistant_message'].trim()) {
                // Its start, and its end when it is longer (a question to him usually sits at the end).
                const reply = input['last_assistant_message'].replace(/\s+/g, ' ').trim();
                appendWords(dir, sessionId, { at, reply: reply.slice(0, REPLY_MAX), ...(reply.length > REPLY_MAX ? { tail: reply.slice(-REPLY_MAX) } : {}) });
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
        // A server that speaks message numbers gets each message as it is typed (a detached send; the
        // server reads a session's messages together a little later, or at once while a question is open).
        // An older one gets today's pieces: when 2,000 characters or 30 minutes wait, after a reply.
        const numbered = serverCapture(config, env) >= CAPTURE_V2;
        if (rule.mode === 'full' && ((event === 'prompt' && numbered) || (event === 'stop' && !numbered))) {
            const lines = readWords(dir, sessionId);
            const state = readJson<FlushState>(flushFile(dir, sessionId));
            if (numbered ? leftover(lines, state, true) > 0 : flushDue(lines, state?.sent ?? 0, now)) await startFlush(api, dir, sessionId, env, now);
        }
        // B10: in a `nudge` folder every prompt reminds the agent to save quietly (with the clock), and once a day to offer to log the work.
        const nudge = event === 'prompt' && rule.nudge ? [nudgeText(now), ...logReminders(clockProject, now, firstToday, env)] : [];
        return [note ? `Recollect, from the user's buddy (pass it on in one sentence at a natural pause; skip it if they are in the middle of something): ${note.text}` : '', ...nudge]
            .filter(Boolean)
            .join('\n');
    }
    if (event === 'end') {
        if (existsSync(file)) await close(api, file, at, env, now);
        return '';
    }
    if (event !== 'start') return '';

    await sweep(api, dir, file, env, now);
    pruneClocks(env, now);
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
        // Stage 4: what the server speaks, and the buddy's open questions (a short reply is read while one is open).
        noteCapture(config, env, brief.capture);
        const asks = (brief.asks ?? []).map((a) => ({ id: a._id, until: a.until }));
        if (asks.length) {
            session = { ...session, asks };
            writeFileSync(file, JSON.stringify(session));
        }
        // The brief carries the buddy's newest note: it counts as shown in this session, and it is the
        // note file's note from now on (so a prompt never repeats it, or brings back an older one).
        const b = brief.buddy;
        if (b?.note && b.noteId) {
            writeFileSync(noteFile(env), JSON.stringify({ id: b.noteId, text: b.note, day: b.noteDay ?? '' } satisfies BuddyNote));
            writeFileSync(file, JSON.stringify({ ...session, notesShown: [...(session.notesShown ?? []), b.noteId].slice(-20) }));
        }
        return [
            `Recollect (session-start hook): where the user stands. This Claude Code session is logged by the hook (key ${session.key}, project "${session.project}"). ` +
                `When you finish a piece of work here, call checkpoint once with that key, project "${session.project}", a short title and the nextStep, so the project's next step stays current. ` +
                'If you study or practise with them, checkpoint as the recollect-study skill says, with the same key.',
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
