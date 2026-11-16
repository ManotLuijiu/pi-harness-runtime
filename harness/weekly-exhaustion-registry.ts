/**
 * The decision of the human about an empty weekly allowance.
 *
 * The weekly allowance of a provider blocks the work until the human
 * decides what happens. There are two choices:
 *
 * - the harness counts down to the reset of the week and continues then,
 * - the human deals with the account itself.
 *
 * The decision belongs to the human alone. The judge is never asked, and
 * there is no timeout that decides: a silence keeps the work paused. The
 * registry therefore holds the decision, the delivery of the message and
 * the identity of the answer - and it holds the first answer, because a
 * second click on an old button must not change a decision that was made.
 */

/** The choices of the human. */
export type WeeklyDecision = "countdown" | "manual";

/** The channel a decision came from. */
export type WeeklyDecisionChannel = "telegram" | "line";

/**
 * One exhausted weekly allowance.
 */
export interface WeeklyExhaustionRecord {
	/** The canonical id of the decision. */
	requestId: string;
	/** The provider whose weekly allowance is empty. */
	provider: string;
	/** The absolute epoch of the weekly reset. */
	resetAt: number;
	/** When the decision was requested. */
	createdAt: number;
	/** Did the message reach the user? */
	delivered: boolean;
	/** The choice of the human. */
	decision?: WeeklyDecision;
	/** When the human decided. */
	decidedAt?: number;
	/** The channel the decision came from. */
	channel?: WeeklyDecisionChannel;
}

/**
 * The result of a claim of the registry.
 *
 * The shape is flat on purpose: the harness compiles the strict and the
 * lenient variant of TypeScript, and the narrowing of a discriminated
 * union is not available in both of them.
 */
export interface WeeklyClaimResult {
	/** Did the human take the decision? */
	ok: boolean;
	/** The decision that was taken. */
	record?: WeeklyExhaustionRecord;
	/** Why the decision was refused. */
	reason?: string;
}

/**
 * The registry of the weekly decisions.
 *
 * One entry per exhausted weekly allowance. The entry is registered
 * before the message is delivered, so that a click that arrives before
 * the delivery is acknowledged still finds its decision; and it is
 * removed when the delivery fails, because a decision nobody can reach
 * would wait for an answer that never comes.
 */
export class WeeklyExhaustionRegistry {
	private readonly records = new Map<string, WeeklyExhaustionRecord>();

	/**
	 * Register the decision of an exhausted weekly allowance.
	 *
	 * A decision that is already registered is kept: the second
	 * registration of the same exhaustion is the same decision.
	 */
	register(params: {
		requestId: string;
		provider: string;
		resetAt: number;
		now: number;
	}): WeeklyExhaustionRecord {
		const existing = this.records.get(params.requestId);
		if (existing) return existing;
		const record: WeeklyExhaustionRecord = {
			requestId: params.requestId,
			provider: params.provider,
			resetAt: params.resetAt,
			createdAt: params.now,
			delivered: false,
		};
		this.records.set(params.requestId, record);
		return record;
	}

	/** The decision of an id. */
	get(requestId: string): WeeklyExhaustionRecord | undefined {
		return this.records.get(requestId);
	}

	/** Every decision that waits for an answer. */
	get pending(): WeeklyExhaustionRecord[] {
		return [...this.records.values()].filter(
			(record) => record.decision === undefined,
		);
	}

	/** Did the message of the decision reach the user? */
	markDelivered(requestId: string): boolean {
		const record = this.records.get(requestId);
		if (!record) return false;
		record.delivered = true;
		return true;
	}

	/**
	 * Take the decision of the human.
	 *
	 * The first answer wins: a second answer for the same decision is
	 * stale, and the reason says so. An answer for a decision that does
	 * not exist is stale as well - the button is older than the session.
	 */
	claim(
		requestId: string,
		decision: WeeklyDecision,
		channel: WeeklyDecisionChannel,
		now: number,
	): WeeklyClaimResult {
		const record = this.records.get(requestId);
		if (!record) {
			return { ok: false, reason: "the decision does not exist any more" };
		}
		if (record.decision !== undefined) {
			return {
				ok: false,
				reason: `the decision was already made (${record.decision})`,
			};
		}
		record.decision = decision;
		record.decidedAt = now;
		record.channel = channel;
		return { ok: true, record };
	}

	/** Remove a decision. */
	remove(requestId: string): boolean {
		return this.records.delete(requestId);
	}

	/** Remove every decision. */
	clear(): void {
		this.records.clear();
	}
}

/**
 * The canonical id of a weekly decision.
 *
 * The id travels through the callback data of a button, and that data is
 * split on the underscore: an id with an underscore would be cut in two.
 * The id therefore holds no underscore, and it is short enough for the
 * postback data of LINE.
 */
export function buildWeeklyRequestId(
	provider: string,
	resetAt: number,
): string {
	const key = `${provider.toLowerCase()}:${resetAt}`;
	let hash = 2166136261;
	for (let i = 0; i < key.length; i += 1) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	const hex = (hash >>> 0).toString(16).padStart(8, "0");
	return `week-${provider.toLowerCase()}-${hex}`;
}
