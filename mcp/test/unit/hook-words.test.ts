// The hooks' words for the buddy (BUDDY_MEMORY_PLAN §3.1 A): folder rules, what is read of a prompt,
// the flush (a piece at 2,000 characters or 30 minutes; a failed POST keeps the words; a retry is
// the same piece), the buddy's note once per session, and work folders that never see the brief.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushDue, folderRule, isAllowed, promptWords, runHook, unsentMessages } from '../../src/hook.js';

describe('folder rules and words', () => {
    const allow = [{ path: 'E:/PERSONAL_PROJECTS/', mode: 'full' as const, brief: true }, { path: '*', mode: 'full' as const, brief: false }, { path: 'C:/secret/', mode: 'off' as const }];

    it('the longest match wins; "*" is the last resort; off is off; a plain string keeps its old meaning', () => {
        expect(folderRule('E:\\PERSONAL_PROJECTS\\second_brain', allow)).toMatchObject({ mode: 'full', brief: true });
        expect(folderRule('C:/work/acme-api', allow)).toMatchObject({ mode: 'full', brief: false });
        expect(isAllowed('C:/secret/x', allow)).toBe(false);
        expect(folderRule('E:/PERSONAL_PROJECTS/x', ['E:/PERSONAL_PROJECTS/'])).toMatchObject({ mode: 'light', brief: true });
        expect(folderRule('C:/work', ['E:/PERSONAL_PROJECTS/'])).toBeNull();
    });

    it('what is read of a prompt: no slash commands or short replies; pastes and code become a marker; long ones are cut', () => {
        expect(promptWords('/compact')).toBeNull();
        expect(promptWords('yes do')).toBeNull();
        expect(promptWords('I keep putting off the mock interview, remind me Friday')).toBe('I keep putting off the mock interview, remind me Friday');
        expect(promptWords('look at this <pasted_content id="1">a\nb\nc</pasted_content id="1"> and tell me')).toBe('look at this [pasted text, 3 lines] and tell me');
        expect(promptWords('why does this fail\n```ts\nconst a = 1;\nconst b = 2;\n```\nplease')).toBe('why does this fail\n[code, 2 lines]\nplease');
        expect(promptWords(`<ide_selection>secret code</ide_selection>${'word '.repeat(2000)}`)!.length).toBeLessThan(3900);
    });

    it('a piece is due at 2,000 characters or after 30 minutes; a reply joins the words before it', () => {
        const t = (m: number) => new Date(Date.UTC(2026, 10, 16, 10, m)).toISOString();
        const lines = [{ at: t(0), text: 'a'.repeat(100) }, { at: t(1), reply: 'Sure, here is the plan' }, { at: t(2), text: 'b'.repeat(100) }];
        expect(unsentMessages(lines, 0)).toEqual([{ at: t(0), text: 'a'.repeat(100), reply: 'Sure, here is the plan' }, { at: t(2), text: 'b'.repeat(100) }]);
        expect(flushDue(lines, 0, new Date(t(10)))).toBe(false);
        expect(flushDue(lines, 0, new Date(t(31)))).toBe(true);
        expect(flushDue([{ at: t(0), text: 'x'.repeat(2000) }], 0, new Date(t(1)))).toBe(true);
        expect(flushDue(lines, 3, new Date(t(59)))).toBe(false);
    });
});

describe('the flow with words', () => {
    let home = '';
    afterEach(() => {
        vi.unstubAllGlobals();
        if (home) rmSync(home, { recursive: true, force: true });
    });

    function setup(opts: { failWords?: number; briefNote?: boolean } = {}) {
        home = mkdtempSync(path.join(os.tmpdir(), 'recollect-words-'));
        const allow = [{ path: 'E:/PERSONAL_PROJECTS/', mode: 'full', brief: true }, { path: '*', mode: 'full', brief: false }];
        writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://recollect.test', token: `rcl_${'a'.repeat(43)}`, allow, brief: true }));
        const calls: Array<{ method: string; url: string; body: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        let fails = opts.failWords ?? 0;
        vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
            const call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined };
            calls.push(call);
            const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } });
            if (call.url.includes('/api/buddy/words')) {
                if (fails > 0) {
                    fails--;
                    return new Response(JSON.stringify({ message: 'down' }), { status: 500, headers: { 'content-type': 'application/json' } });
                }
                return json({ queued: call.body.messages.length }, 202);
            }
            if (call.url.includes('/api/buddy/note')) return json({ id: 'n1', text: 'You said the mock interview is Friday: still on?', day: '2026-11-16' });
            if (call.url.includes('/api/brief')) {
                return json({
                    now: { day: '2026-11-16', weekday: 'Mon', time: '10:00', timezone: 'Asia/Kolkata' },
                    profile: 'Backend engineer looking for a new job',
                    goals: [],
                    today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] },
                    next: [],
                    recent: [],
                    recall: { days: 7, finished: 0, weakTopics: [] },
                    project: null,
                    ...(opts.briefNote ? { buddy: { who: null, heading: null, now: null, memories: [], note: 'Write down what launched means first.', followUp: null, noteId: 'n2:note', noteDay: '2026-11-16' } } : {}),
                    session: { key: 'cc_s1' },
                });
            }
            return json({ session: {} });
        });
        return { env: { RECOLLECT_HOOKS_HOME: home, RECOLLECT_HOOKS_FLUSH: 'inline' }, calls };
    }

    const input = (over: Record<string, unknown> = {}) => ({ session_id: 's1', cwd: 'E:/PERSONAL_PROJECTS/second_brain', source: 'startup', ...over });
    const t = (m: number) => new Date(Date.UTC(2026, 10, 16, 10, m));

    it('words go in a piece once due; the reply comes along; the note is fetched and shown once', async () => {
        const { env, calls } = setup();
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'I want to try a mock interview this week, it scares me a bit' }), env, t(1));
        await runHook('stop', input({ last_assistant_message: 'Good idea. Let us pick a day and a format that fits your week.' }), env, t(2));
        expect(calls.filter((c) => c.url.includes('/api/buddy/words'))).toHaveLength(0); // not due yet
        await runHook('prompt', input({ prompt: 'yes' }), env, t(20));
        await runHook('prompt', input({ prompt: 'also I study best after 9 pm, never before work' }), env, t(33));
        await runHook('stop', input({ last_assistant_message: 'Noted.' }), env, t(34));
        const posts = calls.filter((c) => c.url.includes('/api/buddy/words'));
        expect(posts).toHaveLength(1);
        expect(posts[0]!.body).toMatchObject({ sessionKey: 'cc_s1', seq: 1, project: 'second_brain' });
        expect(posts[0]!.body.messages).toEqual([
            { at: t(1).toISOString(), text: 'I want to try a mock interview this week, it scares me a bit', reply: 'Good idea. Let us pick a day and a format that fits your week.' },
            { at: t(33).toISOString(), text: 'also I study best after 9 pm, never before work', reply: 'Noted.' },
        ]);
        expect(JSON.parse(readFileSync(path.join(home, 'note.json'), 'utf8')).id).toBe('n1');

        // The next prompt carries the note once; the one after doesn't.
        expect(await runHook('prompt', input({ prompt: 'ok next part of the plan please' }), env, t(35))).toContain("from Ramin's buddy");
        expect(await runHook('prompt', input({ prompt: 'and the part after that one' }), env, t(36))).toBe('');

        // The end sends what is left and forgets the session's files.
        await runHook('end', input(), env, t(40));
        const after = calls.filter((c) => c.url.includes('/api/buddy/words'));
        expect(after).toHaveLength(2);
        expect(after[1]!.body).toMatchObject({ seq: 2, messages: [{ text: 'ok next part of the plan please' }, { text: 'and the part after that one' }] });
        expect(readdirSync(path.join(home, 'open'))).toEqual([]);
    });

    it("the brief's note counts as shown: no prompt repeats it, nor brings back an older one", async () => {
        const { env } = setup({ briefNote: true });
        // An older note waits in the file (from an earlier flush).
        writeFileSync(path.join(home, 'note.json'), JSON.stringify({ id: 'n1:note', text: 'An older note', day: '2026-11-16' }));
        expect(await runHook('start', input(), env, t(0))).toContain('Write down what launched means first.');
        expect(JSON.parse(readFileSync(path.join(home, 'note.json'), 'utf8')).id).toBe('n2:note');
        expect(await runHook('prompt', input({ prompt: 'ok let us start' }), env, t(1))).toBe('');
        expect(await runHook('prompt', input({ prompt: 'next' }), env, t(2))).toBe('');
    });

    it('a failed POST keeps the words for the next flush, as the same piece', async () => {
        const { env, calls } = setup({ failWords: 1 });
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'x'.repeat(2100) + ' and more words here' }), env, t(1));
        await runHook('stop', input(), env, t(2)); // due (2,000 characters): the POST fails
        await runHook('stop', input(), env, t(3)); // tries again
        const posts = calls.filter((c) => c.url.includes('/api/buddy/words'));
        expect(posts.map((p) => p.body.seq)).toEqual([1, 1]);
        expect(existsSync(path.join(home, 'open', 's1.flush.json'))).toBe(true);
        expect(JSON.parse(readFileSync(path.join(home, 'open', 's1.flush.json'), 'utf8'))).toEqual({ sent: 1, seq: 1 });
    });

    it('a work folder ("*", brief false): words are read, but no brief and no note are ever printed', async () => {
        const { env, calls } = setup();
        writeFileSync(path.join(home, 'note.json'), JSON.stringify({ id: 'n9', text: 'A personal note', day: '2026-11-16' }));
        const work = (over: Record<string, unknown> = {}) => input({ cwd: 'C:/work/acme-api', session_id: 'w1', ...over });
        expect(await runHook('start', work(), env, t(0))).toBe('');
        expect(calls.some((c) => c.url.includes('/api/brief'))).toBe(false);
        expect(await runHook('prompt', work({ prompt: 'I am tired of this sprint, honestly I want out of this job' }), env, t(1))).toBe('');
        await runHook('end', work(), env, t(5));
        const posts = calls.filter((c) => c.url.includes('/api/buddy/words'));
        expect(posts[0]!.body).toMatchObject({ sessionKey: 'cc_w1', project: 'acme-api' });
    });

    it('a light folder (a plain string) never reads words', async () => {
        const { env, calls } = setup();
        writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://recollect.test', token: `rcl_${'a'.repeat(43)}`, allow: ['E:/PERSONAL_PROJECTS/'], brief: true }));
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input({ prompt: 'I am worried about the deadline this week' }), env, t(1));
        await runHook('end', input(), env, t(40));
        expect(calls.some((c) => c.url.includes('/api/buddy/words'))).toBe(false);
        expect(existsSync(path.join(home, 'open', 's1.words.jsonl'))).toBe(false);
    });
});
