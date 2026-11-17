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

import { createHash, randomUUID } from "node:crypto";
import { canonicalizePath, isInsideWorkspace } from "./workspace.js";
import type { AgentRegistration } from "./registry.js";

/**
 * The version of the schema of the message.
 */
export const PLAN_HANDOFF_SCHEMA_VERSION = 1;

/**
 * The largest payload a message may carry.
 */
export const MAX_PLAN_PAYLOAD_BYTES = 1_000_000;

/**
 * The longest summary a message may carry.
 */
export const MAX_PLAN_SUMMARY_LENGTH = 2_000;

/**
 * The actions a message may ask for.
 */
export type PlanHandoffAction = "inform" | "review" | "implement";

/**
 * The actions, as a set.
 */
const ACTIONS = new Set<string>(["inform", "review", "implement"]);

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
export function hashPlanPayload(payload: string): string {
	return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * The input of a new message.
 */
export interface CreatePlanHandoffMessage {
	sender: PlanHandoffIdentity;
	recipient: PlanHandoffRecipientIdentity;
	plan: Omit<PlanHandoffPlan, "hash"> & { hash?: string };
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
export function createPlanHandoffMessage(
	input: CreatePlanHandoffMessage,
): PlanHandoffMessage {
	const now = input.now ?? (() => Date.now());
	const hash =
		input.plan.hash ??
		(input.plan.payload === undefined
			? hashPlanPayload(input.plan.reference ?? "")
			: hashPlanPayload(input.plan.payload));
	const message: PlanHandoffMessage = {
		schemaVersion: PLAN_HANDOFF_SCHEMA_VERSION,
		id: randomUUID(),
		correlationId: input.correlationId ?? randomUUID(),
		createdAt: input.createdAt ?? new Date(now()).toISOString(),
		sender: { ...input.sender },
		recipient: { ...input.recipient },
		workspace: canonicalizePath(input.sender.workspace),
		plan: { ...input.plan, hash },
		action: input.action,
		scope: input.scope,
	};
	return message;
}

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
export function validatePlanHandoffMessage(
	message: PlanHandoffMessage,
): ValidationResult {
	const reasons: string[] = [];

	if (message?.schemaVersion !== PLAN_HANDOFF_SCHEMA_VERSION) {
		reasons.push(
			`the schema version is ${String(message?.schemaVersion)}, the receiver speaks ${PLAN_HANDOFF_SCHEMA_VERSION}`,
		);
	}
	if (!message?.id) reasons.push("the message has no id");
	if (!message?.correlationId) reasons.push("the message has no correlation id");
	if (!message?.createdAt) reasons.push("the message has no creation time");

	for (const [name, identity] of [
		["sender", message?.sender],
		["recipient", message?.recipient],
	] as const) {
		if (!identity?.agentId) reasons.push(`the ${name} has no agent id`);
		if (!identity?.sessionId) reasons.push(`the ${name} has no session id`);
		if (!identity?.workspace) reasons.push(`the ${name} has no workspace`);
	}
	if (
		message?.recipient &&
		typeof message.recipient.generation !== "number"
	) {
		reasons.push("the recipient has no instance generation");
	}
	if (!ACTIONS.has(String(message?.action))) {
		reasons.push(`the action ${String(message?.action)} is not one of inform, review, implement`);
	}

	const plan = message?.plan;
	if (!plan?.revision) reasons.push("the plan has no revision");
	if (!plan?.summary) reasons.push("the plan has no summary");
	if (plan?.summary && plan.summary.length > MAX_PLAN_SUMMARY_LENGTH) {
		reasons.push(
			`the summary is ${plan.summary.length} characters long, the maximum is ${MAX_PLAN_SUMMARY_LENGTH}`,
		);
	}
	if (plan?.payload !== undefined) {
		const bytes = Buffer.byteLength(plan.payload, "utf8");
		if (bytes > MAX_PLAN_PAYLOAD_BYTES) {
			reasons.push(
				`the payload is ${bytes} bytes, the maximum is ${MAX_PLAN_PAYLOAD_BYTES}`,
			);
		}
		if (plan.hash && plan.hash !== hashPlanPayload(plan.payload)) {
			reasons.push("the hash of the payload does not match the payload");
		}
	}

	const workspace = message?.workspace;
	if (workspace) {
		if (plan?.reference && !isInsideWorkspace(plan.reference, workspace)) {
			reasons.push("the reference of the plan lies outside the workspace");
		}
		for (const path of message?.scope?.paths ?? []) {
			if (!isInsideWorkspace(path, workspace)) {
				reasons.push(`the scope names ${path}, which lies outside the workspace`);
			}
		}
	}

	return { ok: reasons.length === 0, reasons };
}

/**
 * Validate that the message is addressed to this instance.
 *
 * The recipient validates the agent id, the session id, the generation and
 * the workspace immediately before it queues anything. A message for a
 * session that ended is not for this instance, and a plan of another
 * workspace never enters this queue.
 */
export function validateRecipientIdentity(
	message: PlanHandoffMessage,
	registration: AgentRegistration,
): ValidationResult {
	const reasons: string[] = [];
	const recipient = message?.recipient;
	if (!recipient) {
		return { ok: false, reasons: ["the message has no recipient"] };
	}
	if (recipient.agentId !== registration.agentId) {
		reasons.push("the message is addressed to another agent id");
	}
	if (recipient.sessionId !== registration.sessionId) {
		reasons.push("the message is addressed to another session");
	}
	if (recipient.generation !== registration.generation) {
		reasons.push("the message is addressed to another instance generation");
	}
	if (
		canonicalizePath(recipient.workspace) !==
		canonicalizePath(registration.workspace)
	) {
		reasons.push("the message belongs to another workspace");
	}
	return { ok: reasons.length === 0, reasons };
}
