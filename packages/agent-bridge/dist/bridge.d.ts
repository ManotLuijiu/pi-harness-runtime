/**
 * The core of the reverse bridge.
 *
 * A worker of another vendor may address a live Pi session. The worker
 * sends a message into the mailbox of the instance, and the receiver of
 * the instance delivers it to its session. The worker reads the result of
 * the exchange from the replies of the exchange.
 *
 * The rules that must hold:
 *
 * - a message names the instance it is for: the agent id, the session id,
 *   the generation and the workspace,
 * - an instance that is not live any more never receives a message,
 * - an instance of another workspace never receives a message,
 * - the globally newest session never decides: the routing decides only
 *   when exactly one instance of the workspace is live,
 * - a message is accepted, not completed: the answer of the session comes
 *   later, as a reply of the exchange,
 * - a busy instance defers the message: it waits in the mailbox until the
 *   instance is free.
 */
import type { BridgeAction, BridgeAgent, BridgeCancelResult, BridgeResult, BridgeSendInput, BridgeSendResult } from "./types.js";
/**
 * Is the value an action a message may ask for?
 *
 * The arguments of a tool come from the worker, so they are checked
 * before they are used.
 */
export declare function isBridgeAction(value: unknown): value is BridgeAction;
/**
 * The home of the plan handoff state of the user.
 */
export declare const BRIDGE_HOME: string;
/**
 * The options of the bridge.
 */
export interface BridgeOptions {
    /** The directory of the registrations of the live instances. */
    registryDir?: string;
    /** The directory of the mailboxes of the instances. */
    mailboxDir?: string;
    /** The directory of the replies of the exchanges. */
    replyDir?: string;
    /** The host this bridge runs on. */
    host?: string;
    /**
     * The canonical workspace of the sender.
     *
     * The worker runs in a copy of the workspace, so the copy is not the
     * workspace of the user. The bridge is told the workspace of the user.
     */
    workspace: string;
    /** The identity of the sender. */
    sender: {
        agentId: string;
        sessionId: string;
        label?: string;
    };
    /** The clock of the bridge. */
    now?: () => number;
}
/**
 * The live instances of the bridge.
 */
export declare function listAgents(options: BridgeOptions): BridgeAgent[];
/**
 * Send a message to a live instance.
 */
export declare function sendToAgent(options: BridgeOptions, input: BridgeSendInput): BridgeSendResult;
/**
 * Read the result of an exchange.
 */
export declare function readResult(options: BridgeOptions, correlationId: string): BridgeResult;
/**
 * Cancel a message that was sent.
 *
 * The message is cancelled in the mailbox of the instance it was sent to.
 * A message that was already delivered is not cancelled: the session has
 * it already.
 */
export declare function cancelMessage(options: BridgeOptions, input: {
    agentId: string;
    messageId?: string;
    correlationId?: string;
}): BridgeCancelResult;
//# sourceMappingURL=bridge.d.ts.map