// Drift guards for the tool catalogue (SYNC_SPINE_SPEC 0.4):
//   - the README names every tool and says how many there are;
//   - the tool definitions every chat loads stay under a budget. When a new tool would break it,
//     shorten descriptions; raise the number only with Ramin's say-so.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_GROUPS, TOOL_GROUPS, TOOL_NAMES } from '../../src/server.js';
import { connect, type Harness } from './harness.js';

/** Characters of JSON for the default tool definitions, as tools/list returns them (the manage group is listed on request). */
export const TOOL_JSON_BUDGET = 40_000;

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

let h: Harness | undefined;
afterEach(async () => {
    await h?.close();
    h = undefined;
});

describe('the catalogue', () => {
    it('the README names every tool in backticks', () => {
        const missing = TOOL_NAMES.filter((name) => !readme.includes(`\`${name}\``));
        expect(missing, 'add these tools to mcp/README.md').toEqual([]);
    });

    it("the README's tool count is the real one", () => {
        const stated = /^(\d+) tools\b/m.exec(readme)?.[1];
        expect(stated, 'mcp/README.md must have a line starting "<n> tools"').toBeDefined();
        expect(Number(stated)).toBe(TOOL_NAMES.length);
    });

    it('lists the default groups of TOOL_NAMES, and their definitions stay under the budget', async () => {
        h = await connect({});
        const { tools } = await h.client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES.filter((n) => DEFAULT_GROUPS.includes(TOOL_GROUPS[n])).sort());
        const size = JSON.stringify(tools).length;
        expect(size, `tool definitions are ${size} characters; the budget is ${TOOL_JSON_BUDGET}`).toBeLessThanOrEqual(TOOL_JSON_BUDGET);
    });
});
