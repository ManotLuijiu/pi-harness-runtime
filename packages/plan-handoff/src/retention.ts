/**
 * The handoffs that wait for a recipient.
 *
 * A handoff whose recipient does not exist yet is not delivered to another
 * project and is not thrown away. It is retained until a Pi instance of the
 * workspace appears, until the user cancels it, or until it expires.
 *
 * The rebinding of a retained handoff to a later instance is explicit and
 * recorded: the agent id of the recipient is never substituted silently.
 */

import {
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentRegistration } from "./registry.js";
import { canonicalizePath } from "./workspace.js";

/**
 * How long a retained handoff waits for a recipient.
 */
export const DEFAULT_HANDOFF_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * The state of a retained handoff.
 */
export type HandoffState = "awaiting-recipient" | "claimed" | "cancelled";

/**
 * A handoff that waits for its recipient.
 */
export interface PendingHandoff {
	/** The identity of the message. */
	id: string;
	/** The correlation id of the exchange. */
	correlationId: string;
	/** The canonical workspace the handoff belongs to. */
	workspace: string;
	/** The agent id the handoff was addressed to, when one was chosen. */
	requestedAgentId?: string;
	/** The session the handoff was addressed to, when one was chosen. */
	requestedSessionId?: string;
	/** The state of the handoff. */
	state: HandoffState;
	/** When the handoff was retained. */
	createdAt: number;
	/** When the handoff expires. */
	expiresAt: number;
	/** The summary of the plan, for the user. */
	summary: string;
	/** The path of the plan, when it is a file. */
	reference?: string;
}

/**
 * The store of the retained handoffs.
 *
 * Every handoff owns one file of the store, so two senders never overwrite
 * each other. The write of a file is atomic.
 */
export class PendingHandoffStore {
	private readonly directory: string;
	private readonly retentionMs: number;

	constructor(
		directory: string,
		options: { retentionMs?: number } = {},
	) {
		this.directory = directory;
		this.retentionMs = options.retentionMs ?? DEFAULT_HANDOFF_RETENTION_MS;
	}

	/**
	 * The retained handoffs, expired ones included.
	 */
	list(): PendingHandoff[] {
		let names: string[];
		try {
			names = readdirSync(this.directory);
		} catch {
			return [];
		}
		const handoffs: PendingHandoff[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				const parsed: unknown = JSON.parse(
					readFileSync(join(this.directory, name), "utf8"),
				);
				if (!isPendingHandoff(parsed)) continue;
				handoffs.push(parsed);
			} catch {
				continue;
			}
		}
		return handoffs;
	}

	/**
	 * The handoffs that wait for a recipient and did not expire.
	 */
	awaiting(now: number = Date.now()): PendingHandoff[] {
		return this.list().filter(
			(handoff) =>
				handoff.state === "awaiting-recipient" && handoff.expiresAt > now,
		);
	}

	/**
	 * Retain a handoff.
	 */
	retain(handoff: PendingHandoff): void {
		mkdirSync(this.directory, { recursive: true });
		const target = join(this.directory, `${handoff.id}.json`);
		const temporary = `${target}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(handoff, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, target);
	}

	/**
	 * Retain a handoff with the expiry of the store.
	 *
	 * The caller names the handoff and the store names its expiry: the
	 * retention of the deployment is one number, and it is not written
	 * twice in two callers.
	 */
	retainWithExpiry(
		handoff: Omit<PendingHandoff, "expiresAt">,
		now: number = Date.now(),
	): PendingHandoff {
		const retained: PendingHandoff = {
			...handoff,
			expiresAt: now + this.retentionMs,
		};
		this.retain(retained);
		return retained;
	}

	/**
	 * Claim a retained handoff for an instance.
	 *
	 * The claim is explicit: the caller names the instance the handoff goes
	 * to, and the state of the handoff records it.
	 */
	claim(id: string, registration: AgentRegistration, now: number = Date.now()): PendingHandoff | undefined {
		const handoff = this.read(id);
		if (!handoff) return undefined;
		if (handoff.state !== "awaiting-recipient") return undefined;
		if (handoff.expiresAt <= now) return undefined;
		const claimed: PendingHandoff = {
			...handoff,
			state: "claimed",
			requestedAgentId: registration.agentId,
			requestedSessionId: registration.sessionId,
		};
		this.retain(claimed);
		return claimed;
	}

	/**
	 * Cancel a retained handoff.
	 */
	cancel(id: string): boolean {
		const handoff = this.read(id);
		if (!handoff) return false;
		this.retain({ ...handoff, state: "cancelled" });
		return true;
	}

	/**
	 * Remove the handoffs that expired.
	 */
	prune(now: number = Date.now()): number {
		let removed = 0;
		for (const handoff of this.list()) {
			if (handoff.expiresAt > now) continue;
			try {
				unlinkSync(join(this.directory, `${handoff.id}.json`));
				removed += 1;
			} catch {
				continue;
			}
		}
		return removed;
	}

	/**
	 * Read one handoff.
	 */
	read(id: string): PendingHandoff | undefined {
		try {
			const parsed: unknown = JSON.parse(
				readFileSync(join(this.directory, `${id}.json`), "utf8"),
			);
			return isPendingHandoff(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
}

/**
 * Whether a value is a retained handoff.
 */
function isPendingHandoff(value: unknown): value is PendingHandoff {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<PendingHandoff>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.correlationId === "string" &&
		typeof candidate.workspace === "string" &&
		typeof candidate.state === "string" &&
		typeof candidate.createdAt === "number" &&
		typeof candidate.expiresAt === "number"
	);
}

/**
 * The handoffs of a workspace that wait for a recipient.
 */
export function awaitingInWorkspace(
	store: PendingHandoffStore,
	workspace: string,
	now: number = Date.now(),
): PendingHandoff[] {
	const target = canonicalizePath(workspace);
	return store
		.awaiting(now)
		.filter((handoff) => canonicalizePath(handoff.workspace) === target);
}
