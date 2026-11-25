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
import { join, resolve, sep } from "node:path";
/**
 * The longest name a store may hold.
 */
const MAX_NAME_LENGTH = 128;
/**
 * Is the value a name that may name a file or a folder of a store?
 *
 * A name is never a path. A separator, a null byte and the two names of
 * a folder of the parent would let a caller of the store reach outside
 * of it, so an identity that is not a name is refused before it is used.
 */
export function isStoreName(value) {
    return (typeof value === "string" &&
        value.length > 0 &&
        value.length <= MAX_NAME_LENGTH &&
        value !== "." &&
        value !== ".." &&
        !value.includes("/") &&
        !value.includes("\\") &&
        !value.includes("\0"));
}
/**
 * The path of a name inside a store, when the name stays inside it.
 *
 * The name is checked twice: once as a name, and once as a path that
 * resolves under the root of the store. The second check holds even when
 * the root of the store is a link.
 */
function storePath(root, name) {
    if (!isStoreName(name))
        return null;
    const base = resolve(root);
    const target = resolve(join(root, name));
    if (target !== base && !target.startsWith(`${base}${sep}`))
        return null;
    return target;
}
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
     *
     * A reply that carries an identity that is not a name is refused: the
     * store holds a name, never a path.
     */
    write(reply) {
        const target = storePath(this.directory, reply.correlationId);
        if (!target || !isStoreName(reply.id)) {
            throw new Error("the reply carries an identity that is not a name: it cannot be written into the store");
        }
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
     *
     * An exchange that is not named by a name has no replies: the store
     * is never read outside of itself. A reply that belongs to another
     * exchange is not the answer of this one, and it is not read.
     */
    read(correlationId) {
        const target = storePath(this.directory, correlationId);
        if (!target)
            return [];
        let names;
        try {
            names = readdirSync(target);
        }
        catch {
            return [];
        }
        const replies = [];
        for (const name of names) {
            if (!name.endsWith(".json"))
                continue;
            try {
                const parsed = JSON.parse(readFileSync(join(target, name), "utf8"));
                if (!isHandoffReply(parsed))
                    continue;
                if (parsed.correlationId !== correlationId)
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
     *
     * A message that is not named by a name is not read: the mailbox is
     * never read outside of itself.
     */
    read(id) {
        const file = storePath(this.directory, `${id}.json`);
        if (!file)
            return undefined;
        try {
            const parsed = JSON.parse(readFileSync(file, "utf8"));
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
            const file = storePath(this.directory, `${entry.message.id}.json`);
            if (!file)
                continue;
            try {
                unlinkSync(file);
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
     *
     * A message that carries an identity that is not a name is refused:
     * the mailbox holds a name, never a path.
     */
    write(entry) {
        if (!isStoreName(entry.message.id)) {
            throw new Error("the message carries an identity that is not a name: it cannot be written into the mailbox");
        }
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