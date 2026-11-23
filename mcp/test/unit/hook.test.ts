// Claude Code hooks (SYNC_SPINE_SPEC 1.4): the pure parts, and the whole flow against a fake API in
// a scratch folder (no network, no ~/.recollect).
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeMinutes, isAllowed, projectOf, projectRoot, promptTitle, runHook, worthLogging } from '../../src/hook.js';

describe('the pure parts', () => {
    it('allowed folders: a prefix, any case, either slash', () => {
        expect(isAllowed('E:\\PERSONAL_PROJECTS\\second_brain', ['E:/PERSONAL_PROJECTS/'])).toBe(true);
        expect(isAllowed('e:/personal_projects', ['E:/PERSONAL_PROJECTS/'])).toBe(true);
        expect(isAllowed('E:/PERSONAL_PROJECTSX/x', ['E:/PERSONAL_PROJECTS/'])).toBe(false);
        expect(isAllowed('C:/work/job-repo', ['E:/PERSONAL_PROJECTS/'])).toBe(false);
    });

    it('active minutes: gaps between stamps, none over 5 minutes', () => {
        const at = (m: number) => new Date(Date.UTC(2026, 10, 14, 10, m)).toISOString();
        expect(activeMinutes([at(0), at(3), at(4), at(30), at(32)])).toBe(3 + 1 + 5 + 2);
        expect(activeMinutes([at(0)])).toBe(0);
    });

    it('too small to log: under 2 minutes or fewer than 2 prompts', () => {
        expect(worthLogging({ prompts: 3 }, 1, {})).toBe(false);
        expect(worthLogging({ prompts: 1 }, 30, {})).toBe(false);
        expect(worthLogging({ prompts: 2 }, 2, {})).toBe(true);
        expect(worthLogging({ prompts: 0 }, 0, { RECOLLECT_HOOKS_MIN_MINUTES: '0', RECOLLECT_HOOKS_MIN_PROMPTS: '0' })).toBe(true);
    });

    it('the project is the folder name, lower case', () => {
        expect(projectOf('E:\\PERSONAL_PROJECTS\\Second_Brain\\')).toBe('second_brain');
    });

    it('a subfolder belongs to the first folder under its allow root', () => {
        const allow = ['E:/PERSONAL_PROJECTS/'];
        expect(projectOf('E:\\PERSONAL_PROJECTS\\second_brain\\backend\\src', allow)).toBe('second_brain');
        expect(projectRoot('E:\\PERSONAL_PROJECTS\\second_brain\\backend', allow)).toBe('E:/PERSONAL_PROJECTS/second_brain');
        expect(projectOf('e:/personal_projects/Upfly', allow)).toBe('upfly');
        expect(projectOf('E:/PERSONAL_PROJECTS', allow)).toBe('personal_projects');
        expect(projectOf('C:/elsewhere/tool', allow)).toBe('tool');
    });

    it('a session is named by its first real prompt: the first line, not a slash command or a one-word reply', () => {
        expect(promptTitle('Fix the hook sweep so a swept window keeps logging\nand add a test')).toBe('Fix the hook sweep so a swept window keeps logging');
        expect(promptTitle('/compact')).toBeNull();
        expect(promptTitle('go')).toBeNull();
        expect(promptTitle(42)).toBeNull();
        expect(promptTitle('x'.repeat(200))).toHaveLength(120);
    });
});

describe('the flow', () => {
    let home = '';
    afterEach(() => {
        vi.unstubAllGlobals();
        if (home) rmSync(home, { recursive: true, force: true });
    });

    function setup() {
        home = mkdtempSync(path.join(os.tmpdir(), 'recollect-hook-'));
        writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://recollect.test', token: `rcl_${'a'.repeat(43)}`, allow: ['E:/PERSONAL_PROJECTS/'], brief: true }));
        const calls: Array<{ method: string; url: string; body: unknown }> = [];
        vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
            calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
            const data = String(url).includes('/api/brief')
                ? {
                      now: { day: '2026-11-14', weekday: 'Sat', time: '10:00', timezone: 'Asia/Kolkata' },
                      profile: null,
                      goals: [],
                      today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] },
                      next: [],
                      recent: [],
                      recall: { days: 7, finished: 0, weakTopics: [] },
                      project: null,
                      session: { key: 'cc_s1' },
                  }
                : { session: {} };
            return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        return { env: { RECOLLECT_HOOKS_HOME: home }, calls };
    }

    const input = (over: Record<string, unknown> = {}) => ({ session_id: 's1', cwd: 'E:/PERSONAL_PROJECTS/second_brain', source: 'startup', ...over });

    it('a session longer than the server takes is logged with its most (600 minutes), never refused at every start', async () => {
        const { env, calls } = setup();
        const t = (m: number) => new Date(Date.UTC(2026, 10, 14, 6, 0) + m * 60_000);
        await runHook('start', input(), env, t(0));
        // A prompt every 4 minutes for 13 hours: 780 active minutes.
        for (let m = 4; m <= 780; m += 4) await runHook('prompt', input(), env, t(m));
        await runHook('end', input({ reason: 'prompt_input_exit' }), env, t(780));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.body).toMatchObject({ minutes: 600 });
        // About 200 hook runs, each writing files: about a second alone, more beside the other suites' workers.
    }, 20_000);

    it('start prints the brief and opens the session; prompts stamp it; end logs it under cc_<session> and forgets it', async () => {
        const { env, calls } = setup();
        const t = (m: number) => new Date(Date.UTC(2026, 10, 14, 10, m));
        const out = await runHook('start', input(), env, t(0));
        expect(out).toContain('Recollect (session-start hook)');
        expect(out).toContain('Session key: cc_s1');
        // EASY_SETUP_PLAN: the start asks for the server's folder rules first (kept 10 minutes), then the brief.
        expect(calls[0]!.url).toBe('http://recollect.test/api/projects/rules');
        expect(calls[1]!.url).toContain('/api/brief?project=second_brain&key=cc_s1');
        await runHook('prompt', input(), env, t(1));
        await runHook('stop', input(), env, t(4));
        await runHook('prompt', input(), env, t(5));
        await runHook('end', input({ reason: 'prompt_input_exit' }), env, t(9));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.url).toBe('http://recollect.test/api/sessions/by-key/cc_s1');
        expect(put.body).toMatchObject({ kindIfNew: 'build', source: 'hook', project: 'second_brain', minutes: 9, startedAt: t(0).toISOString(), endedAt: t(9).toISOString() });
        expect(readdirSync(path.join(home, 'open'))).toEqual([]);
    });

    it('nothing outside the allowed folders, in subagents, or with RECOLLECT_HOOKS=off; too small is dropped quietly', async () => {
        const { env, calls } = setup();
        expect(await runHook('start', input({ cwd: 'C:/work/job-repo' }), env)).toBe('');
        expect(await runHook('start', input({ agent_id: 'a1' }), env)).toBe('');
        expect(await runHook('start', input(), { ...env, RECOLLECT_HOOKS: 'off' })).toBe('');
        expect(calls).toHaveLength(0);
        const t = new Date();
        await runHook('start', input(), env, t);
        await runHook('end', input(), env, new Date(t.getTime() + 30_000));
        expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    });

    it('a window closed without SessionEnd is logged by the next start (the sweep)', async () => {
        const { env, calls } = setup();
        const t = (m: number) => new Date(Date.UTC(2026, 10, 14, 10, m));
        await runHook('start', input({ session_id: 'old' }), env, t(0));
        await runHook('prompt', input({ session_id: 'old' }), env, t(2));
        await runHook('prompt', input({ session_id: 'old' }), env, t(6));
        await runHook('start', input({ session_id: 'new' }), env, t(60));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.url).toContain('/cc_old');
        expect(put.body).toMatchObject({ minutes: 6, endedAt: t(6).toISOString() });
        expect(readdirSync(path.join(home, 'open'))).toEqual(['new.json']);
        expect(JSON.parse(readFileSync(path.join(home, 'open', 'new.json'), 'utf8')).key).toBe('cc_new');
    });

    it('a swept window that is used again logs the rest as a session of its own, named by its first prompt', async () => {
        const { env, calls } = setup();
        const t = (m: number) => new Date(Date.UTC(2026, 10, 14, 10, m));
        await runHook('start', input({ session_id: 'old' }), env, t(0));
        await runHook('prompt', input({ session_id: 'old', prompt: 'Build the week targets API' }), env, t(2));
        await runHook('prompt', input({ session_id: 'old', prompt: 'and the tests' }), env, t(6));
        await runHook('start', input({ session_id: 'new' }), env, t(60)); // sweeps "old"
        await runHook('prompt', input({ session_id: 'old', prompt: '/compact' }), env, t(61));
        await runHook('prompt', input({ session_id: 'old', prompt: 'Now wire the targets into Home' }), env, t(63));
        await runHook('end', input({ session_id: 'old' }), env, t(65));
        const puts = calls.filter((c) => c.method === 'PUT');
        expect(puts).toHaveLength(2);
        expect(puts[0]!.url).toMatch(/\/cc_old$/);
        expect(puts[0]!.body).toMatchObject({ minutes: 6, titleIfNew: 'Build the week targets API' });
        expect(puts[1]!.url).toMatch(/\/cc_old%3Ar[0-9a-z]+$/);
        expect(puts[1]!.body).toMatchObject({ minutes: 4, titleIfNew: 'Now wire the targets into Home', startedAt: t(61).toISOString() });
    });

    it('the start hook names the project of a subfolder and tells the model how to keep its next step', async () => {
        const { env, calls } = setup();
        const out = await runHook('start', input({ cwd: 'E:/PERSONAL_PROJECTS/second_brain/backend' }), env, new Date(Date.UTC(2026, 10, 14, 10, 0)));
        expect(calls.find((c) => c.url.includes('/api/brief'))!.url).toContain('project=second_brain');
        expect(out).toContain('project "second_brain"');
        expect(out).toContain('nextStep');
    });
});
