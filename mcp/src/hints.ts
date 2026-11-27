// TOOL_ACCESS_PLAN §4.5: the annotation table, one place. destructiveHint only where existing content is removed or
// replaced; an update that sets a value (doing it twice changes nothing more) says idempotentHint. Reads stay as their
// spec says (readOnlyHint: true). A host may ask more before a destructive call, so the word must be true.
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/** Removes or replaces what is there (Undo brings it back), or asks to (empty_trash). */
export const DESTRUCTIVE: ReadonlySet<string> = new Set([
    'replace_section',
    'delete_blocks',
    'update_block',
    'update_canvas',
    'trash_doc',
    'empty_trash',
    'remove_milestone',
    'remove_focus',
    'remove_note',
    'forget',
    'update_note',
    'set_revision_card',
    'clear_lock_line',
    'cancel_reminder',
    'delete_pocket_note',
    'delete_subject',
    'remove_file',
    // TOOL_ACCESS_PLAN §12: each removes or replaces what is there (Undo brings it back).
    'undo_edit',
    'delete_task',
    'update_decision',
    'remove_topic',
    'stop_revision',
    'uncomplete_revision',
    'update_session',
]);

/** Sets a value: the same call again changes nothing more. */
export const IDEMPOTENT: ReadonlySet<string> = new Set([
    'update_task',
    'update_topic',
    'update_work_line',
    'update_settings',
    'update_project',
    'set_folder',
    'set_chat',
    'update_goal',
    'update_milestone',
    'update_focus',
    'update_week_target',
    'update_doc',
    'move_revision',
    'update_pocket_note',
    'update_subject',
]);

export function hintsFor(name: string, base: ToolAnnotations): ToolAnnotations {
    if (base.readOnlyHint) return base;
    return { ...base, readOnlyHint: false, destructiveHint: DESTRUCTIVE.has(name), idempotentHint: IDEMPOTENT.has(name) };
}
