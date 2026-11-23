/**
 * The durable state of the bd handoffs.
 *
 * A handoff travels through several states, and the difference between
 * them decides whether the work runs twice:
 *
 * - observed: the handoff was seen in the store. Nothing happened yet.
 * - queued: the handoff waits for a safe boundary to be delivered.
 * - received: the handoff was delivered and the session knows about it.
 * - acknowledged: the agent read the handoff and said so.
 * - claimed: one owner holds the handoff and may execute it.
 * - running: the owner is executing it.
 * - completed: the work of the handoff is done.
 *
 * The cursor of a handoff only moves when something really happened: a
 * handoff that was seen is not a handoff that was delivered, and a
 * handoff that was delivered is not a handoff that was acknowledged. A
 * cursor that moved on observation would lose a handoff after a crash
 * between the read and the delivery. The cursor that moves on the
 * delivery is the one that keeps a restart from delivering the handoff
 * a second time: the handoff is delivered once, and the session that
 * receives it says so.
 *
 * The state is written on disk, so it survives a restart of the session:
 * a machine that was off while a handoff waited still knows that the
 * handoff was not delivered.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../packages/cookie-sanitizer/dist/index.js";

/**
 * The state of one handoff.
 */
export type BdHandoffLifecycle =
	| "observed"
	| "queued"
	| "received"
	| "acknowledged"
	| "claimed"
	| "running"
	| "completed"
	| "failed";

/**
 * What the harness knows about one handoff.
 */
export interface BdHandoffRecord {
	/** The stable id of the handoff. */
	handoffId: string;
	/** The issue the handoff came from. */
	issueId: string;
	/**
	 * The recipient the handoff is delivered to.
	 *
	 * The cursor belongs to the recipient: a handoff that was delivered
	 * to one agent was not delivered to another one.
	 */
	recipient: string;
	/** The revision that was seen last. */
	seenRevision: number;
	/** The revision that was delivered last, when it was delivered. */
	deliveredRevision?: number;
	/** The revision that was acknowledged last, when it was acknowledged. */
	acknowledgedRevision?: number;
	/** The state of the handoff. */
	state: BdHandoffLifecycle;
	/** The id that ties the reply to the request. */
	correlationId?: string;
	/** The todos that were created for the handoff. */
	todoIds?: number[];
	/** The owner of the claim. */
	claimedBy?: string;
	/** When the claim runs out. */
	leaseExpiresAt?: number;
	/** When the record was changed last. */
	updatedAt: number;
}

/**
 * How long a claim is held.
 *
 * A claim is a lease: it ends when the owner is gone, so a crash does not
 * keep the handoff forever.
 */
export const DEFAULT_BD_CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * The result of a claim.
 */
export type BdClaimResult =
	| { ok: true; record: BdHandoffRecord }
	| {
			ok: false;
			reason: "held" | "unknown" | "not-claimable";
			/** The owner that holds the claim. */
			holder?: string;
			/** When the claim of the holder runs out. */
			leaseExpiresAt?: number;
			/** The state of the handoff. */
			state?: BdHandoffLifecycle;
	  };

/**
 * The store of the handoffs.
 *
 * Every handoff is one file, so a handoff is never half written and a
 * reader never sees a handoff in a state that never was.
 */
export class BdHandoffStore {
	/** The root of the store. */
	private readonly root: string;
	/** The clock, for the tests. */
	private readonly now: () => number;

	constructor(root: string, options: { now?: () => number } = {}) {
		this.root = root;
		this.now = options.now ?? Date.now;
	}

	/** The directory of the handoffs. */
	private dir(): string {
		return join(this.root, "bd-handoffs");
	}

	/**
	 * The file of one handoff.
	 *
	 * The name is built from the recipient and the id: both are known
	 * values of a protocol, and the name is made safe so a file can never
	 * leave the directory.
	 */
	private fileFor(recipient: string, handoffId: string): string {
		const safe = `${recipient}::${handoffId}`
			.replace(/[^A-Za-z0-9._-]+/g, "_")
			.slice(0, 200);
		return join(this.dir(), `${safe}.json`);
	}

	/**
	 * The record of one handoff, when it is there.
	 */
	read(recipient: string, handoffId: string): BdHandoffRecord | null {
		const raw = this.readRaw(this.fileFor(recipient, handoffId));
		if (raw.kind !== "record") return null;
		return raw.record;
	}

	/**
	 * The file of a handoff, as it is on the disk.
	 *
	 * A file that cannot be read is not an empty handoff: the handoff is
	 * kept aside and it is treated as delivered. A handoff that is
	 * delivered twice is worse than a handoff that is not delivered
	 * again.
	 */
	private readRaw(file: string):
		| { kind: "missing" }
		| { kind: "broken" }
		| { kind: "record"; record: BdHandoffRecord } {
		if (!existsSync(file)) return { kind: "missing" };
		try {
			const raw = JSON.parse(readFileSync(file, "utf8")) as BdHandoffRecord;
			if (!raw || typeof raw !== "object") return { kind: "broken" };
			if (typeof raw.handoffId !== "string") return { kind: "broken" };
			return { kind: "record", record: raw };
		} catch {
			return { kind: "broken" };
		}
	}

	/**
	 * Keep a file that cannot be read aside.
	 *
	 * The file is the evidence of what happened: it is moved, not
	 * deleted.
	 */
	private quarantine(file: string): void {
		try {
			renameSync(file, `${file}.broken-${this.now()}`);
		} catch {
			// The file cannot be moved: the record that is written over
			// it replaces it anyway.
		}
	}

	/**
	 * Every record of the store.
	 */
	all(): BdHandoffRecord[] {
		const dir = this.dir();
		if (!existsSync(dir)) return [];
		const records: BdHandoffRecord[] = [];
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			try {
				const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as BdHandoffRecord;
				if (raw && typeof raw === "object" && typeof raw.handoffId === "string") {
					records.push(raw);
				}
			} catch {
				// A broken file is skipped: it is the work of the repair,
				// and a broken file must not hide the other handoffs.
			}
		}
		return records;
	}

	/**
	 * Write the state of a handoff.
	 *
	 * The write is atomic: the file is renamed over its target.
	 */
	write(record: BdHandoffRecord): BdHandoffRecord {
		const dir = this.dir();
		mkdirSync(dir, { recursive: true });
		const next: BdHandoffRecord = { ...record, updatedAt: this.now() };
		atomicWriteFileSync(
			this.fileFor(record.recipient, record.handoffId),
			JSON.stringify(next, null, 2),
		);
		return next;
	}

	/**
	 * The record of a handoff that was seen.
	 *
	 * The cursor of a delivery is never moved here: a handoff that was
	 * seen was not delivered.
	 */
	observe(input: {
		handoffId: string;
		issueId: string;
		recipient: string;
		revision: number;
		correlationId?: string;
	}): BdHandoffRecord {
		const file = this.fileFor(input.recipient, input.handoffId);
		const raw = this.readRaw(file);
		if (raw.kind === "broken") {
			// The file of the handoff cannot be read. It is kept aside,
			// and the handoff is treated as delivered: the handoff must
			// not be delivered a second time because a file was cut.
			this.quarantine(file);
			return this.write({
				handoffId: input.handoffId,
				issueId: input.issueId,
				recipient: input.recipient,
				seenRevision: input.revision,
				deliveredRevision: input.revision,
				state: "received",
				updatedAt: this.now(),
			});
		}
		const existing = raw.kind === "record" ? raw.record : undefined;
		const record: BdHandoffRecord = existing
			? { ...existing, seenRevision: Math.max(existing.seenRevision, input.revision) }
			: {
					handoffId: input.handoffId,
					issueId: input.issueId,
					recipient: input.recipient,
					seenRevision: input.revision,
					state: "observed",
					updatedAt: this.now(),
				};
		if (input.correlationId) record.correlationId = input.correlationId;
		return this.write(record);
	}

	/**
	 * The handoff that was delivered.
	 *
	 * The cursor moves here, and only here: the delivery is the fact that
	 * keeps a restart from delivering the handoff again.
	 */
	markDelivered(input: {
		handoffId: string;
		issueId: string;
		recipient: string;
		revision: number;
		correlationId?: string;
	}): BdHandoffRecord {
		const existing = this.read(input.recipient, input.handoffId);
		const record: BdHandoffRecord = existing
			? { ...existing }
			: {
					handoffId: input.handoffId,
					issueId: input.issueId,
					recipient: input.recipient,
					seenRevision: input.revision,
					state: "received",
					updatedAt: this.now(),
				};
		record.seenRevision = Math.max(record.seenRevision, input.revision);
		record.deliveredRevision = Math.max(record.deliveredRevision ?? 0, input.revision);
		record.state = "received";
		if (input.correlationId) record.correlationId = input.correlationId;
		return this.write(record);
	}

	/**
	 * The handoff that was acknowledged.
	 */
	markAcknowledged(input: {
		handoffId: string;
		recipient: string;
		revision: number;
	}): BdHandoffRecord | null {
		const existing = this.read(input.recipient, input.handoffId);
		if (!existing) return null;
		const record: BdHandoffRecord = { ...existing };
		record.acknowledgedRevision = Math.max(
			record.acknowledgedRevision ?? 0,
			input.revision,
		);
		record.state = "acknowledged";
		return this.write(record);
	}

	/**
	 * The handoff that is done.
	 */
	markCompleted(input: {
		handoffId: string;
		recipient: string;
		correlationId?: string;
		todoIds?: number[];
	}): BdHandoffRecord | null {
		const existing = this.read(input.recipient, input.handoffId);
		if (!existing) return null;
		const record: BdHandoffRecord = { ...existing };
		record.state = "completed";
		if (input.correlationId) record.correlationId = input.correlationId;
		if (input.todoIds && input.todoIds.length > 0) {
			record.todoIds = [...new Set([...(record.todoIds ?? []), ...input.todoIds])];
		}
		return this.write(record);
	}

	/**
	 * The handoff that failed.
	 */
	markFailed(input: {
		handoffId: string;
		recipient: string;
	}): BdHandoffRecord | null {
		const existing = this.read(input.recipient, input.handoffId);
		if (!existing) return null;
		const record: BdHandoffRecord = { ...existing };
		record.state = "failed";
		return this.write(record);
	}

	/**
	 * Take the claim of a handoff.
	 *
	 * The claim is a lease with an owner. A handoff that is already
	 * claimed by somebody else cannot be claimed, and a claim that ran
	 * out can be taken over: a machine that was off does not keep the
	 * handoff forever.
	 */
	claim(input: {
		handoffId: string;
		recipient: string;
		owner: string;
		leaseMs?: number;
	}): BdClaimResult {
		const existing = this.read(input.recipient, input.handoffId);
		if (!existing) {
			return { ok: false, reason: "unknown" };
		}
		if (existing.state === "completed") {
			return { ok: false, reason: "not-claimable", state: "completed" };
		}
		const now = this.now();
		const lease = input.leaseMs ?? DEFAULT_BD_CLAIM_LEASE_MS;
		const held =
			existing.claimedBy !== undefined &&
			existing.claimedBy !== input.owner &&
			(existing.leaseExpiresAt ?? 0) > now;
		if (held) {
			return {
				ok: false,
				reason: "held",
				holder: existing.claimedBy,
				leaseExpiresAt: existing.leaseExpiresAt,
				state: existing.state,
			};
		}
		const record: BdHandoffRecord = {
			...existing,
			state: "claimed",
			claimedBy: input.owner,
			leaseExpiresAt: now + lease,
		};
		return { ok: true, record: this.write(record) };
	}

	/**
	 * Give the claim of a handoff back.
	 *
	 * Only the owner may give the claim back: a session that lost its
	 * claim does not release the claim of somebody else.
	 */
	release(input: {
		handoffId: string;
		recipient: string;
		owner: string;
		state?: BdHandoffLifecycle;
	}): boolean {
		const existing = this.read(input.recipient, input.handoffId);
		if (!existing) return false;
		if (existing.claimedBy !== undefined && existing.claimedBy !== input.owner) {
			return false;
		}
		const record: BdHandoffRecord = { ...existing };
		record.claimedBy = undefined;
		record.leaseExpiresAt = undefined;
		if (input.state !== undefined) {
			// The caller names the state the handoff keeps: a handoff
			// whose delivery failed waits again, and it is not
			// acknowledged by anybody.
			record.state = input.state;
		} else if (record.state === "claimed" || record.state === "running") {
			record.state = "acknowledged";
		}
		this.write(record);
		return true;
	}

	/**
	 * The handoff that is running.
	 */
	markRunning(input: {
		handoffId: string;
		recipient: string;
		owner: string;
	}): BdHandoffRecord | null {
		const existing = this.read(input.recipient, input.handoffId);
		if (!existing) return null;
		if (existing.claimedBy !== input.owner) return null;
		const record: BdHandoffRecord = { ...existing, state: "running" };
		return this.write(record);
	}

	/**
	 * Link todos to a handoff.
	 */
	linkTodos(input: {
		handoffId: string;
		recipient: string;
		todoIds: number[];
	}): BdHandoffRecord | null {
		const existing = this.read(input.recipient, input.handoffId);
		if (!existing) return null;
		const record: BdHandoffRecord = { ...existing };
		record.todoIds = [...new Set([...(record.todoIds ?? []), ...input.todoIds])];
		return this.write(record);
	}

	/**
	 * The records that are not done.
	 */
	open(): BdHandoffRecord[] {
		return this.all().filter((record) => record.state !== "completed");
	}

	/**
	 * Forget the records that are older than the retention.
	 *
	 * A handoff that was completed long ago says nothing about the
	 * session of today.
	 */
	expire(olderThanMs: number): number {
		const now = this.now();
		let removed = 0;
		for (const record of this.all()) {
			if (record.state !== "completed") continue;
			if (now - record.updatedAt <= olderThanMs) continue;
			const file = this.fileFor(record.recipient, record.handoffId);
			try {
				rmSync(file, { force: true });
				removed += 1;
			} catch {
				// A file that cannot be removed is kept: the next run tries
				// again.
			}
		}
		return removed;
	}
}
