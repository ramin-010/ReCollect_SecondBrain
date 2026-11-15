// Installs Recollect's skills for Claude Code at the user level (every project, like the recollect
// MCP server itself): each skills/<name>/SKILL.md goes to ~/.claude/skills/<name>/.
//   recollect-notes   write notes with real diagrams
//   recollect-study   study with Ramin: get_brief first, checkpoint as you go (SYNC_SPINE_SPEC 1.3)
//   npm run install:skill
import { copyFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['recollect-notes', 'recollect-study']) {
    const source = path.resolve(here, `../skills/${name}/SKILL.md`);
    const targetDir = path.join(os.homedir(), '.claude', 'skills', name);
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source, path.join(targetDir, 'SKILL.md'));
    console.log(`Installed the ${name} skill to ${targetDir}`);
}
