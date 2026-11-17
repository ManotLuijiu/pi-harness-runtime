/**
 * The selection of the recipient of a plan.
 *
 * Several Pi instances can run in the workspace of a plan. The plan is not
 * broadcast: the user chooses the instance that receives it, and the choice
 * becomes the pairing of the workspace.
 *
 * The tests use a temporary directory and a fake clock: no real session, no
 * real store, no provider.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	offerRecipientSelection,
	resolveRecipientSelection,
	readRecipientSelection,
	openRecipientSelections,
} from "../harness/plan-handoff-recipient-selection.ts";
import { PairingStore } from "../packages/plan-handoff/dist/index.js";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "plan-recipient-"));
}

/**
 * A registration of an instance, as the store of the runtime writes it.
 */
function registration(agentId, sessionId, workspace) {
	return {
		agentId,
		sessionId,
		generation: 1,
		workspace,
		host: "host-a",
		pid: 1,
		modelLabel: "minimax",
		busy: false,
		paused: false,
		startedAt: 1_000,
		heartbeatAt: 1_000,
	};
}

test("the offer names the identity of every candidate", () => {
	const workspace = temporary();
	const selection = offerRecipientSelection({
		workspace,
		candidates: [
			registration("agent-a", "session-a", workspace),
			registration("agent-b", "session-b", workspace),
		],
		now: 1_000,
	});

	assert.equal(selection.candidates.length, 2);
	assert.equal(selection.offers.length, 2);
	assert.equal(selection.offers[0].agentId, "agent-a");
	assert.equal(selection.offers[1].agentId, "agent-b");
	// Every candidate has its own token: the callback data of a button
	// stays short and names exactly one candidate.
	assert.notEqual(selection.offers[0].token, selection.offers[1].token);
	assert.ok(selection.offers[0].token.length <= 12);
});

test("the choice of the user names the chosen instance", () => {
	const workspace = temporary();
	const selection = offerRecipientSelection({
		workspace,
		candidates: [
			registration("agent-a", "session-a", workspace),
			registration("agent-b", "session-b", workspace),
		],
		now: 1_000,
	});

	const result = resolveRecipientSelection(selection.offers[1].token, 2_000);
	assert.equal(result.ok, true);
	assert.equal(result.recipient?.agentId, "agent-b");
	assert.equal(result.recipient?.sessionId, "session-b");
});

test("the first answer wins", () => {
	const workspace = temporary();
	const selection = offerRecipientSelection({
		workspace,
		candidates: [
			registration("agent-a", "session-a", workspace),
			registration("agent-b", "session-b", workspace),
		],
		now: 1_000,
	});

	const first = resolveRecipientSelection(selection.offers[0].token, 2_000);
	assert.equal(first.ok, true);

	const second = resolveRecipientSelection(selection.offers[1].token, 3_000);
	assert.equal(second.ok, false);
	assert.match(second.reason, /already answered/);
});

test("an expired offer is no offer", () => {
	const workspace = temporary();
	const selection = offerRecipientSelection({
		workspace,
		candidates: [registration("agent-a", "session-a", workspace)],
		now: 1_000,
		ttlMs: 500,
	});

	const result = resolveRecipientSelection(selection.offers[0].token, 2_000);
	assert.equal(result.ok, false);
	assert.match(result.reason, /expired/);
});

test("an unknown token is refused", () => {
	const result = resolveRecipientSelection("not-a-token", 1_000);
	assert.equal(result.ok, false);
	assert.match(result.reason, /unknown/);
});

test("the choice becomes the pairing of the workspace", () => {
	const directory = temporary();
	const workspace = temporary();
	const pairingFile = join(directory, "pairings.json");
	const store = new PairingStore(pairingFile);

	const selection = offerRecipientSelection({
		workspace,
		candidates: [
			registration("agent-a", "session-a", workspace),
			registration("agent-b", "session-b", workspace),
		],
		pairings: store,
		now: 1_000,
	});

	resolveRecipientSelection(selection.offers[1].token, 2_000);

	// The pairing is durable: it survives the runtime, so the next plan of
	// the same workspace goes to the chosen instance without asking again.
	const pairing = new PairingStore(pairingFile).read(workspace);
	assert.ok(pairing, "the pairing of the workspace was written");
	assert.equal(pairing.agentId, "agent-b");
	assert.equal(pairing.sessionId, "session-b");
	assert.equal(pairing.pairedAt, 2_000);
});

test("the pairing of another workspace is not touched", () => {
	const directory = temporary();
	const store = new PairingStore(join(directory, "pairings.json"));
	const workspace = temporary();
	const other = temporary();

	const selection = offerRecipientSelection({
		workspace,
		candidates: [registration("agent-a", "session-a", workspace)],
		pairings: store,
		now: 1_000,
	});

	resolveRecipientSelection(selection.offers[0].token, 2_000);

	assert.equal(store.read(other), undefined);
});

test("the offer is open until it is answered or it expires", () => {
	const workspace = temporary();
	const selection = offerRecipientSelection({
		workspace,
		candidates: [registration("agent-a", "session-a", workspace)],
		now: 1_000,
		ttlMs: 5_000,
	});

	const open = openRecipientSelections(2_000);
	assert.equal(open.length >= 1, true);
	assert.equal(readRecipientSelection(selection.token)?.used, false);

	resolveRecipientSelection(selection.offers[0].token, 2_500);
	assert.equal(readRecipientSelection(selection.token)?.used, true);
});
