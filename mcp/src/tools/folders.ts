// What a folder is and what a chat is (EASY_SETUP_PLAN, 11-23).
//
//   set_folder   their answer to a new folder's one question (build, study, work, or ignore it): the server keeps it
//                for every chat and PC, and this PC's hooks see it at once (~/.kaaga/rules.json)
//   set_chat     what this chat is when it isn't what its folder says: the user's own word ("user") or the agent's
//                judgement ("agent", said in one line). With Claude Code's hooks the chat's time splits there (the
//                hook's open/<session>.kind.jsonl); a chat without hooks carries it on its next checkpoint (from now:
//                its later checkpoints go under a new key, so its time so far keeps what it was).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError, type KaagaApi } from '../api.js';
import { ToolError } from '../errors.js';
import { addPart, folderKey, KIND_WORDS, kindOfWord, noteFolder, type ChatKind, type FolderKind, type Tracking } from '../folders.js';
import { hooksHome, loadHookConfig, type OpenSession } from '../hook.js';
import { CHANGES, defineTool, type ToolContext } from '../tool.js';

/** A chat's own word, kept in this process for a chat without hooks until its next checkpoint carries it. */
export interface ChatMemory {
    /** Key → what the chat is and who said so ('*': the next checkpoint, whatever its key). */
    pending: Map<string, { kind: ChatKind; by: 'agent' | 'chat' }>;
    /** An old key → the key its later checkpoints go under (a chat that changed what it is from now). */
    alias: Map<string, string>;
    /** The last key a checkpoint used. */
    lastKey?: string;
}

export const newChatMemory = (): ChatMemory => ({ pending: new Map(), alias: new Map() });

/** build, study or work (STUDY_FLOW_PLAN §4.5); an older `personal` still means build. */
export const zKindWord = <T extends string>(more: readonly T[]) =>
    z.preprocess((v) => (v === 'personal' ? 'build' : v), z.enum(['build', 'study', 'work', ...more] as unknown as readonly ['build', 'study', 'work', ...T[]]));

/** A key in the server's own shape (s_ + start second + 5 random), so the first checkpoint counts from now. */
export function newChatKey(now: Date = new Date()): string {
    const seconds = Math.floor(now.getTime() / 1000).toString(36).padStart(7, '0').slice(-7);
    let rand = '';
    for (let i = 0; i < 5; i++) rand += Math.floor(Math.random() * 36).toString(36);
    return `s_${seconds}${rand}`;
}

/** The hooks' open session for this chat: by its key, else the newest one in this folder (null: no hooks here). */
export function openSessionFor(key: string | undefined, folder: string | undefined, env: Record<string, string | undefined> = process.env): OpenSession | null {
    const dir = path.join(hooksHome(env), 'open');
    let names: string[] = [];
    try {
        names = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.flush.json'));
    } catch {
        return null;
    }
    let best: { s: OpenSession; last: number } | null = null;
    for (const name of names) {
        let s: OpenSession;
        try {
            s = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as OpenSession;
        } catch {
            continue;
        }
        if (!s?.key || !s.sessionId) continue;
        if (key) {
            if (key === s.key || key.startsWith(`${s.key}:`)) return s;
            continue;
        }
        if (folder && s.project !== folder) continue;
        const last = Math.max(0, ...s.stamps.map((x) => Date.parse(x)).filter((n) => Number.isFinite(n)));
        if (!s.endedAt && (!best || last > best.last)) best = { s, last };
    }
    return best?.s ?? null;
}

/** PUT a checkpoint; an older server that refuses chatKind / kindBy gets it without them. */
export async function putWithKind<T>(api: KaagaApi, key: string, body: Record<string, unknown>, mark: { kind: ChatKind; by: 'agent' | 'chat' } | undefined): Promise<T> {
    const url = `/api/sessions/by-key/${encodeURIComponent(key)}`;
    if (!mark) return api.put<T>(url, body);
    try {
        return await api.put<T>(url, { ...body, chatKind: mark.kind, kindBy: mark.by });
    } catch (err) {
        if (err instanceof ApiError && err.status === 400 && /chatKind|kindBy|unrecognized/i.test(err.message)) return api.put<T>(url, body);
        throw err;
    }
}

interface FolderAnswer {
    key: string;
    name: string;
    kind: FolderKind;
    tracking: Tracking;
    trackingSet?: boolean;
}

export function registerFolderTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;
    const chats = ctx.chats;

    defineTool(
        server,
        ctx,
        'set_folder',
        {
            title: 'Say what a folder is',
            description: "Save the user's answer to what this folder is (asked once per folder): build (their own), study, work (time logged, words not read) or ignore (nothing logged). Holds for every chat in it.",
            input: {
                kind: zKindWord(['ignore'] as const),
                folder: z.string().trim().min(1).max(100).optional().describe("Another folder's name (default: this one)."),
            },
            annotations: CHANGES,
        },
        async ({ kind, folder }) => {
            const target = folder ? { key: folderKey(folder), name: folder } : (ctx.folder ?? null);
            if (!target) throw new ToolError('Which folder? Pass folder, its name.');
            const body = kind === 'ignore' ? { tracking: 'off', name: target.name } : { kind: kindOfWord(kind), name: target.name };
            const p = await api.put<FolderAnswer>(`/api/projects/by-key/${encodeURIComponent(target.key)}`, body);
            // This PC's hooks follow it from the next prompt (the server's rules reach other PCs within 10 minutes).
            const hooks = loadHookConfig();
            if (hooks) noteFolder(hooks.url, p.key, { name: p.name, kind: p.kind, tracking: p.tracking, ...(p.trackingSet ? { trackingSet: true } : {}), decided: true });
            if (kind === 'ignore') return `Kaaga ignores ${p.name} from now on: nothing from its chats is logged. Settings › Tracking can change it.`;
            const what = p.kind === 'work' ? 'work: its time is logged for their work log, its words are not read, and it isn’t counted as progress' : `for ${p.kind === 'study' ? 'learning' : 'building something of their own'}: its time and their words count for them`;
            return `${p.name} is ${what}. This holds for every chat in it; Settings › Tracking can change it.`;
        }
    );

    defineTool(
        server,
        ctx,
        'set_chat',
        {
            title: 'Say what this chat is',
            description:
                'Mark this chat when it isn’t what its folder says. by "user": they said so; "agent": your judgement, then tell them in one line ("Logged this chat as learning, not work: say if that’s wrong"). from "start": the whole chat; else from now.',
            input: {
                kind: zKindWord([] as const),
                by: z.enum(['user', 'agent']),
                from: z.enum(['start', 'now']).optional(),
                key: z.string().trim().min(1).max(80).optional().describe('This chat’s session key, if any.'),
            },
            annotations: CHANGES,
        },
        async ({ kind: word, by, from, key }) => {
            const kind: ChatKind = kindOfWord(word);
            const who = by === 'user' ? 'chat' : 'agent';
            const fromStart = from === 'start';
            // Their own word moves this chat's tools with it: theirs get the full set (and the full brief), work the
            // work folder's. An agent's judgement never opens more.
            const moved = by === 'user' ? ctx.switchSet?.(kind === 'work' ? 'office' : 'code') === true : false;
            const after = moved ? (kind === 'work' ? ' This chat now has a work folder’s tools only.' : ' Their full Kaaga tools are on now: call get_brief for where they stand.') : '';
            // Claude Code with Kaaga's hooks: the hook splits the chat's time where it changed.
            // Only a process on the user's own computer reads the hooks' sessions (never the backend's machine).
            const open = ctx.set === 'code' || ctx.set === 'office' ? openSessionFor(key, ctx.folder?.key) : null;
            if (open) {
                const at = fromStart ? open.startedAt : new Date().toISOString();
                const { added } = addPart(path.join(hooksHome(), 'open'), open.sessionId, { at, kind, by: who });
                if (!added) return `This chat is already logged as ${KIND_WORDS[kind]}.${after}`;
                return `This chat is logged as ${KIND_WORDS[kind]} ${fromStart ? 'from its start' : 'from now on (its time so far keeps what it was)'}.${by === 'user' && kind !== 'work' ? ' Their words here count as their own.' : ''}${after}`;
            }
            // A chat without hooks: its session record by key, or its next checkpoint.
            const k = key ?? chats?.lastKey;
            if (!chats) throw new ToolError('This app can’t mark a chat.');
            if (k && fromStart) {
                try {
                    const r = await api.patch<{ changed: boolean }>(`/api/sessions/by-key/${encodeURIComponent(k)}/kind`, { kind, by });
                    return r.changed ? `This chat is logged as ${KIND_WORDS[kind]}.${after}` : `Kept as it was: ${by === 'agent' ? 'the user already said what this chat is' : 'it already is that'}.${after}`;
                } catch (err) {
                    if (!(err instanceof ApiError) || err.status !== 404) throw err;
                }
            }
            if (k && !fromStart) {
                // From now: the later checkpoints go under a new key, so the time so far keeps what it was.
                const next = newChatKey();
                chats.alias.set(chats.alias.get(k) ?? k, next);
                chats.pending.set(next, { kind, by: who });
                return `This chat counts as ${KIND_WORDS[kind]} from now on; the next checkpoint carries it (keep using the same key).${after}`;
            }
            chats.pending.set(k ?? '*', { kind, by: who });
            return `This chat counts as ${KIND_WORDS[kind]}; its next checkpoint carries it.${after}`;
        }
    );
}
