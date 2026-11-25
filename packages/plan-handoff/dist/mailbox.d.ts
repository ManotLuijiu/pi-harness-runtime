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
import type { PlanHandoffMessage } from "./message.js";
/**
 * Is the value a name that may name a file or a folder of a store?
 *
 * A name is never a path. A separator, a null byte and the two names of
 * a folder of the parent would let a caller of the store reach outside
 * of it, so an identity that is not a name is refused before it is used.
 */
export declare function isStoreName(value: unknown): value is string;
/**
 * The state of a message in the mailbox.
 */
export type MailboxState = 
/** The message is there and nobody claimed it. */
"pending"
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
export declare class ReplyStore {
    private readonly directory;
    constructor(directory: string);
    /**
     * Write a reply.
     *
     * A reply that carries an identity that is not a name is refused: the
     * store holds a name, never a path.
     */
    write(reply: HandoffReply): void;
    /**
     * The replies of an exchange, oldest first.
     *
     * An exchange that is not named by a name has no replies: the store
     * is never read outside of itself. A reply that belongs to another
     * exchange is not the answer of this one, and it is not read.
     */
    read(correlationId: string): HandoffReply[];
}
/**
 * The mailbox of the messages of one recipient.
 *
 * The mailbox of an agent is a directory of its own: the recipient reads
 * only its own messages, and another instance of the same workspace never
 * reads them.
 */
export declare class Mailbox {
    private readonly directory;
    private readonly now;
    constructor(directory: string, options?: {
        now?: () => number;
    });
    /**
     * Publish a message.
     *
     * The handling is idempotent by the message id: publishing the same
     * message again keeps the state it already has.
     */
    publish(message: PlanHandoffMessage): MailboxEntry;
    /**
     * The messages that nobody claimed, oldest first.
     */
    pending(): MailboxEntry[];
    /**
     * The messages that still have to be delivered, oldest first.
     *
     * A message that was claimed but not acknowledged stays here: a crash
     * between the claim and the acknowledgement must not lose the plan.
     */
    claimable(): MailboxEntry[];
    /**
     * The message that is already claimed or delivered.
     *
     * A message that is not named by a name is not read: the mailbox is
     * never read outside of itself.
     */
    read(id: string): MailboxEntry | undefined;
    /**
     * Claim a message for the recipient.
     *
     * The claim is idempotent: a message that is already claimed by this
     * recipient is returned as it is, so a crash between the claim and the
     * acknowledgement does not lose the message.
     */
    claim(id: string): MailboxEntry | undefined;
    /**
     * Acknowledge the delivery of a message.
     */
    acknowledge(id: string): MailboxEntry | undefined;
    /**
     * Cancel a message.
     */
    cancel(id: string): MailboxEntry | undefined;
    /**
     * Every message of the mailbox.
     */
    entries(): MailboxEntry[];
    /**
     * Remove the messages that were delivered or cancelled.
     */
    prune(): number;
    /**
     * Write one message.
     *
     * A message that carries an identity that is not a name is refused:
     * the mailbox holds a name, never a path.
     */
    private write;
}
//# sourceMappingURL=mailbox.d.ts.map