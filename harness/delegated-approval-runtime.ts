/**
 * The runtime of the delegated approval.
 *
 * An operation that the human has to approve is open as a request. The
 * request is delivered to the channels, and two things can end it:
 *
 * - the human answers. The first answer wins, and it is recorded with the
 *   source `"human"`.
 * - the deadline passes. The deadline is not an answer: the operation
 *   continues only when the user delegated that outcome in advance, and
 *   only for the kinds of operation the delegation names. The decision is
 *   recorded with the source `"delegated-timeout"`, never as a click of
 *   the human.
 *
 * The claim of the decision is atomic and durable, so exactly one resume
 * is queued: a duplicate click, a late inference and a restart cannot
 * queue a second one.
 *
 * The runtime never forces a turn and never decides for the human. It
 * records what happened and hands the decision to the caller.
 */

import type { ApprovalDecisionStore } from "./approval-decision-store.ts";
import type { DelegationStore } from "./delegation-store.ts";
import type {
	ApprovalDecision,
	ApprovalOutcome,
	ApprovalRequest,
	DelegatedOperationKind,
	Delegation,
} from "./delegated-approval-types.ts";
import { delegationCovers } from "./delegated-approval-types.ts";

/**
 * The delay before a request whose deadline passed is tried again.
 *
 * The work can be paused or busy at the moment the deadline passes. The
 * decision of the delegation waits for the work to run again: a delegation
 * of the user must not be lost because the session was not free.
 */
const RETRY_DELAY_MS = 60_000;

/** What the caller wants to ask the human. */
export interface OpenApprovalInput {
	/** The canonical id of the request. It is the id of the pending question. */
	requestId: string;
	/** The workspace of the operation. */
	workspace: string;
	/** The session of the request. */
	sessionId: string;
	/** The generation of the request. */
	generation: number;
	/** The kind of the operation. */
	kind: DelegatedOperationKind;
	/** The exact operation, in the words of the human. */
	operation: string;
	/** What stays blocked while the request is open. */
	blocked?: string[];
	/** Why the operation is not simply running. */
	reason?: string;
	/** The deadline of the answer. It is absolute. */
	deadlineAt: number;
}

/** The result of opening a request. */
export interface OpenApprovalOutcome {
	/** The request. It is expired when the delivery failed. */
	request: ApprovalRequest;
	/** Did at least one route accept the message? */
	delivered: boolean;
	/** The routes that refused the message. */
	failures: string[];
}

export interface DelegatedApprovalDeps {
	/** The clock of the runtime. */
	now(): number;
	/** The delegations the user recorded in advance. */
	delegations: DelegationStore;
	/** The decisions that were made. */
	decisions: ApprovalDecisionStore;
	/**
	 * Deliver the request to the human.
	 *
	 * The result says whether at least one route accepted the message.
	 */
	deliver(
		request: ApprovalRequest,
	): Promise<{ delivered: boolean; failures: string[] }>;
	/**
	 * The resume that continues the work.
	 *
	 * It is queued at most once per request: the claim of the decision is
	 * what guarantees it.
	 */
	resume(request: ApprovalRequest, decision: ApprovalDecision): void;
	/**
	 * The request was decided by the deadline.
	 *
	 * The caller settles the request here: it resolves the question of the
	 * request and ends the wait of the judge. The hook runs before the
	 * resume is queued, so the continuation never starts while the
	 * question is still open.
	 */
	onDecided?(request: ApprovalRequest, decision: ApprovalDecision): void;
	/**
	 * Is the work of the request still active?
	 *
	 * A request that was cancelled, replaced or completed must not be
	 * continued by a timeout.
	 */
	active?(request: ApprovalRequest): boolean;
	/** The work is paused. */
	paused?(): boolean;
	/** The log of the runtime. */
	log?(message: string): void;
}

/**
 * The runtime of the delegated approval.
 */
export class DelegatedApprovalRuntime {
	private readonly deps: DelegatedApprovalDeps;
	/** The requests that are open. */
	private readonly requests = new Map<string, ApprovalRequest>();
	/** The timer of the earliest deadline. */
	private timer: ReturnType<typeof setTimeout> | null = null;
	constructor(deps: DelegatedApprovalDeps) {
		this.deps = deps;
	}

	/** The request of an id, when there is one. */
	get(requestId: string): ApprovalRequest | undefined {
		return this.requests.get(requestId);
	}

	/**
	 * Stop the timer.
	 *
	 * The session stops it when it ends: a deadline that fires after the
	 * session is gone must not continue anything.
	 */
	stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Arm the timer of the earliest deadline.
	 *
	 * One timer serves every request: the deadline that comes first is the
	 * one that is watched, and the timer is armed again for the next one
	 * when it ran.
	 */
	private armTimer(): void {
		this.stop();
		const now = this.deps.now();
		const pending = this.pending();
		const next = pending
			.filter((request) => request.deadlineAt > now)
			.sort((a, b) => a.deadlineAt - b.deadlineAt)[0];
		if (next) {
			this.arm(Math.max(0, next.deadlineAt - now), next.requestId);
			return;
		}
		// A request whose deadline passed but that could not be decided -
		// the work was paused, or the session was busy - is tried again:
		// the delegation of the user must not be lost because the session
		// was not free at that moment.
		const overdue = pending
			.filter((request) => request.deadlineAt <= now)
			.sort((a, b) => a.deadlineAt - b.deadlineAt)[0];
		if (overdue) {
			this.arm(RETRY_DELAY_MS, overdue.requestId);
		}
	}

	/**
	 * Arm one timer for one request.
	 *
	 * The timer never throws: a decision that fails must not take the
	 * timer chain of the other requests with it.
	 */
	private arm(delay: number, requestId: string): void {
		const timer = setTimeout(() => {
			this.timer = null;
			try {
				this.expire(requestId);
			} catch (error) {
				this.deps.log?.(
					`The deadline of the approval request ${requestId} failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			this.armTimer();
		}, Math.max(0, delay));
		// The timer must not hold the process of the harness open.
		(timer as { unref?: () => void }).unref?.();
		this.timer = timer;
	}

	/** The requests that are open. */
	pending(): ApprovalRequest[] {
		return [...this.requests.values()].filter(
			(request) => request.state === "pending",
		);
	}

	/**
	 * Open a request and deliver it to the human.
	 *
	 * The window starts only when a route accepted the message: a question
	 * that nobody was told about must not consume the opportunity of the
	 * human to answer.
	 *
	 * The caller may pass the result of a delivery it made itself. The
	 * delivery of the question and the window are then one decision, and
	 * the message is not sent twice.
	 */
	async open(
		input: OpenApprovalInput,
		delivery?: { delivered: boolean; failures: string[] },
	): Promise<OpenApprovalOutcome> {
		const existing = this.requests.get(input.requestId);
		if (existing && existing.state === "pending") {
			// The same question is not asked twice: a repeated delivery
			// would only wear the human down.
			this.deps.log?.(
				`The approval request ${input.requestId} is already open - it is not asked again.`,
			);
			return { request: existing, delivered: true, failures: [] };
		}
		const request: ApprovalRequest = {
			requestId: input.requestId,
			workspace: input.workspace,
			sessionId: input.sessionId,
			generation: input.generation,
			kind: input.kind,
			operation: input.operation,
			blocked: input.blocked ?? [],
			reason: input.reason,
			deadlineAt: input.deadlineAt,
			state: "pending",
		};
		this.requests.set(request.requestId, request);
		const result = delivery ?? (await this.deps.deliver(request));
		if (!result.delivered) {
			// The operation stays blocked: nobody was asked, so nobody
			// authorized anything.
			request.state = "expired";
			this.deps.log?.(
				`The approval request ${request.requestId} was not delivered: ${result.failures.join(", ")}. The operation stays blocked.`,
			);
			return { request, delivered: false, failures: result.failures };
		}
		// The window starts with the delivery: the deadline is watched
		// from here on.
		this.armTimer();
		return { request, delivered: true, failures: [] };
	}

	/**
	 * The answer of the human.
	 *
	 * The first answer wins: a second click, a click of another channel
	 * and a late answer of a stale button do nothing.
	 */
	answer(
		requestId: string,
		outcome: ApprovalOutcome,
	): ApprovalDecision | null {
		const request = this.requests.get(requestId);
		if (!request) return null;
		// A request that is not decided yet may still be answered: a
		// request that was not delivered, or whose deadline passed without
		// an authorization, is still a question of the human.
		if (request.state !== "pending" && request.state !== "expired") {
			this.deps.log?.(
				`The approval request ${requestId} was answered already - the answer is stale.`,
			);
			return null;
		}
		const decision: ApprovalDecision = {
			requestId,
			outcome,
			source: "human",
			reason: "the human answered",
			at: this.deps.now(),
		};
		// The claim is atomic: two answers that arrive at the same moment
		// still produce one decision.
		if (!this.deps.decisions.claim(decision)) {
			// The decision was made already. The durable record is the
			// truth: the answer of the human is stale, and the work must
			// not continue a second time.
			const known = this.deps.decisions.get(requestId);
			this.deps.log?.(
				`The approval request ${requestId} was decided already - the answer of the human is stale.`,
			);
			if (known) {
				request.state = "claimed";
				request.answer = {
					outcome: known.outcome,
					source: known.source,
					at: known.at,
				};
			}
			return known ?? null;
		}
		request.state = "answered";
		request.answer = { outcome, source: "human", at: decision.at };
		// The deadline of an answered request is not watched any more.
		this.armTimer();
		return decision;
	}

	/**
	 * The deadline of a request passed.
	 *
	 * The state of the work is checked before the claim, the claim is
	 * atomic, and the resume is queued at most once.
	 *
	 * The caller settles the request before the resume is queued: the
	 * decision is handed to `onDecided` first, so the question of the
	 * request is resolved and the wait of the judge ends before the
	 * continuation starts.
	 */
	expire(requestId: string): ApprovalDecision | null {
		const request = this.requests.get(requestId);
		if (!request) return null;
		// The human wins: an answer that arrived before the claim is kept,
		// and the deadline never overrides it.
		if (request.state === "answered" || request.state === "claimed") {
			this.deps.log?.(
				`The approval request ${requestId} was decided already - the deadline does not override it.`,
			);
			return null;
		}
		// A request that was not delivered, or whose deadline passed
		// without an authorization, is not decided by the deadline: nobody
		// was asked, or nobody authorized anything.
		if (request.state !== "pending") return null;
		// The deadline of the request is the only deadline. A request that
		// is not due yet is not decided: the timer is armed again for the
		// time that is left, and the decision waits for the deadline.
		//
		// The window of a delegated question starts with the delivery of the
		// message, so the deadline of the request is later than the deadline
		// of the question that was asked. A countdown that reaches zero
		// first must not decide anything.
		const now = this.deps.now();
		if (now < request.deadlineAt) {
			this.deps.log?.(
				`The approval request ${requestId} is not due yet: the deadline is at ${request.deadlineAt}. The decision waits.`,
			);
			this.armTimer();
			return null;
		}
		// A request that was cancelled, replaced or completed must not be
		// continued by a deadline.
		if (this.deps.active && !this.deps.active(request)) {
			this.deps.log?.(
				`The approval request ${requestId} is not active - the deadline does not continue it.`,
			);
			request.state = "expired";
			return null;
		}
		if (this.deps.paused?.() === true) {
			this.deps.log?.(
				`The approval request ${requestId} is paused - the deadline does not continue it. The decision waits for the work to run again.`,
			);
			// The work is paused: the decision waits. The timer tries
			// again, so a pause does not lose the delegation of the user.
			this.armTimer();
			return null;
		}
		// The scope of the delegation decides: an operation that no
		// delegation covers stays blocked.
		const delegation = this.delegationForRequest(request);
		if (!delegation) {
			// Nobody is authorized. The operation stays blocked, and the
			// human may still answer. No decision is recorded: a deadline
			// without a delegation is not a decision of the user, and a
			// recorded decision would close the question for the human.
			request.state = "expired";
			this.deps.log?.(
				`The deadline of the approval request ${requestId} passed and no delegation covers the operation: the operation stays blocked until the human answers.`,
			);
			return null;
		}
		const outcome: ApprovalOutcome =
			delegation.defaultOutcome === "continue" ? "yes" : "no";
		const decision: ApprovalDecision = {
			requestId,
			outcome,
			source: "delegated-timeout",
			delegationId: delegation.id,
			reason: `the deadline passed under the delegation ${delegation.id}`,
			at: now,
		};
		// The claim is atomic and durable: the decision is handed out once,
		// and a restart does not hand it out again.
		if (!this.deps.decisions.claim(decision)) {
			this.deps.log?.(
				`The decision of the approval request ${requestId} was claimed already.`,
			);
			// The decision was made: the durable record is the truth, and
			// the work must not continue a second time.
			const known = this.deps.decisions.get(requestId);
			if (known) {
				request.state = "claimed";
				request.answer = {
					outcome: known.outcome,
					source: known.source,
					at: known.at,
				};
			}
			return known ?? null;
		}
		request.state = "claimed";
		request.answer = { outcome, source: "delegated-timeout", at: decision.at };
		// The caller settles the request: the question of the request is
		// resolved and the wait of the judge ends before the continuation
		// is queued. A hook that throws must not strand the decision: the
		// continuation is queued anyway.
		try {
			this.deps.onDecided?.(request, decision);
		} catch (error) {
			this.deps.log?.(
				`The harness failed to settle the approval request ${requestId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		if (outcome === "yes") {
			// Exactly one resume: the claim is what guarantees it.
			this.queueResume(request, decision);
		} else {
			this.deps.log?.(
				`The operation of the approval request ${requestId} stays blocked: ${decision.reason}.`,
			);
		}
		return decision;
	}

	/**
	 * The delegation that covers an operation of a workspace.
	 *
	 * The most recent delegation wins: a delegation that was recorded
	 * later replaces the one before it.
	 */
	delegationFor(input: {
		kind: DelegatedOperationKind;
		workspace: string;
	}): Delegation | undefined {
		const now = this.deps.now();
		return this.deps.delegations
			.list(input.workspace)
			.filter((delegation) =>
				delegationCovers(
					delegation,
					input.kind,
					input.workspace,
					now,
				),
			)
			.sort((a, b) => b.recordedAt - a.recordedAt)[0];
	}

	/**
	 * The delegation that covers the operation of a request.
	 */
	private delegationForRequest(request: ApprovalRequest): Delegation | undefined {
		return this.delegationFor({
			kind: request.kind,
			workspace: request.workspace,
		});
	}

	/** Queue the resume of the work. It never throws. */
	private queueResume(
		request: ApprovalRequest,
		decision: ApprovalDecision,
	): void {
		try {
			this.deps.resume(request, decision);
		} catch (error) {
			this.deps.log?.(
				`The resume of the approval request ${request.requestId} failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
}
