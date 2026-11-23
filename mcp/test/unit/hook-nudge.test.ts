// B10 (BUDDY_MEMORY_PLAN §12.4): the day's clock (local only), the per-prompt reminder to save with the
// time, the reminders to log once a day, a work folder's session titled by its project with no commit
// subjects, and a folder turned from full to light holding its waiting words.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockSpans, folderRule, markLogged, promptHead, readClock, runHook } from '../../src/hook.js';

let home = '';
afterEach(() => {
    vi.unstubAllGlobals();
    if (home) rmSync(home, { recursive: true, force: true });
    home = '';
});

const TOKEN = `rcl_${'a'.repeat(43)}`;
const writeConfig = (allow: unknown[]) => writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://recollect.test', token: TOKEN, allow, brief: true }));

function setup(allow: unknown[]) {
    home = mkdtempSync(path.join(os.tmpdir(), 'recollect-nudge-'));
    writeConfig(allow);
    const calls: Array<{ method: string; url: string; body: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({ success: true, data: { session: {}, queued: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return { env: { RECOLLECT_HOOKS_HOME: home, RECOLLECT_HOOKS_FLUSH: 'inline' }, calls };
}

const OFFICE = [
    { path: 'E:/PERSONAL_PROJECTS/', mode: 'full', brief: true },
    { path: 'D:/erp-workspace/', mode: 'light', brief: false, nudge: true, commits: false },
    { path: '*', mode: 'light', brief: false, nudge: true, commits: false },
];
/** The PC's local time (the clock and the reminders go by it). */
const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m);
const office = (over: Record<string, unknown> = {}) => ({ session_id: 'o1', cwd: 'D:/erp-workspace/erp', source: 'startup', ...over });

describe('the pieces', () => {
    it('a folder rule reads nudge and commits (off and on by default); a prompt head is its first real line', () => {
        expect(folderRule('D:/erp-workspace/erp', OFFICE as never)).toMatchObject({ mode: 'light', brief: false, nudge: true, commits: false });
        expect(folderRule('E:/PERSONAL_PROJECTS/x', OFFICE as never)).toMatchObject({ nudge: false, commits: true });
        expect(folderRule('E:/x', ['E:/'])).toMatchObject({ nudge: false, commits: true });
        expect(promptHead('<ide_selection>secret</ide_selection>\n\n  fix the rounding in invoice_totals\nand more')).toBe('fix the rounding in invoice_totals');
        expect(promptHead(`${'x'.repeat(80)}`)).toHaveLength(60);
        expect(promptHead('   ')).toBeUndefined();
    });

    it('stretches: a turn lasts from the prompt to the last stop, however long; turns over 30 minutes apart split', () => {
        const l = (h: number, m: number, end = false) => ({ at: at(h, m).toISOString(), sid: 's', ...(end ? { end: true as const } : {}) });
        const spans = clockSpans([l(10, 0), l(10, 50, true), l(11, 10), l(11, 15, true), l(13, 0), l(13, 5, true)]);
        expect(spans.map((s) => s.minutes)).toEqual([75, 5]);
    });
});

describe('an office folder', () => {
    it('stamps each prompt and reply locally, reminds the agent with the time, sends nothing until the end, then only the hours under the project name', async () => {
        const { env, calls } = setup(OFFICE);
        expect(await runHook('start', office(), env, at(10, 0))).toBe('');
        const out = await runHook('prompt', office({ prompt: 'fix the GST rounding in invoice_totals for client Acme\nmore' }), env, at(10, 12));
        expect(out).toMatch(/^Recollect \[Mon 16 Nov, 10:12\]: before you finish this turn, if their message or your answer holds something the user would want later/);
        expect(out).toContain('Never save company code, data or client names.');
        await runHook('stop', office(), env, at(10, 19));
        await runHook('prompt', office({ prompt: 'now the tests' }), env, at(10, 25));
        await runHook('stop', office(), env, at(10, 31));
        // The start's one read of the folder rules aside (EASY_SETUP_PLAN), nothing goes out.
        expect(calls.filter((c) => !c.url.endsWith('/api/projects/rules'))).toHaveLength(0);
        expect(readClock('erp', '2026-11-16', env)).toEqual([
            { at: at(10, 12).toISOString(), sid: 'o1', head: 'fix the GST rounding in invoice_totals for client Acme' },
            { at: at(10, 19).toISOString(), sid: 'o1', end: true },
            { at: at(10, 25).toISOString(), sid: 'o1', head: 'now the tests' },
            { at: at(10, 31).toISOString(), sid: 'o1', end: true },
        ]);
        await runHook('end', office(), env, at(10, 40));
        const sent = calls.filter((c) => !c.url.endsWith('/api/projects/rules'));
        expect(sent).toHaveLength(1);
        expect(sent[0]!.body).toMatchObject({ project: 'erp', titleIfNew: 'erp', details: {}, source: 'hook' });
        // Nothing of what he typed left the PC.
        expect(JSON.stringify(calls)).not.toMatch(/GST|Acme|tests/);
        // A personal folder: stamped too, but no reminder (no nudge flag).
        expect(await runHook('prompt', { session_id: 'p1', cwd: 'E:/PERSONAL_PROJECTS/upfly', prompt: 'next part of the landing page' }, env, at(11, 0))).not.toContain('Recollect [');
        expect(readClock('upfly', '2026-11-16', env)).toHaveLength(1);
    });

    it('offers to log the day once: the next morning for an unlogged day of work, after 17:30 with an hour of work; never for a logged day', async () => {
        const { env } = setup(OFFICE);
        // Sunday: 40 minutes of work, not logged.
        await runHook('prompt', office({ session_id: 'y1', prompt: 'payroll export' }), env, at(15, 0, 15));
        await runHook('stop', office({ session_id: 'y1' }), env, at(15, 40, 15));
        // Monday's first prompt offers once to log Sunday.
        const first = await runHook('prompt', office({ prompt: 'good morning, the next task' }), env, at(9, 30));
        expect(first).toContain('Work here on Sun 15 Nov was not logged');
        expect(first).toContain('log_work with day 2026-11-15');
        expect(await runHook('prompt', office({ prompt: 'and the next one' }), env, at(9, 35))).not.toContain('was not logged');
        // An hour of work before 17:30: no evening line yet; the first prompt after it: once.
        for (const m of [0, 25, 50, 75]) await runHook('prompt', office({ prompt: `work ${m}` }), env, at(16, m));
        expect(await runHook('prompt', office({ prompt: 'one more fix' }), env, at(17, 20))).not.toContain('not logged');
        const evening = await runHook('prompt', office({ prompt: 'the last fix' }), env, at(17, 40));
        expect(evening).toContain("It is past 5:30 pm and today's work here is not logged");
        expect(await runHook('prompt', office({ prompt: 'really the last' }), env, at(17, 55))).not.toContain('not logged');
        // Monday logged: Tuesday's first prompt asks nothing.
        markLogged('erp', '2026-11-16', env);
        expect(await runHook('prompt', office({ prompt: 'tuesday starts' }), env, at(9, 0, 17))).not.toContain('was not logged');
    });

    it("a folder turned from full to light mid-session: its waiting words are held, never sent", async () => {
        const { env, calls } = setup([{ path: 'E:/PERSONAL_PROJECTS/', mode: 'full', brief: false }]);
        const p = { session_id: 'p1', cwd: 'E:/PERSONAL_PROJECTS/second_brain' };
        await runHook('start', p, env, at(10, 0));
        await runHook('prompt', { ...p, prompt: 'I want to study graphs every morning this week' }, env, at(10, 1));
        expect(existsSync(path.join(home, 'open', 'p1.words.jsonl'))).toBe(true);
        writeConfig([{ path: 'E:/PERSONAL_PROJECTS/', mode: 'light', brief: false }]);
        await runHook('prompt', { ...p, prompt: 'the next part please' }, env, at(10, 5));
        expect(existsSync(path.join(home, 'open', 'p1.words.jsonl'))).toBe(false);
        expect(readdirSync(path.join(home, 'held'))).toContain('p1.words.jsonl');
        await runHook('end', p, env, at(10, 10));
        expect(calls.some((c) => c.url.includes('/api/buddy/words'))).toBe(false);
        expect(readFileSync(path.join(home, 'hook.log'), 'utf8')).toContain('held the waiting words of p1');
    });
});
