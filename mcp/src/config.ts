// Settings from the environment. The token is kept here and handed to the API client only: it is
// never logged, printed or put in an error message.

export const DEFAULT_URL = 'http://localhost:8002';
export const DEFAULT_AGENT_NAME = 'Claude Code';
const DEFAULT_TIMEOUT_MS = 30_000;
/** The API keeps at most 60 characters of X-Agent-Name. */
const AGENT_NAME_MAX = 60;

export interface Config {
    /** API origin without a trailing slash and without `/api` (paths start with /api/…). */
    baseUrl: string;
    token: string;
    agentName: string;
    timeoutMs: number;
    debug: boolean;
    /** Set problems make every tool answer with this message instead of calling the API. */
    problem: string | null;
    /** RECOLLECT_TOOLS: which tool groups are listed from the start ("all", or e.g. "core,docs,manage"). */
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const baseUrl = normalizeBaseUrl(env['RECOLLECT_URL']);
    const token = (env['RECOLLECT_TOKEN'] ?? '').trim();
    const timeout = Number(env['RECOLLECT_TIMEOUT_MS']);

    let problem: string | null = null;
    if (!/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
        problem = `RECOLLECT_URL must be an http(s) URL such as ${DEFAULT_URL}.`;
    } else if (!token) {
        problem = 'RECOLLECT_TOKEN is not set. Make a token in Recollect (Settings → Agents) and add it with: claude mcp add recollect -e RECOLLECT_TOKEN=rcl_… -- node …/mcp/dist/index.js';
    } else if (!token.startsWith('rcl_')) {
        problem = "RECOLLECT_TOKEN doesn't look like a Recollect token (they start with rcl_). Make a new one in Settings → Agents.";
    }

    return {
        baseUrl,
        token,
        // RECOLLECT_AGENT is the short form people reach for first (e.g. RECOLLECT_AGENT=study-chat).
        agentName: cleanAgentName(env['RECOLLECT_AGENT_NAME'] || env['RECOLLECT_AGENT']),
        timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.trunc(timeout) : DEFAULT_TIMEOUT_MS,
        debug: /^(1|true|yes)$/i.test(env['RECOLLECT_DEBUG'] ?? ''),
        problem,
        tools: env['RECOLLECT_TOOLS'],
    };
}
