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
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
/**
 * The store of the replies.
 *
 * The replies of an exchange live under its correlation id, so two
 * concurrent exchanges never read the results of each other.
 */
export class ReplyStore {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    /**
     * Write a reply.
     */
    write(reply) {
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
    read(correlationId) {
        let names;
        try {
            names = readdirSync(join(this.directory, correlationId));
        }
        catch {
            return [];
        }
        const replies = [];
        for (const name of names) {
            if (!name.endsWith(".json"))
                continue;
            try {
                const parsed = JSON.parse(readFileSync(join(this.directory, correlationId, name), "utf8"));
                if (!isHandoffReply(parsed))
                    continue;
                replies.push(parsed);
            }
            catch {
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
    directory;
    now;
    constructor(directory, options = {}) {
        this.directory = directory;
        this.now = options.now ?? (() => Date.now());
    }
    /**
     * Publish a message.
     *
     * The handling is idempotent by the message id: publishing the same
     * message again keeps the state it already has.
     */
    publish(message) {
        const existing = this.read(message.id);
        if (existing)
            return existing;
        const entry = {
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
    pending() {
        return this.entries().filter((entry) => entry.state === "pending");
    }
    /**
     * The messages that still have to be delivered, oldest first.
     *
     * A message that was claimed but not acknowledged stays here: a crash
     * between the claim and the acknowledgement must not lose the plan.
     */
    claimable() {
        return this.entries().filter((entry) => entry.state === "pending" || entry.state === "claimed");
    }
    /**
     * The message that is already claimed or delivered.
     */
    read(id) {
        try {
            const parsed = JSON.parse(readFileSync(join(this.directory, `${id}.json`), "utf8"));
            return isMailboxEntry(parsed) ? parsed : undefined;
        }
        catch {
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
    claim(id) {
        const entry = this.read(id);
        if (!entry)
            return undefined;
        if (entry.state === "claimed" || entry.state === "delivered")
            return entry;
        const claimed = {
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
    acknowledge(id) {
        const entry = this.read(id);
        if (!entry)
            return undefined;
        const delivered = {
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
    cancel(id) {
        const entry = this.read(id);
        if (!entry)
            return undefined;
        const cancelled = { ...entry, state: "cancelled" };
        this.write(cancelled);
        return cancelled;
    }
    /**
     * Every message of the mailbox.
     */
    entries() {
        let names;
        try {
            names = readdirSync(this.directory);
        }
        catch {
            return [];
        }
        const entries = [];
        for (const name of names) {
            if (!name.endsWith(".json"))
                continue;
            const entry = this.read(name.slice(0, -".json".length));
            if (entry)
                entries.push(entry);
        }
        return entries.sort((left, right) => left.publishedAt - right.publishedAt);
    }
    /**
     * Remove the messages that were delivered or cancelled.
     */
    prune() {
        let removed = 0;
        for (const entry of this.entries()) {
            if (entry.state !== "delivered" && entry.state !== "cancelled")
                continue;
            try {
                unlinkSync(join(this.directory, `${entry.message.id}.json`));
                removed += 1;
            }
            catch {
                continue;
            }
        }
        return removed;
    }
    /**
     * Write one message.
     */
    write(entry) {
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
function isMailboxEntry(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value;
    return (typeof candidate.state === "string" &&
        typeof candidate.publishedAt === "number" &&
        typeof candidate.message === "object" &&
        candidate.message !== null);
}
/**
 * Whether a value is a reply.
 */
function isHandoffReply(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value;
    return (typeof candidate.id === "string" &&
        typeof candidate.correlationId === "string" &&
        typeof candidate.event === "string" &&
        typeof candidate.createdAt === "number");
}
//# sourceMappingURL=mailbox.js.map