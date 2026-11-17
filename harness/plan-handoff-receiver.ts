/**
 * The receiver of the plans of this instance.
 *
 * The recipient of a plan is the only instance that reads the plan. The
 * receiver of the instance owns the loop that reads the mailbox of the
 * instance, claims every plan that is addressed to it, hands it to the
 * session and acknowledges the delivery.
 *
 * Without this loop a plan that was routed to an instance stays in its
 * mailbox: the routing decided who receives the plan, but nobody read it.
 * The instance that receives the plan is the one that executes it, never
 * the instance that sent it.
 *
 * The receiver never authorises anything: it hands a plan to the session
 * that was chosen, and the session decides what to do with it.
 */

import {
	acknowledgePlan,
	claimPlan,
	receivePlans,
} from "./plan-handoff-bridge.ts";
import type {
	AgentRegistration,
	Mailbox,
	PlanHandoffMessage,
} from "../packages/plan-handoff/dist/index.js";

/**
 * The bridge the receiver uses.
 *
 * The seam keeps the loop testable without a file system: a test replaces
 * the bridge and watches what the loop does.
 */
export interface PlanReceiverBridge {
	/** The plans that are addressed to this instance. */
	receive(options: {
		registration: AgentRegistration;
		now?: () => number;
		mailbox?: Mailbox;
	}): PlanHandoffMessage[];
	/** Claim a plan for this instance. */
	claim(agentId: string, messageId: string, mailbox?: Mailbox): boolean;
	/** Acknowledge the delivery of a plan. */
	acknowledge(agentId: string, messageId: string, mailbox?: Mailbox): boolean;
}

/**
 * The options of the receiver.
 */
export interface PlanReceiverOptions {
	/** The registration of this instance. */
	registration: AgentRegistration;
	/**
	 * Hand a plan to the session of this instance.
	 *
	 * The delivery is awaited: a plan that was not handed over stays
	 * claimed and is delivered again in the next round.
	 */
	deliver: (message: PlanHandoffMessage) => Promise<void> | void;
	/** The interval between two rounds. */
	intervalMs?: number;
	/** The clock. */
	now?: () => number;
	/** The bridge. The real one by default. */
	bridge?: PlanReceiverBridge;
	/**
	 * The mailbox of this instance.
	 *
	 * The mailbox of the agent by default. A test passes its own mailbox
	 * and still exercises the real bridge.
	 */
	mailbox?: Mailbox;
	/**
	 * Should this plan wait instead of being handed over?
	 *
	 * A plan that is held stays pending in the mailbox: it is never
	 * claimed, never delivered and never acknowledged. The human decides
	 * when it is handed over.
	 */
	hold?: (message: PlanHandoffMessage) => boolean;
}

/**
 * The receiver of one instance.
 */
export interface PlanReceiver {
	/** The runtime-generated identity of the instance. */
	readonly agentId: string;
	/** The session of the instance. */
	readonly sessionId: string;
	/** The generation of the instance. */
	readonly generation: number;
	/** Start the loop. */
	start(): void;
	/** Stop the loop. */
	stop(): void;
	/**
	 * Run one round now.
	 *
	 * The number of the plans that were handed over is returned, so a test
	 * and a caller can see what the round did.
	 */
	poll(): Promise<number>;
}

/**
 * The interval between two rounds of the receiver.
 */
export const PLAN_RECEIVER_INTERVAL_MS = 2_000;

/**
 * The bridge of the real store.
 */
const realBridge: PlanReceiverBridge = {
	receive: (options) => receivePlans(options),
	claim: (agentId, messageId, mailbox) =>
		claimPlan(agentId, messageId, mailbox),
	acknowledge: (agentId, messageId, mailbox) =>
		acknowledgePlan(agentId, messageId, mailbox),
};

/**
 * The text that hands a plan to a session.
 *
 * The text says what the plan is and where it lives. It never tells the
 * session to commit, to push or to build: the plan itself carries that
 * decision, and the human owns the rest.
 */
export function planDeliveryText(message: PlanHandoffMessage): string {
	const lines = ["A plan was handed to this session."];
	if (message.plan.summary) {
		lines.push(`Summary: ${message.plan.summary}`);
	}
	if (message.plan.reference) {
		lines.push(
			"",
			`Read and follow the plan at: ${message.plan.reference}`,
			"",
			"Treat that file as the task requirements. Start by summarizing the plan and then carry it out. Do not edit the plan unless the user asks.",
		);
	}
	return lines.join("\n");
}

/**
 * Start the receiver of the plans of this instance.
 *
 * The loop is owned by the session: it starts with the session and stops
 * with it, so a plan never arrives in a session that is gone.
 */
export function startPlanReceiver(
	options: PlanReceiverOptions,
): PlanReceiver {
	const bridge = options.bridge ?? realBridge;
	const now = options.now ?? (() => Date.now());
	const intervalMs = options.intervalMs ?? PLAN_RECEIVER_INTERVAL_MS;
	/**
	 * The plans this instance already handed over.
	 *
	 * A plan that was delivered but whose acknowledgement failed stays in
	 * the mailbox: the next round sees it again and acknowledges it, but it
	 * is never delivered twice.
	 */
	const delivered = new Set<string>();
	let timer: ReturnType<typeof setInterval> | null = null;
	let stopped = false;

	const poll = async (): Promise<number> => {
		if (stopped) return 0;
		let messages: PlanHandoffMessage[];
		try {
			messages = bridge.receive({
				registration: options.registration,
				now,
				mailbox: options.mailbox,
			});
		} catch {
			// The mailbox could not be read: the round is skipped, never a
			// failure of the session.
			return 0;
		}

		let handed = 0;
		for (const message of messages) {
			if (options.hold?.(message)) {
				// The plan waits for the human: it stays pending and is
				// never claimed.
				continue;
			}
			if (delivered.has(message.id)) {
				// The plan was handed over already: the acknowledgement is
				// retried, the plan is not delivered twice.
				try {
					bridge.acknowledge(
						options.registration.agentId,
						message.id,
						options.mailbox,
					);
				} catch {
					continue;
				}
				continue;
			}
			try {
				if (
					!bridge.claim(
						options.registration.agentId,
						message.id,
						options.mailbox,
					)
				) {
					// The plan was delivered by somebody else or cancelled.
					continue;
				}
				await options.deliver(message);
			} catch {
				// The plan stays claimed: the next round hands it over
				// again. A plan that cannot be delivered is never lost.
				continue;
			}
			delivered.add(message.id);
			handed += 1;
			try {
				bridge.acknowledge(
					options.registration.agentId,
					message.id,
					options.mailbox,
				);
			} catch {
				// The acknowledgement failed: the plan stays in the mailbox
				// and is acknowledged in a later round.
			}
		}
		return handed;
	};

	return {
		agentId: options.registration.agentId,
		sessionId: options.registration.sessionId,
		generation: options.registration.generation,
		start: () => {
			if (timer || stopped) return;
			timer = setInterval(() => {
				void poll();
			}, intervalMs);
			if (typeof timer.unref === "function") timer.unref();
		},
		stop: () => {
			stopped = true;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		},
		poll,
	};
}
