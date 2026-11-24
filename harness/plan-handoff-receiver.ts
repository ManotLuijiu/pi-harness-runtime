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
 * The shared lease of a handoff.
 *
 * The path of the store and the path of the live plan lease the same
 * handoff, so the work of one handoff runs once: the lease is taken
 * before the plan is claimed, and it is held while the work runs.
 */
export interface PlanReceiverLease {
	/**
	 * Take the lease of the handoff of the plan.
	 *
	 * The lease is refused when the other path already runs the handoff:
	 * the plan then waits in the mailbox, unclaimed and undelivered.
	 */
	claim: (message: PlanHandoffMessage) => boolean;
	/**
	 * Give the lease of the handoff back.
	 *
	 * The lease is given back when the plan was not handed over: nobody
	 * runs the work, so the other path may run it.
	 */
	release: (message: PlanHandoffMessage) => void;
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
	 * claimed. A rejected delivery is tried again in the next round; a
	 * delivery that only timed out stays in flight, because the attempt
	 * may still arrive.
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
	/**
	 * Should this plan wait for the session to be free?
	 *
	 * A plan that is deferred stays pending in the mailbox: it is never
	 * claimed, never delivered and never acknowledged. The session of a
	 * busy agent is not the place for the plan of another request, and a
	 * paused session does not act on it at all.
	 */
	defer?: (message: PlanHandoffMessage) => boolean;
	/**
	 * How long the delivery of a plan may take.
	 *
	 * A delivery that never settles would keep the round and the mailbox
	 * of this session blocked for the rest of the process.
	 */
	deliveryTimeoutMs?: number;
	/**
	 * How long a delivery that never settles may hold its plan.
	 *
	 * The plan is never handed over a second time, so the bound is the
	 * age after which the receiver reports the delivery as stuck. The
	 * bound is far above the timeout of the delivery: a delivery that
	 * only timed out is still running and may still reach the session.
	 */
	stuckDeliveryAfterMs?: number;
	/**
	 * The log of the receiver.
	 */
	log?: (message: string) => void;
	/**
	 * The shared lease of the handoffs.
	 *
	 * The lease is taken before the plan is claimed: a plan whose handoff
	 * is leased by the other path waits in the mailbox. The lease is held
	 * while the work runs, and it is given back when the plan was not
	 * handed over.
	 */
	lease?: PlanReceiverLease;
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
 * How long the delivery of a plan may take.
 *
 * A delivery that never settles must not keep the mailbox of the session
 * blocked. The plan stays in flight while its attempt may still arrive,
 * and the next round waits for that attempt instead of handing the plan
 * over a second time.
 */
export const PLAN_DELIVERY_TIMEOUT_MS = 30_000;

/**
 * How long a delivery that never settles may hold its plan.
 *
 * The bound is far above the timeout of the delivery: a delivery that
 * only timed out is still in flight, and it is never handed over a second
 * time. A delivery that hangs for this long is reported as stuck, and the
 * plan waits for it: the plan may still arrive, so it is never delivered
 * twice.
 */
export const PLAN_STUCK_DELIVERY_AFTER_MS = 5 * PLAN_DELIVERY_TIMEOUT_MS;

/**
 * Wait for a promise, but not longer than a bound.
 *
 * The timer is released, so a delivery that settles in time does not leave
 * a timer behind.
 */
async function withTimeout<T>(
	promise: Promise<T> | T,
	timeoutMs: number,
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return Promise.resolve(promise);
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const race = Promise.race([
		Promise.resolve(promise),
		new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(new Error(`the delivery did not settle in ${timeoutMs}ms`));
			}, timeoutMs);
			if (typeof timer.unref === "function") timer.unref();
		}),
	]);
	try {
		return await race;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

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
 *
 * The action of the message decides what the session is asked to do. A
 * plan that is handed over for information is not a task, and a plan that
 * is handed over for a review is not an order to implement it.
 */
export function planDeliveryText(message: PlanHandoffMessage): string {
	const lines = ["A plan was handed to this session."];
	if (message.plan.summary) {
		lines.push(`Summary: ${message.plan.summary}`);
	}
	if (message.plan.reference) {
		lines.push("", `Read the plan at: ${message.plan.reference}`, "");
	} else if (message.plan.payload) {
		// The plan travels with the message: the session gets the plan
		// itself and not a path to it. A plan that is only a path would
		// arrive without its content.
		lines.push("", "The plan:", message.plan.payload, "");
	}
	switch (message.action) {
		case "review":
			lines.push(
				"Treat that plan as the requirements of a review. Read it, then report what it asks for and what is missing. Do not implement it.",
			);
			break;
		case "implement":
			lines.push(
				"Treat that plan as the task requirements. Start by summarizing the plan and then carry it out. Do not edit the plan unless the user asks.",
			);
			break;
		default:
			lines.push(
				"That plan is for your information. Read it so you know what the other session is working on. Do not carry it out: the human decides what happens next.",
			);
			break;
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
	/**
	 * The plans that are on their way to the session right now.
	 *
	 * A plan that is claimed and awaited must not be handed over by a
	 * second round: the round that is running owns the plan until the
	 * delivery is over.
	 *
	 * The memory belongs to this instance: a receiver that is started
	 * again has an empty set, so the guarantee is per receiver instance.
	 * The value is the time the attempt started, so a delivery that never
	 * settles can be reported as stuck.
	 */
	const inFlight = new Map<string, number>();
	/**
	 * The plans whose stuck delivery was already reported.
	 *
	 * The report happens once per plan, so a plan that waits for a
	 * delivery that never settles does not fill the log of the session
	 * with the same line every round.
	 */
	const stuckReported = new Set<string>();
	/**
	 * The number of the handovers of this instance.
	 *
	 * A delivery that settles after the round moved on is still a
	 * handover, and it has to be reported by a round: the counter belongs
	 * to the receiver, not to the round that started the attempt.
	 */
	let handoverCount = 0;
	/**
	 * The number of the handovers that a round already reported.
	 */
	let reportedHandoverCount = 0;
	/**
	 * True while a round is running.
	 *
	 * One round at a time: two overlapping rounds would both see a claimed
	 * plan, and both would hand it over.
	 */
	let polling = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let stopped = false;

	/**
	 * Take the lease of the handoff of a plan.
	 *
	 * The lease is taken before the plan is claimed: a plan whose handoff
	 * runs in the other path waits in the mailbox, unclaimed and
	 * undelivered.
	 */
	const takeLease = (message: PlanHandoffMessage): boolean => {
		if (!options.lease) return true;
		try {
			return options.lease.claim(message) === true;
		} catch {
			return false;
		}
	};

	/**
	 * Give the lease of the handoff of a plan back.
	 *
	 * The lease runs out on its own, so a failure to give it back is not
	 * a failure of the round.
	 */
	const dropLease = (message: PlanHandoffMessage): void => {
		if (!options.lease) return;
		try {
			options.lease.release(message);
		} catch {
			// The lease of the handoff stays until it runs out.
		}
	};

	const poll = async (): Promise<number> => {
		if (stopped) return 0;
		if (polling) {
			// A round is running: this one does nothing. The running round
			// owns the plans it found.
			return 0;
		}
		polling = true;
		try {
			await runRound();
		} finally {
			polling = false;
		}
		// The handovers of this window. A delivery that settled after its
		// round moved on is a handover too, and it is reported here: the
		// counter belongs to the receiver, not to the round that started
		// the attempt.
		const handed = handoverCount - reportedHandoverCount;
		reportedHandoverCount = handoverCount;
		return handed;
	};

	const runRound = async (): Promise<void> => {
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
			return;
		}

		for (const message of messages) {
			if (delivered.has(message.id)) {
				// The plan was handed over already: the acknowledgement is
				// retried, the plan is not delivered twice. A plan that
				// waits for its acknowledgement does not need a free
				// session: the acknowledgement is not a delivery.
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
			// The callbacks of the session decide whether the plan waits.
			// A callback that throws must not take the round and the
			// session with it: the plan waits for the next round.
			let held = false;
			try {
				held = options.hold?.(message) === true;
			} catch {
				// The callback could not answer: the plan waits. A plan
				// that is delivered on a broken callback would reach a
				// session that cannot receive it.
				held = true;
			}
			if (held) {
				// The plan waits for the human: it stays pending and is
				// never claimed.
				continue;
			}
			let deferred = false;
			try {
				deferred = options.defer?.(message) === true;
			} catch {
				// The callback could not answer: the plan waits.
				deferred = true;
			}
			if (deferred) {
				// The session cannot take the plan now: it is paused or
				// busy on other work. The plan waits in the mailbox.
				continue;
			}
			if (inFlight.has(message.id)) {
				// The plan is in flight: another round is handing this plan
				// over right now, or a delivery of it is still running.
				// The claim is reconciled below: the plan is acknowledged
				// once the delivery is over.
				//
				// The plan stays in flight until the attempt settles. A
				// delivery that only timed out may still reach the
				// session, so a second handover would deliver the same
				// plan twice and acknowledge it twice. A delivery that
				// never settles is reported after the bound, and the plan
				// waits for it: a plan that may still arrive is never
				// handed over a second time.
				const startedAt = inFlight.get(message.id) ?? 0;
				const stuckAfter =
					options.stuckDeliveryAfterMs ??
					PLAN_STUCK_DELIVERY_AFTER_MS;
				if (now() - startedAt >= stuckAfter && !stuckReported.has(message.id)) {
					stuckReported.add(message.id);
					options.log?.(
						`The delivery of the plan ${message.id} never settled - the plan waits for it.`,
					);
				}
				continue;
			}
			// The lease of the handoff is taken before the plan is claimed:
			// a plan whose handoff runs in the other path waits in the
			// mailbox, unclaimed and undelivered.
			const leased = takeLease(message);
			if (!leased) {
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
					if (leased) dropLease(message);
					continue;
				}
			} catch {
				if (leased) dropLease(message);
				continue;
			}
			inFlight.set(message.id, now());
			// The delivery is bounded: a delivery that never settles
			// would keep the round and the mailbox of this session
			// blocked for the rest of the process.
			//
			// The bound is a bound of the round, not a cancellation of the
			// delivery. A delivery that is still running when the bound
			// passed may still reach the session, so the plan stays in
			// flight until the attempt settles: a second round must not
			// hand the same plan over a second time.
			let settled = false;
			const attempt = (async () => options.deliver(message))();
			const finish = (handedOver: boolean) => {
				if (settled) return;
				settled = true;
				inFlight.delete(message.id);
				if (!handedOver) {
					// The plan was not handed over: nobody runs the work, so
					// the lease is given back and the other path may run it.
					if (leased) dropLease(message);
					return;
				}
				delivered.add(message.id);
				handoverCount += 1;
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
			};
			// The attempt is watched even after the round moved on: a
			// delivery that settles later still has to be acknowledged, and
			// a rejection must not become an unhandled rejection.
			attempt.then(
				() => finish(true),
				() => finish(false),
			);
			try {
				await withTimeout(
					attempt,
					options.deliveryTimeoutMs ?? PLAN_DELIVERY_TIMEOUT_MS,
				);
			} catch {
				// The plan is not lost, and it is not delivered twice.
				// The attempt that may still arrive keeps the plan in
				// flight, so the next round waits for it instead of
				// handing the plan over again.
				continue;
			}
			// The delivery settled in time: the plan is handed over and
			// acknowledged above.
			continue;
		}
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
