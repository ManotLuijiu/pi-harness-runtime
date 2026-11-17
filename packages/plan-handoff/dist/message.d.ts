/**
 * The message of a plan handoff.
 *
 * A message names its sender, its recipient, the workspace it belongs to,
 * the plan it carries and the action it asks for. The hash of the payload
 * detects a change of the plan; it does not authenticate the sender.
 *
 * The plan text is task data. It is never a source of system-level
 * instructions, and it is never executed because it says so.
 */
import type { AgentRegistration } from "./registry.js";
/**
 * The version of the schema of the message.
 */
export declare const PLAN_HANDOFF_SCHEMA_VERSION = 1;
/**
 * The largest payload a message may carry.
 */
export declare const MAX_PLAN_PAYLOAD_BYTES = 1000000;
/**
 * The longest summary a message may carry.
 */
export declare const MAX_PLAN_SUMMARY_LENGTH = 2000;
/**
 * The actions a message may ask for.
 */
export type PlanHandoffAction = "inform" | "review" | "implement";
/**
 * The identity of one side of the handoff.
 */
export interface PlanHandoffIdentity {
    /** The runtime-generated identity of the instance. */
    agentId: string;
    /** The session of the instance. */
    sessionId: string;
    /** The canonical workspace of the instance. */
    workspace: string;
    /** A descriptive label, for a human. Never an identity. */
    label?: string;
}
/**
 * The identity of the recipient, with the generation of its instance.
 */
export interface PlanHandoffRecipientIdentity extends PlanHandoffIdentity {
    /** The generation of the instance: a restart raises it. */
    generation: number;
}
/**
 * The plan a message carries.
 */
export interface PlanHandoffPlan {
    /** The revision of the plan. */
    revision: string;
    /** The hash of the payload. It detects a change, nothing more. */
    hash: string;
    /** The summary of the plan, for a human and for a notification. */
    summary: string;
    /** The plan itself, when it is small enough to travel in the message. */
    payload?: string;
    /** A reference to the plan inside the workspace, when it is a file. */
    reference?: string;
}
/**
 * The scope a message is authorized for.
 */
export interface PlanHandoffScope {
    /** The paths inside the workspace the action may touch. */
    paths?: string[];
}
/**
 * A message of the plan handoff.
 */
export interface PlanHandoffMessage {
    schemaVersion: number;
    /** The identity of this message. */
    id: string;
    /** The identity of the exchange this message belongs to. */
    correlationId: string;
    /** When the message was created. */
    createdAt: string;
    /** The side that publishes the plan. */
    sender: PlanHandoffIdentity;
    /** The side that receives the plan. */
    recipient: PlanHandoffRecipientIdentity;
    /** The canonical workspace the message belongs to. */
    workspace: string;
    /** The plan. */
    plan: PlanHandoffPlan;
    /** The action the message asks for. */
    action: PlanHandoffAction;
    /** The scope the action is authorized for. */
    scope?: PlanHandoffScope;
    /** Where the reply goes. */
    replyRef?: {
        agentId: string;
        sessionId: string;
        correlationId: string;
    };
}
/**
 * The hash of a payload.
 */
export declare function hashPlanPayload(payload: string): string;
/**
 * The input of a new message.
 */
export interface CreatePlanHandoffMessage {
    sender: PlanHandoffIdentity;
    recipient: PlanHandoffRecipientIdentity;
    plan: Omit<PlanHandoffPlan, "hash"> & {
        hash?: string;
    };
    action: PlanHandoffAction;
    scope?: PlanHandoffScope;
    correlationId?: string;
    createdAt?: string;
    now?: () => number;
}
/**
 * Build a message of the plan handoff.
 *
 * The hash of the payload is computed when the payload is given, so the
 * receiver can detect a change of the plan without trusting the sender.
 */
export declare function createPlanHandoffMessage(input: CreatePlanHandoffMessage): PlanHandoffMessage;
/**
 * The result of a validation.
 */
export interface ValidationResult {
    ok: boolean;
    /** The reasons of the refusal, in words. */
    reasons: string[];
}
/**
 * Validate a message before it is queued.
 *
 * The validation checks the schema, the required fields, the size of the
 * payload, the path boundaries of the reference and of the scope, and the
 * hash of the payload. It does not authenticate the sender: a hash detects
 * a change, nothing more.
 */
export declare function validatePlanHandoffMessage(message: PlanHandoffMessage): ValidationResult;
/**
 * Validate that the message is addressed to this instance.
 *
 * The recipient validates the agent id, the session id, the generation and
 * the workspace immediately before it queues anything. A message for a
 * session that ended is not for this instance, and a plan of another
 * workspace never enters this queue.
 */
export declare function validateRecipientIdentity(message: PlanHandoffMessage, registration: AgentRegistration): ValidationResult;
//# sourceMappingURL=message.d.ts.map