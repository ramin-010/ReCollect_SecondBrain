// Every unit test process starts in a scratch home: no test may read or write the real ~/.kaaga or ~/.recollect
// (11-26: a test that ran a stale build once rewrote the real rules.json). KAAGA_HOOKS_HOME and the home folder
// (USERPROFILE, HOME) point at a fresh temp folder, the older RECOLLECT_* knobs are dropped, and the temp folder moves
// inside that home, so a test's folders sit below the home as they do on a real PC (the project walk stops there).
// A test that wants a home of its own still sets one (an explicit env, vi.stubEnv), as before.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(tmpdir(), 'kaaga-unit-home-'));
const temp = path.join(scratch, 'temp');
mkdirSync(temp);
for (const name of Object.keys(process.env)) if (/^RECOLLECT_/.test(name)) delete process.env[name];
process.env['KAAGA_HOOKS_HOME'] = scratch;
process.env['USERPROFILE'] = scratch;
process.env['HOME'] = scratch;
process.env['TEMP'] = temp;
process.env['TMP'] = temp;
process.env['TMPDIR'] = temp;
