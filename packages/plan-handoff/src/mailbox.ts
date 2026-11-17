/**
 * The durable mailbox of the plan handoff.
 *
 * The mailbox is the recoverable source of the delivery state. Every message
 * owns one file, so two senders never overwrite each other, and the write of
 * a file is atomic: a reader never sees half a message.
 *
 * The delivery is at-least-once and the handling is idempotent by the
 * message id: a message that is published twice is one message, and a
 * message that is claimed after a crash is claimed again by the recipient
 * that finds it pending.
 *
 * The mailbox holds nothing but the plan. It never holds cookies, keys or
 * conversation transcripts.
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
import type { PlanHandoffMessage } from "./message.js";

/**
 * The state of a message in the mailbox.
 */
export type MailboxState =
	/** The message is there and nobody claimed it. */
	| "pending"
	/** The recipient claimed the message and works on it. */
	| "claimed"
	/** The recipient delivered the message to its model. */
	| "delivered"
	/** The message was cancelled. */
	| "cancelled";

/**
 * One message in the mailbox.
 */
export interface MailboxEntry {
	/** The state of the message. */
	state: MailboxState;
	/** When the message was published. */
	publishedAt: number;
	/** When the message was claimed. */
	claimedAt?: number;
	/** When the message was delivered. */
	deliveredAt?: number;
	/** The message itself. */
	message: PlanHandoffMessage;
}

/**
 * The reply of a recipient.
 */
export interface HandoffReply {
	/** The identity of the reply. */
	id: string;
	/** The correlation id of the exchange. */
	correlationId: string;
	/** The event of the reply. */
	event: "received" | "started" | "result" | "question" | "blocked" | "completed";
	/** When the reply was written. */
	createdAt: number;
	/** The payload of the reply. */
	detail?: string;
}

/**
 * The store of the replies.
 *
 * The replies of an exchange live under its correlation id, so two
 * concurrent exchanges never read the results of each other.
 */
export class ReplyStore {
	private readonly directory: string;

	constructor(directory: string) {
		this.directory = directory;
	}

	/**
	 * Write a reply.
	 */
	write(reply: HandoffReply): void {
		const target = join(this.directory, reply.correlationId);
		mkdirSync(target, { recursive: true });
		const file = join(target, `${reply.id}.json`);
		const temporary = `${file}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(reply, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, file);
	}

	/**
	 * The replies of an exchange, oldest first.
	 */
	read(correlationId: string): HandoffReply[] {
		let names: string[];
		try {
			names = readdirSync(join(this.directory, correlationId));
		} catch {
			return [];
		}
		const replies: HandoffReply[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				const parsed: unknown = JSON.parse(
					readFileSync(join(this.directory, correlationId, name), "utf8"),
				);
				if (!isHandoffReply(parsed)) continue;
				replies.push(parsed);
			} catch {
				continue;
			}
		}
		return replies.sort((left, right) => left.createdAt - right.createdAt);
	}
}

/**
 * The mailbox of the messages of one recipient.
 *
 * The mailbox of an agent is a directory of its own: the recipient reads
 * only its own messages, and another instance of the same workspace never
 * reads them.
 */
export class Mailbox {
	private readonly directory: string;
	private readonly now: () => number;

	constructor(directory: string, options: { now?: () => number } = {}) {
		this.directory = directory;
		this.now = options.now ?? (() => Date.now());
	}

	/**
	 * Publish a message.
	 *
	 * The handling is idempotent by the message id: publishing the same
	 * message again keeps the state it already has.
	 */
	publish(message: PlanHandoffMessage): MailboxEntry {
		const existing = this.read(message.id);
		if (existing) return existing;
		const entry: MailboxEntry = {
			state: "pending",
			publishedAt: this.now(),
			message,
		};
		this.write(entry);
		return entry;
	}

	/**
	 * The messages that nobody claimed, oldest first.
	 */
	pending(): MailboxEntry[] {
		return this.entries().filter((entry) => entry.state === "pending");
	}

	/**
	 * The message that is already claimed or delivered.
	 */
	read(id: string): MailboxEntry | undefined {
		try {
			const parsed: unknown = JSON.parse(
				readFileSync(join(this.directory, `${id}.json`), "utf8"),
			);
			return isMailboxEntry(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Claim a message for the recipient.
	 *
	 * The claim is idempotent: a message that is already claimed by this
	 * recipient is returned as it is, so a crash between the claim and the
	 * acknowledgement does not lose the message.
	 */
	claim(id: string): MailboxEntry | undefined {
		const entry = this.read(id);
		if (!entry) return undefined;
		if (entry.state === "claimed" || entry.state === "delivered") return entry;
		const claimed: MailboxEntry = {
			...entry,
			state: "claimed",
			claimedAt: this.now(),
		};
		this.write(claimed);
		return claimed;
	}

	/**
	 * Acknowledge the delivery of a message.
	 */
	acknowledge(id: string): MailboxEntry | undefined {
		const entry = this.read(id);
		if (!entry) return undefined;
		const delivered: MailboxEntry = {
			...entry,
			state: "delivered",
			deliveredAt: this.now(),
		};
		this.write(delivered);
		return delivered;
	}

	/**
	 * Cancel a message.
	 */
	cancel(id: string): MailboxEntry | undefined {
		const entry = this.read(id);
		if (!entry) return undefined;
		const cancelled: MailboxEntry = { ...entry, state: "cancelled" };
		this.write(cancelled);
		return cancelled;
	}

	/**
	 * Every message of the mailbox.
	 */
	entries(): MailboxEntry[] {
		let names: string[];
		try {
			names = readdirSync(this.directory);
		} catch {
			return [];
		}
		const entries: MailboxEntry[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const entry = this.read(name.slice(0, -".json".length));
			if (entry) entries.push(entry);
		}
		return entries.sort(
			(left, right) => left.publishedAt - right.publishedAt,
		);
	}

	/**
	 * Remove the messages that were delivered or cancelled.
	 */
	prune(): number {
		let removed = 0;
		for (const entry of this.entries()) {
			if (entry.state !== "delivered" && entry.state !== "cancelled") continue;
			try {
				unlinkSync(join(this.directory, `${entry.message.id}.json`));
				removed += 1;
			} catch {
				continue;
			}
		}
		return removed;
	}

	/**
	 * Write one message.
	 */
	private write(entry: MailboxEntry): void {
		mkdirSync(this.directory, { recursive: true });
		const file = join(this.directory, `${entry.message.id}.json`);
		const temporary = `${file}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(entry, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, file);
	}
}

/**
 * Whether a value is a message of the mailbox.
 */
function isMailboxEntry(value: unknown): value is MailboxEntry {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<MailboxEntry>;
	return (
		typeof candidate.state === "string" &&
		typeof candidate.publishedAt === "number" &&
		typeof candidate.message === "object" &&
		candidate.message !== null
	);
}

/**
 * Whether a value is a reply.
 */
function isHandoffReply(value: unknown): value is HandoffReply {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<HandoffReply>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.correlationId === "string" &&
		typeof candidate.event === "string" &&
		typeof candidate.createdAt === "number"
	);
}
