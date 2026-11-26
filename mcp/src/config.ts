// Settings from the environment, else from ~/.kaaga/config.json (`npx kaaga-setup`). The token is kept here and
// handed to the API client only: it is never logged, printed or put in an error message.
// KAAGA_REBRAND_PLAN D7 (11-26): every KAAGA_* setting may still be given by its older RECOLLECT_* name, and a PC set
// up before the rename keeps using ~/.recollect until `npx kaaga-setup` moves it to ~/.kaaga.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_URL = 'http://localhost:8002';
export const DEFAULT_AGENT_NAME = 'Claude Code';
const DEFAULT_TIMEOUT_MS = 30_000;
/** The API keeps at most 60 characters of X-Agent-Name. */
const AGENT_NAME_MAX = 60;

type Env = Record<string, string | undefined>;

/** A KAAGA_* setting, else the same setting by its older RECOLLECT_* name; an empty value counts as not set. */
export function envOf(name: `KAAGA_${string}`, env: Env = process.env): string | undefined {
    return env[name] || env[name.replace(/^KAAGA_/, 'RECOLLECT_')] || undefined;
}

/** Kaaga's folder on this PC, and the one it had before the rename. */
export const HOME_DIR = '.kaaga';
export const OLD_HOME_DIR = '.recollect';

/** A folder a setup has used: it holds the sign-in (config.json) or the older hooks.json. */
const setUp = (dir: string) => existsSync(path.join(dir, 'config.json')) || existsSync(path.join(dir, 'hooks.json'));

/**
 * ~/.kaaga (KAAGA_HOOKS_HOME instead: tests). While only the old ~/.recollect holds a setup (a PC that hasn't run
 * `npx kaaga-setup` yet), that one: its sign-in, folder rules, open sessions and the day's clock stay in use there.
 */
export function kaagaHome(env: Env = process.env, home: string = os.homedir()): string {
    const set = envOf('KAAGA_HOOKS_HOME', env);
    if (set) return set;
    const next = path.join(home, HOME_DIR);
    const old = path.join(home, OLD_HOME_DIR);
    return !setUp(next) && setUp(old) ? old : next;
}

export interface Config {
    /** API origin without a trailing slash and without `/api` (paths start with /api/…). */
    baseUrl: string;
    token: string;
    agentName: string;
    timeoutMs: number;
    debug: boolean;
    /** Set problems make every tool answer with this message instead of calling the API. */
    problem: string | null;
    /** KAAGA_TOOLS: which tool groups are listed from the start ("all", or e.g. "core,docs,manage"). */
    tools: string | undefined;
}

/** `http://host:8002/`, `http://host:8002/api` → `http://host:8002`. */
export function normalizeBaseUrl(raw: string | undefined): string {
    const value = (raw ?? '').trim() || DEFAULT_URL;
    return value.replace(/\/+$/, '').replace(/\/api$/i, '');
}

/** Printable ASCII only (a fetch header must be a byte string), single spaces, at most 60 characters. */
export function cleanAgentName(raw: string | undefined): string {
    const clean = (raw ?? '')
        .replace(/[^\x20-\x7e]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, AGENT_NAME_MAX)
        .trim();
    return clean || DEFAULT_AGENT_NAME;
}

/** EASY_SETUP_PLAN: what `npx kaaga-setup` wrote ({ url, token }), or null. */
function setupConfig(env: Env): { url?: string; token?: string } | null {
    try {
        const c = JSON.parse(readFileSync(path.join(kaagaHome(env), 'config.json'), 'utf8')) as { url?: unknown; token?: unknown };
        return { ...(typeof c.url === 'string' ? { url: c.url } : {}), ...(typeof c.token === 'string' ? { token: c.token } : {}) };
    } catch {
        return null;
    }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    // The environment first (a hand setup: claude mcp add -e …); else what `npx kaaga-setup` wrote.
    const saved = envOf('KAAGA_TOKEN', env)?.trim() ? null : setupConfig(env);
    const baseUrl = normalizeBaseUrl(envOf('KAAGA_URL', env) || saved?.url);
    const token = (envOf('KAAGA_TOKEN', env) ?? saved?.token ?? '').trim();
    const timeout = Number(envOf('KAAGA_TIMEOUT_MS', env));

    let problem: string | null = null;
    if (!/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
        problem = `KAAGA_URL must be an http(s) URL such as ${DEFAULT_URL}.`;
    } else if (!token) {
        problem = 'Kaaga is not signed in on this computer: run `npx kaaga-setup` (it opens kaaga.in to approve), then start a new chat.';
    } else if (!token.startsWith('rcl_')) {
        problem = "KAAGA_TOKEN doesn't look like a Kaaga token (they start with rcl_). Make a new one in Settings → Agents.";
    }

    return {
        baseUrl,
        token,
        // KAAGA_AGENT is the short form people reach for first (e.g. KAAGA_AGENT=study-chat).
        agentName: cleanAgentName(envOf('KAAGA_AGENT_NAME', env) || envOf('KAAGA_AGENT', env)),
        timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.trunc(timeout) : DEFAULT_TIMEOUT_MS,
        debug: /^(1|true|yes)$/i.test(envOf('KAAGA_DEBUG', env) ?? ''),
        problem,
        tools: envOf('KAAGA_TOOLS', env),
    };
}
