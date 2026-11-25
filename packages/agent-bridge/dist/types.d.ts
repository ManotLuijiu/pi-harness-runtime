/**
 * The shapes of the reverse bridge.
 *
 * The bridge lets a worker of another vendor address a live Pi session.
 * Every message of the bridge names the instance it is for: the agent id,
 * the session id, the generation and the workspace. A message that names
 * an instance that is not live any more is refused: a session that ended
 * does not receive the message of its successor.
 */
/**
 * The action a message asks for.
 *
 * The actions are the ones of the plan handoff: a message informs, asks
 * for a review or asks for an implementation. A message never approves
 * anything and never runs a command of the session.
 */
export type BridgeAction = "inform" | "review" | "implement";
/**
 * The identity of one instance of the bridge.
 */
export interface BridgeIdentity {
    /** The runtime-generated identity of the instance. */
    agentId: string;
    /** The session of the instance. */
    sessionId: string;
    /** The generation of the instance. A restart raises it. */
    generation?: number;
    /** The canonical workspace of the instance. */
    workspace?: string;
    /** The host the instance runs on. */
    host?: string;
}
/**
 * One live instance of the bridge.
 */
export interface BridgeAgent {
    agentId: string;
    sessionId: string;
    generation: number;
    workspace: string;
    host: string;
    /** True while the instance works on something. */
    busy: boolean;
    /** True while the user paused the instance. */
    paused: boolean;
    /** The model of the instance. Descriptive, never an identity. */
    modelLabel?: string;
    /** When the instance started. */
    startedAt: number;
}
/**
 * The input of a message.
 */
export interface BridgeSendInput {
    /**
     * The instance the message is for.
     *
     * The caller names the instance when it knows it. Without a name the
     * routing decides, and it decides only when exactly one instance of
     * the workspace is live: the globally newest session never decides.
     */
    agentId?: string;
    /** The session of the instance, when the caller knows it. */
    sessionId?: string;
    /** The generation of the instance, when the caller knows it. */
    generation?: number;
    /** The action the message asks for. */
    action: BridgeAction;
    /** The summary of the message, for a human and for a notification. */
    summary: string;
    /** The body of the message. */
    payload?: string;
    /** A reference to a file of the workspace, when the message names one. */
    reference?: string;
    /** The paths inside the workspace the action may touch. */
    paths?: string[];
    /** The id of the exchange, when the caller wants to follow it. */
    correlationId?: string;
}
/**
 * The result of a message.
 */
export interface BridgeSendResult {
    /**
     * What the bridge decided.
     *
     * - `accepted`: the message is in the mailbox of the instance,
     * - `deferred`: the message is in the mailbox and the instance is busy;
     *   it is delivered when the instance is free,
     * - `refused`: the message was not sent, and the reason says why.
     */
    status: "accepted" | "deferred" | "refused";
    /** The id of the exchange. */
    correlationId: string;
    /** The id of the message, when it was sent. */
    messageId?: string;
    /** The instance the message was sent to. */
    recipient?: BridgeIdentity;
    /** Why the bridge decided that, in words. */
    reason: string;
}
/**
 * The state of an exchange.
 */
export type BridgeResultStatus = 
/** Nobody answered yet. */
"pending"
/** The instance took the message. */
 | "accepted"
/** The instance worked on it and finished. */
 | "completed"
/** The instance is blocked and needs a human. */
 | "blocked"
/** The instance asked a question. */
 | "question"
/** The exchange is unknown to the bridge. */
 | "unknown";
/**
 * One reply of an exchange.
 */
export interface BridgeReply {
    /** The event of the reply. */
    event: string;
    /** When the reply was written. */
    createdAt: number;
    /** The payload of the reply. */
    detail?: string;
}
/**
 * The result of an exchange.
 */
export interface BridgeResult {
    /** The id of the exchange. */
    correlationId: string;
    /** The state of the exchange. */
    status: BridgeResultStatus;
    /** The replies of the exchange, oldest first. */
    replies: BridgeReply[];
    /** Why the bridge decided that, in words. */
    reason: string;
}
/**
 * The result of a cancel.
 */
export interface BridgeCancelResult {
    status: "cancelled" | "refused" | "unknown";
    reason: string;
}
//# sourceMappingURL=types.d.ts.map