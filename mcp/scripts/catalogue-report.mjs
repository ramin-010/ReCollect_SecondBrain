// The tool catalogue of each door, with sizes, levels, groups and every tool's full text (TOOL_ACCESS_PLAN stage 0).
// No network: a fake API address. Reads the built dist/ (run `npm run build` first).
//
//   node scripts/catalogue-report.mjs [out.txt]      (default: print the summary; the full report goes to the file)
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
const imp = (f) => import(new URL(f, dist).href);
const { createKaagaServer, TOOL_GROUPS, TOOL_LEVELS, WEB_TOOLS, INSTRUCTIONS, WEB_INSTRUCTIONS } = await imp('server.js');
const { KaagaApi } = await imp('api.js');
const sdk = (f) => import(pathToFileURL(fileURLToPath(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${f}`, import.meta.url))).href);
const { Client } = await sdk('client/index.js');
const { InMemoryTransport } = await sdk('inMemory.js');

async function list(set) {
    const api = new KaagaApi({ baseUrl: 'http://localhost:1', token: `rcl_${'x'.repeat(43)}`, agentName: 'report', log: () => {} });
    const server = createKaagaServer({ api, agentName: 'report', problem: null, set });
    const client = new Client({ name: 'report', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const { tools } = await client.listTools();
    const instructions = client.getInstructions() ?? '';
    await client.close();
    await server.close();
    return { tools, instructions };
}

const out = [];
for (const set of ['web', 'code', 'office', 'all']) {
    const { tools, instructions } = await list(set);
    out.push(`## door ${set}: ${tools.length} tools listed, ${JSON.stringify(tools).length} characters; instructions ${instructions.length} characters`);
    if (set !== 'all') out.push(tools.map((t) => t.name).join(', '));
}
const { tools: all } = await list('all');
out.push('', '## every tool (door all): name | group | level | on web? | description chars | schema chars');
for (const t of all) out.push(`${t.name} | ${TOOL_GROUPS[t.name]} | ${TOOL_LEVELS[t.name]} | ${WEB_TOOLS.includes(t.name) ? 'web' : '-'} | ${(t.description ?? '').length} | ${JSON.stringify(t.inputSchema).length}`);
out.push('', `instructions: code ${INSTRUCTIONS.length}, web ${WEB_INSTRUCTIONS.length}`);
out.push('', '## full text');
for (const t of all) out.push(`### ${t.name} (${t.title})`, t.description ?? '', `INPUT: ${JSON.stringify(t.inputSchema.properties ?? {})}`, `REQUIRED: ${JSON.stringify(t.inputSchema.required ?? [])}`, '');
const { tools: web } = await list('web');
out.push('## web wording where it differs');
for (const t of web) {
    const a = all.find((x) => x.name === t.name);
    if (a && a.description !== t.description) out.push(`### ${t.name}`, t.description ?? '', `INPUT: ${JSON.stringify(t.inputSchema.properties ?? {})}`, '');
}
// Timing: a fresh server + tools/list, as each web request does.
const t0 = performance.now();
for (let i = 0; i < 30; i++) await list('web');
out.push('', `timing: fresh server + connect + tools/list (web) = ${((performance.now() - t0) / 30).toFixed(1)} ms each (30 runs)`);

const file = process.argv[2];
if (file) writeFileSync(file, out.join('\n'));
console.log(out.filter((l) => l.startsWith('## door') || l.startsWith('instructions') || l.startsWith('timing')).join('\n'));
