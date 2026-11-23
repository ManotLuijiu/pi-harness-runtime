/**
 * The session-scoped owner of the bd handoff watcher.
 *
 * The watcher reads the issue tracker of the workspace and finds the
 * handoffs that are addressed to this agent. It belongs to the session:
 * a watcher that outlives its session would deliver a handoff into a
 * session that does not exist, and a session that is replaced would keep
 * the reader of the old workspace.
 *
 * This module owns the lifecycle of that watcher and nothing else. The
 * polling, the recipient filter, the read-only access, the delivery
 * gating and the cursor rules belong to the registration and the runtime;
 * this module starts them, replaces them and stops them.
 *
 * The generation of a handoff proposal belongs to the session too. A
 * proposal of the store has its own identity: it is not the completion
 * generation of the request, and the two must never answer each other.
 * The generation of a handoff starts far above the generations of the
 * requests, so the closed generations of the requests and the closed
 * generations of the handoffs can never be the same number.
 */

import {
	registerBdHandoff,
	type BdHandoffRegistration,
} from "./bd-handoff-registration.ts";
import type { BdCommandRunner } from "./bd-handoff-reader.ts";
import type { BdHandoffIssue } from "./bd-handoff-reader.ts";
import type {
	BdHandoffRuntime,
	BdHandoffStatus,
} from "./bd-handoff-runtime.ts";

/**
 * The first generation of a handoff proposal.
 *
 * The generations of the requests are small numbers that grow with every
 * request of the session. The generations of the handoffs start here, so
 * a generation that is closed by a request is never the generation of a
 * handoff proposal, and the approval of one group never answers the
 * proposal of another.
 */
export const BD_HANDOFF_FIRST_GENERATION = 1_000_000;

/**
 * What the session needs from the outside.
 */
export interface BdHandoffSessionOptions {
	/** The workspace the store belongs to. */
	workspace: () => string;
	/** The id of the session, used as the owner of a claim. */
	sessionId: () => string;
	/**
	 * Deliver the observation to the session.
	 *
	 * The result says whether the session received the message: a delivery
	 * that did not happen does not move the cursor of the store.
	 */
	deliver: (
		message: string,
	) => Promise<{ delivered: boolean; reason?: string }>;
	/** Is the session able to receive a message? */
	isIdle?: () => boolean;
	/** Is the human holding the session back? */
	isPaused?: () => boolean;
	/** Is a question of the human open? */
	hasOpenQuestion?: () => boolean;
	/**
	 * Propose a handoff that is outside the authorized scope.
	 *
	 * The proposal is a question to the human. The handoff never starts by
	 * itself, and the generation of the proposal is the one of the session.
	 */
	proposeScope?: (
		handoff: { issueId: string; title: string; summary?: string },
		generation: number,
	) => Promise<boolean>;
	/** The watcher reports its state. */
	onStatus?: (status: BdHandoffStatus) => void;
	/** The log of the watcher. */
	log?: (message: string) => void;
	/** The root of the durable state. */
	root?: string;
	/** The way bd is run. */
	run?: BdCommandRunner;
	/** The binary of bd. */
	binary?: string;
	/** The clock. */
	now?: () => number;
	/** The environment of the session. */
	env?: Record<string, string | undefined>;
}

/**
 * The watcher of the handoffs, owned by the session.
 */
export class BdHandoffSession {
	/** The registration of the watcher, when the watcher is on. */
	private registration: BdHandoffRegistration | undefined;
	/** The generations of the handoff proposals of this session. */
	private generation = BD_HANDOFF_FIRST_GENERATION - 1;

	/**
	 * Start the watcher of the session.
	 *
	 * A watcher that is already running is stopped first: a session that
	 * is replaced must not leave the watcher of the old session behind.
	 */
	start(options: BdHandoffSessionOptions): BdHandoffRegistration | undefined {
		this.stop();
		const registration = registerBdHandoff(
			{
				workspace: options.workspace,
				sessionId: options.sessionId,
				deliver: options.deliver,
				isIdle: options.isIdle,
				isPaused: options.isPaused,
				hasOpenQuestion: options.hasOpenQuestion,
				proposeScope: options.proposeScope
					? async (handoff) => {
							const proposed = await options.proposeScope?.(
								handoff,
								this.nextGeneration(),
							);
							return proposed === true;
						}
					: undefined,
				onStatus: options.onStatus,
				log: options.log,
				root: options.root,
				run: options.run,
				binary: options.binary,
				now: options.now,
			},
			options.env ?? process.env,
		);
		this.registration = registration;
		registration?.start();
		return registration;
	}

	/**
	 * The watcher stops with the session.
	 */
	stop(): void {
		this.registration?.stop();
		this.registration = undefined;
	}

	/** Is the watcher of this session running? */
	get active(): boolean {
		return this.registration !== undefined;
	}

	/** The runtime of the handoffs, when the watcher is on. */
	get runtime(): BdHandoffRuntime | undefined {
		return this.registration?.runtime;
	}

	/**
	 * Look at the store and deliver what waits.
	 *
	 * The check waits for a safe boundary on its own: a session that is
	 * busy, paused or busy with a question of the human keeps the handoff
	 * in the queue.
	 */
	async check(): Promise<BdHandoffStatus | undefined> {
		if (!this.registration) return undefined;
		try {
			return await this.registration.tick();
		} catch {
			return undefined;
		}
	}

	/**
	 * Propose a handoff that is outside the authorized scope.
	 *
	 * The handoff is only acknowledged when the proposal was created: a
	 * proposal that reached nobody leaves the handoff in the queue.
	 */
	async propose(handoff: BdHandoffIssue): Promise<boolean> {
		if (!this.registration) return false;
		return this.registration.runtime.propose(handoff);
	}

	/**
	 * The next generation of a handoff proposal.
	 */
	private nextGeneration(): number {
		this.generation += 1;
		return this.generation;
	}
}

/**
 * The text of the status row of the watcher.
 *
 * The row is passive: it says what the watcher observed and nothing else.
 */
export function formatBdHandoffStatus(status: BdHandoffStatus): string {
	const detail = status.detail ? ` | ${status.detail}` : "";
	switch (status.state) {
		case "idle":
			return "idle";
		case "queued":
			return `${status.count} waiting${detail}`;
		case "delivered":
			return `delivered ${status.count}${detail}`;
		case "suppressed":
			return `suppressed${detail}`;
		case "unavailable":
			return `unavailable${detail}`;
		default:
			return status.state;
	}
}
