// The mirror (LOOP_COMPLETE_SPEC 1.7): where Ramin stands per goal and per subject. Every number is
// worked out by the app; quote them, don't recompute them.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { quote } from '../format.js';
import { READ_ONLY, defineTool, type ToolContext } from '../tool.js';

type Kind = 'study' | 'practice' | 'build' | 'review';

interface Pace {
    done: number;
    total: number;
    perWeek: number;
    requiredPerWeek: number | null;
    landsOn: string | null;
    status: string;
    fix: { extraPerWeek: number; orLandsOn: string | null } | null;
}

interface Mirror {
    today: string;
    goals: Array<{ _id: string; title: string; deadline: string; daysLeft: number; milestones: { done: number; total: number }; forecast: { status: string }; paths: Array<Pace & { subject: { name: string } }>; hoursPerWeek: Array<{ weekStart: string; minutes: Record<Kind, number> }> }>;
    subjects: Array<{ _id: string; name: string; path: Pace | null; quiz: Array<{ day: string; done: number; total: number }>; weakSpots: { open: number; clearedIn30: number }; practice: { alone: number; hints: number; after_answer: number }; minutesPerTopic: number | null }>;
    weeks: Array<{ weekStart: string; minutes: Record<Kind, number>; targets: { done: number; total: number } }>;
}

const hours = (m: number) => (m < 60 ? `${m} min` : `${Math.round(m / 6) / 10} h`);
const total = (m: Record<Kind, number>) => Object.values(m).reduce((a, b) => a + b, 0);

function paceLine(p: Pace): string {
    const need = p.requiredPerWeek !== null && p.status !== 'done' ? `, needs ${p.requiredPerWeek}/wk` : '';
    const lands = p.landsOn && p.status !== 'done' ? `, lands ${p.landsOn}` : '';
    const fix = p.fix ? ` · fix: ${p.fix.extraPerWeek} more topic${p.fix.extraPerWeek === 1 ? '' : 's'} a week${p.fix.orLandsOn ? `, or finish ${p.fix.orLandsOn}` : ''}` : '';
    return `${p.done}/${p.total} topics at ${p.perWeek}/wk${need}${lands} · ${p.status.replace('_', ' ')}${fix}`;
}

export function registerMirrorTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;
    defineTool(
        server,
        ctx,
        'get_mirror',
        {
            title: 'Where Ramin stands',
            description: 'Where he stands, worked out by the app: each goal path’s pace against its deadline and the smallest fix, hours per week, per-subject quiz scores, weak spots, practice. Quote these numbers.',
            input: {
                goal: z.string().trim().max(120).optional().describe('Only this goal (its title or a part of it).'),
                subject: z.string().trim().max(100).optional().describe('Only this subject.'),
            },
            annotations: READ_ONLY,
        },
        async ({ goal, subject }) => {
            const m = await api.get<Mirror>('/api/mirror');
            const lines: string[] = [];
            const goals = m.goals.filter((g) => !goal || g.title.toLowerCase().includes(goal.toLowerCase()));
            const subjects = m.subjects.filter((s) => !subject || s.name.toLowerCase() === subject.toLowerCase());
            if (!subject) {
                for (const g of goals) {
                    lines.push(`Goal ${quote(g.title, 80)} · due ${g.deadline} (${g.daysLeft} days) · milestones ${g.milestones.done}/${g.milestones.total} · ${g.forecast.status.replace('_', ' ')}`);
                    for (const p of g.paths) lines.push(`  ${p.subject.name}: ${paceLine(p)}`);
                    const hw = g.hoursPerWeek.map((w) => hours(total(w.minutes))).join(', ');
                    if (g.hoursPerWeek.some((w) => total(w.minutes) > 0)) lines.push(`  Last ${g.hoursPerWeek.length} weeks in its subjects: ${hw}`);
                }
            }
            if (!goal) {
                for (const s of subjects) {
                    const parts = [
                        s.path ? `path ${paceLine(s.path)}` : null,
                        s.quiz.length ? `quiz ${s.quiz.slice(-5).map((q) => `${q.done}/${q.total}`).join(', ')}` : null,
                        s.weakSpots.open || s.weakSpots.clearedIn30 ? `weak spots ${s.weakSpots.open} open, ${s.weakSpots.clearedIn30} cleared in 30 days` : null,
                        s.practice.alone + s.practice.hints + s.practice.after_answer ? `practice: ${s.practice.alone} alone, ${s.practice.hints} with hints, ${s.practice.after_answer} after the answer` : null,
                        s.minutesPerTopic ? `${s.minutesPerTopic} min per finished topic` : null,
                    ].filter(Boolean);
                    if (parts.length) lines.push(`${s.name}: ${parts.join(' · ')}`);
                }
                if (!subject) lines.push(`Weeks (oldest first): ${m.weeks.map((w) => `${hours(total(w.minutes))}${w.targets.total ? ` (${w.targets.done}/${w.targets.total} targets)` : ''}`).join(', ')}`);
            }
            return lines.length ? lines.join('\n') : 'Nothing to show yet: no goals, paths or sessions match.';
        }
    );
}
