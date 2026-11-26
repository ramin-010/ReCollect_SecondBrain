// Installs Kaaga's skills for Claude Code at the user level (every project, like the kaaga
// MCP server itself): each skills/<name>/SKILL.md goes to ~/.claude/skills/<name>/.
//   kaaga-notes   write notes with real diagrams
//   kaaga-study   study with the user: get_brief first, checkpoint as you go (SYNC_SPINE_SPEC 1.3)
//   log-work      log the day's work from a chat, with its times (BUDDY_MEMORY_PLAN §12, B10)
//   study, build, work   say what this chat is, from now (EASY_SETUP_PLAN §7)
//   npm run install:skill
import { copyFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['kaaga-notes', 'kaaga-study', 'log-work', 'study', 'build', 'work']) {
    const source = path.resolve(here, `../skills/${name}/SKILL.md`);
    const targetDir = path.join(os.homedir(), '.claude', 'skills', name);
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source, path.join(targetDir, 'SKILL.md'));
    console.log(`Installed the ${name} skill to ${targetDir}`);
}
