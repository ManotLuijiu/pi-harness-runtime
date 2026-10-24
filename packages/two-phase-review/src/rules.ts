/**
 * The workflow rules.
 *
 * The rules are injected into the system prompt: they tell the agent how the
 * two phases are separated and what it has to do in the current phase.
 */

import type { ReviewChunk, ReviewSignal, TwoPhasePhase, TwoPhaseState } from "./types.js";
import {
	REVIEW_FIX_PREFIX,
	REVIEW_PREFIX,
	classifyTodo,
	summarizeTodos,
	type TodoLike,
} from "./classify.js";
import { summarizeSignals } from "./signals.js";

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
- The review covers the diff of the task, not the whole repository.
- Review the scope in chunks, per module. Use independent reviewers for independent chunks.
- Record every confirmed finding as a [REVIEW-FIX] todo, grouped by root cause and severity. A minor suggestion does not interrupt a running chunk.
- Fix the confirmed findings after the review pass, check the changed area, and run one final integration review over the task diff.
- The request is complete only when the implementation todos, the review chunks and the required fix todos are done or explicitly accepted.

### Todo prefixes
- [IMPLEMENT] implementation work of the current request
- ${REVIEW_PREFIX} the queued review of the task diff
- ${REVIEW_FIX_PREFIX} a confirmed finding that has to be fixed

A user pause, an approval requirement, a security issue or any other safety rule stops the work immediately. The phase order never overrides the intent of the user.`;

/** The current state of the workflow as the agent sees it. */
export interface PhaseView {
	phase: TwoPhasePhase;
	/** How many implementation todos are still open. */
	implementationOpen: number;
	/** How many review todos are open. */
	reviewOpen: number;
	/** How many review-fix todos are open. */
	reviewFixOpen: number;
	/** How many files the review covers. */
	scopeFiles: number;
	/** The review chunks and their state. */
	chunks: { id: string; label: string; status: string }[];
	/** Is a review queued? */
	queued: boolean;
	/** The signals that queued the review. */
	signals: ReviewSignal[];
}

/** Build the phase view from the state and the todo list. */
export function buildPhaseView(state: TwoPhaseState, todos: TodoLike[]): PhaseView {
	const summary = summarizeTodos(todos);
	return {
		phase: state.phase,
		implementationOpen: summary.implementation,
		reviewOpen: summary.review,
		reviewFixOpen: summary.reviewFix,
		scopeFiles: state.scopeFiles.length,
		chunks: state.chunks.map((chunk) => ({
			id: chunk.id,
			label: chunk.label,
			status: chunk.status,
		})),
		queued: state.signals.length > 0,
		signals: state.signals,
	};
}

/** The subject of the one queued review todo. */
export function buildReviewTodoSubject(state: TwoPhaseState): string {
	const summary = summarizeSignals(state.signals);
	const first = summary.sources[0] ?? "review signal";
	const more = summary.sources.length > 1 ? ` +${summary.sources.length - 1} more` : "";
	return `${REVIEW_PREFIX} Review the task diff (queued by ${first}${more})`;
}

/** The description of the one queued review todo. */
export function buildReviewTodoDescription(state: TwoPhaseState): string {
	const summary = summarizeSignals(state.signals);
	const lines: string[] = [];
	if (summary.sources.length > 0) lines.push(`Source: ${summary.sources.join(", ")}`);
	if (summary.reason) lines.push(`Reason: ${summary.reason}`);
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
export function formatPhaseStatus(state: TwoPhaseState): string {
	switch (state.phase) {
		case "implementation":
			return "[PHASE] implementation";
		case "review_pending":
			return "[PHASE] review_pending";
		case "review": {
			const done = state.chunks.filter((chunk) => chunk.status === "done").length;
			return `[PHASE] review (${done}/${state.chunks.length} chunk(s), ${state.scopeFiles.length} file(s))`;
		}
		case "review_fixes":
			return `[PHASE] review_fixes (${state.findings.length} finding(s))`;
		case "complete":
			return "[PHASE] complete";
		default:
			return "[PHASE] implementation";
	}
}

/**
 * The subject of the todo that covers one review chunk.
 *
 * The chunk id is part of the subject, so the runtime can tell which chunk a
 * todo belongs to.
 */
export function buildChunkTodoSubject(chunk: ReviewChunk): string {
	return `${REVIEW_PREFIX} ${chunk.id}: ${chunk.label}`;
}

/** The description of the todo that covers one review chunk. */
export function buildChunkTodoDescription(chunk: ReviewChunk): string {
	const files = chunk.files.map((file) => `- ${file}`).join("\n");
	return [
		`Review the files of ${chunk.id} (${chunk.label}):`,
		files,
		"",
		`Review only this chunk. Record confirmed findings as ${REVIEW_FIX_PREFIX} todos grouped by root cause and severity.`,
	].join("\n");
}

/** Does the todo item belong to the review chunk? */
export function isChunkTodo(todo: TodoLike, chunk: ReviewChunk): boolean {
	if (classifyTodo(todo) !== "review") return false;
	const subject = todo.subject ?? "";
	const at = subject.indexOf(chunk.id);
	if (at < 0) return false;
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
export function syncChunkStatus(state: TwoPhaseState, todos: TodoLike[]): TwoPhaseState {
	if (state.chunks.length === 0) return state;
	let changed = false;
	const chunks = state.chunks.map((chunk) => {
		if (chunk.status === "done") return chunk;
		const done = todos.some(
			(todo) => isChunkTodo(todo, chunk) && todo.status === "completed",
		);
		if (!done) return chunk;
		changed = true;
		return { ...chunk, status: "done" as const };
	});
	return changed ? { ...state, chunks } : state;
}

/**
 * The reason a comprehensive review was deferred.
 *
 * The reason has to be actionable: the agent continues with the
 * implementation and keeps the task-level checks alive.
 */
export function buildDeferralReason(
	state: TwoPhaseState,
	context: { source: string; implementationOpen: number },
): string {
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
export function buildPhaseInstruction(state: TwoPhaseState, view: PhaseView): string {
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
		const chunkLines = view.chunks.map(
			(chunk) => `- ${chunk.id}: ${chunk.label} [${chunk.status}]`,
		);
		return [
			`[two-phase] Phase 2 (review): the implementation is done. Review scope: ${view.scopeFiles} file(s) in ${view.chunks.length} chunk(s).`,
			...chunkLines,
			`Review each chunk in scope (never the whole repository). Record confirmed findings as ${REVIEW_FIX_PREFIX} todos grouped by root cause and severity, fix them after the pass, then run one final integration review over the task diff. The request is not complete while review or fix items remain.`,
		].join("\n");
	}

	if (state.phase === "review_fixes") {
		return `[two-phase] Phase 2 (review fixes): ${view.reviewFixOpen} review-fix todo(s) open. Fix the confirmed findings, check the changed area, then run one final integration review over the task diff.`;
	}

	return "[two-phase] The task is complete: implementation, review and the required fixes are done.";
}
