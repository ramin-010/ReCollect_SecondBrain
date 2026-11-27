// TOOL_ACCESS_PLAN §7.1: does find_tools answer the right tool for a job said in plain words? The queries were written
// from the job, before any card existed (test/fixtures/find-queries.json; every third one held back from tuning). Gates
// on the held set and on the whole set: the right tool in the top 3 for at least 95%, first for at least 80%; a
// playbook query answers its playbook. Misses are fixed in the cards (keywords, use), never in the search code.
// FIND_MISSES=1 prints every miss.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../src/server.js';
import { buildIndex, closestNames, search, stem, words } from '../../src/find.js';
import { PLAYBOOKS } from '../../src/playbooks.js';
import { connect, type Harness } from './harness.js';

interface Query {
    q: string;
    tools: string[];
    held: boolean;
}
interface PlaybookQuery {
    q: string;
    playbook: string;
    held: boolean;
}
const fixture = JSON.parse(readFileSync(new URL('../fixtures/find-queries.json', import.meta.url), 'utf8')) as { queries: Query[]; playbooks: PlaybookQuery[] };
const known = new Set<string>(TOOL_NAMES);

let web: Harness;
let code: Harness;
beforeAll(async () => {
    web = await connect({}, { set: 'web' });
    code = await connect({});
});
afterAll(async () => {
    await web.close();
    await code.close();
});

/** The tools find_tools answered, in order, and the playbook it led with. */
async function answer(h: Harness, q: string, limit = 3): Promise<{ tools: string[]; playbook: string | null }> {
    const text = (await h.call('find_tools', { query: q, limit })).text;
    const tools = [...text.matchAll(/^([a-z]+(?:_[a-z]+)*) · /gm)].map((m) => m[1]!);
    const title = /^How to do it: (.+)$/m.exec(text)?.[1] ?? null;
    return { tools, playbook: PLAYBOOKS.find((p) => p.title === title)?.id ?? null };
}

interface Score {
    n: number;
    first: number;
    top3: number;
    misses: string[];
}
async function score(h: Harness, queries: Query[]): Promise<Score> {
    const s: Score = { n: 0, first: 0, top3: 0, misses: [] };
    for (const q of queries) {
        const { tools } = await answer(h, q.q);
        s.n += 1;
        if (q.tools.includes(tools[0] ?? '')) s.first += 1;
        if (tools.some((t) => q.tools.includes(t))) s.top3 += 1;
        else s.misses.push(`${q.held ? '[held] ' : ''}"${q.q}" → ${tools.join(', ') || '(nothing)'} (want ${q.tools.join(' or ')})`);
    }
    return s;
}
const pct = (a: number, n: number) => (n ? (100 * a) / n : 100);

describe('find_tools on the fixture (TOOL_ACCESS_PLAN §7.1)', () => {
    // Only tools that exist yet, and that the web reaches (set_folder is the code door's).
    const usable = fixture.queries.filter((q) => q.tools.every((t) => known.has(t)) && !q.tools.every((t) => t === 'set_folder'));

    it('has enough queries: 2 or more for every tool, every third one held', () => {
        expect(fixture.queries.length).toBeGreaterThanOrEqual(160);
        const per = new Map<string, number>();
        for (const q of fixture.queries) for (const t of q.tools) per.set(t, (per.get(t) ?? 0) + 1);
        const runners = new Set(['find_tools', 'use_read_tool', 'use_tool']);
        for (const t of TOOL_NAMES) if (!runners.has(t)) expect(per.get(t) ?? 0, t).toBeGreaterThanOrEqual(2);
    });

    it('the web door: the right tool in the top 3 for 95%, first for 80%, on the held set and on the whole set', async () => {
        const all = await score(web, usable);
        const held = await score(web, usable.filter((q) => q.held));
        const tuned = await score(web, usable.filter((q) => !q.held));
        if (process.env['FIND_MISSES']) console.log(`tuned on: first ${pct(tuned.first, tuned.n).toFixed(1)}% top3 ${pct(tuned.top3, tuned.n).toFixed(1)}% of ${tuned.n}`);
        if (process.env['FIND_MISSES']) console.log([`whole: first ${pct(all.first, all.n).toFixed(1)}% top3 ${pct(all.top3, all.n).toFixed(1)}% of ${all.n}`, `held: first ${pct(held.first, held.n).toFixed(1)}% top3 ${pct(held.top3, held.n).toFixed(1)}% of ${held.n}`, ...all.misses].join('\n'));
        for (const [name, s] of [['whole', all], ['held', held]] as const) {
            expect(pct(s.top3, s.n), `${name} top 3: ${s.misses.slice(0, 12).join(' | ')}`).toBeGreaterThanOrEqual(95);
            expect(pct(s.first, s.n), `${name} first`).toBeGreaterThanOrEqual(80);
        }
    });

    it('a job with steps answers its playbook first', async () => {
        const misses: string[] = [];
        for (const p of fixture.playbooks) {
            const { playbook } = await answer(web, p.q);
            if (playbook !== p.playbook) misses.push(`"${p.q}" → ${playbook ?? '(none)'} (want ${p.playbook})`);
        }
        if (process.env['FIND_MISSES']) console.log(misses.join('\n'));
        expect(misses.length / fixture.playbooks.length, misses.join(' | ')).toBeLessThanOrEqual(0.1);
    });

    it('the code door finds the same way (its listed tools too)', async () => {
        const s = await score(code, usable.filter((q) => !q.tools.includes('use_read_tool')));
        expect(pct(s.top3, s.n), s.misses.slice(0, 8).join(' | ')).toBeGreaterThanOrEqual(95);
    });
});

describe('find_tools answers', () => {
    it("a card: what it does, when, what it isn't for, its inputs with one example, what comes back; how to run it here", async () => {
        const text = (await web.call('find_tools', { query: 'move a review to friday', limit: 1 })).text;
        expect(text.split('\n')).toEqual([
            'move_revision · Move a review · changes (Undo) · run with use_tool',
            'Use when: "push my caching review to Friday", "I can’t revise this today".',
            'Not for: marking it done (complete_revision); a pile of overdue ones (spread_backlog); being busy for some days ("busy until Wednesday", "pause my reviews"): update_settings busyUntil holds their reviews by itself, so move nothing.',
            'Args: { revisionId: string, day: "YYYY-MM-DD" }   revisionId: from list_due; day: "YYYY-MM-DD", today or later',
            'Example: use_tool {"name":"move_revision","args":{"revisionId":"rev_cache","day":"2026-12-04"}}',
            'Answers: the review’s new day.',
        ]);
    });

    it('a read on the web runs with use_read_tool; a listed tool says to call it directly', async () => {
        expect((await web.call('find_tools', { query: 'my settings, daily budget', limit: 1 })).text).toMatch(/^get_settings · Settings · reads · run with use_read_tool$/m);
        expect((await web.call('find_tools', { query: 'what is due to revise today', limit: 2 })).text).toMatch(/^list_due · Due revisions · reads · listed: call it directly$/m);
    });

    it('no query: the catalogue by area, every reachable tool once, under 6,000 characters', async () => {
        const text = (await web.call('find_tools', {})).text;
        expect(text.length).toBeLessThanOrEqual(6000);
        expect(text).toMatch(/^Memory:$/m);
        expect(text).toMatch(/^ {2}trash_doc · Move a doc to the trash · changes \(Undo\)$/m);
        expect(text).not.toMatch(/set_folder/);
    });

    it('nothing matches: says so, then the areas with their tool names', async () => {
        const text = (await web.call('find_tools', { query: 'zzqx vrrb' })).text;
        expect(text.split('\n')[0]).toBe('Nothing matches "zzqx vrrb". The tools by area:');
        expect(text).toMatch(/^Docs: search_docs, read_doc, /m);
    });
});

describe('the search, pure', () => {
    it('words: lower case, no stop words, a light stem; names split on _', () => {
        expect(words('Moving my Reviews to Friday')).toEqual(['mov', 'review', 'friday']);
        expect(stem('reviews')).toBe(stem('review'));
        expect(stem('scheduled')).toBe(stem('schedule'));
    });

    it("a query that is a tool's name puts it first; ties go to reads, then the name", () => {
        const e = (name: string, level: 1 | 2) => ({ name, title: 'Widget', description: 'a widget', use: '', keywords: [], params: [], level });
        const index = buildIndex([e('b_widget', 2), e('a_widget', 2), e('c_widget', 1)]);
        expect(search(index, 'widget', 3).map((h) => h.entry.name)).toEqual(['c_widget', 'a_widget', 'b_widget']);
        expect(search(index, 'b_widget', 1)[0]!.entry.name).toBe('b_widget');
    });

    it('closest names for a wrong one', () => {
        expect(closestNames(['trash_doc', 'empty_trash', 'read_doc', 'restore_doc'], 'trash')).toEqual(['empty_trash', 'trash_doc']);
    });
});
