// The Kaaga REST API, as an agent (personal access token) sees it.
//
//   - Every request: Authorization: Bearer rcl_…, X-Agent-Name, Accept: application/json.
//   - Every write (POST/PUT/PATCH): an Idempotency-Key (a fresh uuid per write request), reused on
//     our own retry, so a retry can never write twice: the API answers a retry of a finished
//     request with the first response (header Idempotent-Replayed: true).
//   - A network error or a 5xx is retried once (same key). If that retry finds the first attempt
//     still running (409 without a code), we wait and ask once more for its saved answer.
//   - Answers are `{ success: true, data }`; errors are `{ message, code? }` and become ApiError.
import { randomUUID } from 'node:crypto';
import { silentLogger, type Logger } from './log.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Query = Record<string, string | number | boolean | undefined>;

export interface ApiOptions {
    baseUrl: string;
    token: string;
    agentName: string;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
    /** Wait before the retry after a network error or a 5xx (ms). */
    retryDelayMs?: number;
    /** Wait before asking again when the first attempt is still running (ms). */
    runningDelayMs?: number;
    newKey?: () => string;
    log?: Logger;
    debug?: boolean;
}

export interface ApiResponse<T> {
    data: T;
    status: number;
    /** The API answered with the saved response of an earlier attempt (same Idempotency-Key). */
    replayed: boolean;
}

/** An API error, or (status 0) no answer at all. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly code: string | null,
        readonly request: string,
        /** 409: the first attempt with this Idempotency-Key is still running. */
        readonly stillRunning = false
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export const USER_AGENT = 'kaaga-mcp/0.1.0';

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

interface ErrorBody {
    success?: unknown;
    data?: unknown;
    message?: unknown;
    code?: unknown;
}

function parseBody(text: string): ErrorBody | null {
    if (!text) return null;
    try {
        const value: unknown = JSON.parse(text);
        return value && typeof value === 'object' ? (value as ErrorBody) : null;
    } catch {
        return null;
    }
}

function messageOf(status: number, body: ErrorBody | null, text: string): string {
    if (typeof body?.message === 'string' && body.message.trim()) return body.message.trim();
    const plain = text.trim();
    if (plain && !plain.startsWith('<')) return plain.slice(0, 300);
    return `HTTP ${status}`;
}

const isStillRunning = (status: number, body: ErrorBody | null): boolean =>
    status === 409 && !body?.code && typeof body?.message === 'string' && /idempotency-key is still running/i.test(body.message);

/** Why a fetch failed, in a few words (never the URL's credentials: we send none in URLs). */
export function networkReason(err: unknown): string {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'no answer in time';
    const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined;
    const code = typeof cause?.code === 'string' ? cause.code : '';
    if (code === 'ECONNREFUSED') return 'connection refused';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host not found';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'connection reset';
    if (code) return code;
    return err instanceof Error ? err.message : String(err);
}

export class KaagaApi {
    readonly baseUrl: string;
    private readonly token: string;
    private readonly agentName: string;
    private readonly timeoutMs: number;
    private readonly fetchFn: typeof globalThis.fetch;
    private readonly retryDelayMs: number;
    private readonly runningDelayMs: number;
    private readonly newKey: () => string;
    private readonly log: Logger;
    private readonly debug: boolean;

    constructor(options: ApiOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.agentName = options.agentName;
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.retryDelayMs = options.retryDelayMs ?? 500;
        this.runningDelayMs = options.runningDelayMs ?? 1500;
        this.newKey = options.newKey ?? randomUUID;
        this.log = options.log ?? silentLogger;
        this.debug = options.debug ?? false;
    }

    get<T>(path: string, query?: Query): Promise<T> {
        return this.request<T>('GET', path, { query }).then((r) => r.data);
    }

    post<T>(path: string, body: unknown): Promise<T> {
        return this.request<T>('POST', path, { body }).then((r) => r.data);
    }

    put<T>(path: string, body: unknown): Promise<T> {
        return this.request<T>('PUT', path, { body }).then((r) => r.data);
    }

    /** TOOL_ACCESS_PLAN §11.4: a file from disk, as multipart (fetch sets the boundary). */
    postForm<T>(path: string, form: FormData): Promise<T> {
        return this.request<T>('POST', path, { form }).then((r) => r.data);
    }

    patch<T>(path: string, body: unknown): Promise<T> {
        return this.request<T>('PATCH', path, { body }).then((r) => r.data);
    }

    /** Only for what agents may remove (a focus line, a milestone); every removal is undoable. */
    delete<T = unknown>(path: string): Promise<T> {
        return this.request<T>('DELETE', path).then((r) => r.data);
    }

    private url(path: string, query?: Query): string {
        const url = new URL(`${this.baseUrl}${path}`);
        for (const [name, value] of Object.entries(query ?? {})) {
            if (value === undefined || value === '') continue;
            url.searchParams.set(name, String(value));
        }
        return url.toString();
    }

    private headers(idempotencyKey: string | null, hasBody: boolean): Record<string, string> {
        return {
            Authorization: `Bearer ${this.token}`,
            'X-Agent-Name': this.agentName,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        };
    }

    async request<T>(method: HttpMethod, path: string, init: { query?: Query | undefined; body?: unknown; form?: FormData | undefined } = {}): Promise<ApiResponse<T>> {
        const url = this.url(path, init.query);
        const label = `${method} ${path}`;
        const hasBody = init.body !== undefined;
        const body: string | FormData | undefined = init.form ?? (hasBody ? JSON.stringify(init.body) : undefined);
        // One key per write request: the retry below reuses it.
        const key = method === 'GET' ? null : this.newKey();
        let retried = false;
        let waited = false;

        for (;;) {
            const started = Date.now();
            let status: number;
            let text: string;
            let replayed: boolean;
            try {
                const res = await this.fetchFn(url, {
                    method,
                    headers: this.headers(key, hasBody),
                    ...(body !== undefined ? { body } : {}),
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
                status = res.status;
                replayed = res.headers.get('idempotent-replayed') === 'true';
                text = await res.text();
            } catch (err) {
                const reason = networkReason(err);
                if (!retried) {
                    retried = true;
                    this.log(`${label}: ${reason}, retrying once`);
                    await sleep(this.retryDelayMs);
                    continue;
                }
                this.log(`${label}: ${reason}`);
                throw new ApiError(0, reason, null, label);
            }

            if (this.debug) this.log(`${label} → ${status} (${Date.now() - started} ms)${replayed ? ' replayed' : ''}`);
            const parsed = parseBody(text);

            if (status >= 500 && !retried) {
                retried = true;
                this.log(`${label}: HTTP ${status}, retrying once`);
                await sleep(this.retryDelayMs);
                continue;
            }
            if (key && retried && !waited && isStillRunning(status, parsed)) {
                waited = true;
                this.log(`${label}: the first attempt is still running, asking again`);
                await sleep(this.runningDelayMs);
                continue;
            }
            if (status < 200 || status >= 300) {
                const code = typeof parsed?.code === 'string' ? parsed.code : null;
                if (status >= 500) this.log(`${label}: HTTP ${status}`);
                throw new ApiError(status, messageOf(status, parsed, text), code, label, isStillRunning(status, parsed));
            }
            if (parsed?.success !== true) throw new ApiError(status, 'Kaaga sent an answer this server does not understand', null, label);
            return { data: parsed.data as T, status, replayed };
        }
    }
}
