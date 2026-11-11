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
	private dispatched = new Map<string, ScopeProposal>();
	/** The proposal of every registered question. */
	private questions = new Map<string, string>();
	/** The question of every proposal. */
	private questionIds = new Map<string, string>();

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
				this.dispatched.set(proposal.id, proposal);
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
		const candidates = request.candidates.slice();
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
		const id = `scope-${request.generation}-${proposedIds[0]}`;
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
		const delivered = await this.controller.deliverProposal(proposal);
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
		const decision = this.controller.answer(proposalId, outcome, reasoning);
		if (!decision) {
			return { started: false, reason: "the proposal has no open answer" };
		}
		return this.controller.applyDecision(proposalId);
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
		const decision = await this.controller.evaluateDue(proposalId);
		if (!decision) return null;
		await this.controller.applyDecision(proposalId);
		return decision;
	}

	/**
	 * The work of the authorized group finished.
	 *
	 * The session stops again: the approval of that group does not authorize
	 * the next group of the backlog.
	 */
	async checkGroupFinished(): Promise<void> {
		for (const proposal of this.dispatched.values()) {
			const ids = proposal.decision?.selectedIds ?? [];
			if (ids.length === 0) continue;
			if (!(await this.deps.groupFinished?.(proposal, ids))) continue;
			this.controller.finishGroup(proposal.id);
			this.clearTimer(proposal.id);
			this.dispatched.delete(proposal.id);
		}
	}

	/** Stop the runtime: no timer survives the session. */
	dispose(): void {
		for (const handle of this.timers.values()) {
			this.deps.clearTimeout?.(handle);
		}
		this.timers.clear();
		this.dispatched.clear();
	}

	private scheduleEvaluation(proposal: ScopeProposal): void {
		const delay = Math.max(0, proposal.deadlineAt - this.deps.now());
		const setTimer = this.deps.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
		const handle = setTimer(() => {
			this.timers.delete(proposal.id);
			return (async () => {
				try {
					await this.evaluateDue(proposal.id);
				} catch (error) {
					this.deps.log?.(
						`The evaluation of the scope proposal ${proposal.id} failed: ${String(error)}`,
					);
				}
			})();
		}, delay);
		this.timers.set(proposal.id, handle);
	}

	private clearTimer(id: string): void {
		const handle = this.timers.get(id);
		if (handle === undefined) return;
		this.deps.clearTimeout?.(handle);
		this.timers.delete(id);
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
