/**
 * The dispatch of a Frappe operation.
 *
 * The Frappe policy decides; this module carries the decision into the
 * paths the harness already owns:
 *
 * - "execute" runs the operation,
 * - "countdown" registers a pending action that resumes the work when
 *   the confirmation expires,
 * - "approval-required" opens a question for the human through the
 *   runtime of the delegated approval,
 * - "blocked" refuses the operation and names the reason.
 *
 * The rules that this module keeps:
 *
 * - The question of a Frappe operation has no deadline. A deadline is
 *   not an answer, and the answer of the human is the only way out of a
 *   destructive operation. The generic delegation of the workspace never
 *   stands in for the answer of the human.
 * - The identity of the operation is the identity of the question, so a
 *   repeated proposal asks once and the countdown of a repeated proposal
 *   is one move of one action.
 * - The check before the dispatch pins the proposal: a new request, a
 *   cancellation, a code that changed or a permission that ended stops
 *   the operation.
 */

import type { DelegatedApprovalRuntime } from "./delegated-approval-runtime.ts";
import type { PendingActionRegistry } from "./pending-actions.ts";
import {
	decideFrappeOperation,
	frappeOperationIdentity,
	recheckFrappeOperation,
	type FrappeDecisionContext,
	type FrappeDispatchState,
	type FrappeOperationAssessment,
	type FrappeRecheckResult,
} from "./frappe-lifecycle-policy.ts";

/** How long a confirmation lasts when the caller names no time. */
export const DEFAULT_FRAMPE_COUNTDOWN_MS = 120_000;

/** The kind of the question of a Frappe operation. */
export const FRAPPE_APPROVAL_KIND = "external-write" as const;

/** What the dispatch does. */
export type FrappeDispatch =
	| {
			/** The operation may run. */
			kind: "execute";
			identity: string;
			reason: string;
	  }
	| {
			/** The operation waits for a confirmation that expires. */
			kind: "countdown";
			identity: string;
			reason: string;
			/** When the confirmation expires. */
			deadlineAt: number;
			/** The identity of the pending action. */
			actionId: string;
	  }
	| {
			/** The human is asked. */
			kind: "approval";
			identity: string;
			reason: string;
			/** The identity of the question. */
			requestId: string;
			/** Did a route accept the question? */
			delivered: boolean;
	  }
	| {
			/** The operation is refused. */
			kind: "blocked";
			identity: string;
			reason: string;
	  };

/** The input of a dispatch. */
export interface FrappeDispatchInput {
	/** The assessed operation. */
	assessment: FrappeOperationAssessment;
	/** The context of the decision: the rule of the project, the grant. */
	context: FrappeDecisionContext;
	/** The workspace of the operation. */
	workspace: string;
	/** The session of the request. */
	sessionId: string;
	/** The clock of the dispatch. */
	now: number;
	/** The runtime of the delegated approval. */
	approval?: DelegatedApprovalRuntime;
	/** The registry of the pending actions. */
	pending?: PendingActionRegistry;
	/** How long a confirmation lasts. */
	countdownMs?: number;
}

/**
 * The identity of the question of a Frappe operation.
 *
 * The identity of the operation is the identity of the question: a
 * repeated proposal of the same operation asks once.
 */
export function frappeApprovalRequestId(identity: string): string {
	return `frappe-${identity}`;
}

/**
 * The dispatch of an assessed Frappe operation.
 *
 * The decision of the policy is the only thing that decides here. The
 * judge, the place of the routine and the confidence of the model are
 * evidence of the assessment, never a permission.
 */
export async function dispatchFrappeOperation(
	input: FrappeDispatchInput,
): Promise<FrappeDispatch> {
	const assessment = input.assessment;
	const identity = frappeOperationIdentity(assessment);
	const decision = decideFrappeOperation(assessment, input.context);
	if (decision.decision === "blocked") {
		return { kind: "blocked", identity, reason: decision.reason };
	}
	if (decision.decision === "execute") {
		return { kind: "execute", identity, reason: decision.reason };
	}
	if (decision.decision === "countdown") {
		const deadlineAt = input.now + (input.countdownMs ?? DEFAULT_FRAMPE_COUNTDOWN_MS);
		const actionId = `frappe-${identity}`;
		input.pending?.register({
			id: actionId,
			sessionId: input.sessionId,
			owner: "frappe-lifecycle",
			kind: "resume",
			state: "scheduled",
			dueAt: deadlineAt,
			reason: decision.reason,
		});
		return {
			kind: "countdown",
			identity,
			reason: decision.reason,
			deadlineAt,
			actionId,
		};
	}
	const requestId = frappeApprovalRequestId(identity);
	const runtime = input.approval;
	if (!runtime) {
		return {
			kind: "blocked",
			identity,
			reason: `${decision.reason}; no channel of the harness can ask the human`,
		};
	}
	const outcome = await runtime.open({
		requestId,
		workspace: input.workspace,
		sessionId: input.sessionId,
		generation: assessment.requestGeneration,
		kind: FRAPPE_APPROVAL_KIND,
		operation: assessment.proposal,
		blocked: [identity],
		reason: decision.reason,
	});
	return {
		kind: "approval",
		identity,
		reason: decision.reason,
		requestId,
		delivered: outcome.delivered,
	};
}

/**
 * The run of an approved operation.
 *
 * The check runs once more right before the operation: the proposal that
 * was assessed is the proposal that runs.
 */
export async function runFrappeOperation(input: {
	/** The assessed operation. */
	assessment: FrappeOperationAssessment;
	/** The state of the world at the moment of the run. */
	state: FrappeDispatchState;
	/** The work of the operation. */
	run(): Promise<void>;
}): Promise<FrappeRecheckResult> {
	const recheck = recheckFrappeOperation(input.assessment, input.state);
	if (!recheck.ok) return recheck;
	await input.run();
	return { ok: true, reason: "the operation ran" };
}
