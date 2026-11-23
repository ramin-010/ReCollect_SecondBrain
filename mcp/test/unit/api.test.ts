import { describe, expect, it } from 'vitest';
import { ApiError, RecollectApi, USER_AGENT } from '../../src/api.js';
import { cleanAgentName, loadConfig, normalizeBaseUrl } from '../../src/config.js';
import { INVALID_TOKEN_MESSAGE, describeError, ToolError } from '../../src/errors.js';
import { BASE, TOKEN, UUID_RE, fail, fakeFetch, ok, refused, type Routes } from './harness.js';

function api(routes: Routes, extra: Partial<ConstructorParameters<typeof RecollectApi>[0]> = {}) {
    const fake = fakeFetch(routes);
    const logs: string[] = [];
    const client = new RecollectApi({
        baseUrl: BASE,
        token: TOKEN,
        agentName: 'Claude Code',
        fetch: fake.fetch,
        retryDelayMs: 0,
        runningDelayMs: 0,
        log: (m) => logs.push(m),
        ...extra,
    });
    return { client, requests: fake.requests, logs };
}

describe('RecollectApi: request shape', () => {
    it('GET sends the bearer token, X-Agent-Name and Accept, no Idempotency-Key, and the query without empty values', async () => {
        const { client, requests } = api({ 'GET /api/agent/docs': ok([]) });
        await client.get('/api/agent/docs', { query: 'postgres locks', limit: 5, empty: '', none: undefined });
        expect(requests).toHaveLength(1);
        const [req] = requests;
        expect(req!.method).toBe('GET');
        expect(req!.path).toBe('/api/agent/docs');
        expect(req!.query).toEqual({ query: 'postgres locks', limit: '5' });
        expect(req!.headers['authorization']).toBe(`Bearer ${TOKEN}`);
        expect(req!.headers['x-agent-name']).toBe('Claude Code');
        expect(req!.headers['accept']).toBe('application/json');
        expect(req!.headers['user-agent']).toBe(USER_AGENT);
        expect(req!.headers['idempotency-key']).toBeUndefined();
        expect(req!.headers['content-type']).toBeUndefined();
    });

    it('POST, PUT and PATCH send JSON with a fresh uuid Idempotency-Key each', async () => {
        const { client, requests } = api({ 'POST /api/focus': ok({}, 201), 'PUT /api/quick-notes/x': ok({}, 201), 'PATCH /api/goals/g': ok({}) });
        await client.post('/api/focus', { text: 'a' });
        await client.put('/api/quick-notes/x', { content: 'b' });
        await client.patch('/api/goals/g', { title: 'c' });
        const keys = requests.map((r) => r.headers['idempotency-key']);
        for (const key of keys) expect(key).toMatch(UUID_RE);
        expect(new Set(keys).size).toBe(3);
        expect(requests.map((r) => r.headers['content-type'])).toEqual(['application/json', 'application/json', 'application/json']);
        expect(requests.map((r) => r.body)).toEqual([{ text: 'a' }, { content: 'b' }, { title: 'c' }]);
    });

    it('unwraps { success, data } and reports a replay', async () => {
        const { client } = api({ 'POST /api/focus': { status: 201, data: { _id: 'f1' }, headers: { 'Idempotent-Replayed': 'true' } } });
        const res = await client.request('POST', '/api/focus', { body: { text: 'x' } });
        expect(res).toEqual({ data: { _id: 'f1' }, status: 201, replayed: true });
    });
});

describe('RecollectApi: retries', () => {
    it('retries a 5xx once with the SAME Idempotency-Key', async () => {
        const { client, requests, logs } = api({ 'POST /api/agent/docs': [fail(502, 'Bad gateway'), ok({ id: 'd1' }, 201)] });
        await expect(client.post('/api/agent/docs', { title: 't' })).resolves.toEqual({ id: 'd1' });
        expect(requests).toHaveLength(2);
        expect(requests[0]!.headers['idempotency-key']).toMatch(UUID_RE);
        expect(requests[1]!.headers['idempotency-key']).toBe(requests[0]!.headers['idempotency-key']);
        expect(requests[1]!.body).toEqual(requests[0]!.body);
        expect(logs.join('\n')).toContain('retrying once');
    });

    it('retries a network error once with the same key', async () => {
        const { client, requests } = api({ 'PUT /api/quick-notes/n1': [refused(), ok({ _id: 'n1' }, 201)] });
        await expect(client.put('/api/quick-notes/n1', { content: 'x' })).resolves.toEqual({ _id: 'n1' });
        expect(requests).toHaveLength(2);
        expect(requests[1]!.headers['idempotency-key']).toBe(requests[0]!.headers['idempotency-key']);
    });

    it('gives up after one retry: a network error becomes status 0', async () => {
        const { client, requests } = api({ 'GET /api/today': refused() });
        const err = await client.get('/api/today').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(0);
        expect((err as ApiError).message).toBe('connection refused');
        expect(requests).toHaveLength(2);
    });

    it('gives up after one retry on a second 5xx', async () => {
        const { client, requests } = api({ 'POST /api/focus': fail(500, 'Server Error') });
        const err = (await client.post('/api/focus', {}).catch((e: unknown) => e)) as ApiError;
        expect(err.status).toBe(500);
        expect(requests).toHaveLength(2);
    });

    it('when the retry finds the first attempt still running (409), asks once more for the saved answer', async () => {
        const running = fail(409, 'A request with this Idempotency-Key is still running');
        const { client, requests } = api({
            'POST /api/agent/docs': [refused(), running, { status: 201, data: { id: 'd1' }, headers: { 'Idempotent-Replayed': 'true' } }],
        });
        const res = await client.request('POST', '/api/agent/docs', { body: { title: 't' } });
        expect(res.replayed).toBe(true);
        expect(res.data).toEqual({ id: 'd1' });
        expect(requests).toHaveLength(3);
        expect(new Set(requests.map((r) => r.headers['idempotency-key'])).size).toBe(1);
    });

    it('stops at a still-running 409 after that extra ask', async () => {
        const running = fail(409, 'A request with this Idempotency-Key is still running');
        const { client, requests } = api({ 'POST /api/agent/docs': [fail(503, 'down'), running, running] });
        const err = (await client.post('/api/agent/docs', {}).catch((e: unknown) => e)) as ApiError;
        expect(err.status).toBe(409);
        expect(err.stillRunning).toBe(true);
        expect(requests).toHaveLength(3);
    });

    it('never retries a 4xx (a business 409 has a code and is not "still running")', async () => {
        const { client, requests } = api({ 'POST /api/focus': fail(409, 'Up to 3 focus lines a day', 'FOCUS_LIMIT') });
        const err = (await client.post('/api/focus', { text: 'x' }).catch((e: unknown) => e)) as ApiError;
        expect(err.status).toBe(409);
        expect(err.code).toBe('FOCUS_LIMIT');
        expect(err.stillRunning).toBe(false);
        expect(requests).toHaveLength(1);
    });

    it('retries a GET on 5xx (no key)', async () => {
        const { client, requests } = api({ 'GET /api/goals': [fail(500, 'boom'), ok([])] });
        await expect(client.get('/api/goals')).resolves.toEqual([]);
        expect(requests).toHaveLength(2);
        expect(requests.every((r) => r.headers['idempotency-key'] === undefined)).toBe(true);
    });

    it('treats a timeout as a network error (retried once)', async () => {
        let calls = 0;
        const hang: typeof fetch = (_input, init) => {
            calls += 1;
            return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
        };
        const client = new RecollectApi({ baseUrl: BASE, token: TOKEN, agentName: 'A', fetch: hang, timeoutMs: 20, retryDelayMs: 0 });
        const err = (await client.get('/api/today').catch((e: unknown) => e)) as ApiError;
        expect(err.status).toBe(0);
        expect(err.message).toBe('no answer in time');
        expect(calls).toBe(2);
    });
});

describe('RecollectApi: errors', () => {
    it('keeps the API message and code', async () => {
        const { client } = api({ 'GET /api/agent/docs/d1': fail(404, 'Doc not found') });
        const err = (await client.get('/api/agent/docs/d1').catch((e: unknown) => e)) as ApiError;
        expect(err).toMatchObject({ status: 404, message: 'Doc not found', code: null, request: 'GET /api/agent/docs/d1' });
    });

    it('an HTML error page becomes "HTTP <status>"', async () => {
        const { client } = api({ 'GET /api/nope': { status: 404, body: '<!DOCTYPE html><html>Cannot GET</html>' } });
        await expect(client.get('/api/nope')).rejects.toMatchObject({ status: 404, message: 'HTTP 404' });
    });

    it('a 2xx without the envelope is an error', async () => {
        const { client } = api({ 'GET /api/today': { status: 200, body: { today: 'x' } } });
        await expect(client.get('/api/today')).rejects.toThrow(/does not understand/);
    });
});

describe('describeError', () => {
    const e = (status: number, message: string, stillRunning = false) => new ApiError(status, message, null, 'POST /api/x', stillRunning);

    it('401 → make a new token in Settings → Agents', () => {
        expect(describeError(e(401, 'This access token was revoked'), BASE)).toContain(INVALID_TOKEN_MESSAGE);
    });
    it('403 for a missing scope names the scope', () => {
        const text = describeError(e(403, 'This access token lacks the "learning:write" scope'), BASE);
        expect(text).toContain('lacks the "learning:write" scope');
        expect(text).toContain('Settings → Agents');
    });
    it('other 403s pass through', () => {
        expect(describeError(e(403, 'Viewers cannot edit this document'), BASE)).toBe('Viewers cannot edit this document');
    });
    it('no answer → is the backend running? (a write also says to check recent_agent_edits)', () => {
        const write = describeError(e(0, 'connection refused'), BASE);
        expect(write).toMatch(/^Can't reach Recollect at http:\/\/recollect\.test \(connection refused\)\. Is the backend running\?/);
        expect(write).toContain('recent_agent_edits');
        const read = describeError(new ApiError(0, 'connection refused', null, 'GET /api/today'), BASE);
        expect(read).not.toContain('recent_agent_edits');
    });
    it('5xx → server error, retried once', () => {
        expect(describeError(e(500, 'Server Error'), BASE)).toMatch(/server error \(HTTP 500\).*retried once/);
    });
    it('still running → check recent_agent_edits', () => {
        expect(describeError(e(409, 'A request with this Idempotency-Key is still running', true), BASE)).toContain('recent_agent_edits');
    });
    it('a 404 with a heading list passes through unchanged', () => {
        const message = 'Heading "Nope" not found in this doc. Its headings: "Intro", "Complexity".';
        expect(describeError(e(404, message), BASE)).toBe(message);
    });
    it('tool errors and unknown errors', () => {
        expect(describeError(new ToolError('No subject named "X".'), BASE)).toBe('No subject named "X".');
        expect(describeError(new Error('boom'), BASE)).toBe('Unexpected error: boom');
    });
});

describe('config', () => {
    it('defaults: localhost:8002 and "Claude Code"', () => {
        const config = loadConfig({ RECOLLECT_TOKEN: TOKEN });
        expect(config).toMatchObject({ baseUrl: 'http://localhost:8002', agentName: 'Claude Code', problem: null, timeoutMs: 30_000, debug: false });
    });
    it('normalizes the URL (trailing slashes, a trailing /api)', () => {
        expect(normalizeBaseUrl('http://localhost:8002/')).toBe('http://localhost:8002');
        expect(normalizeBaseUrl('https://api.re-collect.in/api/')).toBe('https://api.re-collect.in');
        expect(normalizeBaseUrl('  ')).toBe('http://localhost:8002');
    });
    it('a missing or malformed token is a problem every tool reports (never echoing the value)', () => {
        expect(loadConfig({ RECOLLECT_HOOKS_HOME: 'Z:/no/such/home' }).problem).toMatch(/not signed in on this computer: run `npx re-collect setup`/);
        const bad = loadConfig({ RECOLLECT_TOKEN: 'ghp_secretvalue123' });
        expect(bad.problem).toMatch(/start with rcl_/);
        expect(bad.problem).not.toContain('secretvalue');
        expect(loadConfig({ RECOLLECT_TOKEN: TOKEN, RECOLLECT_URL: 'localhost:8002' }).problem).toMatch(/http\(s\) URL/);
    });
    it('each connection can name itself: RECOLLECT_AGENT_NAME, or the short RECOLLECT_AGENT', () => {
        expect(loadConfig({ RECOLLECT_TOKEN: TOKEN, RECOLLECT_AGENT: 'study-chat' }).agentName).toBe('study-chat');
        expect(loadConfig({ RECOLLECT_TOKEN: TOKEN, RECOLLECT_AGENT_NAME: 'work', RECOLLECT_AGENT: 'study-chat' }).agentName).toBe('work');
    });
    it('agent names are printable ASCII, at most 60 characters', () => {
        expect(cleanAgentName('  Claude\tCode \u{1F916} ')).toBe('Claude Code');
        expect(cleanAgentName('x'.repeat(80))).toHaveLength(60);
        expect(cleanAgentName('')).toBe('Claude Code');
    });
});
