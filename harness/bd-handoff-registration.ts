/**
 * The registration of the bd handoff watcher.
 *
 * The watcher is the part of the harness that looks at the issue tracker
 * of the workspace and finds the handoffs that are addressed to this
 * agent. It is registered once per session and it is stopped with the
 * session: a watcher that outlives its session would deliver a handoff
 * into a session that does not exist.
 *
 * The watcher is narrow on purpose:
 *
 * - Only issues that carry the handoff protocol and that name this agent
 *   as the recipient are considered. The whole backlog is never dumped
 *   into the session.
 * - The watcher reads. It never writes to the store, never closes an
 *   issue and never starts work by itself.
 * - A handoff outside the authorized scope of the request is proposed,
 *   not executed. The proposal is the existing exact-id path, so the
 *   question reaches the human in the shape the human already knows.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { BdHandoffReader, type BdCommandRunner } from "./bd-handoff-reader.ts";
import { BdHandoffRuntime, type BdHandoffStatus } from "./bd-handoff-runtime.ts";
import { BdHandoffStore } from "./bd-handoff-state.ts";

/**
 * The environment variable that switches the watcher off.
 */
export const BD_HANDOFF_ENV = "PI_BD_HANDOFF";

/**
 * The environment variable that names the recipient of the handoffs.
 */
export const BD_HANDOFF_RECIPIENT_ENV = "PI_BD_HANDOFF_RECIPIENT";

/**
 * The environment variable that sets the interval of the watcher.
 */
export const BD_HANDOFF_INTERVAL_ENV = "PI_BD_HANDOFF_INTERVAL_MS";

/**
 * How often the watcher looks at the store.
 */
export const DEFAULT_BD_HANDOFF_INTERVAL_MS = 60_000;

/**
 * The smallest interval the watcher accepts.
 *
 * A watcher that reads the store every second is a busy loop against a
 * program that has to answer a database.
 */
export const MIN_BD_HANDOFF_INTERVAL_MS = 5_000;

/**
 * Is the watcher switched on?
 *
 * The watcher is on by default: it only reads a local store, and it only
 * delivers what another agent explicitly addressed to this agent. A user
 * who does not want it switches it off.
 */
export function bdHandoffEnabled(
	env: Record<string, string | undefined> = process.env,
): boolean {
	const value = (env[BD_HANDOFF_ENV] ?? "").trim().toLowerCase();
	if (value === "0" || value === "off" || value === "false" || value === "no") {
		return false;
	}
	return true;
}

/**
 * The recipient of the handoffs.
 */
export function bdHandoffRecipient(
	env: Record<string, string | undefined> = process.env,
): string {
	const value = (env[BD_HANDOFF_RECIPIENT_ENV] ?? "").trim();
	return value.length > 0 ? value : "pi";
}

/**
 * The interval of the watcher.
 */
export function bdHandoffIntervalMs(
	env: Record<string, string | undefined> = process.env,
): number {
	const raw = (env[BD_HANDOFF_INTERVAL_ENV] ?? "").trim();
	if (raw.length === 0) return DEFAULT_BD_HANDOFF_INTERVAL_MS;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < MIN_BD_HANDOFF_INTERVAL_MS) {
		return DEFAULT_BD_HANDOFF_INTERVAL_MS;
	}
	return parsed;
}

/**
 * The options of the registration.
 */
export interface BdHandoffRegistrationOptions {
	/** The workspace the store belongs to. */
	workspace: () => string;
	/** The id of the session, used as the owner of a claim. */
	sessionId: () => string;
	/** The root of the durable state. */
	root?: string;
	/**
	 * Deliver the observation to the session.
	 *
	 * The result says whether the session received the message: a
	 * delivery that did not happen does not move the cursor.
	 */
	deliver: (message: string) => Promise<{ delivered: boolean; reason?: string }>;
	/** Is the session able to receive a message? */
	isIdle?: () => boolean;
	/** Is the human holding the session back? */
	isPaused?: () => boolean;
	/** Is a question of the human open? */
	hasOpenQuestion?: () => boolean;
	/**
	 * The handoff is outside the authorized scope of the request.
	 *
	 * The watcher proposes it and does not start it.
	 */
	proposeScope?: (
		handoff: { issueId: string; title: string; summary?: string },
	) => Promise<boolean>;
	/** The watcher reports its state. */
	onStatus?: (status: BdHandoffStatus) => void;
	/** The log of the watcher. */
	log?: (message: string) => void;
	/** The way bd is run. */
	run?: BdCommandRunner;
	/** The binary of bd. */
	binary?: string;
	/** The clock. */
	now?: () => number;
}

/**
 * The registration of the watcher.
 */
export interface BdHandoffRegistration {
	/** The runtime of the handoffs. */
	runtime: BdHandoffRuntime;
	/** The durable state of the handoffs. */
	store: BdHandoffStore;
	/** The reader of the store. */
	reader: BdHandoffReader;
	/** Look at the store and deliver what waits. */
	tick: () => Promise<BdHandoffStatus>;
	/** The timer of the watcher. */
	start: () => void;
	/** The watcher stops. */
	stop: () => void;
}

/**
 * Register the watcher of the handoffs.
 *
 * The registration is nothing when the watcher is switched off: no
 * reader, no runtime, no timer.
 */
export function registerBdHandoff(
	options: BdHandoffRegistrationOptions,
	env: Record<string, string | undefined> = process.env,
): BdHandoffRegistration | undefined {
	if (!bdHandoffEnabled(env)) return undefined;
	const root = options.root ?? join(homedir(), ".pi-harness-runtime");
	const store = new BdHandoffStore(root, { now: options.now });
	const reader = new BdHandoffReader({
		workspace: options.workspace(),
		binary: options.binary,
		run: options.run,
	});
	const runtime = new BdHandoffRuntime({
		reader,
		store,
		recipient: bdHandoffRecipient(env),
		now: options.now,
		sessionId: options.sessionId,
		deliver: async (delivery) => options.deliver(delivery.message),
		isIdle: options.isIdle,
		isPaused: options.isPaused,
		hasOpenQuestion: options.hasOpenQuestion,
		proposeScope: options.proposeScope
			? async (handoff) => {
					const proposed = await options.proposeScope?.({
						issueId: handoff.issue.id,
						title: handoff.issue.title,
						summary: handoff.envelope.summary,
					});
					return proposed === true;
				}
			: undefined,
		onStatus: options.onStatus,
		log: options.log,
	});

	let timer: ReturnType<typeof setInterval> | undefined;
	const tick = async (): Promise<BdHandoffStatus> => {
		await runtime.check();
		return runtime.dispatch();
	};

	return {
		runtime,
		store,
		reader,
		tick,
		start: () => {
			if (timer) return;
			const interval = bdHandoffIntervalMs(env);
			timer = setInterval(() => {
				void tick().catch((error) => {
					options.log?.(`[bd] the watcher failed: ${String(error)}`);
				});
			}, interval);
			timer.unref?.();
		},
		stop: () => {
			if (!timer) return;
			clearInterval(timer);
			timer = undefined;
		},
	};
}
