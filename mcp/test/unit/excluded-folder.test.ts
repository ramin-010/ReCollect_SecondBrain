// MCP_MEMORY_PLAN stage 4 (§4.9, R13): a folder the user excluded is excluded everywhere. The real server process
// (src/index.ts, run by tsx-free node on the built dist-next when present, else skipped) starts in a folder whose
// hooks rule is "off": it lists no tools and says the folder is excluded; a work folder lists its seven tools.
// Also the wording test over every text (§4.10): no "he", "him" or "his" anywhere a model reads.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { EXCLUDED_INSTRUCTIONS, INSTRUCTIONS, OFFICE_INSTRUCTIONS, OFFICE_TOOLS, WEB_INSTRUCTIONS } from '../../src/server.js';
import { CATCH_UP } from '../../src/prompts.js';
import { connect, type Harness } from './harness.js';

const ENTRY = path.resolve(__dirname, '../../dist-next/index.js');
const built = existsSync(ENTRY);

/** The real server in `folder`, with a hooks.json whose rules are `allow`. */
async function serverIn(allow: unknown[]): Promise<{ client: Client; folder: string }> {
    const home = mkdtempSync(path.join(tmpdir(), 'rc-hooks-'));
    const folder = path.join(home, 'work', 'project');
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ url: 'http://127.0.0.1:9', token: `rcl_${'c'.repeat(43)}`, allow: allow.map((a) => (typeof a === 'object' ? { ...a, path: (a as { path: string }).path.replace('<home>', home.replace(/\\/g, '/')) } : a)) }));
    const client = new Client({ name: 'excluded-test', version: '1.0.0' });
    await client.connect(
        new StdioClientTransport({
            command: process.execPath,
            args: [ENTRY],
            cwd: folder,
            env: { ...process.env, RECOLLECT_HOOKS_HOME: home, RECOLLECT_URL: 'http://127.0.0.1:9', RECOLLECT_TOKEN: `rcl_${'c'.repeat(43)}` } as Record<string, string>,
            stderr: 'ignore',
        })
    );
    return { client, folder };
}

let client: Client | undefined;
let h: Harness | undefined;
afterEach(async () => {
    await client?.close();
    client = undefined;
    await h?.close();
    h = undefined;
});

describe.skipIf(!built)('an excluded folder (the real server process on dist-next)', () => {
    it('a folder whose rule is "off" lists no tools, and its instructions say it is excluded', async () => {
        ({ client } = await serverIn([{ path: '<home>/work/', mode: 'off' }]));
        expect((await client.listTools()).tools).toEqual([]);
        expect(client.getInstructions()).toBe(EXCLUDED_INSTRUCTIONS);
    });

    it('a work folder (brief: false) lists its seven tools; any other folder the default set', async () => {
        ({ client } = await serverIn([{ path: '<home>/work/', mode: 'light', brief: false }]));
        expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...OFFICE_TOOLS].sort());
        expect(client.getInstructions()).toBe(OFFICE_INSTRUCTIONS);
        await client.close();
        ({ client } = await serverIn([{ path: '<home>/work/', mode: 'full' }]));
        expect((await client.listTools()).tools.map((t) => t.name)).toContain('update_memory');
        expect(client.getInstructions()).toBe(INSTRUCTIONS);
    }, 30_000);
});

describe('the wording, for anyone (MCP_MEMORY_PLAN §4.10, every text)', () => {
    it('no "he", "him" or "his" in any instruction, prompt or tool text a model reads', async () => {
        h = await connect({}, { set: 'all' });
        const { tools } = await h.client.listTools();
        const texts = [INSTRUCTIONS, WEB_INSTRUCTIONS, OFFICE_INSTRUCTIONS, EXCLUDED_INSTRUCTIONS, CATCH_UP, ...tools.map((t) => JSON.stringify({ name: t.name, title: t.title, description: t.description, input: t.inputSchema }))];
        const bad = texts.filter((t) => /\b(he|him|his|himself)\b/i.test(t)).map((t) => t.slice(0, 80));
        expect(bad).toEqual([]);
    });
});
