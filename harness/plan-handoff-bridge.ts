/**
 * The bridge between the sender and the recipient of a plan.
 *
 * The sender publishes a plan into the mailbox of the instance it selected.
 * The recipient reads its own mailbox and delivers the plans that are
 * addressed to it.
 *
 * The bridge never delivers a plan to an instance of another workspace: the
 * mailbox of an agent belongs to that agent, and the routing decided the
 * recipient before the message was written.
 */

import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
	Mailbox,
	PairingStore,
	PendingHandoffStore,
	RegistrationStore,
	ReplyStore,
	publishPlan,
	type AgentRegistration,
	type PlanHandoffMessage,
	type PublicationResult,
	type PublishPlanContent,
	type RecipientPairing,
} from "../packages/plan-handoff/dist/index.js";

/**
 * The directory of the handoff state of the user.
 */
export const PLAN_HANDOFF_HOME = join(
	homedir(),
	".pi-harness-runtime",
	"plan-handoff",
);

/**
 * The directory of the registrations.
 */
export const PLAN_HANDOFF_REGISTRY_DIR = join(PLAN_HANDOFF_HOME, "agents");

/**
 * The directory of the retained handoffs.
 */
export const PLAN_HANDOFF_RETAINED_DIR = join(PLAN_HANDOFF_HOME, "retained");

/**
 * The directory of the mailboxes.
 */
export const PLAN_HANDOFF_MAILBOX_DIR = join(PLAN_HANDOFF_HOME, "mailboxes");

/**
 * The directory of the replies.
 */
export const PLAN_HANDOFF_REPLY_DIR = join(PLAN_HANDOFF_HOME, "replies");

/**
 * The file that remembers the pairing of a workspace.
 */
export const PLAN_HANDOFF_PAIRING_FILE = join(
	PLAN_HANDOFF_HOME,
	"pairings.json",
);

/**
 * The store of the registrations of the user.
 */
export function planHandoffRegistry(): RegistrationStore {
	return new RegistrationStore(PLAN_HANDOFF_REGISTRY_DIR);
}

/**
 * The store of the pairings of the user.
 */
export function planHandoffPairings(): PairingStore {
	return new PairingStore(PLAN_HANDOFF_PAIRING_FILE);
}

/**
 * The store of the retained handoffs of the user.
 */
export function planHandoffRetained(): PendingHandoffStore {
	return new PendingHandoffStore(PLAN_HANDOFF_RETAINED_DIR);
}

/**
 * The store of the replies of the user.
 */
export function planHandoffReplies(): ReplyStore {
	return new ReplyStore(PLAN_HANDOFF_REPLY_DIR);
}

/**
 * The mailbox of one agent.
 */
export function planHandoffMailbox(agentId: string): Mailbox {
	return new Mailbox(join(PLAN_HANDOFF_MAILBOX_DIR, agentId));
}

/**
 * The options of a publication through the bridge.
 */
export interface BridgePublishOptions {
	/** The plan and the action it asks for. */
	plan: PublishPlanContent;
	/** The identity of the sender. */
	sender: {
		agentId: string;
		sessionId: string;
		workspace?: string;
		label?: string;
	};
	/** The working directory of the sender. */
	cwd?: string;
	/** The host of the sender. */
	host?: string;
	/** The pairing that was selected before. */
	pairing?: RecipientPairing;
	/** The clock of the publication. */
	now?: () => number;
}

/**
 * The result of a publication through the bridge.
 */
export interface BridgePublishResult {
	/** What the publication decided. */
	outcome: "addressed" | "needs-recipient" | "retained";
	/** The instance the plan was addressed to. */
	recipient?: AgentRegistration;
	/** The instances that matched, for a selection by the user. */
	candidates: AgentRegistration[];
	/** Why the publication decided that, in words. */
	reason: string;
	/** The message, when the plan could be addressed. */
	message?: PlanHandoffMessage;
}

/**
 * Publish a plan into the mailbox of the selected instance.
 *
 * A plan without a recipient is retained: it waits for an instance of the
 * workspace, and it is never delivered to an instance of another project.
 */
export function publishPlanThroughBridge(
	options: BridgePublishOptions,
): BridgePublishResult {
	const registry = planHandoffRegistry();
	const result: PublicationResult = publishPlan({
		plan: options.plan,
		sender: options.sender,
		registrations: registry.live(),
		host: options.host ?? hostname(),
		pairing: options.pairing,
		cwd: options.cwd,
		now: options.now,
	});

	if (result.outcome !== "addressed" || !result.message || !result.recipient) {
		if (result.outcome === "retained") {
			// The plan waits for a recipient of its workspace. It keeps its own
			// identity, so a later claim of the retained handoff names the
			// exact plan that was published.
			const now = options.now ? options.now() : Date.now();
			const id = randomUUID();
			planHandoffRetained().retainWithExpiry({
				id,
				correlationId: id,
				workspace:
					options.sender.workspace ??
					options.cwd ??
					process.cwd(),
				state: "awaiting-recipient",
				createdAt: now,
				summary: options.plan.plan.summary,
				...(options.plan.plan.reference
					? { reference: options.plan.plan.reference }
					: {}),
			}, now);
		}
		return {
			outcome: result.outcome,
			candidates: result.candidates,
			reason: result.reason,
		};
	}

	planHandoffMailbox(result.recipient.agentId).publish(result.message);

	return {
		outcome: "addressed",
		recipient: result.recipient,
		candidates: result.candidates,
		reason: result.reason,
		message: result.message,
	};
}

/**
 * The options of a receipt.
 */
export interface BridgeReceiveOptions {
	/** The registration of this instance. */
	registration: AgentRegistration;
	/** The clock of the receipt. */
	now?: () => number;
}

/**
 * The plans that are addressed to this instance and were not delivered yet.
 *
 * The recipient validates the message against its own registration before
 * it queues anything: a plan of a session that ended, of another generation
 * or of another workspace never enters the queue.
 */
export function receivePlans(
	options: BridgeReceiveOptions,
): PlanHandoffMessage[] {
	const mailbox = planHandoffMailbox(options.registration.agentId);
	const received: PlanHandoffMessage[] = [];
	for (const entry of mailbox.pending()) {
		const message = entry.message;
		if (message.recipient.agentId !== options.registration.agentId) continue;
		if (message.recipient.sessionId !== options.registration.sessionId) continue;
		if (message.recipient.generation !== options.registration.generation) continue;
		received.push(message);
	}
	return received;
}

/**
 * Acknowledge the delivery of a plan.
 */
export function acknowledgePlan(agentId: string, messageId: string): boolean {
	const acknowledged = planHandoffMailbox(agentId).acknowledge(messageId);
	return acknowledged?.state === "delivered";
}

/**
 * Claim a plan for this instance.
 */
export function claimPlan(agentId: string, messageId: string): boolean {
	const claimed = planHandoffMailbox(agentId).claim(messageId);
	return claimed?.state === "claimed";
}
