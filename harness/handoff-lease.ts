/**
 * The shared lease of a handoff.
 *
 * One logical handoff has one identity: the handoff id and the
 * correlation id of the request it belongs to. The two delivery paths -
 * the live path of the plan handoff and the path of the issue tracker -
 * name that identity in different ways: the live path knows the
 * correlation id of the message, the path of the tracker knows the
 * handoff id of the envelope and the correlation id when the producer
 * wrote one.
 *
 * The lease joins the two paths. A handoff that is being executed holds
 * its lease under every name it has, so the second path cannot start the
 * same work while the first one is running it. The lease is durable: it
 * survives a restart, so a session that died in the middle of a handoff
 * does not let a second session start the same work at the same time.
 *
 * The two paths meet on the correlation of the request when the producer
 * wrote one in both, and on the id of the live message when the producer
 * wrote the id of that message into the live job of the envelope. A
 * producer that wrote neither leaves the paths apart: they are then about
 * work that nobody can prove to be the same.
 *
 * The lease is not the claim of the store. The claim of the store keeps
 * one session from delivering one handoff twice; the lease keeps two
 * paths from executing one handoff at once. The two answer different
 * questions, and the lease is the one that is held while the work runs.
 *
 * The bound of the lease is a bound: the owner extends the lease of a
 * handoff while it works on it, and a lease that is not extended - the
 * lease of a session that died - runs out. A lease that runs out holds
 * nothing: the name is free again, and the other path may start the
 * work.
 *
 * The lease is given back when the delivery failed and when the session
 * ends. A handoff whose delivery succeeded keeps its lease until the
 * session ends, so the other path cannot start the same work again while
 * the session lives. The wait is therefore bounded by the bound of the
 * lease and by the life of the session, whichever comes first.
 */

import {
	existsSync,
	linkSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	atomicCreateFileSync,
} from "../packages/cookie-sanitizer/dist/index.js";

/**
 * How long a lease is held.
 *
 * The lease is a lease: it ends when the owner is gone, so a crashed
 * session does not keep a handoff forever. The owner gives it back when
 * the work is over; the bound is only the safety net of a crash.
 */
export const HANDOFF_LEASE_DEFAULT_MS = 5 * 60 * 1000;

/**
 * How long a renewed lease of a handoff is held.
 *
 * The lease of a handoff that is renewed runs for half an hour. The
 * bound is the price of a session that dies in the middle of a handoff:
 * the handoff waits for the bound instead of running twice.
 */
export const HANDOFF_LEASE_RENEW_MS = 30 * 60 * 1000;

/**
 * The lease of one handoff.
 */
export interface HandoffLease {
	/** The name of the lease. */
	key: string;
	/** The owner that holds the lease. */
	owner: string;
	/** When the lease was taken. */
	claimedAt: number;
	/** When the lease runs out. */
	expiresAt: number;
	/** The handoff the lease belongs to. */
	handoffId?: string;
	/** The correlation of the request. */
	correlationId?: string;
	/** The issue of the store. */
	bdIssueId?: string;
}

/**
 * The result of a claim.
 */
export type HandoffLeaseClaim =
	| {
			ok: true;
			leases: HandoffLease[];
			/**
			 * The names that this claim created.
			 *
			 * A name that the owner held already is not in this list: the
			 * lease of that name belongs to a work that runs already, and
			 * giving it back would let the other path run the same
			 * handoff at the same time. Only a name that this claim
			 * created may be given back when the delivery fails.
			 */
			created: string[];
	  }
	| {
			ok: false;
			reason: "held";
			/** The name of the lease that is held. */
			key: string;
			/** The owner that holds it. */
			holder?: string;
			/** When the lease of the holder runs out. */
			expiresAt?: number;
	  };

/**
 * The owner of the leases of one path.
 *
 * Every path has an owner of its own: the path of the store and the
 * live path of the plan are two ways to the same handoff, so the lease
 * has to tell them apart. One owner for both would let the second path
 * take the lease of the first one, and the work would run twice.
 *
 * The owner is never empty: an empty owner would make every session of
 * the machine the owner of the same lease, and the lease would hold
 * nobody. A session without an id falls back to the name of its process.
 */
export function handoffLeaseOwner(
	sessionId: string,
	path: "store" | "plan",
): string {
	const session = sessionId.trim().length > 0 ? sessionId.trim() : `pi-${process.pid}`;
	return `${session}:${path}`;
}

/**
 * The names of a handoff.
 *
 * A handoff is known under the handoff id, under the correlation id of
 * the request and under the id of the live message of the work. Every
 * name is used: the live path knows the correlation id and the id of its
 * message, and the path of the tracker knows the handoff id and, when
 * the producer wrote it, the correlation id and the live job of the
 * envelope. A lease under the names of the work joins the two paths.
 *
 * The two paths meet on the correlation when the producer wrote the same
 * correlation into the envelope of the handoff and into the request of
 * the live path, and on the id of the message when the producer wrote
 * the id of the live message into the live job of the envelope. A
 * producer that wrote neither leaves the paths apart: they are then about
 * work that nobody can prove to be the same.
 */
export function handoffLeaseKeys(input: {
	/** The id of the handoff. */
	handoffId?: string;
	/** The correlation of the request. */
	correlationId?: string;
	/**
	 * The id of the live message of the work.
	 *
	 * The live path knows it as the id of the plan message. The path of
	 * the tracker knows it as the live job of the envelope, and falls
	 * back to the id of the handoff when the envelope names no live job:
	 * the producer gave both the same id then.
	 */
	messageId?: string;
}): string[] {
	const keys: string[] = [];
	if (input.handoffId && input.handoffId.trim().length > 0) {
		keys.push(`handoff:${input.handoffId.trim()}`);
	}
	if (input.correlationId && input.correlationId.trim().length > 0) {
		keys.push(`correlation:${input.correlationId.trim()}`);
	}
	if (input.messageId && input.messageId.trim().length > 0) {
		keys.push(`message:${input.messageId.trim()}`);
	}
	return [...new Set(keys)];
}

/**
 * The name of the file of a lease.
 *
 * The name is readable and it carries a digest of the whole key: two
 * keys that are different can have the same readable part, and the
 * digest keeps them apart. Without it, `handoff:a:b` and `handoff:a_b`
 * would share one lease, and one handoff would block the other.
 */
export function handoffLeaseFileName(key: string): string {
	const safe = key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
	const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
	return `${safe}-${digest}.json`;
}
export class HandoffLeaseStore {
	/** The root of the store. */
	private readonly root: string;
	/** The clock, for the tests. */
	private readonly now: () => number;

	constructor(root: string, options: { now?: () => number } = {}) {
		this.root = root;
		this.now = options.now ?? Date.now;
	}

	/** The directory of the leases. */
	private dir(): string {
		return join(this.root, "handoff-leases");
	}

	/**
	 * The file of one lease.
	 *
	 * The name is made safe, so a file can never leave the directory, and
	 * it carries a digest of the whole key, so two different keys never
	 * share one file.
	 */
	private fileFor(key: string): string {
		return join(this.dir(), handoffLeaseFileName(key));
	}

	/**
	 * The lease of one name, when it is there.
	 *
	 * A file that cannot be read is kept aside and the name is treated as
	 * held: a lease that is lost would let two sessions execute the same
	 * handoff. The caller that found the broken file does not take a name
	 * it cannot read. The name is free again for the caller that comes
	 * after it, because the broken file is kept aside and the lease it
	 * may have held is gone with it.
	 */
	read(key: string): HandoffLease | null {
		const file = this.fileFor(key);
		if (!existsSync(file)) return null;
		try {
			const raw = JSON.parse(readFileSync(file, "utf8")) as HandoffLease;
			if (!raw || typeof raw !== "object") throw new Error("not a lease");
			if (typeof raw.key !== "string" || typeof raw.owner !== "string") {
				throw new Error("not a lease");
			}
			return raw;
		} catch {
			try {
				renameSync(file, `${file}.broken-${this.now()}`);
			} catch {
				// The file cannot be moved: the lease is treated as held.
			}
			return {
				key,
				owner: "",
				claimedAt: 0,
				expiresAt: Number.MAX_SAFE_INTEGER,
			};
		}
	}

	/**
	 * The lease of a name, when it is still held.
	 */
	private held(key: string): HandoffLease | null {
		const lease = this.read(key);
		if (!lease) return null;
		if (lease.expiresAt <= this.now()) return null;
		return lease;
	}

	/**
	 * Take the lease of a handoff.
	 *
	 * Every name of the handoff is checked before any of them is written:
	 * a handoff that is held under one name is held under all of them, so
	 * the two paths cannot slip past each other.
	 */
	claim(input: {
		/** The names of the handoff. */
		keys: readonly string[];
		/** The owner that takes the lease. */
		owner: string;
		/** How long the lease is held. */
		leaseMs?: number;
		/** The handoff the lease belongs to. */
		handoffId?: string;
		/** The correlation of the request. */
		correlationId?: string;
		/** The issue of the store. */
		bdIssueId?: string;
	}): HandoffLeaseClaim {
		if (input.keys.length === 0) {
			return { ok: true, leases: [], created: [] };
		}
		const now = this.now();
		for (const key of input.keys) {
			const lease = this.held(key);
			if (!lease) continue;
			if (lease.owner === input.owner) continue;
			return {
				ok: false,
				reason: "held",
				key,
				holder: lease.owner,
				expiresAt: lease.expiresAt,
			};
		}
		const leaseMs = input.leaseMs ?? HANDOFF_LEASE_DEFAULT_MS;
		const leases: HandoffLease[] = [];
		const created: HandoffLease[] = [];
		for (const key of input.keys) {
			const lease: HandoffLease = {
				key,
				owner: input.owner,
				claimedAt: now,
				expiresAt: now + leaseMs,
			};
			if (input.handoffId) lease.handoffId = input.handoffId;
			if (input.correlationId) lease.correlationId = input.correlationId;
			if (input.bdIssueId) lease.bdIssueId = input.bdIssueId;
			const taken = this.take(lease);
			if (taken === false) {
				// Somebody took the name in the gap between the check and
				// the write: the names this call created are given back, so
				// the handoff is not half leased. A name that the caller
				// held already is not given back: the caller still holds
				// it, and giving it back would leave the handoff free for
				// the other path.
				this.releaseTaken(created);
				const holder = this.held(key);
				return {
					ok: false,
					reason: "held",
					key,
					holder: holder?.owner,
					expiresAt: holder?.expiresAt,
				};
			}
			leases.push(lease);
			if (taken === "created") created.push(lease);
		}
		return {
			ok: true,
			leases,
			created: created.map((lease) => lease.key),
		};
	}

	/**
	 * Take one name of a handoff.
	 *
	 * The name is taken with an exclusive create: the create is atomic,
	 * so exactly one caller writes the file and every other caller is
	 * told that the claim was lost. Two sessions of one machine cannot
	 * both take the same name.
	 *
	 * A lease of another owner that is still alive is never taken away.
	 * The name is only free again when its lease ran out: a lease that
	 * ends is the only lease that another owner may replace, and a lease
	 * that is taken from a live owner would let two paths run the work of
	 * one handoff at once.
	 *
	 * The answer tells the caller what happened: a name that was created
	 * by this call may be given back, a name that the caller held already
	 * may not.
	 */
	private take(lease: HandoffLease): "created" | "held" | false {
		const file = this.fileFor(lease.key);
		const content = JSON.stringify(lease, null, 2);
		try {
			atomicCreateFileSync(file, content);
			return "created";
		} catch {
			// The name is taken: it belongs to somebody.
		}
		const existing = this.read(lease.key);
		if (!existing) return false;
		if (existing.expiresAt > this.now()) {
			if (existing.owner === lease.owner) {
				// The caller holds the name already and the lease is still
				// alive. The lease is extended: the work of a handoff that
				// runs longer than the bound of the lease keeps the
				// protection of the lease while the owner works on it.
				this.extend(existing, lease.expiresAt);
				return "held";
			}
			// The lease of the other owner is alive: the name is not free.
			return false;
		}
		// The lease of the name ran out: the name is free again. The same
		// owner finds its own dead lease here, and it has to write it
		// again, or the claim would be a claim of a lease that nobody
		// holds.
		//
		// The dead lease is taken aside with a move, not with a removal: the
		// move is atomic, so the file that is moved is the file that was
		// read. The lease that was moved is looked at again, and it is put
		// back when it is not the lease that was read: a lease that another
		// owner took in the gap must not be taken away.
		const aside = `${file}.stale-${process.pid}-${this.now()}`;
		try {
			renameSync(file, aside);
		} catch {
			// Somebody else took the name in the gap: the exclusive create
			// below decides.
		}
		const moved = this.readFile(aside);
		if (!moved || moved.owner !== existing.owner || moved.claimedAt !== existing.claimedAt) {
			// The file that was moved is not the lease that was read: it is
			// the fresh lease of somebody else. It is put back, and the
			// name is not free.
			this.restore(aside, file);
			return false;
		}
		try {
			rmSync(aside, { force: true });
		} catch {
			// The dead lease is rubbish in the directory: the cleanup
			// removes it.
		}
		try {
			atomicCreateFileSync(file, content);
			return "created";
		} catch {
			return false;
		}
	}

	/**
	 * Extend a lease that the owner holds.
	 *
	 * The lease is taken aside with a move before it is written again,
	 * and the lease that was moved is looked at again: a lease that
	 * another owner took in the gap is put back. The moment of the claim
	 * does not change: it is the same lease, it only runs longer.
	 */
	private extend(lease: HandoffLease, expiresAt: number): void {
		const file = this.fileFor(lease.key);
		const aside = `${file}.stale-${process.pid}-${this.now()}`;
		try {
			renameSync(file, aside);
		} catch {
			// The file is gone: there is nothing to extend.
			return;
		}
		const moved = this.readFile(aside);
		if (!moved || moved.owner !== lease.owner || moved.claimedAt !== lease.claimedAt) {
			// The file that was moved is not the lease that was read: it is
			// the fresh lease of somebody else. It is put back.
			this.restore(aside, file);
			return;
		}
		try {
			atomicCreateFileSync(file, JSON.stringify({ ...moved, expiresAt }, null, 2));
			rmSync(aside, { force: true });
		} catch {
			this.restore(aside, file);
		}
	}

	/**
	 * Extend the leases of the owner.
	 *
	 * The work of a handoff can run longer than the bound of a lease. A
	 * lease that is not extended runs out while the work is still
	 * running: the name is free again and the other path may start the
	 * same work. The owner renews its leases while it works, so the lease
	 * of a handoff is held as long as the work runs.
	 *
	 * A lease that ran out is not renewed: it is free again, and the
	 * owner has to take it again.
	 */
	renew(input: {
		/** The names of the handoff. */
		keys: readonly string[];
		/** The owner that holds the leases. */
		owner: string;
		/** How long the leases are held from now on. */
		leaseMs?: number;
	}): number {
		const leaseMs = input.leaseMs ?? HANDOFF_LEASE_DEFAULT_MS;
		const now = this.now();
		let renewed = 0;
		for (const key of input.keys) {
			const lease = this.read(key);
			if (!lease) continue;
			if (lease.owner !== input.owner) continue;
			if (lease.expiresAt <= now) continue;
			this.extend(lease, now + leaseMs);
			renewed += 1;
		}
		return renewed;
	}

	/**
	 * Put a file back under its name.
	 *
	 * The file is put back with a link, not with a move: a link does not
	 * replace a file that is there, so the lease of another owner is never
	 * taken away by the repair.
	 */
	private restore(aside: string, file: string): void {
		try {
			linkSync(aside, file);
			rmSync(aside, { force: true });
		} catch {
			// The name is taken again: the lease that was moved stays
			// beside the name as rubbish, and the cleanup removes it.
		}
	}

	/**
	 * The lease of a file, without the repair of a file that cannot be
	 * read.
	 */
	private readFile(file: string): HandoffLease | null {
		if (!existsSync(file)) return null;
		try {
			const raw = JSON.parse(readFileSync(file, "utf8")) as HandoffLease;
			if (!raw || typeof raw !== "object") return null;
			if (typeof raw.key !== "string" || typeof raw.owner !== "string") return null;
			return raw;
		} catch {
			return null;
		}
	}

	/**
	 * Give the names a claim took back.
	 */
	private releaseTaken(leases: readonly HandoffLease[]): void {
		for (const lease of leases) {
			try {
				rmSync(this.fileFor(lease.key), { force: true });
			} catch {
				// The file cannot be removed: the lease runs out on its own.
			}
		}
	}

	/**
	 * Give the lease of a handoff back.
	 *
	 * Only the owner may give it back: a session that lost the lease does
	 * not release the lease of somebody else.
	 */
	release(input: {
		/** The names of the handoff. */
		keys: readonly string[];
		/** The owner that gives the lease back. */
		owner: string;
	}): boolean {
		let released = false;
		for (const key of input.keys) {
			const lease = this.read(key);
			if (!lease) continue;
			if (lease.owner !== input.owner) continue;
			// The lease is taken aside with a move before it is removed: the
			// move is atomic, and the lease that was moved is looked at
			// again. A lease that another owner took in the gap between the
			// read and the removal is put back, so the release of one owner
			// never removes the lease of another one.
			const file = this.fileFor(key);
			const aside = `${file}.stale-${process.pid}-${this.now()}`;
			try {
				renameSync(file, aside);
			} catch {
				continue;
			}
			const moved = this.readFile(aside);
			if (!moved || moved.owner !== lease.owner || moved.claimedAt !== lease.claimedAt) {
				this.restore(aside, file);
				continue;
			}
			try {
				rmSync(aside, { force: true });
				released = true;
			} catch {
				// The file cannot be removed: the lease runs out on its own.
			}
		}
		return released;
	}

	/**
	 * The leases of one owner.
	 */
	leasesOf(owner: string): HandoffLease[] {
		const dir = this.dir();
		if (!existsSync(dir)) return [];
		const leases: HandoffLease[] = [];
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			try {
				const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as HandoffLease;
				if (raw && typeof raw === "object" && raw.owner === owner) {
					leases.push(raw);
				}
			} catch {
				// A broken file is the work of the repair: it must not hide
				// the other leases.
			}
		}
		return leases;
	}

	/**
	 * Remove the leases that ran out and the files that were kept aside.
	 *
	 * A lease that ran out holds nothing: it is only a name that is
	 * taken, and a name that is taken by nobody is free again. A file
	 * that was kept aside is a lease that could not be read: it holds
	 * nothing either, and it is only rubbish in the directory of the
	 * leases.
	 *
	 * The answer is the number of files that were removed.
	 */
	cleanup(): number {
		const dir = this.dir();
		if (!existsSync(dir)) return 0;
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return 0;
		}
		const now = this.now();
		let removed = 0;
		for (const name of names) {
			const file = join(dir, name);
			if (!name.endsWith(".json")) {
				// Only a file that is marked as rubbish is removed: a file
				// that the repair of an unreadable lease or the takeover
				// of a lease that ran out kept aside. Another file may be
				// in use right now, and the cleanup of a session must never
				// take the file of a live lease away.
				if (!/\.(broken|stale)-/.test(name)) continue;
				// A file that the takeover of a lease that ran out kept aside
				// may be in use right now: the takeover looks at it before
				// it puts it back. A file that is younger than the bound of
				// the lease is left alone, so the cleanup of another session
				// never takes the lease of a live owner away. A file of the
				// repair of an unreadable lease is rubbish at once: nobody
				// looks at it any more.
				if (/\.stale-/.test(name)) {
					let young = false;
					try {
						young = now - statSync(file).mtimeMs < HANDOFF_LEASE_DEFAULT_MS;
					} catch {
						young = false;
					}
					if (young) continue;
				}
				try {
					rmSync(file, { force: true });
					removed += 1;
				} catch {
					// The file cannot be removed: it stays rubbish.
				}
				continue;
			}
			let expired = true;
			try {
				const raw = JSON.parse(readFileSync(file, "utf8")) as HandoffLease;
				expired = typeof raw?.expiresAt !== "number" || raw.expiresAt <= now;
			} catch {
				// A file that cannot be read holds nothing.
				expired = true;
			}
			if (!expired) continue;
			try {
				rmSync(file, { force: true });
				removed += 1;
			} catch {
				// The file cannot be removed: the lease runs out on its own.
			}
		}
		return removed;
	}
}
