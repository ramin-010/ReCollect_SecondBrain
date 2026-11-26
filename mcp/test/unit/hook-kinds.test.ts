// PERSONAL_OFFICE_PLAN (11-23): a folder rule may say what the folder is (personal, study, work), which gives its
// defaults; an old rule keeps its meaning (`brief: false` = work); the session tells the server the kind as a first
// guess, and an older server that refuses the field still gets the session.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { folderRule, runHook, type AllowEntry } from '../../src/hook.js';

describe('folder kinds', () => {
    it('a named kind gives its defaults; the knobs still override; an old rule keeps its meaning', () => {
        const allow: AllowEntry[] = [
            { path: 'E:/PERSONAL_PROJECTS/', kind: 'personal' },
            { path: 'E:/PERSONAL_PROJECTS/dsa', kind: 'study' },
            { path: 'D:/erp-workspace/', kind: 'work' },
            { path: 'D:/client-x/', kind: 'work', mode: 'off' },
            { path: 'C:/old-office/', mode: 'light', brief: false, nudge: true, commits: false },
            'C:/old-personal/',
        ];
        expect(folderRule('E:/PERSONAL_PROJECTS/second_brain', allow)).toMatchObject({ kind: 'personal', mode: 'full', brief: true, nudge: false, commits: true });
        expect(folderRule('E:/PERSONAL_PROJECTS/dsa/arrays', allow)).toMatchObject({ kind: 'study', mode: 'full', brief: true, commits: true });
        expect(folderRule('D:/erp-workspace/api', allow)).toMatchObject({ kind: 'work', mode: 'light', brief: false, nudge: true, commits: false });
        expect(folderRule('D:/client-x', allow)).toMatchObject({ kind: 'work', mode: 'off' });
        expect(folderRule('C:/old-office/repo', allow)).toMatchObject({ kind: 'work', mode: 'light', brief: false, nudge: true, commits: false });
        expect(folderRule('C:/old-personal/x', allow)).toMatchObject({ kind: 'personal', mode: 'light', brief: true, commits: true });
        expect(folderRule('F:/elsewhere', allow)).toBeNull();
    });
});

describe('the session tells the server its folder’s kind', () => {
    let home = '';
    afterEach(() => {
        vi.unstubAllGlobals();
        if (home) rmSync(home, { recursive: true, force: true });
    });

    function setup(allow: AllowEntry[], refuseKind = false) {
        home = mkdtempSync(path.join(os.tmpdir(), 'kaaga-kinds-'));
        writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://kaaga.test', token: `rcl_${'a'.repeat(43)}`, allow, brief: true }));
        const puts: unknown[] = [];
        vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            if (init?.method === 'PUT') {
                puts.push(body);
                if (refuseKind && body && typeof body === 'object' && 'projectKind' in body) {
                    return new Response(JSON.stringify({ success: false, message: 'Unrecognized key: "projectKind"' }), { status: 400, headers: { 'content-type': 'application/json' } });
                }
            }
            const data = String(url).includes('/api/brief') ? { now: { day: '2026-11-23', weekday: 'Mon', time: '10:00', timezone: 'Asia/Kolkata' }, profile: null, goals: [], today: { revisions: { planned: 0, estMinutes: 0, done: 0, waiting: 0 }, focus: [] }, next: [], recent: [], recall: { days: 7, finished: 0, weakTopics: [] }, project: null, session: { key: 'cc_k1' } } : { session: {} };
            return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        return { env: { KAAGA_HOOKS_HOME: home }, puts };
    }

    const run = async (env: Record<string, string>, cwd: string) => {
        const t = (m: number) => new Date(Date.UTC(2026, 10, 23, 5, m));
        const input = (over: Record<string, unknown> = {}) => ({ session_id: 'k1', cwd, source: 'startup', ...over });
        await runHook('start', input(), env, t(0));
        await runHook('prompt', input(), env, t(1));
        await runHook('prompt', input(), env, t(4));
        await runHook('end', input({ reason: 'prompt_input_exit' }), env, t(8));
    };

    it('a work folder: its kind, its folder as the title, no commit subjects', async () => {
        const { env, puts } = setup([{ path: 'D:/erp-workspace/', kind: 'work' }]);
        await run(env, 'D:/erp-workspace');
        expect(puts).toHaveLength(1);
        expect(puts[0]).toMatchObject({ projectKind: 'work', project: 'erp-workspace', titleIfNew: 'erp-workspace', details: {} });
    });

    it('a study folder says study; an older server that refuses the field gets the session without it', async () => {
        const { env, puts } = setup([{ path: 'E:/PERSONAL_PROJECTS/', kind: 'study' }], true);
        await run(env, 'E:/PERSONAL_PROJECTS/dsa');
        expect(puts).toHaveLength(2);
        expect(puts[0]).toMatchObject({ projectKind: 'study', project: 'dsa' });
        expect(puts[1]).not.toHaveProperty('projectKind');
        expect(puts[1]).toMatchObject({ project: 'dsa', kindIfNew: 'build' });
    });
});
