// MCP prompts (AGENT_DIAGRAMS_PLAN step 5). `note_recipe` is how a good Recollect note is built,
// with real diagrams. Its text IS the Claude Code skill (skills/recollect-notes/SKILL.md), read
// from disk, so the prompt and the skill never drift apart. In Claude Code it shows as
// /mcp__recollect__note_recipe; other MCP clients list it as a prompt.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** src/ in tests, dist/ when built: the skill sits beside both, in ../skills. */
export const SKILL_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/recollect-notes/SKILL.md');

/** The recipe: the skill without its front matter (name and description are for Claude Code). */
export function noteRecipe(skillPath = SKILL_PATH): string {
    const text = readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
    return text.replace(/^---\n[\s\S]*?\n---\n+/, '').trim();
}

export function registerPrompts(server: McpServer): void {
    server.registerPrompt(
        'note_recipe',
        {
            title: 'Write a learning note',
            description:
                'How to write a complete Recollect note with real diagrams, in one create_doc call: the point, requirements and an estimate, a canvas of the design, the data (erDiagram), one flow (sequenceDiagram), trade-offs, and self-test toggles. With two worked examples.',
            argsSchema: {
                topic: z.string().max(200).optional().describe('What the note is about, e.g. "consistent hashing" or "a URL shortener".'),
            },
        },
        ({ topic }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `${noteRecipe()}\n\n---\n\n${
                            topic?.trim()
                                ? `Write a Recollect note on: ${topic.trim()}. Follow the recipe above: one create_doc call, then fix anything its answer reports, once.`
                                : 'Follow the recipe above for the note I ask for next.'
                        }`,
                    },
                },
            ],
        })
    );
}
