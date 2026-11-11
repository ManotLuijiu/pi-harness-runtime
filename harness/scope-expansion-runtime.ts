/**
 * The runtime of the scope expansion.
 *
 * The controller (`harness/scope-expansion.ts`) owns the state of a
 * proposal. This module owns the moments around it:
 *
 * - the proposal is created and delivered, and the window of the decision
 *   starts with the delivery,
 * - the pending question is registered, so the answer of the human has a
 *   canonical identity,
 * - the deadline fires once and lets Jev decide the exact proposal,
 * - the decision of the human is read again after the delivery and before
 *   the dispatch: a rejection that arrived late still prevents the work,
 * - the authorized group finishes and the session stops again.
 *
 * Everything the runtime needs from the outside is injected, so the
 * behaviour is deterministic in a test.
 */

import {
	MAX_SCOPE_CANDIDATES,
	SCOPE_EXPANSION_WINDOW_MS,
	ScopeExpansionController,
	createScopeProposal,
	scopeProposalMessage,
	type ScopeCandidate,
	type ScopeDecision,
	type ScopeProposal,
} from "./scope-expansion.ts";

/** What a caller wants to propose. */
export interface ScopeProposalRequest {
	/** The identity of the request whose work is finished. */
	requestId: string;
	/** The workspace the work happens in. */
	workspace: string;
	/** The generation of the completion. */
	generation: number;
	/** The candidates of the backlog. */
	candidates: ScopeCandidate[];
	/** What would be done. */
	scope: string;
	/** How the work would be validated. */
	validation: string;
	/** The material risks or costs. */
	risks?: string[];
	/** The choices the human has. */
	choices?: string[];
	/** The ids the proposal names. Defaults to every candidate. */
	proposedIds?: string[];
}

/** The outcome of a human answer. */
export type HumanScopeOutcome = "approve" | "reject";

/** The handle of a timer of the runtime. */
export type ScopeTimerHandle = ReturnType<typeof setTimeout> | number;

export interface ScopeExpansionRuntimeDeps {
	/** The clock of the runtime. */
	now(): number;
	/**
	 * Deliver a message to the channels of the human.
	 *
	 * The result says whether at least one route accepted the message.
	 */
	deliver(
		text: string,
		meta: { id: string; kind: "proposal" | "decision"; questionId?: string },
	): Promise<{ delivered: boolean; failures: string[] }>;
	/** Jev decides the proposal when the human did not answer. */
	judge(proposal: ScopeProposal): Promise<ScopeDecision>;
	/** Start the authorized work. */
	dispatch(proposal: ScopeProposal, ids: string[]): void;
	/**
	 * Register the pending question of a proposal.
	 *
	 * The returned id is the canonical question id: it correlates the
	 * buttons of the notification with the answer of the human.
	 */
	registerQuestion(proposal: ScopeProposal): string | undefined;
	/**
	 * Cancel a question that nobody was told about.
	 *
	 * A question of a proposal that was not delivered must not stay open: an
	 * open question blocks the work of the session.
	 */
	cancelQuestion?(questionId: string): void;
	/**
	 * The latest human decision of a proposal.
	 *
	 * It is read after the delivery of the decision and before the
	 * dispatch, so a rejection that arrived late still prevents the work.
	 */
	latestHumanDecision?(proposal: ScopeProposal): HumanScopeOutcome | undefined;
	/**
	 * Are the authorized issues of the group finished?
	 *
	 * The check is mechanical: the work of the group is done when the
	 * issues of the group are closed.
	 */
	groupFinished?(proposal: ScopeProposal, ids: string[]): boolean | Promise<boolean>;
	/** The timer of the deadline. */
	setTimeout?(callback: () => void | Promise<void>, ms: number): ScopeTimerHandle;
	/** The cancel of the timer. */
	clearTimeout?(handle: ScopeTimerHandle): void;
	/** The log of the runtime. */
	log?(message: string): void;
}

export class ScopeExpansionRuntime {
	private readonly deps: ScopeExpansionRuntimeDeps;
	private readonly controller: ScopeExpansionController;
	private timers = new Map<string, ScopeTimerHandle>();
	/** The proposal of every generation, for the group check. */
	private dispatched = new Map<string, { proposal: ScopeProposal; ids: string[] }>();
	/**
	 * The runtime was disposed.
	 *
	 * A disposed runtime belongs to a session that ended: it decides
	 * nothing, it dispatches nothing and it keeps no timer. Without this
	 * flag a timer of the default clock - the one the wiring uses - would
	 * fire after the session and start work in a session that is gone.
	 */
	private disposed = false;
	/** The proposal of every registered question. */
	private questions = new Map<string, string>();
	/** The question of every proposal. */
	private questionIds = new Map<string, string>();
	/** The number of the proposals of this runtime. */
	private proposalCounter = 0;

	constructor(deps: ScopeExpansionRuntimeDeps) {
		this.deps = deps;
		this.controller = new ScopeExpansionController({
			now: () => deps.now(),
			deliver: (text, meta) =>
				deps.deliver(text, {
					...meta,
					questionId: meta.questionId ?? this.questionIds.get(meta.id),
				}),
			judge: (proposal) => deps.judge(proposal),
			dispatch: (proposal, ids) => {
				// A disposed runtime belongs to a session that ended: it
				// dispatches nothing.
				if (this.disposed) {
					this.deps.log?.(
						`The scope proposal ${proposal.id} is not dispatched: the runtime is disposed.`,
					);
					return;
				}
				// The ids that were dispatched are the ids of the group: the
				// check of the group asks about the work that started, not
				// about the ids a decision named.
				this.dispatched.set(proposal.id, {
					proposal,
					ids: [...ids],
				});
				deps.dispatch(proposal, ids);
			},
			log: (message) => deps.log?.(message),
			latestHumanDecision: (proposal) =>
				deps.latestHumanDecision?.(proposal),
		});
	}

	/** The proposals that wait for an answer. */
	get open(): ScopeProposal[] {
		return this.controller.open;
	}

	/** The proposal with this identity. */
	get(id: string): ScopeProposal | undefined {
		return this.controller.get(id);
	}

	/**
	 * Propose a new scope.
	 *
	 * The proposal is delivered before the window of the decision starts: a
	 * proposal that reaches no route must not start a countdown that nobody
	 * can stop.
	 */
	async propose(request: ScopeProposalRequest): Promise<ScopeProposal | null> {
		if (this.disposed) return null;
		// The candidates are bounded here as well: a proposal that names an
		// id beyond the bound would find no known candidate and would
		// throw where the caller expects nothing to happen.
		const candidates = request.candidates.slice(0, MAX_SCOPE_CANDIDATES);
		if (candidates.length === 0) {
			this.deps.log?.("No scope proposal: the backlog has no candidate.");
			return null;
		}
		const proposedIds =
			request.proposedIds?.filter((id) => candidates.some((c) => c.id === id)) ??
			candidates.map((candidate) => candidate.id);
		if (proposedIds.length === 0) {
			this.deps.log?.("No scope proposal: no candidate is known.");
			return null;
		}
		// The identity of a proposal is unique: two proposals of the same
		// generation with the same first id would answer each other, and the
		// second answer of the human would be dropped.
		const base = `scope-${request.generation}-${proposedIds[0]}`;
		let id = base;
		if (this.controller.get(base)) {
			this.proposalCounter += 1;
			id = `scope-${request.generation}-${this.proposalCounter}-${proposedIds[0]}`;
		}
		const proposal = createScopeProposal({
			id,
			sessionId: "",
			requestId: request.requestId,
			generation: request.generation,
			workspace: request.workspace,
			candidates,
			proposedIds,
			scope: request.scope,
			validation: request.validation,
			risks: request.risks ?? [],
			now: this.deps.now(),
		});
		if (!this.controller.register(proposal)) {
			return null;
		}
		// The question is registered before the delivery: the buttons of the
		// notification carry the canonical question id, and the id exists
		// only when the question does.
		const questionId = this.deps.registerQuestion(proposal);
		if (questionId) {
			this.questions.set(questionId, proposal.id);
			this.questionIds.set(proposal.id, questionId);
		}
		let delivered = false;
		try {
			delivered = await this.controller.deliverProposal(proposal);
		} catch (error) {
			// A delivery that throws is a delivery that happened nowhere: the
			// proposal must not stay registered with an open question.
			this.deps.log?.(
				`The delivery of the scope proposal ${proposal.id} failed: ${String(error)}`,
			);
			delivered = false;
		}
		if (!delivered) {
			// A proposal that reached nobody leaves no open question behind:
			// an open question blocks the work of the session.
			if (questionId) {
				this.deps.cancelQuestion?.(questionId);
				this.questions.delete(questionId);
				this.questionIds.delete(proposal.id);
			}
			return null;
		}
		this.scheduleEvaluation(proposal);
		return proposal;
	}

	/**
	 * The answer of the human.
	 *
	 * The first answer wins, and the answer beats an evaluation that is
	 * still running.
	 */
	async answer(
		proposalId: string,
		outcome: HumanScopeOutcome,
		reasoning: string,
	): Promise<{ started: boolean; reason?: string }> {
		if (this.disposed) {
			return { started: false, reason: "the runtime is disposed" };
		}
		const decision = this.controller.answer(proposalId, outcome, reasoning);
		if (!decision) {
			return { started: false, reason: "the proposal has no open answer" };
		}
		const result = await this.controller.applyDecision(proposalId);
		// The question of a decided proposal is closed: an open question
		// blocks the work of the session.
		this.closeQuestion(proposalId);
		return result;
	}

	/**
	 * The answer of the human, by the identity of the question.
	 *
	 * The channels answer a question, not a proposal: the canonical
	 * question id is what the callback carries.
	 */
	async answerByQuestion(
		questionId: string,
		outcome: HumanScopeOutcome,
		reasoning: string,
	): Promise<{ started: boolean; reason?: string }> {
		if (this.disposed) {
			return { started: false, reason: "the runtime is disposed" };
		}
		const proposalId = this.questions.get(questionId);
		if (!proposalId) {
			return { started: false, reason: "the question belongs to no proposal" };
		}
		return this.answer(proposalId, outcome, reasoning);
	}

	/** The proposal of a canonical question id. */
	proposalForQuestion(questionId: string): ScopeProposal | undefined {
		const proposalId = this.questions.get(questionId);
		if (!proposalId) return undefined;
		return this.controller.get(proposalId);
	}

	/** The canonical question id of a proposal. */
	questionIdFor(proposalId: string): string | undefined {
		return this.questionIds.get(proposalId);
	}

	/**
	 * The evaluation of a proposal whose deadline has passed.
	 *
	 * The evaluation happens once, and the decision is delivered before the
	 * work starts.
	 */
	async evaluateDue(proposalId: string): Promise<ScopeDecision | null> {
		if (this.disposed) return null;
		const decision = await this.controller.evaluateDue(proposalId);
		if (!decision) return null;
		// The controller turns a failed evaluation into a wait: it
		// authorizes nothing, and the decision is still delivered, so the
		// human learns that the window ended without an answer.
		await this.controller.applyDecision(proposalId);
		// The decision that was applied is the decision that counts: the
		// controller may have replaced the decision of the evaluation.
		// The question of a decided proposal is closed: an open question
		// blocks the work of the session.
		this.closeQuestion(proposalId);
		return this.controller.get(proposalId)?.decision ?? decision;
	}

	/**
	 * The work of the authorized group finished.
	 *
	 * The session stops again: the approval of that group does not authorize
	 * the next group of the backlog.
	 */
	async checkGroupFinished(): Promise<void> {
		for (const entry of this.dispatched.values()) {
			const { proposal, ids } = entry;
			if (ids.length === 0) continue;
			if (!(await this.deps.groupFinished?.(proposal, ids))) continue;
			this.controller.finishGroup(proposal.id);
			this.clearTimer(proposal.id);
			this.closeQuestion(proposal.id);
			this.dispatched.delete(proposal.id);
		}
	}

	/**
	 * Stop the runtime: no timer survives the session.
	 *
	 * The timer of the default clock is cancelled with the same clock that
	 * armed it: a runtime that keeps its timer would decide the backlog of
	 * a session that ended, and the decision would start work in a session
	 * that does not exist any more.
	 */
	dispose(): void {
		this.disposed = true;
		for (const handle of this.timers.values()) {
			this.cancelTimer(handle);
		}
		this.timers.clear();
		// A question of a proposal that nobody answered must not stay open:
		// the controller of the questions lives in the process, and an open
		// question of a dead session blocks the next one.
		for (const questionId of this.questions.keys()) {
			this.deps.cancelQuestion?.(questionId);
		}
		this.questions.clear();
		this.questionIds.clear();
		this.dispatched.clear();
	}

	private scheduleEvaluation(proposal: ScopeProposal): void {
		const delay = Math.max(0, proposal.deadlineAt - this.deps.now());
		const handle = this.armTimer(() => {
			this.timers.delete(proposal.id);
			return (async () => {
				if (this.disposed) return;
				try {
					const decision = await this.evaluateDue(proposal.id);
					// A timer that fired before the deadline leaves the window
					// open: the timer is armed again for the rest of it, so
					// the proposal always ends in a decision.
					if (decision === null && !this.disposed) {
						const current = this.controller.get(proposal.id);
						if (current?.state === "proposed") {
							this.scheduleEvaluation(proposal);
						}
					}
				} catch (error) {
					this.deps.log?.(
						`The evaluation of the scope proposal ${proposal.id} failed: ${String(error)}`,
					);
				}
			})();
		}, delay);
		this.timers.set(proposal.id, handle);
	}

	/** Arm a timer on the clock of the runtime, or on the default clock. */
	private armTimer(
		callback: () => void | Promise<void>,
		ms: number,
	): ScopeTimerHandle {
		const setTimer =
			this.deps.setTimeout ??
			((cb: () => void, delay: number) => setTimeout(cb, delay));
		return setTimer(callback, ms);
	}

	/** Cancel a timer on the clock that armed it. */
	private cancelTimer(handle: ScopeTimerHandle): void {
		const clearTimer =
			this.deps.clearTimeout ??
			((h: ScopeTimerHandle) =>
				clearTimeout(h as ReturnType<typeof setTimeout>));
		clearTimer(handle);
	}

	private clearTimer(id: string): void {
		const handle = this.timers.get(id);
		if (handle === undefined) return;
		this.cancelTimer(handle);
		this.timers.delete(id);
	}

	/**
	 * Close the question of a proposal.
	 *
	 * A proposal that reached its end does not keep a question open: an
	 * open question blocks the work of the session.
	 */
	private closeQuestion(proposalId: string): void {
		const questionId = this.questionIds.get(proposalId);
		if (!questionId) return;
		this.deps.cancelQuestion?.(questionId);
		this.questions.delete(questionId);
		this.questionIds.delete(proposalId);
	}

	/**
	 * The message of a proposal, for the caller that delivers it itself.
	 */
	message(proposal: ScopeProposal): string {
		return scopeProposalMessage(proposal);
	}
}

/**
 * The window of a decision, in milliseconds.
 *
 * The runtime uses the same constant as the controller: one source of the
 * five minutes.
 */
export const SCOPE_WINDOW_MS = SCOPE_EXPANSION_WINDOW_MS;
