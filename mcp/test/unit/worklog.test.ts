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
const saved = process.env['KAAGA_HOOKS_HOME'];
beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'kaaga-worklog-'));
    process.env['KAAGA_HOOKS_HOME'] = home;
});
afterEach(async () => {
    await h?.close();
    h = undefined;
    if (saved === undefined) delete process.env['KAAGA_HOOKS_HOME'];
    else process.env['KAAGA_HOOKS_HOME'] = saved;
    rmSync(home, { recursive: true, force: true });
});

/** A day of turns on the clock, written by the hook itself (an office folder, so nothing is sent). */
async function clockDay(day: Date, turns: Array<[number, number, string, number]>) {
    const { writeFileSync } = await import('node:fs');
    const allow = [{ path: 'D:/erp-workspace/', mode: 'light', brief: false, nudge: true, commits: false }];
    writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://kaaga.test', token: `rcl_${'a'.repeat(43)}`, allow, brief: true }));
    const env = { KAAGA_HOOKS_HOME: home };
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
        h = await connect({ 'GET /api/buddy/work/picture': ok({ open: [], today: [] }) }, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        const res = await h.call('log_work', {});
        expect(res.isError).toBe(false);
        expect(res.text).toContain('10:12 "fix the GST rounding in invoice_totals" → 10:19');
        expect(res.text).toContain('14:05 "credit note export, start with the schema" → 14:45');
        expect(res.text).toContain('Worked 10:12–10:31 (19 min), 14:05–14:45 (40 min).');
        // Stage 12: and what other chats already logged for this folder's project (read only).
        expect(h.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/buddy/work/picture']);
    });

    it('with lines: posted with one key for the chat, office from the folder; the day marked logged; off and paused said plainly', async () => {
        const saved = { status: 'saved', day: localDay(new Date()), project: 'erp', saved: 2, skipped: 1 };
        h = await connect({ 'POST /api/buddy/work': [ok(saved, 201), ok({ ...saved, saved: 1, skipped: 0 }, 201), ok({ status: 'off' }, 201), ok({ status: 'paused' }, 201)] }, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        const lines = [
            { kind: 'did', text: 'Fixed the GST rounding in the invoice report', at: '10:12–10:31' },
            { kind: 'next', text: 'Add the credit note export' },
        ];
        const first = await h.call('log_work', { lines });
        expect(first.text).toMatch(/^Logged 2 lines for erp, \w{3} \d{1,2} \w{3} \(1 left out: already in their log, or removed by them\)\.$/);
        const body = h.requests[0]!.body as { key: string; project: string; day: string; office: boolean; lines: unknown[] };
        expect(body).toMatchObject({ project: 'erp', day: localDay(new Date()), office: true, lines });
        expect(body.key).toMatch(/^lw_[0-9a-f]{16}$/);
        expect(existsSync(path.join(clockDir('erp'), `${localDay(new Date())}.logged`))).toBe(true);
        // The same chat again: the same key (the server replaces that chat's lines).
        await h.call('log_work', { lines: lines.slice(0, 1) });
        expect((h.requests[1]!.body as { key: string }).key).toBe(body.key);
        expect((await h.call('log_work', { lines })).text).toBe('Not logged: their work log is off (About you › How your buddy learns).');
        expect((await h.call('log_work', { lines })).text).toBe('Not logged: their buddy is paused (nothing is kept while it is paused).');
    });

    it('where no hook runs (another folder): no clock, and a project must be named', async () => {
        h = await connect({ 'POST /api/buddy/work': ok({ status: 'saved', day: '2026-11-16', project: 'upfly', saved: 1, skipped: 0 }, 201), 'GET /api/buddy/work/picture': ok(null) });
        expect((await h.call('log_work', {})).text).toMatch(/^No clock here/);
        const unnamed = await h.call('log_work', { lines: [{ kind: 'did', text: 'Shipped the landing page' }] });
        expect(unnamed.isError).toBe(true);
        expect(unnamed.text).toContain('Name the project');
        await h.call('log_work', { project: 'Upfly', lines: [{ kind: 'did', text: 'Shipped the landing page' }] });
        expect(h.requests.find((r) => r.method === 'POST')!.body).toMatchObject({ project: 'upfly', office: false });
    });

    it('stage 12: the first answer shows what other chats logged, with ids; a line may be news on one (on)', async () => {
        const picture = {
            open: [{ _id: 'w9', kind: 'stuck', text: 'Payroll export fails for March', project: 'erp', day: '2026-11-20', app: 'ChatGPT' }],
            today: [{ _id: 'w8', kind: 'decided', text: 'Decided to keep the old export until sign-off', project: 'erp', day: '2026-11-20', app: 'Claude' }],
        };
        h = await connect({ 'GET /api/buddy/work/picture': ok(picture), 'POST /api/buddy/work': ok({ status: 'saved', day: localDay(new Date()), project: 'erp', saved: 1, skipped: 0 }, 201) }, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        const first = await h.call('log_work', {});
        expect(first.text).toContain("Already in their log from other chats (don't repeat these; a line that is news on one carries its id in on):");
        expect(first.text).toContain('Open in their log (news on one: log_work with its id in on): "Payroll export fails for March" (open, erp, via ChatGPT) · id w9');
        expect(first.text).toContain('Also logged that day: "Decided to keep the old export until sign-off" (decided, erp, via Claude) · id w8');
        expect(h.requests[0]!.query).toEqual({ day: localDay(new Date()), project: 'erp', work: '1' });
        await h.call('log_work', { lines: [{ kind: 'did', text: 'Fixed the March payroll export (date parsing)', on: 'w9' }] });
        expect((h.requests[1]!.body as { lines: unknown[] }).lines).toEqual([{ kind: 'did', text: 'Fixed the March payroll export (date parsing)', on: 'w9' }]);
    });
});

describe('the web door’s log_work (stage 12)', () => {
    const line = { _id: 'w1', kind: 'did', text: 'Fixed the upload timeouts by raising the proxy timeout', project: 'api', day: '2026-11-20', app: 'ChatGPT' };
    const close = { _id: 'w0', kind: 'did', text: 'Raised the nginx proxy timeout to 120 s', project: 'api', day: '2026-11-20', app: 'Claude Code', close: true };

    it('one outcome a call: open is sent as stuck; the answer shows the close line first, quietly', async () => {
        h = await connect({ 'POST /api/buddy/work/line': ok({ status: 'saved', line, follows: null, picture: { open: [], today: [close] } }, 201) }, { set: 'web' });
        const res = await h.call('log_work', { text: line.text, project: 'API' });
        expect(h.requests[0]!.body).toEqual({ text: line.text, kind: 'did', project: 'API' });
        expect(res.text).toBe(
            [
                'Logged: "Fixed the upload timeouts by raising the proxy timeout" (api) · id w1.',
                'Close in words (if one is the same thing, it was already logged: fold yours into it with update_work_line same_as; a different thing stays): "Raised the nginx proxy timeout to 120 s" (done, api, via Claude Code) · id w0',
                'Logged quietly: say nothing about it in your reply unless they asked for it.',
            ].join('\n')
        );
        await h.close();
        h = await connect({ 'POST /api/buddy/work/line': ok({ status: 'saved', line: { ...line, kind: 'stuck' }, follows: null, picture: { open: [], today: [] } }, 201) }, { set: 'web' });
        await h.call('log_work', { text: 'Uploads still fail over 2 GB', kind: 'open' });
        expect((h.requests[0]!.body as { kind: string }).kind).toBe('stuck');
    });

    it('stage 13: two or three results of one message in one call (more): each line said, the nudges and the picture once', async () => {
        const second = { ...line, _id: 'w2', text: 'Fixed the retry storm on the payments webhook' };
        const open = { _id: 'w7', kind: 'stuck', text: 'Webhook retries pile up', project: 'api', day: '2026-11-19', app: 'Claude' };
        h = await connect(
            {
                'POST /api/buddy/work/line': ok(
                    {
                        status: 'saved',
                        line,
                        follows: null,
                        picture: { open: [open], today: [] },
                        lines: [
                            { status: 'saved', line, follows: null },
                            { status: 'saved', line: second, follows: null },
                            { status: 'already', line: close },
                        ],
                    },
                    201
                ),
            },
            { set: 'web' }
        );
        const res = await h.call('log_work', { text: line.text, more: [{ text: second.text }, { text: 'Raised the proxy timeout', kind: 'did', on: 'w0' }] });
        expect(h.requests[0]!.body).toEqual({ text: line.text, kind: 'did', more: [{ text: second.text, kind: 'did' }, { text: 'Raised the proxy timeout', kind: 'did', on: 'w0' }] });
        expect(res.text.split('\n').slice(0, 4)).toEqual([
            'Logged: "Fixed the upload timeouts by raising the proxy timeout" (api) · id w1.',
            'Logged: "Fixed the retry storm on the payments webhook" (api) · id w2.',
            'Already in their log: "Raised the nginx proxy timeout to 120 s" (via Claude Code) · id w0. Not logged again.',
            "If one of these fixes one of the open lines below, link it now: update_work_line with id w1 or w2 and on <that line's id>.",
        ]);
        expect(res.text).toContain('"Webhook retries pile up"');
        expect(res.text).toMatch(/\nLogged quietly: say nothing about it in your reply unless they asked for it\.$/);
        // An open kind in more is sent as stuck; at most two more.
        expect((await h.call('log_work', { text: 'a', more: [{ text: 'b' }, { text: 'c' }, { text: 'd' }] })).isError).toBe(true);
    });

    it('already there, removed, the cap, off, paused and an older server, each said plainly', async () => {
        h = await connect(
            {
                'POST /api/buddy/work/line': [
                    ok({ status: 'already', line, picture: { open: [], today: [] } }),
                    ok({ status: 'already', line: null, picture: { open: [], today: [] } }),
                    ok({ status: 'removed' }),
                    ok({ status: 'full', picture: { open: [], today: [] } }),
                    ok({ status: 'off' }),
                    ok({ status: 'paused' }),
                ],
            },
            { set: 'web' }
        );
        const say = async () => (await h!.call('log_work', { text: 'Fixed the upload timeouts' })).text;
        expect(await say()).toBe('Already in their log: "Fixed the upload timeouts by raising the proxy timeout" (via ChatGPT) · id w1. Not logged again.');
        expect(await say()).toBe('Already in their log: a line from a work folder. Not logged again.');
        expect(await say()).toBe('Not logged: they removed a line that says the same from their log.');
        expect(await say()).toMatch(/^Not logged: 30 new work lines from chats in a day is the most/);
        expect(await say()).toBe('Not logged: their work log is off (About you › How your buddy learns). Log no work in this chat.');
        expect(await say()).toBe('Not logged: their buddy is paused (nothing is kept while it is paused).');
    });

    it('update_work_line: one change at a time, the answer says what happened', async () => {
        h = await connect({ 'PATCH /api/buddy/work/line/w1': [ok({ status: 'joined', line, into: close, picture: { open: [], today: [] } }), ok({ status: 'removed' })] }, { set: 'web' });
        expect((await h.call('update_work_line', { id: 'w1', same_as: 'w0', remove: true })).isError).toBe(true);
        expect((await h.call('update_work_line', { id: 'w1', same_as: 'w0' })).text).toBe('Folded into "Raised the nginx proxy timeout to 120 s" · id w0: listed once.');
        expect(h.requests[0]!.body).toEqual({ sameAs: 'w0' });
        expect((await h.call('update_work_line', { id: 'w1', remove: true })).text).toBe('Removed from their work log (it won’t be written again).');
    });

    it('the brief prints the Work part with ids, only while the server sends it', async () => {
        const { buddyViewText } = await import('../../src/tools/record.js');
        const view = { now: { day: '2026-11-20', weekday: 'Fri', time: '11:30', timezone: 'Asia/Kolkata' }, who: null, inMotion: [], savedLately: [], asks: [], howTo: ['Work: log what they confirm done.'] };
        const on = buddyViewText({ ...view, work: { open: [{ ...line, _id: 'w5', kind: 'stuck', text: 'Webhook retries pile up' }], today: [line], projects: ['api', 'erp'] } });
        expect(on).toContain('Work (their log, from every chat and app):\n- open: "Webhook retries pile up" (open, api, via ChatGPT) · id w5\n- today: "Fixed the upload timeouts by raising the proxy timeout" (done, api, via ChatGPT) · id w1\nTheir projects: api, erp');
        expect(buddyViewText({ ...view, work: { open: [], today: [], projects: [] } })).toContain('- nothing open, nothing logged today');
        expect(buddyViewText({ ...view, work: null })).not.toContain('Work (');
    });
});

describe('a work folder (B10)', () => {
    it('a save there tells the agent to keep it out of its reply (a real run announced one in nineteen turns)', async () => {
        const memory = { _id: 'm1', text: 'Works best in the mornings', kind: 'preference', sensitivity: 'open', status: 'active', pinned: false, byUser: false, seenCount: 1, lastSeenDay: '2026-11-16' };
        h = await connect({ 'POST /api/buddy/remember': ok({ paused: false, notes: [{ status: 'saved', memory }] }, 201) }, { workMode: true, workProject: 'erp', clockProject: 'erp' });
        expect((await h.call('remember', { text: 'Works best in the mornings', kind: 'preference' })).text).toMatch(/\nSaved quietly: say nothing about it in your reply unless they asked for it\.$/);
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
        expect(INSTRUCTIONS).toContain('Pass on quietly');
    });
});
