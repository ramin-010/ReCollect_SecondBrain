// The hooks' second protocol (ECOSYSTEM_V2_PLAN §4.11 rule 2, §4.15; stage 4): once the server says it
// speaks it, every message goes as it is typed, with its own number in the session and the last message
// already read as context (with the end of the agent's reply); a lost answer loses and doubles nothing; a
// paused AI keeps the words on the PC; a failed close leaves its words for the next start (14 days at
// most); a short reply is read while one of the buddy's questions is open; an older server gets today's
// pieces, and a session longer than 10 hours is logged whole when the server takes a day.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leftover, numberedMessages, runHook, serverCapture } from '../../src/hook.js';

type Call = { method: string; url: string; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('numbers', () => {
    it('each of his messages has its number; the end of the reply to it comes along', () => {
        const at = '2026-11-18T10:00:00.000Z';
        const long = `${'a'.repeat(310)} Shall we do it on Friday?`;
        const lines = [{ at, text: 'first' }, { at, reply: long.slice(0, 300), tail: long.slice(-300) }, { at, text: 'second' }];
        const n = numberedMessages(lines);
        expect(n.map((m) => [m.n, m.text])).toEqual([
            [1, 'first'],
            [2, 'second'],
        ]);
        expect(n[0]!.tail).toMatch(/Shall we do it on Friday\?$/);
        expect(leftover(lines, { sent: 0, seq: 0, read: 1 }, true)).toBe(1);
        // A session that moves to numbers midway: what the lines already sent held counts as read.
        expect(leftover(lines, { sent: 2, seq: 1 }, true)).toBe(1);
    });
});

describe('the flow with numbers', () => {
    let home = '';
    afterEach(() => {
        vi.unstubAllGlobals();
        if (home) rmSync(home, { recursive: true, force: true });
    });

    /**
     * A fake server that keeps how far it has read each session. `capture`: what its brief says (0: an
     * older server, which refuses unknown fields). `lose`: answers to drop after the server took the words.
     */
    function setup(opts: { capture?: number; lose?: number; paused?: number; down?: boolean; reuse?: boolean; asks?: Array<{ _id: string; text: string; answers: string[]; until: string }> } = {}) {
        if (!opts.reuse || !home) {
            home = mkdtempSync(path.join(os.tmpdir(), 'kaaga-numbers-'));
            const allow = [{ path: 'E:/PERSONAL_PROJECTS/', mode: 'full', brief: true }];
            writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://kaaga.test', token: `rcl_${'a'.repeat(43)}`, allow, brief: true }));
        }
        const calls: Call[] = [];
        const read = new Map<string, number>();
        const taken: Array<{ n: number; text: string }> = [];
        let lose = opts.lose ?? 0;
        let paused = opts.paused ?? 0;
        const capture = opts.capture ?? 2;
        vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
            const call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
            calls.push(call);
            const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } });
            if (opts.down && !call.url.includes('/api/brief')) return new Response(JSON.stringify({ message: 'down' }), { status: 502 });
            if (call.url.includes('/api/buddy/words')) {
                const b = call.body;
                if (b.v === 2 && capture < 2) return new Response(JSON.stringify({ message: 'Unrecognized key: "v"' }), { status: 400, headers: { 'content-type': 'application/json' } });
                if (b.v !== 2) return json({ queued: b.messages.length, ...(capture >= 2 ? { capture } : {}) }, 202);
                if (paused > 0) {
                    paused--;
                    return new Response(JSON.stringify({ message: 'AI is paused', code: 'AI_PAUSED' }), { status: 503, headers: { 'content-type': 'application/json' } });
                }
                const mark = read.get(b.sessionKey) ?? 0;
                for (const m of b.messages) if (!m.context && m.n > mark) taken.push({ n: m.n, text: m.text });
                const top = Math.max(mark, ...b.messages.filter((m: { context?: boolean }) => !m.context).map((m: { n: number }) => m.n));
                read.set(b.sessionKey, top);
                if (lose > 0) {
                    lose--;
                    // The server took the words; the answer never arrives.
                    throw new TypeError('fetch failed');
                }
                return json({ queued: 1, read: top, capture }, 202);
            }
            if (call.url.includes('/api/buddy/note')) return new Response(null, { status: 204 });
            if (call.url.includes('/api/brief')) {
                return json({
                    now: { day: '2026-11-18', weekday: 'Wed', time: '10:00', timezone: 'Asia/Kolkata' },
                    profile: null,
                    goals: [],
                    today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] },
                    next: [],
                    recent: [],
                    recall: { days: 7, finished: 0, weakTopics: [] },
                    project: null,
                    ...(capture >= 2 ? { capture, asks: opts.asks ?? [] } : {}),
                    session: { key: 'cc_s1' },
                });
            }
            return json({ session: {} });
        });
        return { env: { KAAGA_HOOKS_HOME: home, KAAGA_HOOKS_FLUSH: 'inline' }, calls, taken, read };
    }

    const input = (over: Record<string, unknown> = {}) => ({ session_id: 's1', cwd: 'E:/PERSONAL_PROJECTS/second_brain', source: 'startup', ...over });
    const t = (m: number) => new Date(Date.UTC(2026, 11, 1, 10, m));
    const words = (calls: Call[]) => calls.filter((c) => c.url.includes('/api/buddy/words'));

    it('each message goes as it is typed, numbered, the last one read coming along as context with the end of the reply', async () => {
        const { env, calls, taken } = setup();
        await runHook('start', input(), env, t(0));
        expect(serverCapture({ url: 'http://kaaga.test' }, env)).toBe(2);
        await runHook('prompt', input({ prompt: 'I want to get back to running three mornings a week' }), env, t(1));
        expect(words(calls)).toHaveLength(1);
        expect(words(calls)[0]!.body).toMatchObject({ v: 2, canHold: true, sessionKey: 'cc_s1', seq: 1, messages: [{ n: 1, text: 'I want to get back to running three mornings a week' }] });
        const reply = `${'Here is a plan for the week. '.repeat(12)}Want me to remind you on Monday?`;
        await runHook('stop', input({ last_assistant_message: reply }), env, t(2));
        expect(words(calls)).toHaveLength(1); // the reply waits to come along with the next message
        await runHook('prompt', input({ prompt: 'yes please, Monday at 7 works for me' }), env, t(3));
        const second = words(calls)[1]!.body;
        expect(second.seq).toBe(2);
        expect(second.messages).toHaveLength(2);
        expect(second.messages[0]).toMatchObject({ n: 1, context: true });
        expect(second.messages[0].reply).toMatch(/Want me to remind you on Monday\?$/);
        expect(second.messages[1]).toMatchObject({ n: 2, text: 'yes please, Monday at 7 works for me' });
        expect(taken.map((m) => m.n)).toEqual([1, 2]);
    });

    it('a lost answer loses and doubles nothing: the next send takes up where the server is', async () => {
        // The answer to the send and to its one retry are both lost (the client retries a network error once).
        const { env, calls, taken } = setup({ lose: 2 });
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'Played guitar for fifteen minutes tonight' }), env, t(1)); // taken, answer lost
        await runHook('prompt', input({ prompt: 'and I want to keep it to weekends from now on' }), env, t(2));
        // The second send repeats message 1 (the hook never heard back) and adds message 2; the server reads each once.
        expect(words(calls).at(-1)!.body.messages.map((m: { n: number }) => m.n)).toEqual([1, 2]);
        expect(taken.map((m) => m.n)).toEqual([1, 2]);
        await runHook('prompt', input({ prompt: 'what is on my list for tomorrow then' }), env, t(3));
        expect(words(calls).at(-1)!.body.messages.map((m: { n: number; context?: boolean }) => [m.n, !!m.context])).toEqual([
            [2, true],
            [3, false],
        ]);
        expect(taken.map((m) => m.n)).toEqual([1, 2, 3]);
    });

    it('while the AI is paused the words wait on the PC and go in order once it is back', async () => {
        // Two prompts, each asked twice (the client retries a 5xx once).
        const { env, calls, taken } = setup({ paused: 4 });
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'Long day, skipped the run again this morning' }), env, t(1));
        await runHook('prompt', input({ prompt: 'thinking of moving it to the evenings instead' }), env, t(2));
        expect(taken).toEqual([]);
        expect(readFileSync(path.join(home, 'hook.log'), 'utf8')).toMatch(/held 2 words of s1: the AI is paused/);
        await runHook('prompt', input({ prompt: 'ok, evenings it is, starting tomorrow' }), env, t(3));
        expect(taken.map((m) => m.n)).toEqual([1, 2, 3]);
        expect(words(calls).at(-1)!.body.messages.map((m: { n: number }) => m.n)).toEqual([1, 2, 3]);
    });

    it('a close that cannot send leaves the words for the next start; the session is logged once; nothing older than 14 days goes', async () => {
        const { env, calls, taken } = setup({ down: true });
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'I need to call the landlord about the heating this week' }), env, t(1));
        await runHook('prompt', input({ prompt: 'and book the dentist before the end of the month' }), env, t(4));
        await runHook('end', input({ reason: 'prompt_input_exit' }), env, t(5));
        expect(taken).toEqual([]);
        expect(existsSync(path.join(home, 'open', 's1.words.jsonl'))).toBe(true);
        expect(JSON.parse(readFileSync(path.join(home, 'open', 's1.json'), 'utf8'))).toMatchObject({ endedAt: t(5).toISOString() });

        // The server answers again: the next start (another session) sends the words, then forgets them.
        vi.unstubAllGlobals();
        const back = setup({ reuse: true });
        await runHook('start', input({ session_id: 's2' }), back.env, t(30));
        expect(back.taken.map((m) => m.text)).toEqual(['I need to call the landlord about the heating this week', 'and book the dentist before the end of the month']);
        // The session itself is logged once, now that the server answers.
        expect(back.calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual(['http://kaaga.test/api/sessions/by-key/cc_s1']);
        expect(readdirSync(path.join(home, 'open')).sort()).toEqual(['s2.json']);
        void calls;
    });

    it('words older than 14 days are dropped, not sent', async () => {
        const { env, taken } = setup({ down: true });
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'Remember that I prefer mornings for deep work' }), env, t(1));
        await runHook('end', input(), env, t(2));
        vi.unstubAllGlobals();
        const later = setup({ reuse: true });
        await runHook('start', input({ session_id: 's3' }), later.env, new Date(t(2).getTime() + 15 * 86_400_000));
        expect(later.taken).toEqual([]);
        expect(readdirSync(path.join(home, 'open')).sort()).toEqual(['s3.json']);
        void taken;
    });

    it('a short reply is read while one of the buddy’s questions is open, and only then', async () => {
        const until = new Date(t(0).getTime() + 3 * 3600_000).toISOString();
        const { env, taken } = setup({ asks: [{ _id: 'a1', text: 'Guitar tonight?', answers: ['Did it', 'Not today'], until }] });
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'did it' }), env, t(1));
        expect(taken.map((m) => m.text)).toEqual(['did it']);
        await runHook('prompt', input({ prompt: 'yes' }), env, new Date(t(0).getTime() + 4 * 3600_000));
        expect(taken).toHaveLength(1);
    });

    it('an older server gets today’s pieces (no numbers); a newer one says so in its answer and the next sends use them', async () => {
        const old = setup({ capture: 0 });
        await runHook('start', input(), old.env, t(0));
        await runHook('prompt', input({ prompt: 'I want to read before bed most nights' }), old.env, t(1));
        expect(words(old.calls)).toHaveLength(0); // today: not due yet
        await runHook('stop', input({ last_assistant_message: 'Nice.' }), old.env, t(40));
        expect(words(old.calls)[0]!.body).not.toHaveProperty('v');
        vi.unstubAllGlobals();
        rmSync(home, { recursive: true, force: true });

        // A server that speaks numbers but whose brief was never read (it was upgraded mid-session): the first piece's answer says so.
        home = '';
        const upgraded = setup({ capture: 2 });
        await runHook('start', input({ session_id: 'w1' }), upgraded.env, t(0));
        rmSync(path.join(home, 'server.json'), { force: true });
        await runHook('prompt', input({ session_id: 'w1', prompt: 'a long first message '.repeat(120) }), upgraded.env, t(1));
        await runHook('stop', input({ session_id: 'w1', last_assistant_message: 'ok' }), upgraded.env, t(2));
        expect(words(upgraded.calls)[0]!.body).not.toHaveProperty('v');
        expect(serverCapture({ url: 'http://kaaga.test' }, upgraded.env)).toBe(2);
        await runHook('prompt', input({ session_id: 'w1', prompt: 'and here is the next thing I wanted' }), upgraded.env, t(3));
        // Midway to numbers: message 1 was sent as a piece, so only message 2 is new (1 comes as context).
        expect(words(upgraded.calls).at(-1)!.body.messages.map((m: { n: number; context?: boolean }) => [m.n, !!m.context])).toEqual([
            [1, true],
            [2, false],
        ]);
    });

    it('a session longer than 10 hours is logged whole when the server takes a day', async () => {
        const { env, calls } = setup();
        const at = (m: number) => new Date(Date.UTC(2026, 11, 1, 6, 0) + m * 60_000);
        await runHook('start', input(), env, at(0));
        for (let m = 4; m <= 780; m += 4) await runHook('prompt', input({ prompt: '/compact' }), env, at(m));
        await runHook('end', input({ reason: 'prompt_input_exit' }), env, at(780));
        // Whole: all 780 minutes are logged (in two parts when the 13 hours cross midnight on this computer's clock, 11-26).
        const puts = calls.filter((c) => c.method === 'PUT' && /\/api\/sessions\/by-key\//.test(c.url));
        expect(puts.reduce((n, c) => n + c.body.minutes, 0)).toBe(780);
        const crosses = new Date(at(0)).getDate() !== new Date(at(780)).getDate();
        expect(puts).toHaveLength(crosses ? 2 : 1);
    });
});
