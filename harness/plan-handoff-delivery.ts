/**
 * The delivery of a plan to the Pi instance of its workspace.
 *
 * The Codex watcher observes a plan of a project. The delivery decides which
 * Pi instance receives it:
 *
 * - the instance whose canonical workspace is the workspace of the plan,
 * - chosen automatically when exactly one live instance runs there,
 * - chosen by the user when several of them do,
 * - and nothing is delivered when no instance runs there: the plan waits.
 *
 * The comparison of the workspaces is a comparison of the canonical paths, so
 * a symlink of the same directory matches and two worktrees of one
 * repository do not.
 *
 * The decision belongs to the package of the handoff: this module only names
 * the workspace of the sender, remembers the pairing of the user and writes
 * the plan into the mailbox of the instance that was selected.
 */

import { hostname } from "node:os";
import {
	canonicalizePath,
	type AgentRegistration,
	type Mailbox,
	type PendingHandoffStore,
	type RecipientResolution,
} from "../packages/plan-handoff/dist/index.js";
import {
	planHandoffMailbox,
	planHandoffPairings,
	planHandoffRegistry,
	planHandoffRetained,
} from "./plan-handoff-bridge.ts";
import { publishPlan } from "../packages/plan-handoff/dist/index.js";

/**
 * What the delivery decided.
 */
export type PlanDeliveryDecision =
	/** The plan is delivered to the instance of this workspace. */
	| "delivered"
	/** The plan is queued in the mailbox of the instance. */
	| "queued"
	/** Several instances run in the workspace: the user chooses. */
	| "needs-recipient"
	/** No instance runs in the workspace: the plan waits. */
	| "retained";

/**
 * The result of a delivery.
 */
export interface PlanDeliveryResult {
	/** What the delivery decided. */
	decision: PlanDeliveryDecision;
	/** The instance the plan is for. */
	recipient?: AgentRegistration;
	/** The instances that matched the workspace. */
	candidates: AgentRegistration[];
	/** Why the delivery decided that, in words. */
	reason: string;
	/** The routing the delivery used. */
	resolution: RecipientResolution;
}

/**
 * The options of a delivery.
 */
export interface PlanDeliveryOptions {
	/** The workspace of the plan: the project the plan belongs to. */
	workspace: string;
	/** The identity of the sender. */
	sender: {
		agentId: string;
		sessionId: string;
		label?: string;
	};
	/** The summary of the plan, for the user. */
	summary: string;
	/** The path of the plan, when it is a file. */
	reference?: string;
	/** The live registrations. The registry of the user by default. */
	registrations?: AgentRegistration[];
	/** The host of the sender. */
	host?: string;
	/** The pairing that was selected before. */
	pairing?: { agentId: string; sessionId?: string };
	/** The mailbox of the instances. The mailbox of the user by default. */
	mailbox?: (agentId: string) => Mailbox;
	/** The store of the retained handoffs. The store of the user by default. */
	retained?: PendingHandoffStore;
	/**
	 * The correlation of the work of the plan.
	 *
	 * The correlation names the work of the plan. A producer that writes the
	 * same correlation into the envelope of a handoff of the issue tracker
	 * joins the two paths: both of them lease the work under that name, and
	 * the second one waits for the first one.
	 *
	 * Only the producer of the plan may set it. The path of the repository
	 * that hands a finished plan of one agent to the instance of another
	 * (the plan of Codex that Pi picks up) has no handoff of the issue
	 * tracker behind it, so it has no correlation to give: that path
	 * joins the path of the tracker on the name of the message, and only
	 * when the envelope of the handoff names the live job of the plan.
	 */
	correlationId?: string;
	/** The clock of the delivery. */
	now?: () => number;
}

/**
 * Deliver a plan to the Pi instance of its workspace.
 *
 * The plan is written into the mailbox of the instance. The instance reads
 * its own mailbox, so the plan reaches exactly the instance the routing
 * selected, and never an instance of another project.
 */
export function deliverPlanToWorkspace(
	options: PlanDeliveryOptions,
): PlanDeliveryResult {
	const now = options.now ?? (() => Date.now());
	const registry = planHandoffRegistry();
	const registrations = options.registrations ?? registry.live();
	const mailbox = options.mailbox ?? planHandoffMailbox;
	const retained = options.retained ?? planHandoffRetained();
	const host = options.host ?? hostname();
	const workspace = canonicalizePath(options.workspace);

	// The pairing the user chose before decides, when it still names a live
	// instance of this workspace. A pairing of a session that ended never
	// decides.
	const pairing = options.pairing ?? planHandoffPairings().read(workspace);

	const publication = publishPlan({
		plan: {
			action: "inform",
			// The correlation names the work of the plan. A producer that
			// writes the same correlation into the envelope of a handoff of
			// the issue tracker joins the two paths: both of them lease the
			// work under that name.
			...(options.correlationId ? { correlationId: options.correlationId } : {}),
			plan: {
				revision: "1",
				summary: options.summary,
				...(options.reference ? { reference: options.reference } : {}),
			},
		},
		sender: {
			agentId: options.sender.agentId,
			sessionId: options.sender.sessionId,
			workspace,
			label: options.sender.label,
		},
		registrations,
		host,
		pairing,
		now,
	});

	if (publication.outcome === "needs-recipient") {
		return {
			decision: "needs-recipient",
			candidates: publication.candidates,
			reason: publication.reason,
			resolution: publication.resolution,
		};
	}

	if (publication.outcome === "retained") {
		// No Pi instance runs in the workspace of the plan: the plan waits
		// for one. It is never delivered to an instance of another project.
		const id = `plan-${now()}`;
		retained.retainWithExpiry({
			id,
			correlationId: id,
			workspace,
			state: "awaiting-recipient",
			createdAt: now(),
			summary: options.summary,
			...(options.reference ? { reference: options.reference } : {}),
		}, now());
		return {
			decision: "retained",
			candidates: publication.candidates,
			reason: publication.reason,
			resolution: publication.resolution,
		};
	}

	const recipient = publication.recipient as AgentRegistration;
	const message = publication.message;
	if (!message) {
		return {
			decision: "retained",
			candidates: publication.candidates,
			reason:
				"the plan could not be addressed to the instance of the workspace",
			resolution: publication.resolution,
		};
	}

	mailbox(recipient.agentId).publish(message);

	return {
		decision: "queued",
		recipient,
		candidates: publication.candidates,
		reason: publication.reason,
		resolution: publication.resolution,
	};
}

export { planHandoffMailbox };