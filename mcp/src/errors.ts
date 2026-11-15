// Errors as the agent reads them: one plain message, with the next step when there is one.
import { ApiError } from './api.js';

/** A problem found before (or instead of) calling the API, e.g. an unknown subject name. */
export class ToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolError';
    }
}

export const INVALID_TOKEN_MESSAGE = 'The Recollect token is invalid or revoked: make a new one in Settings → Agents';

/**
 * The learning API answers a missing (or someone else's) id with a bare 404 "Not found": say
 * which id instead. Specific 404 messages (e.g. a heading list) pass through unchanged.
 */
export async function orNotFound<T>(call: Promise<T>, message: string): Promise<T> {
    try {
        return await call;
    } catch (err) {
        if (err instanceof ApiError && err.status === 404 && /^not found$/i.test(err.message.trim())) throw new ToolError(message);
        throw err;
    }
}

/** The agent-facing text for any error a tool throws. */
export function describeError(err: unknown, baseUrl: string): string {
    if (err instanceof ToolError) return err.message;
    if (!(err instanceof ApiError)) return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;

    if (err.status === 0) {
        const write = !err.request.startsWith('GET ');
        return `Can't reach Recollect at ${baseUrl} (${err.message}). Is the backend running?${write ? ' If it comes back, check recent_agent_edits before trying this write again.' : ''}`;
    }
    if (err.status === 401) return `${INVALID_TOKEN_MESSAGE}, and update RECOLLECT_TOKEN for this MCP server.`;
    if (err.status === 403) {
        const scope = /lacks the "([^"]+)" scope/.exec(err.message)?.[1];
        if (scope) return `The Recollect token lacks the "${scope}" scope this tool needs. Make a token with "${scope}" in Settings → Agents.`;
        if (/cannot be used for this endpoint/i.test(err.message)) return `Recollect refused this call for agent tokens (${err.request}).`;
        return err.message;
    }
    if (err.stillRunning) return 'Recollect is still working on this request. Wait a moment, then check recent_agent_edits before trying again.';
    if (err.status >= 500) return `Recollect had a server error (HTTP ${err.status}): ${err.message}. It was retried once; try again later.`;
    return err.message;
}
