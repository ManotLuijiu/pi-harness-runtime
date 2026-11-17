/**
 * The routing of a plan handoff to its recipient.
 *
 * The sender publishes a plan for the workspace it runs in. The recipient is
 * the Pi instance of that same workspace, addressed by its unique agent id
 * and its session id. The rules are:
 *
 * - exactly one live instance of the workspace: it is selected, without a
 *   question to the user,
 * - several live instances: an existing live pairing decides, otherwise the
 *   candidates are exposed and the user chooses,
 * - no live instance: the plan is retained as awaiting a recipient,
 * - an instance of another project never receives the plan.
 *
 * The model label never decides. The globally newest session never decides.
 */
import type { AgentRegistration } from "./registry.js";
/**
 * How the recipient was resolved.
 */
export type RecipientStatus = "selected" | "ambiguous" | "awaiting";
/**
 * The result of the routing.
 */
export interface RecipientResolution {
    /** What the router decided. */
    status: RecipientStatus;
    /** The selected instance, when there is exactly one. */
    registration?: AgentRegistration;
    /** The instances that matched the workspace. */
    candidates: AgentRegistration[];
    /** Why the router decided that, in words. */
    reason: string;
}
/**
 * A pairing that was selected before.
 */
export interface RecipientPairing {
    /** The agent id of the paired instance. */
    agentId: string;
    /** The session of the paired instance, when it was recorded. */
    sessionId?: string;
}
/**
 * The options of the routing.
 */
export interface ResolveRecipientOptions {
    /** The canonical workspace of the sender. */
    workspace: string;
    /** The host of the sender. Only the instances of that host match. */
    host?: string;
    /** The live registrations of the store. */
    registrations: AgentRegistration[];
    /** A pairing that was selected before. */
    pairing?: RecipientPairing;
}
/**
 * The registrations that live in the workspace of the sender.
 *
 * The match is an exact match of the canonical workspace and of the host. A
 * workspace that only shares a name, a repository or a branch is another
 * workspace.
 */
export declare function matchingRegistrations(workspace: string, registrations: AgentRegistration[], host?: string): AgentRegistration[];
/**
 * Resolve the recipient of a plan.
 */
export declare function resolveRecipient(options: ResolveRecipientOptions): RecipientResolution;
//# sourceMappingURL=routing.d.ts.map