/**
 * The publication of a plan.
 *
 * The sender publishes a plan for the workspace it runs in. The publication
 * decides who receives it:
 *
 * - exactly one live instance of the workspace: the plan is addressed to it,
 * - several live instances: the existing pairing decides, otherwise the
 *   candidates are exposed and the user chooses,
 * - no live instance: the plan is retained until one appears.
 *
 * The plan is never addressed to an instance of another project, and the
 * model label never decides.
 */
import type { CreatePlanHandoffMessage, PlanHandoffMessage, PlanHandoffRecipientIdentity } from "./message.js";
import { matchingRegistrations, type RecipientPairing, type RecipientResolution } from "./routing.js";
import type { AgentRegistration } from "./registry.js";
/**
 * The outcome of a publication.
 */
export type PublicationOutcome = 
/** The plan is addressed to an instance and may be delivered. */
"addressed"
/** Several instances match: the user chooses the recipient. */
 | "needs-recipient"
/** No instance matches: the plan waits for one. */
 | "retained";
/**
 * The result of a publication.
 */
export interface PublicationResult {
    /** What the publication decided. */
    outcome: PublicationOutcome;
    /** The message, when the plan could be addressed. */
    message?: PlanHandoffMessage;
    /** The instance the plan is addressed to. */
    recipient?: AgentRegistration;
    /** The instances that matched, for a selection by the user. */
    candidates: AgentRegistration[];
    /** Why the publication decided that, in words. */
    reason: string;
    /** The routing the publication used. */
    resolution: RecipientResolution;
}
/**
 * The content of a publication: the plan and the action it asks for.
 *
 * The sender and the recipient are not part of it: the publication decides
 * the recipient and fills the sender in.
 */
export type PublishPlanContent = Omit<CreatePlanHandoffMessage, "sender" | "recipient">;
/**
 * The options of a publication.
 */
export interface PublishPlanOptions {
    /** The plan and the action it asks for. */
    plan: PublishPlanContent;
    /** The identity of the sender. */
    sender: {
        agentId: string;
        sessionId: string;
        workspace?: string;
        label?: string;
    };
    /** The live registrations of the store. */
    registrations: AgentRegistration[];
    /** The host of the sender. */
    host?: string;
    /** The pairing that was selected before. */
    pairing?: RecipientPairing;
    /** The working directory of the sender. The process directory by default. */
    cwd?: string;
    /** The clock of the publication. */
    now?: () => number;
}
/**
 * The recipient identity of a registration.
 */
export declare function recipientIdentity(registration: AgentRegistration): PlanHandoffRecipientIdentity;
/**
 * Publish a plan.
 *
 * The publication never throws and never delivers to an instance that does
 * not run in the workspace of the sender.
 */
export declare function publishPlan(options: PublishPlanOptions): PublicationResult;
/**
 * The instances of the workspace that a user can choose from.
 *
 * The choice is presented with the identity of every candidate, because the
 * model label is not an identity and the user has to be able to tell the
 * instances apart.
 */
export declare function describeCandidates(candidates: AgentRegistration[]): string[];
export { matchingRegistrations };
//# sourceMappingURL=publish.d.ts.map