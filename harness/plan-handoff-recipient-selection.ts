/**
 * The selection of the recipient of a plan.
 *
 * Several Pi instances can run in the workspace of a plan. The plan is not
 * broadcast: the user chooses the instance that receives it, and the choice
 * becomes the pairing of that workspace.
 *
 * The selection is pending until the user answers or the offer expires. The
 * first answer wins, and an expired offer is no offer.
 *
 * Every candidate has its own token: the callback data of a button has to
 * stay short enough for the channels, and a token names one candidate of one
 * offer without carrying the identity of the instance in the open.
 */

import { randomUUID } from "node:crypto";
import {
	canonicalizePath,
	type AgentRegistration,
	type PairingStore,
} from "../packages/plan-handoff/dist/index.js";
import { planHandoffPairings } from "./plan-handoff-bridge.ts";

/**
 * One candidate of an offer.
 */
export interface RecipientOffer {
	/** The token that names this candidate in the callback data. */
	token: string;
	/** The agent id of the candidate. */
	agentId: string;
	/** The session of the candidate. */
	sessionId: string;
}

/**
 * One pending selection.
 */
export interface PendingRecipientSelection {
	/** The token that names the selection. */
	token: string;
	/** The canonical workspace of the plan. */
	workspace: string;
	/** The path of the plan, when it is a file. */
	planPath?: string;
	/** The summary of the plan, for the user. */
	summary?: string;
	/** The session of the sender, for the reply. */
	senderSessionId?: string;
	/** The instances the user can choose from. */
	candidates: AgentRegistration[];
	/** The token of every candidate. */
	offers: RecipientOffer[];
	/** The store that keeps the pairing of the workspace. */
	pairings: PairingStore;
	/** When the offer expires. */
	expiresAt: number;
	/** True when the selection was answered. */
	used: boolean;
}

/**
 * How long an offer of the recipients stays open.
 */
export const RECIPIENT_SELECTION_TTL_MS = 30 * 60 * 1_000;

/**
 * The pending selections of the runtime.
 *
 * The state is in memory: an offer that the runtime does not remember is no
 * offer, and the user is asked again.
 */
const pendingSelections = new Map<string, PendingRecipientSelection>();

/**
 * The token of every candidate, so that a click names one candidate.
 */
const offerIndex = new Map<string, { selectionToken: string; agentId: string }>();

/**
 * Offer the candidates of a plan to the user.
 *
 * The offer names the identity of every candidate: the agent id and the
 * session. The model label is a hint, never an identity.
 */
export function offerRecipientSelection(options: {
	workspace: string;
	planPath?: string;
	summary?: string;
	senderSessionId?: string;
	candidates: AgentRegistration[];
	/** The store that keeps the pairing of the workspace. */
	pairings?: PairingStore;
	now?: number;
	ttlMs?: number;
}): PendingRecipientSelection {
	const now = options.now ?? Date.now();
	const token = randomUUID().replace(/-/g, "").slice(0, 12);
	const offers: RecipientOffer[] = options.candidates.map((candidate) => {
		const offerToken = randomUUID().replace(/-/g, "").slice(0, 12);
		offerIndex.set(offerToken, { selectionToken: token, agentId: candidate.agentId });
		return {
			token: offerToken,
			agentId: candidate.agentId,
			sessionId: candidate.sessionId,
		};
	});

	const selection: PendingRecipientSelection = {
		token,
		workspace: canonicalizePath(options.workspace),
		candidates: options.candidates,
		offers,
		pairings: options.pairings ?? planHandoffPairings(),
		expiresAt: now + (options.ttlMs ?? RECIPIENT_SELECTION_TTL_MS),
		used: false,
	};
	if (options.planPath) selection.planPath = options.planPath;
	if (options.summary) selection.summary = options.summary;
	if (options.senderSessionId) selection.senderSessionId = options.senderSessionId;
	pendingSelections.set(token, selection);
	return selection;
}

/**
 * The pending selection of a token.
 */
export function readRecipientSelection(
	token: string,
): PendingRecipientSelection | undefined {
	return pendingSelections.get(token);
}

/**
 * The pending selections that are still open.
 */
export function openRecipientSelections(
	now: number = Date.now(),
): PendingRecipientSelection[] {
	return Array.from(pendingSelections.values()).filter(
		(selection) => !selection.used && selection.expiresAt > now,
	);
}

/**
 * Apply the choice of the user.
 *
 * The choice names one candidate of the offer. The first answer wins, an
 * expired offer is refused, and a choice of an unknown candidate is refused.
 * The pairing of the workspace is remembered, so the next plan of the same
 * workspace goes to the instance the user chose.
 */
export function resolveRecipientSelection(
	offerToken: string,
	now: number = Date.now(),
): { ok: boolean; reason: string; selection?: PendingRecipientSelection; recipient?: AgentRegistration } {
	const index = offerIndex.get(offerToken);
	if (!index) {
		return {
			ok: false,
			reason: "the offer of the recipients is unknown or already gone",
		};
	}
	const selection = pendingSelections.get(index.selectionToken);
	if (!selection) {
		offerIndex.delete(offerToken);
		return {
			ok: false,
			reason: "the offer of the recipients is unknown or already gone",
		};
	}
	if (selection.used) {
		return {
			ok: false,
			reason: "the offer of the recipients was already answered",
		};
	}
	if (selection.expiresAt <= now) {
		pendingSelections.delete(selection.token);
		return { ok: false, reason: "the offer of the recipients expired" };
	}
	const candidate = selection.candidates.find(
		(entry) => entry.agentId === index.agentId,
	);
	if (!candidate) {
		return {
			ok: false,
			reason: "the chosen instance is not one of the offered instances",
		};
	}

	selection.used = true;
	selection.pairings.write(selection.workspace, {
		agentId: candidate.agentId,
		sessionId: candidate.sessionId,
		pairedAt: now,
	});

	return {
		ok: true,
		reason: "the recipient is chosen",
		selection,
		recipient: candidate,
	};
}
