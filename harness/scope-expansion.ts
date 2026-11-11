/**
 * The proposal of a new scope.
 *
 * The work of a request is finite. When it is finished, the session may
 * still find work in a backlog - a bd issue that nobody asked for. That
 * work is not work of the request, and it does not become work because it
 * was discovered.
 *
 * A proposal is the only way to reach it: a bounded, concrete question with
 * exact issue IDs, a deadline, and a decision that belongs to a human or to
 * Jev under an explicit policy. Silence is not an approval of the
 * backlog, and an approval of one group is not an approval of the next
 * one.
 *
 * The state machine lives here and not in the judge: the mechanical
 * questions - is the proposal still open, is the answer a subset of the
 * proposal, was the decision delivered - are decided in code.
 */

/** How long the human has to answer before Jev may decide the proposal. */
export const SCOPE_EXPANSION_WINDOW_MS = 5 * 60_000;

/** How many candidates a proposal may name at most. */
export const MAX_SCOPE_CANDIDATES = 10;

/** The state of a proposal. */
export type ScopeProposalState =
	/** The proposal waits for the human or for the deadline. */
	| "proposed"
	/** The proposal was decided and the decision was delivered. */
	| "decided"
	/** The authorized work was started. */
	| "dispatched"
	/** The authorized work finished; the session stops again. */
	| "finished"
	/** The proposal was not executed; the reason is known. */
	| "stopped";

/** One backlog candidate. */
export interface ScopeCandidate {
	/** The exact id of the issue. */
	id: string;
	/** The title of the issue. */
	title: string;
}

/** The decision about a proposal. */
export interface ScopeDecision {
	/** The outcome of the decision. */
	outcome: "approve" | "reject" | "wait";
	/** The exact ids that are authorized. */
	selectedIds: string[];
	/** Why the decision was made. */
	reasoning: string;
	/** Who decided. */
	source: "human" | "jev";
	/** The evaluation failed: a failure is not a decision. */
	failed?: boolean;
}

/** A concrete proposal of a new scope. */
export interface ScopeProposal {
	/** The identity of the proposal. */
	id: string;
	/** The session the proposal belongs to. */
	sessionId: string;
	/** The request whose work is finished. */
	requestId: string;
	/** The completion generation the proposal belongs to. */
	generation: number;
	/** The workspace the work happens in. */
	workspace: string;
	/** The candidates the proposal may name. */
	candidates: ScopeCandidate[];
	/** The exact subset the proposal asks for. */
	proposedIds: string[];
	/** What would be done. */
	scope: string;
	/** How the work would be validated. */
	validation: string;
	/** The material risks or costs. */
	risks: string[];
	/** The choices the human has. */
	choices: string[];
	/** The moment the proposal was created. */
	createdAt: number;
	/** The absolute moment the decision has to be made. */
	deadlineAt: number;
	/** Where the proposal stands. */
	state: ScopeProposalState;
	/** The decision, when there is one. */
	decision?: ScopeDecision;
	/** The reason the proposal was not executed. */
	stopReason?: string;
}

export interface CreateScopeProposalInput {
	id: string;
	sessionId: string;
	requestId: string;
	generation: number;
	workspace: string;
	candidates: ScopeCandidate[];
	proposedIds: string[];
	scope: string;
	validation: string;
	risks?: string[];
	/** The choices the human has. */
	choices?: string[];
	now: number;
}

/**
 * Create a proposal.
 *
 * The proposal names a bounded subset of the candidates: a candidate that
 * is not named is not proposed, and an id that is not a candidate is
 * refused. The bound applies to the proposed ids, and an id is checked
 * against the whole list of the candidates: a bound that drops a known id
 * would refuse a proposal of ids that the caller knew.
 *
 * The deadline is absolute, so every reader measures the same moment.
 */
export function createScopeProposal(input: CreateScopeProposalInput): ScopeProposal {
	const known = new Set(input.candidates.map((candidate) => candidate.id));
	const proposedIds = input.proposedIds
		.filter((id) => known.has(id))
		.slice(0, MAX_SCOPE_CANDIDATES);
	if (proposedIds.length === 0) {
		throw new Error("a scope proposal needs at least one candidate id");
	}
	const proposed = new Set(proposedIds);
	const candidates = input.candidates.filter((candidate) => proposed.has(candidate.id));
	return {
		id: input.id,
		sessionId: input.sessionId,
		requestId: input.requestId,
		generation: input.generation,
		workspace: input.workspace,
		candidates,
		proposedIds,
		scope: input.scope,
		validation: input.validation,
		risks: input.risks ?? [],
		choices:
			input.choices && input.choices.length > 0
				? input.choices
				: ["approve the proposed subset", "decline", "revise the proposal"],
		createdAt: input.now,
		deadlineAt: input.now + SCOPE_EXPANSION_WINDOW_MS,
		state: "proposed",
	};
}

/**
 * The message of the proposal.
 *
 * The message names the exact ids, the deadline, and the fact that the
 * silence of the human lets Jev decide the proposal - it does not let the
 * backlog be worked on.
 */
export function scopeProposalMessage(proposal: ScopeProposal): string {
	const ids = proposal.proposedIds.join(", ");
	const lines = [
		`The requested work is complete. I found additional bd issues outside it.`,
		`Proposal: work on ${ids} in ${proposal.workspace}.`,
		`Scope: ${proposal.scope}`,
		`Validation: ${proposal.validation}`,
	];
	if (proposal.risks.length > 0) {
		lines.push(`Risks/costs: ${proposal.risks.join("; ")}`);
	}
	lines.push(
		`Choices: ${proposal.choices.join(" / ")}.`,
		`Deadline: ${new Date(proposal.deadlineAt).toISOString()}.`,
		`If unanswered for ${Math.round(SCOPE_EXPANSION_WINDOW_MS / 60_000)} minutes, Jev may decide this proposal under your policy.`,
	);
	return lines.join("\n");
}

/**
 * The message of the decision.
 *
 * The decision names the proposal, what was decided, the scope that is
 * really authorized, and whether the work starts or the session stays
 * stopped.
 */
export function scopeDecisionMessage(
	proposal: ScopeProposal,
	decision: ScopeDecision,
	action: "starting the selected work" | "remaining stopped",
	authorizedIds?: readonly string[],
): string {
	const who = decision.source === "jev" ? "Jev decision after the window" : "Your decision";
	const ids = authorizedIds ?? decision.selectedIds;
	return [
		`${who}: ${decision.outcome}.`,
		`Proposal: ${proposal.id}.`,
		`Scope: ${ids.length > 0 ? ids.join(", ") : "none"}.`,
		`Reason: ${decision.reasoning}`,
		`Action: ${action}.`,
		`Proposed: ${proposal.scope}`,
	].join("\n");
}

/**
 * The ids of a decision that the proposal allows.
 *
 * A decision may only name ids of the proposal, and the work may only
 * happen in the workspace of the proposal. Everything else is refused: a
 * decision that names an issue nobody proposed does not authorize work.
 */
export function authorizedScope(
	proposal: ScopeProposal,
	decision: ScopeDecision,
): { ids: string[]; reason?: string } {
	if (decision.outcome !== "approve") {
		return { ids: [], reason: "the decision does not approve the proposal" };
	}
	const allowed = new Set(proposal.proposedIds);
	const ids = decision.selectedIds.filter((id) => allowed.has(id));
	if (ids.length === 0) {
		return { ids: [], reason: "the decision names no id of the proposal" };
	}
	return { ids };
}

/** The dependencies of the controller. */
export interface ScopeExpansionDeps {
	/** The clock of the controller. */
	now(): number;
	/**
	 * Deliver a message to the channels of the human.
	 *
	 * The result says whether at least one route accepted the message. An
	 * acknowledgement is a submission, not a reading.
	 */
	deliver(
		text: string,
		meta: { id: string; kind: "proposal" | "decision"; questionId?: string },
	): Promise<{
		delivered: boolean;
		failures: string[];
	}>;
	/** Jev decides the proposal. */
	judge(proposal: ScopeProposal): Promise<ScopeDecision>;
	/** Start the authorized work. */
	dispatch(proposal: ScopeProposal, ids: string[]): void;
	/**
	 * The latest human decision of a proposal.
	 *
	 * It is read after the delivery of the decision and before the
	 * dispatch: a rejection that arrived while the decision was on its way
	 * still prevents the work.
	 */
	latestHumanDecision?(proposal: ScopeProposal): "approve" | "reject" | undefined;
	/** The log of the controller. */
	log?(message: string): void;
}

/**
 * The controller of the scope proposals.
 *
 * One proposal per completion generation: a second proposal needs the
 * human. The human always wins over an evaluation that is still running,
 * and a decision that was not delivered does not start work.
 */
export class ScopeExpansionController {
	private readonly deps: ScopeExpansionDeps;
	private proposals = new Map<string, ScopeProposal>();
	private generationCounter = 0;
	private answered = new Set<string>();
	private evaluated = new Set<string>();
	/** The proposals whose decision is being applied right now. */
	private applying = new Set<string>();
	/**
	 * The generations that are closed.
	 *
	 * Every closed generation is remembered: the approval of one group is
	 * not the approval of the next one, and that holds for every group
	 * that finished, not only for the last one.
	 */
	private closedGenerations = new Set<number>();

	constructor(deps: ScopeExpansionDeps) {
		this.deps = deps;
	}

	/** The proposals of the controller. */
	get open(): ScopeProposal[] {
		return [...this.proposals.values()].filter(
			(proposal) => proposal.state === "proposed",
		);
	}

	/** The proposal with this identity. */
	get(id: string): ScopeProposal | undefined {
		return this.proposals.get(id);
	}

	/** The generation of the next proposal. */
	nextGeneration(): number {
		this.generationCounter += 1;
		return this.generationCounter;
	}

	/**
	 * Register a proposal.
	 *
	 * A generation that is closed does not get a second proposal: the
	 * approval of one group is not the approval of the next one.
	 */
	register(proposal: ScopeProposal): boolean {
		if (this.closedGenerations.has(proposal.generation)) {
			this.deps.log?.(
				`The scope proposal ${proposal.id} is refused: the generation ${proposal.generation} is closed.`,
			);
			return false;
		}
		const existing = [...this.proposals.values()].find(
			(candidate) =>
				candidate.generation === proposal.generation &&
				candidate.state === "proposed",
		);
		if (existing) {
			this.deps.log?.(
				`The scope proposal ${proposal.id} is refused: the generation ${proposal.generation} already has the proposal ${existing.id}.`,
			);
			return false;
		}
		this.proposals.set(proposal.id, proposal);
		return true;
	}

	/**
	 * Apply the answer of the human.
	 *
	 * The answer wins over an evaluation that is still running: the
	 * evaluation of a proposal that was answered is discarded.
	 *
	 * The first answer wins. A second answer - a stale button of a
	 * notification that was already delivered - does not replace the
	 * decision of the human.
	 */
	answer(id: string, outcome: ScopeDecision["outcome"], reasoning: string): ScopeDecision | null {
		const proposal = this.proposals.get(id);
		if (!proposal) return null;
		if (proposal.state !== "proposed") return null;
		if (this.answered.has(id)) return null;
		this.answered.add(id);
		const decision: ScopeDecision = {
			outcome,
			selectedIds: outcome === "approve" ? [...proposal.proposedIds] : [],
			reasoning,
			source: "human",
		};
		proposal.decision = decision;
		return decision;
	}

	/**
	 * Evaluate the proposal, when the deadline has passed.
	 *
	 * The evaluation happens once. A wait, a failure or a rejection ends
	 * the automatic attempts for this proposal: the countdown is not
	 * restarted.
	 */
	async evaluateDue(id: string): Promise<ScopeDecision | null> {
		const proposal = this.proposals.get(id);
		if (!proposal) return null;
		if (proposal.state !== "proposed") return null;
		if (this.answered.has(id)) return null;
		if (this.evaluated.has(id)) return null;
		if (this.deps.now() < proposal.deadlineAt) return null;
		this.evaluated.add(id);
		let decision: ScopeDecision;
		try {
			decision = await this.deps.judge(proposal);
		} catch (error) {
			decision = {
				outcome: "wait",
				selectedIds: [],
				reasoning: `the evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
				source: "jev",
				failed: true,
			};
		}
		// A failed evaluation is not a decision: it authorizes nothing, and
		// it is a wait that ends the attempts for this proposal.
		if (decision.failed === true) {
			decision = {
				outcome: "wait",
				selectedIds: [],
				reasoning:
					decision.reasoning.length > 0
						? decision.reasoning
						: "the evaluation failed",
				source: "jev",
				failed: true,
			};
		}
		// The human answered while the evaluation was running: the answer
		// wins.
		if (this.answered.has(id)) {
			this.deps.log?.(
				`The evaluation of the proposal ${id} is discarded: the human answered meanwhile.`,
			);
			return null;
		}
		proposal.decision = decision;
		return decision;
	}

	/**
	 * Notify the decision and start the authorized work.
	 *
	 * The decision is delivered before the work starts. A delivery that
	 * reaches no route leaves the work stopped: the session may not claim
	 * that the human was informed and start anyway.
	 */
	async applyDecision(id: string): Promise<{ started: boolean; reason?: string }> {
		// The decision of a proposal is applied once. The answer of the
		// human that arrives while the decision is on its way starts a
		// second application of the same proposal, and the group must not
		// start twice.
		if (this.applying.has(id)) {
			return {
				started: false,
				reason: "the decision of the proposal is being applied",
			};
		}
		this.applying.add(id);
		try {
			return await this.applyDecisionOnce(id);
		} finally {
			this.applying.delete(id);
		}
	}

	/**
	 * Apply the decision of a proposal.
	 *
	 * The decision is applied once: the caller holds the lock.
	 */
	private async applyDecisionOnce(
		id: string,
	): Promise<{ started: boolean; reason?: string }> {
		const proposal = this.proposals.get(id);
		if (!proposal) return { started: false, reason: "unknown proposal" };
		const decision = proposal.decision;
		if (!decision) return { started: false, reason: "the proposal has no decision" };
		if (proposal.state === "dispatched" || proposal.state === "finished") {
			return { started: false, reason: "the proposal was already executed" };
		}
		// The human decides. The answer is read before the delivery, so the
		// delivered message and the executed work agree.
		let effective = decision;
		const recorded = this.humanDecision(proposal);
		const latestBefore = this.deps.latestHumanDecision?.(proposal);
		if (recorded) {
			// The first answer of the human wins: the answer that the
			// controller recorded is stronger than a store that reports the
			// last click.
			effective = recorded;
		} else if (latestBefore === "reject") {
			effective = {
				outcome: "reject",
				selectedIds: [],
				reasoning: "the human rejected the proposal",
				source: "human",
			};
			proposal.decision = effective;
		} else if (latestBefore === "approve" && decision.source !== "human") {
			effective = {
				...decision,
				outcome: "approve",
				selectedIds: [...proposal.proposedIds],
				source: "human",
			};
			proposal.decision = effective;
		}
		const scope = authorizedScope(proposal, effective);
		const action: "starting the selected work" | "remaining stopped" =
			scope.ids.length > 0 ? "starting the selected work" : "remaining stopped";
		const delivery = await this.deps.deliver(
			scopeDecisionMessage(proposal, effective, action, scope.ids),
			{
				id: proposal.id,
				kind: "decision",
			},
		);
		if (!delivery.delivered) {
			proposal.state = "stopped";
			proposal.stopReason = `the decision was not delivered: ${delivery.failures.join(", ")}`;
			this.deps.log?.(`The scope proposal ${proposal.id} stays unexecuted: ${proposal.stopReason}`);
			return { started: false, reason: proposal.stopReason };
		}
		proposal.state = "decided";
		// The answer is read again after the delivery: a rejection that
		// arrived while the decision was on its way still prevents the work,
		// and the answer of the controller is stronger than the store.
		const after = this.humanDecision(proposal);
		const latestAfter = this.deps.latestHumanDecision?.(proposal);
		let finalDecision = effective;
		if (after) {
			finalDecision = after;
		} else if (latestAfter === "reject") {
			finalDecision = {
				outcome: "reject",
				selectedIds: [],
				reasoning: "the human rejected the proposal",
				source: "human",
			};
		} else if (latestAfter === "approve" && effective.source !== "human") {
			finalDecision = {
				...effective,
				outcome: "approve",
				selectedIds: [...proposal.proposedIds],
				source: "human",
			};
		}
		if (finalDecision.outcome === "reject" && effective.outcome !== "reject") {
			proposal.state = "stopped";
			proposal.stopReason =
				"the human rejected the proposal after the decision was delivered";
			// The delivered message said something else: the human has to
			// know that the work stays stopped. A correction that reaches
			// nobody does not change the outcome: the work stays stopped
			// either way.
			const correction = await this.deps.deliver(
				scopeDecisionMessage(proposal, finalDecision, "remaining stopped", []),
				{ id: proposal.id, kind: "decision" },
			);
			if (!correction.delivered) {
				proposal.stopReason = `${proposal.stopReason}; the correction was not delivered: ${correction.failures.join(", ")}`;
			}
			this.deps.log?.(
				`The scope proposal ${proposal.id} stays unexecuted: ${proposal.stopReason}`,
			);
			return { started: false, reason: proposal.stopReason };
		}
		let finalScope = authorizedScope(proposal, finalDecision);
		if (finalDecision !== effective) {
			proposal.decision = finalDecision;
			// The delivered message said something else: the human has to
			// know what starts. A correction that reaches nobody leaves
			// the work stopped.
			const correction = await this.deps.deliver(
				scopeDecisionMessage(
					proposal,
					finalDecision,
					finalScope.ids.length > 0 ? "starting the selected work" : "remaining stopped",
					finalScope.ids,
				),
				{ id: proposal.id, kind: "decision" },
			);
			if (!correction.delivered) {
				proposal.state = "stopped";
				proposal.stopReason = `the correction was not delivered: ${correction.failures.join(", ")}`;
				this.deps.log?.(
					`The scope proposal ${proposal.id} stays unexecuted: ${proposal.stopReason}`,
				);
				return { started: false, reason: proposal.stopReason };
			}
		}
		if (finalScope.ids.length === 0) {
			proposal.state = "stopped";
			proposal.stopReason =
				finalDecision.outcome === "reject"
					? finalDecision.reasoning
					: (finalScope.reason ?? "the decision authorizes no work");
			return { started: false, reason: proposal.stopReason };
		}
		this.deps.dispatch(proposal, finalScope.ids);
		proposal.state = "dispatched";
		return { started: true };
	}

	/**
	 * The answer of the human, when the controller recorded one.
	 *
	 * The first answer wins: a second answer - a stale button of a
	 * notification that was already delivered - does not replace it.
	 */
	private humanDecision(proposal: ScopeProposal): ScopeDecision | undefined {
		if (!this.answered.has(proposal.id)) return undefined;
		const decision = proposal.decision;
		if (!decision || decision.source !== "human") return undefined;
		return decision;
	}

	/**
	 * The authorized group finished.
	 *
	 * The session stops again. The approval of that group does not authorize
	 * the next group of the backlog.
	 */
	finishGroup(id: string): void {
		const proposal = this.proposals.get(id);
		if (!proposal) return;
		proposal.state = "finished";
		this.closedGenerations.add(proposal.generation);
		this.deps.log?.(
			`The scope proposal ${proposal.id} is finished: the session stops again.`,
		);
	}

	/**
	 * Deliver the proposal to the human.
	 *
	 * The window of the decision starts with the delivery: a proposal that
	 * reaches no route does not start a countdown that nobody can stop.
	 */
	async deliverProposal(proposal: ScopeProposal): Promise<boolean> {
		const delivery = await this.deps.deliver(scopeProposalMessage(proposal), {
			id: proposal.id,
			kind: "proposal",
		});
		if (!delivery.delivered) {
			proposal.state = "stopped";
			proposal.stopReason = `the proposal was not delivered: ${delivery.failures.join(", ")}`;
			this.deps.log?.(`The scope proposal ${proposal.id} stays unexecuted: ${proposal.stopReason}`);
			return false;
		}
		return true;
	}
}
