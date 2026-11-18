/**
 * The escalation of a refusal of the judge.
 *
 * The judge said "no". That is a recommendation, and the human is asked
 * about it: the question of the judge is closed, so a linked question with
 * a fresh id carries the buttons of the human.
 *
 * The rules of the escalation:
 *
 * - The question of the judge is not reused. Live buttons on a resolved
 *   request are worse than no buttons, so the escalation gets its own id.
 * - The message names the workspace, the task, the exact action, the
 *   reason of the judge and what stays blocked. A human may only answer
 *   what it can see.
 * - The buttons are unambiguous: the human answers "do you approve this
 *   action", not "do you agree with the judge".
 * - The escalation happens once per rejected proposal. A poll or a turn
 *   does not ask again.
 * - When no channel accepts the message, the work stays visibly blocked.
 *   The harness never claims that the human was notified.
 */

import type { NotificationResult } from "../packages/notification/src/types.ts";

/** The context of a refusal of the judge. */
export interface JevRejectionContext {
	/** The request id of the question that the judge closed. */
	originalRequestId: string;
	/** The session of the request. */
	sessionId: string;
	/** The generation of the request. */
	generation: number;
	/** The workspace of the work. */
	workspace: string;
	/** The current task. */
	task?: string;
	/** The exact proposed action. */
	action: string;
	/** The reason of the judge. */
	reason: string;
	/** What stays blocked while the question is open. */
	blocked?: string[];
	/** The work that may continue on its own. */
	independentWork?: string;
	/**
	 * True when the work was already paused before the refusal.
	 *
	 * A pause of the user is not the pause of the refusal: the approval of
	 * the human releases the action, but it does not clear a pause the user
	 * set with a "stop".
	 */
	pausedBefore?: boolean;
	/** The deadline of the answer, in words. */
	deadlineText?: string;
	/**
	 * The authorization of the user for the deadline.
	 *
	 * It is named when the human is told what happens without an answer.
	 */
	delegatedNotice?: string;
}

/** The state of an escalation. */
export interface EscalationState {
	/** The id of the escalation question. */
	questionId: string;
	/** The context of the refusal. */
	context: JevRejectionContext;
	/** The channels that accepted the message. */
	delivered: string[];
	/** The channels that refused the message, with the reason. */
	failures: { channel: string; error: string }[];
	/** The state of the escalation. */
	status: "open" | "answered" | "blocked";
	/** The answer of the human, when there is one. */
	answer?: "yes" | "no";
}

/** The result of an escalation. */
export interface EscalationResult {
	/** The state of the escalation. */
	state: EscalationState;
	/** Did at least one channel accept the message? */
	deliveredAtLeastOne: boolean;
	/** The escalation that was already open, when there was one. */
	reused: boolean;
}

/** The parts of the runtime that the harness provides. */
export interface JevRejectionEscalationDeps {
	/**
	 * Register the escalation question.
	 *
	 * It returns the fresh id of the question: the buttons of the human
	 * are bound to it.
	 */
	registerQuestion(context: JevRejectionContext, text: string): string;
	/**
	 * Deliver the question with the buttons.
	 */
	deliver(
		questionId: string,
		text: string,
	): Promise<Pick<NotificationResult, "success" | "channel" | "error">[]>;
	/**
	 * The human approved the action.
	 *
	 * It is called at most once.
	 */
	onApproved(state: EscalationState): void;
	/**
	 * The human rejected the action.
	 */
	onRejected(state: EscalationState): void;
	/**
	 * How many times the delivery is attempted.
	 *
	 * A channel that refused the message may refuse the next one too, but a
	 * transient failure must not leave the work blocked without a reason.
	 * The default is three attempts.
	 */
	maxDeliveryAttempts?: number;
	/**
	 * The pause between two attempts.
	 *
	 * The default is 250 milliseconds.
	 */
	retryDelayMs?: number;
	/** The log of the runtime. */
	log?(message: string): void;
}

/**
 * The message of the escalation.
 *
 * It names everything the human needs to answer: the workspace, the task,
 * the exact action, the reason of the judge and the consequence of the
 * block.
 */
export function buildJevRejectionMessage(context: JevRejectionContext): string {
	const lines: string[] = [];
	lines.push(`Jev recommends No: ${context.reason}.`);
	lines.push(
		`Workspace: ${context.workspace}.${context.task ? ` Task: ${context.task}.` : ""}`,
	);
	lines.push(`Proposed action: ${context.action}.`);
	const blocked = context.blocked?.length
		? context.blocked.join(", ")
		: "the proposed action";
	lines.push(
		`The ${blocked} stays blocked while you decide${
			context.independentWork
				? `; ${context.independentWork} may continue.`
				: "."
		}`,
	);
	if (context.deadlineText) {
		lines.push(`Answer within ${context.deadlineText}.`);
	}
	if (context.delegatedNotice) {
		lines.push(context.delegatedNotice);
	}
	lines.push("Do you approve this action? [Yes] [No]");
	return lines.join("\n");
}

/**
 * The continuation that carries the approval of the human.
 *
 * The approval releases the block of the action the judge refused, so the
 * agent has to learn about it: a resume alone leaves the session idle and
 * the work blocked. The message names the approved action and the scope
 * that is released.
 *
 * The approval is not a passed validation: the message says that the
 * checks of the repository still run, so the agent does not treat the
 * approval as a licence that skips them.
 */
export function buildJevApprovalContinuation(
	context: JevRejectionContext,
	questionId: string,
): string {
	const lines: string[] = [];
	lines.push(`The human approved the action of ${questionId}.`);
	lines.push(`Approved action: ${context.action}.`);
	const blocked = context.blocked?.filter((entry) => entry.trim() !== "");
	if (blocked?.length) {
		lines.push(`Released scope: ${blocked.join(", ")}.`);
	}
	lines.push(
		"Continue the work of the request. The approval releases the block of this action; it does not replace the checks of the repository, so the validation and the safety checks still run.",
	);
	return lines.join("\n");
}

/**
 * The runtime of the escalation.
 */
export class JevRejectionEscalationRuntime {
	private readonly deps: JevRejectionEscalationDeps;
	/** The escalations, by the request that the judge closed. */
	private readonly byOriginal = new Map<string, EscalationState>();
	/** The escalations, by the id of their question. */
	private readonly byQuestion = new Map<string, EscalationState>();

	constructor(deps: JevRejectionEscalationDeps) {
		this.deps = deps;
	}

	/** The escalation of a question id. */
	forQuestion(questionId: string): EscalationState | undefined {
		return this.byQuestion.get(questionId);
	}

	/** The escalation of the request that the judge closed. */
	forOriginal(originalRequestId: string): EscalationState | undefined {
		return this.byOriginal.get(originalRequestId);
	}

	/**
	 * Ask the human about the refusal of the judge.
	 *
	 * The escalation happens once per refused proposal: a second call for
	 * the same request returns the open escalation without asking again.
	 */
	async escalate(context: JevRejectionContext): Promise<EscalationResult> {
		const existing = this.byOriginal.get(context.originalRequestId);
		if (existing) {
			// The question was already asked for this request. The human is
			// asked once: a second question about the same refusal would be
			// a duplicate, and the buttons of an answered question are
			// stale.
			this.deps.log?.(
				`The escalation of ${context.originalRequestId} was already asked (${existing.status}) - it is not asked again.`,
			);
			return {
				state: existing,
				deliveredAtLeastOne: existing.delivered.length > 0,
				reused: true,
			};
		}
		const text = buildJevRejectionMessage(context);
		const questionId = this.deps.registerQuestion(context, text);
		const state: EscalationState = {
			questionId,
			context,
			delivered: [],
			failures: [],
			status: "open",
		};
		this.byOriginal.set(context.originalRequestId, state);
		this.byQuestion.set(questionId, state);

		const results = await this.deliverWithRetry(questionId, text);
		for (const result of results) {
			if (result.success) {
				state.delivered.push(result.channel);
			} else {
				state.failures.push({
					channel: result.channel,
					error: result.error ?? "the channel refused the message",
				});
			}
		}
		const deliveredAtLeastOne = state.delivered.length > 0;
		if (!deliveredAtLeastOne) {
			// Nobody was asked: the work stays visibly blocked and the
			// harness does not claim that the human was notified.
			state.status = "blocked";
			this.deps.log?.(
				`The escalation of ${context.originalRequestId} was not delivered: ${state.failures
					.map((failure) => failure.channel)
					.join(", ")}. The work stays blocked.`,
			);
		}
		return { state, deliveredAtLeastOne, reused: false };
	}

	/**
	 * Deliver the escalation, with a bounded number of attempts.
	 *
	 * A channel that refused the message may refuse the next one too, but a
	 * transient failure must not leave the work blocked without a reason.
	 * The question is the same one in every attempt: a retry never asks the
	 * human twice, and the buttons of an earlier attempt stay valid.
	 */
	private async deliverWithRetry(
		questionId: string,
		text: string,
	): Promise<Pick<NotificationResult, "success" | "channel" | "error">[]> {
		const maxAttempts = Math.max(1, this.deps.maxDeliveryAttempts ?? 3);
		const delayMs = Math.max(0, this.deps.retryDelayMs ?? 250);
		// The channels of every attempt are collected: a channel that
		// refused the message in the first attempt and is not part of the
		// second one has still refused it, and the report of the failure
		// must name it.
		const channels = new Map<
			string,
			Pick<NotificationResult, "success" | "channel" | "error">
		>();
		let attempt = 1;
		for (;;) {
			const results = await this.attemptDelivery(questionId, text);
			for (const result of results) {
				const known = channels.get(result.channel);
				if (!known || (!known.success && result.success)) {
					channels.set(result.channel, { ...result });
				}
			}
			if (results.some((result) => result.success) || attempt >= maxAttempts) {
				break;
			}
			attempt += 1;
			this.deps.log?.(
				`The escalation ${questionId} was not delivered - the attempt ${attempt} of ${maxAttempts} follows.`,
			);
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
		}
		return [...channels.values()];
	}

	/**
	 * One attempt of the delivery.
	 *
	 * A channel that throws is a failed attempt, not a crash: a throw that
	 * escaped would leave the escalation in the state "open" while nobody
	 * was asked, and the work would wait for a human who never got the
	 * question.
	 */
	private async attemptDelivery(
		questionId: string,
		text: string,
	): Promise<Pick<NotificationResult, "success" | "channel" | "error">[]> {
		try {
			return await this.deps.deliver(questionId, text);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.deps.log?.(
				`The delivery of the escalation ${questionId} failed: ${reason}`,
			);
			return [{ success: false, channel: "notification", error: reason }];
		}
	}

	/**
	 * The answer of the human.
	 *
	 * The first answer wins: a second click and a click of another channel
	 * do nothing.
	 */
	answer(questionId: string, answer: "yes" | "no"): boolean {
		const state = this.byQuestion.get(questionId);
		if (!state) return false;
		// A refusal that nobody received may still be answered: the human
		// saw it in the session, or a channel that reported a failure
		// delivered the message anyway. The row of the blocked refusal is
		// removed by the answer, so the refusal must be answerable.
		if (state.status !== "open" && state.status !== "blocked") {
			this.deps.log?.(
				`The escalation ${questionId} was answered already - the answer is stale.`,
			);
			return false;
		}
		state.status = "answered";
		state.answer = answer;
		// The hook of the harness decides what happens with the work. A
		// hook that throws does not undo the answer - the answer is the
		// fact - but it must not leave the harness in a state where
		// nothing happened and every later click is refused as stale.
		try {
			if (answer === "yes") {
				this.deps.onApproved(state);
			} else {
				this.deps.onRejected(state);
			}
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.deps.log?.(
				`The escalation ${questionId} was answered, but the harness failed to continue the work: ${reason}`,
			);
		}
		return true;
	}
}
