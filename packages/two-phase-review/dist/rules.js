/**
 * The workflow rules.
 *
 * The rules are injected into the system prompt: they tell the agent how the
 * two phases are separated and what it has to do in the current phase.
 */
import { REVIEW_FIX_PREFIX, REVIEW_PREFIX, TEST_PREFIX, classifyTodo, summarizeTodos, } from "./classify.js";
import { summarizeSignals } from "./signals.js";
import { describeValidationGate, } from "./validation.js";
/** The contract of the workflow. */
export const TWO_PHASE_CONTRACT = `## Two-phase implementation and review

A task with several steps runs in two phases.

### Phase 1 - implementation
- Work through every open implementation todo of the current request.
- Do not start a comprehensive review between implementation todos. A review that is requested while the implementation runs is queued, not executed.
- Keep the task-level checks active: syntax errors, broken imports, type errors of the code you write right now and failing required tests are part of the implementation and are fixed now.
- Broader feedback (style, maintainability, a full diff review) is queued as one [REVIEW] todo. Never discard it.
- Queued review work is not an implementation blocker. The request is not complete while implementation todos remain.

### Phase 2 - review
- The review starts on its own: as soon as the implementation todos are done and the task changed a file, the harness starts the review over the diff of the task. You never have to queue a review item to get one.
- The review covers the diff of the task, not the whole repository.
- Review the scope in chunks, per module. Use independent reviewers for independent chunks.
- Record every confirmed finding as a [REVIEW-FIX] todo, grouped by root cause and severity. A minor suggestion does not interrupt a running chunk.
- Fix the confirmed findings after the review pass, check the changed area, and run one final integration review over the task diff.
- The request is complete only when the implementation todos, the review chunks and the required fix todos are done or explicitly accepted.

### Phase 3 - validation
- A test todo ([${TEST_PREFIX}]) declares the validation plan of the task: the cheap tier you run after every edit and the final tier that decides whether the task is done.
- The runs are recorded in the validation ledger. A task whose final tier is pending or failed is never complete.
- The request is complete only when the implementation todos, the review chunks, the required fix todos and the recorded final tier are done.

### Todo prefixes
- [IMPLEMENT] implementation work of the current request
- ${REVIEW_PREFIX} the queued review of the task diff
- ${REVIEW_FIX_PREFIX} a confirmed finding that has to be fixed
- ${TEST_PREFIX} the validation of the task (the tiers are declared in its metadata)

A user pause, an approval requirement, a security issue or any other safety rule stops the work immediately. The phase order never overrides the intent of the user.`;
/** Build the phase view from the state and the todo list. */
export function buildPhaseView(state, todos, validation, delegation) {
    const summary = summarizeTodos(todos);
    return {
        phase: state.phase,
        implementationOpen: summary.implementation,
        reviewOpen: summary.review,
        reviewFixOpen: summary.reviewFix,
        testOpen: summary.test,
        implementationTotal: summary.implementationTotal,
        reviewTotal: summary.reviewTotal,
        reviewFixTotal: summary.reviewFixTotal,
        testTotal: summary.testTotal,
        scopeFiles: state.scopeFiles.length,
        chunks: state.chunks.map((chunk) => ({
            id: chunk.id,
            label: chunk.label,
            status: chunk.status,
        })),
        queued: state.signals.length > 0,
        signals: state.signals,
        validation,
        delegation,
    };
}
/** The subject of the one queued review todo. */
export function buildReviewTodoSubject(state) {
    const summary = summarizeSignals(state.signals);
    const first = summary.sources[0] ?? "review signal";
    const more = summary.sources.length > 1 ? ` +${summary.sources.length - 1} more` : "";
    return `${REVIEW_PREFIX} Review the task diff (queued by ${first}${more})`;
}
/** The description of the one queued review todo. */
export function buildReviewTodoDescription(state) {
    const summary = summarizeSignals(state.signals);
    const lines = [];
    if (summary.sources.length > 0)
        lines.push(`Source: ${summary.sources.join(", ")}`);
    if (summary.reason)
        lines.push(`Reason: ${summary.reason}`);
    if (state.scopeFiles.length > 0) {
        const shown = state.scopeFiles.slice(0, 20);
        const rest = state.scopeFiles.length - shown.length;
        lines.push(`Scope: ${shown.join(", ")}${rest > 0 ? ` (+${rest} more)` : ""}`);
    }
    lines.push("The review starts after the implementation todos are done.");
    return lines.join("\n");
}
/**
 * The status line of the workflow.
 *
 * The line is plain ASCII: it is shown in the footer of the session.
 */
export function formatPhaseStatus(state, view) {
    const parts = [];
    switch (state.phase) {
        case "implementation": {
            parts.push("[P] IMPLEMENT");
            if (view) {
                parts.push(`${view.implementationTotal - view.implementationOpen}/${view.implementationTotal}`);
            }
            break;
        }
        case "review_pending":
            parts.push("[R] REVIEW", "pending");
            break;
        case "review": {
            const done = state.chunks.filter((chunk) => chunk.status === "done").length;
            parts.push("[R] REVIEW", `${done}/${state.chunks.length} chunks`);
            parts.push(`${view?.scopeFiles ?? state.scopeFiles.length} files`);
            break;
        }
        case "review_fixes":
            parts.push("[F] FIX", `${state.findings.length} findings`);
            break;
        case "test_pending": {
            parts.push("[T] TEST");
            if (view) {
                parts.push(`${view.testTotal - view.testOpen}/${view.testTotal}`);
                const validation = describeValidation(view.validation);
                if (validation)
                    parts.push(validation);
            }
            break;
        }
        case "complete":
            parts.push("[OK] COMPLETE");
            break;
        default:
            parts.push("[P] IMPLEMENT");
            break;
    }
    const delegation = view?.delegation;
    if (delegation && delegation.groups > 0) {
        parts.push(`delegated ${delegation.dispatched}/${delegation.groups}`);
    }
    return parts.join(" | ");
}
/**
 * The validation part of the status.
 *
 * The words describe the state that was read: a validation that could not
 * be read is unknown, never passed.
 */
export function describeValidation(state) {
    if (!state)
        return undefined;
    if (!state.available)
        return "validation unknown";
    if (state.failedFinalTier > 0)
        return `final tier failed (${state.failedFinalTier})`;
    if (state.incompletePlan > 0)
        return `plan incomplete (${state.incompletePlan})`;
    if (state.pendingFinalTier > 0)
        return `final tier pending (${state.pendingFinalTier})`;
    return "validation passed";
}
/**
 * The subject of the todo that covers one review chunk.
 *
 * The chunk id is part of the subject, so the runtime can tell which chunk a
 * todo belongs to.
 */
export function buildChunkTodoSubject(chunk) {
    return `${REVIEW_PREFIX} ${chunk.id}: ${chunk.label}`;
}
/** The description of the todo that covers one review chunk. */
export function buildChunkTodoDescription(chunk) {
    const files = chunk.files.map((file) => `- ${file}`).join("\n");
    return [
        `Review the files of ${chunk.id} (${chunk.label}):`,
        files,
        "",
        `Review only this chunk. Record confirmed findings as ${REVIEW_FIX_PREFIX} todos grouped by root cause and severity.`,
    ].join("\n");
}
/** Does the todo item belong to the review chunk? */
export function isChunkTodo(todo, chunk) {
    if (classifyTodo(todo) !== "review")
        return false;
    const subject = todo.subject ?? "";
    const at = subject.indexOf(chunk.id);
    if (at < 0)
        return false;
    // "chunk-1" must not match "chunk-10".
    const after = subject.slice(at + chunk.id.length, at + chunk.id.length + 1);
    return after === "" || !/[0-9a-z]/i.test(after);
}
/**
 * Derive the status of the review chunks from the todo list.
 *
 * The status only moves forward: a chunk that is done stays done, so a todo
 * list that is briefly empty (a restart, a compaction) can never erase the
 * progress of the review.
 */
export function syncChunkStatus(state, todos) {
    if (state.chunks.length === 0)
        return state;
    let changed = false;
    const chunks = state.chunks.map((chunk) => {
        if (chunk.status === "done")
            return chunk;
        const done = todos.some((todo) => isChunkTodo(todo, chunk) && todo.status === "completed");
        if (!done)
            return chunk;
        changed = true;
        return { ...chunk, status: "done" };
    });
    return changed ? { ...state, chunks } : state;
}
/**
 * The reason a comprehensive review was deferred.
 *
 * The reason has to be actionable: the agent continues with the
 * implementation and keeps the task-level checks alive.
 */
export function buildDeferralReason(state, context) {
    const sources = [...new Set(state.signals.map((signal) => signal.source))];
    return [
        `Phase 1 (implementation) is still running: ${context.implementationOpen} implementation todo(s) are open.`,
        `The comprehensive review (${sources.join(", ") || context.source}) is queued and starts after the implementation todos are done.`,
        "Continue with the implementation. Keep task-level checks (syntax errors, broken imports, type errors of the code you write now, failing required tests) active and fix them now.",
    ].join(" ");
}
/**
 * The instruction for the current phase.
 *
 * The instruction is short: it names the phase, the open work and what the
 * agent has to do next.
 */
export function buildPhaseInstruction(state, view) {
    if (state.phase === "implementation") {
        if (!view.queued) {
            return `[two-phase] Phase 1 (implementation): ${view.implementationOpen} implementation todo(s) open. Finish the implementation first; keep task-level checks (type errors, failing tests, build) active. Do not start a comprehensive review.`;
        }
        const summary = summarizeSignals(state.signals);
        return `[two-phase] Phase 1 (implementation): ${view.implementationOpen} implementation todo(s) open. A comprehensive review is queued (${summary.sources.join(", ") || "review signal"}) and must not start yet. Fix correctness problems of the current code now; queue broader feedback as one ${REVIEW_PREFIX} todo. The request is not complete while implementation todos remain.`;
    }
    if (state.phase === "review_pending") {
        return `[two-phase] Phase 2 (review): the implementation is done, the review scope is being derived from the task diff (${view.scopeFiles} file(s)).`;
    }
    if (state.phase === "review") {
        const chunkLines = view.chunks.map((chunk) => `- ${chunk.id}: ${chunk.label} [${chunk.status}]`);
        return [
            `[two-phase] Phase 2 (review): the implementation is done. Review scope: ${view.scopeFiles} file(s) in ${view.chunks.length} chunk(s).`,
            ...chunkLines,
            `Review each chunk in scope (never the whole repository). Record confirmed findings as ${REVIEW_FIX_PREFIX} todos grouped by root cause and severity, fix them after the pass, then run one final integration review over the task diff. The request is not complete while review or fix items remain.`,
        ].join("\n");
    }
    if (state.phase === "review_fixes") {
        return `[two-phase] Phase 2 (review fixes): ${view.reviewFixOpen} review-fix todo(s) open. Fix the confirmed findings, check the changed area, then run one final integration review over the task diff.`;
    }
    if (state.phase === "test_pending") {
        const validation = view.validation;
        const detail = validation
            ? `Validation: ${describeValidationGate(validation)}.`
            : "Validation: the state of the tiers is not readable.";
        return [
            `[two-phase] Phase 3 (validation): the implementation and the review are done. ${view.testOpen} test todo(s) open.`,
            detail,
            "Run the cheap tier after every edit and record it in the ledger, run the final tier once the work is stable and record that too. A task whose final tier is pending or failed is not complete.",
        ].join("\n");
    }
    return "[two-phase] The task is complete: implementation, review and the required fixes are done.";
}
//# sourceMappingURL=rules.js.map