// TOOL_ACCESS_PLAN §5.3: jobs with steps. find_tools answers one when a query matches it; each is also an MCP prompt
// on the web and code doors (a host with a prompt menu shows it as a command). Steps name real tools: a test checks
// every name exists and is reachable on the web. At most 1,400 characters each.

export interface Playbook {
    id: string;
    title: string;
    /** Words people say for the job (find_tools matches them like a tool's keywords). */
    triggers: readonly string[];
    steps: string;
}

export const PLAYBOOKS: readonly Playbook[] = [
    {
        id: 'study_session',
        title: 'A study session',
        triggers: ['study session', 'study with me', 'tutor me', 'teach me', 'lets study', 'learn about', 'continue my course', 'pick up where we left off', 'pick up where i left off', 'next topic', 'explain and quiz me'],
        steps: [
            '1. get_brief once: their profile (how they like to learn), the next topic of each path with its weak spots, and a session key.',
            '2. get_path for the subject: pick up where they are (the ▶ topic, else the next ○ one), or what they asked for. read_doc its lesson when it has one.',
            '3. Teach a part of 10-20 minutes: explain (a diagram where parts move), take their questions, then a quiz of 2-4 questions they answer before you show the answers.',
            '4. checkpoint after each part with the key: topicId, a title, score, weakSpots (what they got wrong), cleared, topicStatus, nextStep. Never wait for the end.',
            '5. Ask them to explain the part in their own words; what is right can be blended into the lesson (append_to_doc, replace_section) on their yes.',
            '6. Asides worth keeping: add_note on the lesson; a link: add_note with url.',
            '7. Lesson complete: set_revision_card (5-10 key points, one diagram, 4-8 check-yourself toggles), then ask before schedule_revision.',
        ].join('\n'),
    },
    {
        id: 'quiz_me',
        title: 'Quiz them on a lesson (a review)',
        triggers: ['quiz me', 'test me', 'test my knowledge', 'review a lesson', 'revise with me', 'ask me questions', 'drill me', 'flashcards'],
        steps: [
            '1. list_due: the reviews due today with their doc and review id (or search_docs for the lesson they name).',
            '2. read_doc the lesson; get_quiz_results for its topic: the questions they missed before and their open weak spots.',
            '3. Ask 4-6 questions, weak spots first, one at a time; let them answer before you explain.',
            '4. When they have reviewed it with you: complete_revision with the review id (the next one is scheduled). Another day instead: move_revision.',
            '5. checkpoint with kind "review", the score and the weak spots found or cleared.',
        ].join('\n'),
    },
    {
        id: 'write_lesson',
        title: 'Write a lesson (a doc)',
        triggers: ['write a lesson', 'write notes', 'notes doc', 'make a doc', 'write a doc', 'create notes', 'summarize into a doc', 'note with diagrams', 'good study doc', 'write a good note'],
        steps: [
            '1. search_docs with the topic words first: extending a doc (append_to_doc) beats a duplicate.',
            '2. Before your first doc: create_doc with only guide: true answers the full Markdown and diagram guide.',
            '3. create_doc: a 2-3 line summary, ## sections, a worked example or code, a diagram where structure helps (```mermaid, or a ```canvas board), pitfalls in a > [!WARNING] callout, 3-5 self-test questions as <details> toggles. subject (or topicId for a planned topic on a path) files it; revise: true schedules reviews.',
            '4. A board: add_canvas draws it, preview_diagram shows it, update_canvas fixes it in place.',
        ].join('\n'),
    },
    {
        id: 'plan_week',
        title: 'Plan the week',
        triggers: ['plan my week', 'plan the week', 'week plan', 'weekly targets', 'targets for next week', 'targets for the week', 'pick targets', 'this week look like'],
        steps: [
            '1. get_week: this week\'s targets, last week in numbers, whether the weekly review waits. get_today and list_goals: goals, pace, milestones due.',
            '2. Propose 3-5 targets (at most 5): the next path topics at the pace their goal needs, a milestone due soon, practice counts.',
            '3. On their yes, add_week_target for each (topicId, milestoneId or taskId makes it tick itself; measure + amount counts). Changes later: update_week_target.',
            '4. When it is their call and they cannot say yes in this chat: suggest_to_user instead.',
        ].join('\n'),
    },
    {
        id: 'plan_course',
        title: 'Plan a course (a subject and its path)',
        triggers: ['plan a course', 'new subject with topics', 'set up a subject', 'set up a course', 'course outline', 'syllabus', 'study path', 'learning path', 'roadmap', 'from scratch'],
        steps: [
            '1. list_subjects: an existing subject (any case) is reused; else create_subject with its name.',
            '2. plan_topics with the topic titles in order (short, no numbers): planned topics, no docs yet. One topic in the middle: after its id.',
            '3. get_path to show the path; update_topic to reorder, rename a planned topic or mark one skipped.',
            '4. A goal with a deadline: create_goal with 4-10 milestones, each with a dueDay.',
        ].join('\n'),
    },
    {
        id: 'log_day',
        title: 'Log the day\'s work',
        triggers: ['log my work', 'log today', 'log the day', 'standup', 'write up my work', 'end of day', 'record what i did', 'work log', 'log-work'],
        steps: [
            '1. get_brief once if you have not: its Work part shows what the log already has today and what is open, with ids.',
            '2. One plain past-tense line per result (fixed, shipped, sent, decided with why, a problem left open), at most 5; skip what the log already has.',
            '3. log_work once for each line (news on a line shown to you: its id in on). get_work_log reads the log back; update_work_line rewords or folds one of yours.',
        ].join('\n'),
    },
    {
        id: 'start_day',
        title: 'Start the day',
        triggers: ['start my day', 'morning plan', 'plan today', 'plan my day', 'good morning', 'what should i do today', 'daily plan'],
        steps: [
            '1. get_brief once, then get_today: today\'s reviews, focus lines, each path\'s next topic, goals.',
            '2. list_due for the reviews in order; list_tasks with due "today" for tasks.',
            '3. Up to 3 focus lines on their yes: add_focus (update_focus ticks or rewords one).',
            '4. A nudge at a time: set_reminder.',
        ].join('\n'),
    },
    {
        id: 'tidy_docs',
        title: 'Tidy their docs',
        triggers: ['tidy my docs', 'clean up my docs', 'clean up docs', 'merge docs', 'merge notes', 'duplicate docs', 'duplicate notes', 'combine docs', 'organize notes', 'reorganize'],
        steps: [
            '1. search_docs with the topic words (or none: the most recent); read_doc the ones that overlap.',
            '2. Merge on their yes: append_to_doc (or replace_section) into the doc that stays, then trash_doc the other (restore_doc takes it back for 30 days).',
            '3. Re-file: update_doc with subject or a new title. Lesson notes: list_notes, update_note, remove_note with into.',
        ].join('\n'),
    },
];
