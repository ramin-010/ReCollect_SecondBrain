// What a folder is and what a chat is, on this PC (EASY_SETUP_PLAN, 11-23).
//
// The server keeps every folder's rule (what it is: personal, study, work; what is logged there: everything, the time
// only, off) and the account's default for a folder it has never seen (ask, a kind, off). The hooks read the rules at
// a session's start and keep them 10 minutes in ~/.recollect/rules.json, so a prompt never waits for the network; the
// MCP's set_folder writes its answer there at once. A folder is known by its project folder: the outermost git repo
// it is in (below the home folder), else the folder's own name, so no path list per PC.
//
// A chat (one session) can say what it is, whatever its folder: ~/.recollect/open/<session>.kind.jsonl holds each
// change (when, what, and who said so: the agent, or the user's own word), appended by set_chat or by the prompt hook
// when they type /study, /build or /work. The hook splits the session's time there when it closes.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiError, type RecollectApi } from './api.js';

type Env = Record<string, string | undefined>;

export type FolderKind = 'personal' | 'study' | 'work';
export type Tracking = 'full' | 'light' | 'off';
export type NewFolders = 'ask' | FolderKind | 'off';
export type ChatKind = FolderKind;
/** Who said what a chat is: the agent (its judgement), or the user themselves (their words, a slash command). */
export type ChatBy = 'agent' | 'chat';

export const FOLDER_KINDS: readonly FolderKind[] = ['personal', 'study', 'work'];

/**
 * STUDY_FLOW_PLAN §4.5: what people and agents read for a kind. Personal (everything that is theirs) is Learning and
 * Building; the stored values stay personal (= their own project, Building), study (Learning) and work.
 */
export const KIND_WORDS: Readonly<Record<FolderKind, string>> = { personal: 'building', study: 'learning', work: 'work' };

/** What tools take (build, study, work) as the stored kind; an older `personal` still means building. */
export const kindOfWord = (word: 'build' | 'study' | 'work' | 'personal'): FolderKind => (word === 'build' || word === 'personal' ? 'personal' : word);

/** The typed commands and what each says a chat is (a typed /personal is no longer one). */
const SLASH_KINDS: Readonly<Record<string, ChatKind>> = { study: 'study', build: 'personal', work: 'work' };

/** One folder's rule as the server keeps it. */
export interface ServerFolder {
    name: string;
    kind: FolderKind;
    tracking: Tracking;
    /** What is logged there is its own choice (not its kind's default). */
    trackingSet?: boolean;
    /** Someone decided what it is (false: it still asks). */
    decided: boolean;
}

/** ~/.recollect/rules.json: the server's rules, for the url they came from. */
export interface RulesCache {
    url: string;
    /** When they were fetched (ISO). */
    at: string;
    /** The server has no folder rules (an older release): the PC's own rules only. */
    unsupported?: boolean;
    newFolders: NewFolders;
    folders: Record<string, ServerFolder>;
}

export const RULES_FRESH_MS = 10 * 60_000;

export const recollectHome = (env: Env = process.env): string => env['RECOLLECT_HOOKS_HOME'] || path.join(os.homedir(), '.recollect');
const rulesFile = (env: Env) => path.join(recollectHome(env), 'rules.json');

/** A folder's key as the server keeps it (Project.key): single spaces, lower case, at most 100 characters. */
export const folderKey = (name: string): string => name.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 100);

const clean = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
const same = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();

/**
 * The project folder of a working folder (server mode): the outermost git repo it is in, not counting the home folder
 * or anything above it (a home kept in git would swallow every project), else the folder itself.
 * `E:/P/second_brain/backend` (backend and second_brain both repos) → `E:/P/second_brain`.
 */
export function projectFolder(cwd: string, home: string = os.homedir(), has: (p: string) => boolean = (p) => existsSync(p)): string {
    let dir = clean(cwd);
    let found: string | null = null;
    for (let i = 0; i < 40; i++) {
        if (same(dir, home)) break;
        if (has(`${dir}/.git`)) found = dir;
        const up = path.posix.dirname(dir);
        if (!up || up === dir || /^[A-Za-z]:$/.test(up) || up === '/') break;
        dir = up;
    }
    return found ?? clean(cwd);
}

/** The folder's name (its own spelling) and key (server mode). */
export function folderOf(cwd: string, home?: string, has?: (p: string) => boolean): { name: string; key: string } {
    const root = projectFolder(cwd, home, has);
    const name = path.posix.basename(root) || 'home';
    return { name, key: folderKey(name) };
}

/**
 * The work folder a project sits in (server mode): the nearest folder above it that someone decided, when that one is
 * work. `D:/erp-workspace/beta/rbpu-erp` is part of `erp-workspace`, which is no git repo itself, so each repo in it
 * would otherwise be a folder of its own that asks. Only a work folder takes in what is inside it, as that never reads
 * more; inside a personal or study folder a new project still asks. A project decided on its own keeps its own rule
 * (the caller looks at that first). Below the home folder only, like `projectFolder`.
 */
export function workFolderAbove(root: string, rules: Pick<RulesCache, 'folders'> | null, home: string = os.homedir()): { name: string; key: string } | null {
    if (!rules) return null;
    let dir = clean(root);
    for (let i = 0; i < 40; i++) {
        const up = path.posix.dirname(dir);
        if (!up || up === dir || /^[A-Za-z]:$/.test(up) || up === '/' || same(up, home)) return null;
        const name = path.posix.basename(up);
        const folder = rules.folders[folderKey(name)];
        if (folder?.decided) return folder.kind === 'work' ? { name: folder.name || name, key: folderKey(name) } : null;
        dir = up;
    }
    return null;
}

function readJson<T>(file: string): T | null {
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

/** The cached rules for this server, however old (null: none yet). */
export function readRules(url: string, env: Env = process.env): RulesCache | null {
    const c = readJson<RulesCache>(rulesFile(env));
    return c && c.url === url && typeof c.at === 'string' && c.folders && typeof c.folders === 'object' ? c : null;
}

function writeRules(cache: RulesCache, env: Env): void {
    try {
        mkdirSync(recollectHome(env), { recursive: true });
        writeFileSync(rulesFile(env), JSON.stringify(cache));
    } catch {
        // The next start fetches them again.
    }
}

interface RulesAnswer {
    newFolders: NewFolders;
    folders: Array<{ key: string; name: string; kind: FolderKind; tracking: Tracking; trackingSet?: boolean; decided: boolean }>;
}

/**
 * The rules, fetched when the cache is older than `maxAgeMs` (a session's start; a close that waits on a folder's
 * answer asks with 0). No answer: the cache as it is. An older server without rules (403, 404): marked unsupported,
 * asked again after the same 10 minutes.
 */
export async function refreshRules(api: RecollectApi, url: string, env: Env = process.env, now: Date = new Date(), maxAgeMs = RULES_FRESH_MS): Promise<RulesCache | null> {
    const cached = readRules(url, env);
    if (cached && now.getTime() - Date.parse(cached.at) < maxAgeMs) return cached;
    try {
        const r = await api.get<RulesAnswer>('/api/projects/rules');
        const fresh: RulesCache = {
            url,
            at: now.toISOString(),
            newFolders: r.newFolders,
            folders: Object.fromEntries(r.folders.map((f) => [f.key, { name: f.name, kind: f.kind, tracking: f.tracking, ...(f.trackingSet ? { trackingSet: true } : {}), decided: f.decided }])),
        };
        writeRules(fresh, env);
        return fresh;
    } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
            const old: RulesCache = { url, at: now.toISOString(), unsupported: true, newFolders: 'ask', folders: {} };
            writeRules(old, env);
            return old;
        }
        return cached;
    }
}

/** set_folder's answer, kept at once (the hooks see it before the next fetch). */
export function noteFolder(url: string, key: string, folder: ServerFolder, env: Env = process.env): void {
    const cached = readRules(url, env) ?? { url, at: new Date(0).toISOString(), newFolders: 'ask' as NewFolders, folders: {} };
    writeRules({ ...cached, unsupported: false, folders: { ...cached.folders, [key]: folder } }, env);
}

// ─── What a chat is (the parts of a session) ──────────────────────────

export interface ChatPart {
    /** From when (ISO): a part from the chat's start covers all of it. */
    at: string;
    kind: ChatKind;
    by: ChatBy;
}

export const kindFile = (openDir: string, sessionId: string) => path.join(openDir, `${sessionId}.kind.jsonl`);

export function readParts(openDir: string, sessionId: string): ChatPart[] {
    let text = '';
    try {
        text = readFileSync(kindFile(openDir, sessionId), 'utf8');
    } catch {
        return [];
    }
    return text.split('\n').flatMap((l) => {
        try {
            const p = JSON.parse(l) as ChatPart;
            return typeof p.at === 'string' && FOLDER_KINDS.includes(p.kind) && (p.by === 'agent' || p.by === 'chat') ? [p] : [];
        } catch {
            return [];
        }
    });
}

/** How much a choice weighs (the server's order: the folder, the agent, their own word). */
const RANK: Record<ChatBy | 'folder', number> = { folder: 0, agent: 1, chat: 2 };

/**
 * Note what a chat is from now (or from its start). Nothing is added when it already is that (a second /study), and an
 * agent's guess never replaces the user's own word for the same stretch: it only marks from now.
 */
export function addPart(openDir: string, sessionId: string, part: ChatPart): { added: boolean; current: ChatPart | null } {
    const parts = readParts(openDir, sessionId);
    const current = parts[parts.length - 1] ?? null;
    if (current && current.kind === part.kind && RANK[current.by] >= RANK[part.by]) return { added: false, current };
    // The agent can't take back what they said about the chat so far: its mark starts now, after theirs.
    const at = current && RANK[part.by] < RANK[current.by] && Date.parse(part.at) < Date.parse(current.at) ? current.at : part.at;
    mkdirSync(openDir, { recursive: true });
    appendFileSync(kindFile(openDir, sessionId), `${JSON.stringify({ ...part, at })}\n`);
    return { added: true, current: { ...part, at } };
}

/** The part a moment belongs to (null: the chat follows its folder there). */
export function partAt(parts: readonly ChatPart[], at: number): ChatPart | null {
    let hit: ChatPart | null = null;
    for (const p of parts) if (Date.parse(p.at) <= at) hit = p;
    return hit;
}

/**
 * A typed `/study`, `/build` or `/work` (also as Claude Code's command tags): what the chat is, from now; with
 * "all" or "whole" after it ("/study all"), from the chat's start.
 */
export function slashKind(prompt: unknown): { kind: ChatKind; whole: boolean } | null {
    if (typeof prompt !== 'string') return null;
    const tag = /<command-name>\s*\/?([a-z-]+)\s*<\/command-name>/i.exec(prompt);
    const typed = /^\s*\/([a-z-]+)(?:\s+(.*))?$/is.exec(prompt);
    const name = (tag?.[1] ?? typed?.[1] ?? '').toLowerCase().replace(/^re-collect:/, '');
    const kind = Object.hasOwn(SLASH_KINDS, name) ? SLASH_KINDS[name] : undefined;
    if (!kind) return null;
    const args = (tag ? (/<command-args>([\s\S]*?)<\/command-args>/i.exec(prompt)?.[1] ?? '') : (typed?.[2] ?? '')).toLowerCase();
    return { kind, whole: /(?:^|\s)(?:all|whole|entire)(?:\s|$)/.test(args) };
}

