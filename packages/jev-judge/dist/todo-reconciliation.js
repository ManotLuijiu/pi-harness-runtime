/**
 * The reconciliation of the todos before a continuation or a completion.
 *
 * A request owns a list of todos. The agent finishes the work of an item and
 * the item keeps the status `in_progress`, because closing a todo needs the
 * todo tool of the agent. The controller then steers the same item again and
 * the work loops forever.
 *
 * The reconciliation checkpoint breaks that loop: the agent is asked to
 * compare every open item with the work and the validation that already
 * happened, and to close the verified items with the real todo tool. The
 * reminder never closes anything by itself - only the agent may, and only
 * after it compared the item with the work.
 */
/**
 * The reminder the agent receives before a continuation or a completion.
 *
 * The text is fixed: it is the checkpoint that the agent has to pass, and a
 * varying wording would let a continuation slip past it.
 */
export const TODO_RECONCILIATION_REMINDER = "Before continuing or reporting completion, reconcile this request's open todos with the work already performed. Update completed items using the todo tool. Preserve unfinished checks and blockers. Do not repeat completed work or start unrelated backlog items.";
/** The statuses of an item that is still open. */
const OPEN_STATUSES = new Set(["pending", "in_progress"]);
/**
 * A credential in free text: the name of the secret and its value.
 */
const CREDENTIAL_PATTERN = /\b(api[_-]?key|apikey|secret|token|password|passwd|credential|authorization|bearer)\b(\s*[:=]\s*)(\S+)/gi;
/** An absolute path: it names a place on the machine, not the work. */
const ABSOLUTE_PATH_PATTERN = /(^|\s)(\/[^\s]*)/g;
/**
 * Remove what must not leave the machine: a credential and an absolute path.
 *
 * The subject of a todo is written by the agent, so it can hold anything.
 * The block only needs the name of the work.
 */
function sanitizeText(value) {
    const flattened = value.replace(/\s+/g, " ").trim();
    return flattened
        .replace(CREDENTIAL_PATTERN, "$1$2<redacted>")
        .replace(ABSOLUTE_PATH_PATTERN, "$1<path>");
}
/**
 * The open items of a task list (pending and in_progress).
 *
 * A completed item is not open, and a deleted one is not work either. The
 * validation state is not derived here: it comes from the ledger of the
 * runs, so the caller attaches it.
 */
export function todoReconciliationItems(tasks) {
    return tasks
        .filter((task) => OPEN_STATUSES.has(task.status))
        .map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
    }));
}
/**
 * The validation state of an item, in words.
 *
 * An item without validation evidence names the missing validation instead
 * of hiding it: the agent has to see that the check never ran.
 */
function describeValidation(validation) {
    if (!validation || !validation.hasPlan) {
        return "validation: no evidence (the validation of this item never ran)";
    }
    const parts = [`fast=${validation.fast.status}`, `full=${validation.full.status}`];
    if (validation.finalTierRequired && validation.finalTierPending) {
        parts.push("final tier pending");
    }
    if (validation.planIncomplete) {
        const reasons = validation.planIncompleteReasons && validation.planIncompleteReasons.length > 0
            ? validation.planIncompleteReasons.join("; ")
            : "the plan requires a final tier but declares none";
        parts.push(`plan incomplete: ${reasons}`);
    }
    return `validation: ${parts.join(", ")}`;
}
/**
 * The text that rides along with a continuation: the reminder and the open
 * items, one per line, with their validation state.
 *
 * The block is empty when there is no open item: a request without open work
 * has nothing to reconcile.
 */
export function buildTodoReconciliationBlock(open) {
    if (open.length === 0)
        return "";
    const lines = [TODO_RECONCILIATION_REMINDER, "", "Open todos of this request:"];
    for (const item of open) {
        lines.push(`- #${item.id} (${item.status}) ${sanitizeText(item.subject)} - ${describeValidation(item.validation)}`);
    }
    return lines.join("\n");
}
//# sourceMappingURL=todo-reconciliation.js.map