// B10 (BUDDY_MEMORY_PLAN §12.5): log_work (the day's turn times from the hooks' clock, then the lines,
// one key per chat, the marker that stops the reminders to log), and a work folder's own small toolset
// and instructions.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connect, ok, type Harness } from './harness.js';
import { INSTRUCTIONS, OFFICE_INSTRUCTIONS, OFFICE_TOOLS } from '../../src/server.js';
import { clockDir, localDay, runHook } from '../../src/hook.js';

let h: Harness | undefined;
let home = '';
const saved = process.env['RECOLLECT_HOOKS_HOME'];
beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'recollect-worklog-'));
    process.env['RECOLLECT_HOOKS_HOME'] = home;
});
afterEach(async () => {
    await h?.close();
    h = undefined;
    if (saved === undefined) delete process.env['RECOLLECT_HOOKS_HOME'];
    else process.env['RECOLLECT_HOOKS_HOME'] = saved;
    rmSync(home, { recursive: true, force: true });
});

/** A day of turns on the clock, written by the hook itself (an office folder, so nothing is sent). */
async function clockDay(day: Date, turns: Array<[number, number, string, number]>) {
    const { writeFileSync } = await import('node:fs');
    const allow = [{ path: 'D:/erp-workspace/', mode: 'light', brief: false, nudge: true, commits: false }];
    writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://recollect.test', token: `rcl_${'a'.repeat(43)}`, allow, brief: true }));
    const env = { RECOLLECT_HOOKS_HOME: home };
    const input = { session_id: 'o1', cwd: 'D:/erp-workspace/erp' };
    for (const [hour, minute, prompt, took] of turns) {
        await runHook('prompt', { ...input, prompt }, env, new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute));
        await runHook('stop', input, env, new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute + took));
    }
}

describe('log_work', () => {
    it("without lines: the day's turns from the hooks' clock and the stretches worked", async () => {
        const today = new Date();
        await clockDay(today, [
            [10, 12, 'fix the GST rounding in invoice_totals', 7],
            [10, 25, 'now the tests for it', 6],
            [14, 5, 'credit note export, start with the schema', 40],
        ]);
        h = await connect({}, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        const res = await h.call('log_work', {});
        expect(res.isError).toBe(false);
        expect(res.text).toContain('10:12 "fix the GST rounding in invoice_totals" → 10:19');
        expect(res.text).toContain('14:05 "credit note export, start with the schema" → 14:45');
        expect(res.text).toContain('Worked 10:12–10:31 (19 min), 14:05–14:45 (40 min).');
        expect(h.requests).toHaveLength(0);
    });

    it('with lines: posted with one key for the chat, office from the folder; the day marked logged; off and paused said plainly', async () => {
        const saved = { status: 'saved', day: localDay(new Date()), project: 'erp', saved: 2, skipped: 1 };
        h = await connect({ 'POST /api/buddy/work': [ok(saved, 201), ok({ ...saved, saved: 1, skipped: 0 }, 201), ok({ status: 'off' }, 201), ok({ status: 'paused' }, 201)] }, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        const lines = [
            { kind: 'did', text: 'Fixed the GST rounding in the invoice report', at: '10:12–10:31' },
            { kind: 'next', text: 'Add the credit note export' },
        ];
        const first = await h.call('log_work', { lines });
        expect(first.text).toMatch(/^Logged 2 lines for erp, \w{3} \d{1,2} \w{3} \(1 left out: already in his log, or removed by him\)\.$/);
        const body = h.requests[0]!.body as { key: string; project: string; day: string; office: boolean; lines: unknown[] };
        expect(body).toMatchObject({ project: 'erp', day: localDay(new Date()), office: true, lines });
        expect(body.key).toMatch(/^lw_[0-9a-f]{16}$/);
        expect(existsSync(path.join(clockDir('erp'), `${localDay(new Date())}.logged`))).toBe(true);
        // The same chat again: the same key (the server replaces that chat's lines).
        await h.call('log_work', { lines: lines.slice(0, 1) });
        expect((h.requests[1]!.body as { key: string }).key).toBe(body.key);
        expect((await h.call('log_work', { lines })).text).toBe('Not logged: his work log is off (About you › How your buddy learns).');
        expect((await h.call('log_work', { lines })).text).toBe('Not logged: his buddy is paused (nothing is kept while it is paused).');
    });

    it('where no hook runs (claude.ai, another folder): no clock, and a project must be named', async () => {
        h = await connect({ 'POST /api/buddy/work': ok({ status: 'saved', day: '2026-11-16', project: 'upfly', saved: 1, skipped: 0 }, 201) });
        expect((await h.call('log_work', {})).text).toMatch(/^No clock here/);
        const unnamed = await h.call('log_work', { lines: [{ kind: 'did', text: 'Shipped the landing page' }] });
        expect(unnamed.isError).toBe(true);
        expect(unnamed.text).toContain('Name the project');
        await h.call('log_work', { project: 'Upfly', lines: [{ kind: 'did', text: 'Shipped the landing page' }] });
        expect(h.requests[0]!.body).toMatchObject({ project: 'upfly', office: false });
    });
});

describe('a work folder (B10)', () => {
    it('a save there tells the agent to keep it out of its reply (a real run announced one in nineteen turns)', async () => {
        const memory = { _id: 'm1', text: 'Works best in the mornings', kind: 'preference', sensitivity: 'open', status: 'active', pinned: false, byUser: false, seenCount: 1, lastSeenDay: '2026-11-16' };
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory }] }, 201) }, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        expect((await h.call('remember', { text: 'Works best in the mornings', kind: 'preference' })).text).toMatch(/\nSaved quietly: say nothing about it in your reply unless he asked for it\.$/);
        await h.close();
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory }] }, 201) });
        expect((await h.call('remember', { text: 'Works best in the mornings', kind: 'preference' })).text).not.toContain('Saved quietly');
    });

    it('lists only the saving tools and its work log, with instructions of its own; other chats keep theirs and get set_reminder and log_work', async () => {
        h = await connect({}, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        const office = (await h.client.listTools()).tools.map((t) => t.name).sort();
        expect(office).toEqual([...OFFICE_TOOLS].sort());
        expect(h.client.getInstructions()).toBe(OFFICE_INSTRUCTIONS);
        expect(OFFICE_INSTRUCTIONS).toContain('Never save company code, data, clients or colleagues’ names.');
        expect((await h.call('more_tools', {})).isError).toBe(true);
        await h.close();

        h = await connect({});
        const names = (await h.client.listTools()).tools.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(['set_reminder', 'log_work', 'remember', 'add_pocket_note']));
        expect(h.client.getInstructions()).toBe(INSTRUCTIONS);
        expect(INSTRUCTIONS).toContain('Save quietly');
    });
});
