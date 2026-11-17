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
import type { AgentRegistration } from "./registry.js";
/**
 * How long a retained handoff waits for a recipient.
 */
export declare const DEFAULT_HANDOFF_RETENTION_MS: number;
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
export declare class PendingHandoffStore {
    private readonly directory;
    private readonly retentionMs;
    constructor(directory: string, options?: {
        retentionMs?: number;
    });
    /**
     * The retained handoffs, expired ones included.
     */
    list(): PendingHandoff[];
    /**
     * The handoffs that wait for a recipient and did not expire.
     */
    awaiting(now?: number): PendingHandoff[];
    /**
     * Retain a handoff.
     */
    retain(handoff: PendingHandoff): void;
    /**
     * Retain a handoff with the expiry of the store.
     *
     * The caller names the handoff and the store names its expiry: the
     * retention of the deployment is one number, and it is not written
     * twice in two callers.
     */
    retainWithExpiry(handoff: Omit<PendingHandoff, "expiresAt">, now?: number): PendingHandoff;
    /**
     * Claim a retained handoff for an instance.
     *
     * The claim is explicit: the caller names the instance the handoff goes
     * to, and the state of the handoff records it.
     */
    claim(id: string, registration: AgentRegistration, now?: number): PendingHandoff | undefined;
    /**
     * Cancel a retained handoff.
     */
    cancel(id: string): boolean;
    /**
     * Remove the handoffs that expired.
     */
    prune(now?: number): number;
    /**
     * Read one handoff.
     */
    read(id: string): PendingHandoff | undefined;
}
/**
 * The handoffs of a workspace that wait for a recipient.
 */
export declare function awaitingInWorkspace(store: PendingHandoffStore, workspace: string, now?: number): PendingHandoff[];
//# sourceMappingURL=retention.d.ts.map