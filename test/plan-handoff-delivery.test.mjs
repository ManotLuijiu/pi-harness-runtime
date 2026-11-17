/**
 * The delivery of a plan to the Pi instance of its workspace.
 *
 * The tests use temporary directories and a fake clock: no real session, no
 * real store, no provider.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deliverPlanToWorkspace } from "../harness/plan-handoff-delivery.ts";
import {
	Mailbox,
	PairingStore,
	PendingHandoffStore,
} from "../packages/plan-handoff/dist/index.js";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "plan-handoff-delivery-"));
}

/**
 * A registration of an instance, as the store of the runtime writes it.
 */
function registration(agentId, sessionId, workspace, host = "host-a") {
	return {
		agentId,
		sessionId,
		generation: 1,
		workspace,
		host,
		pid: 1,
		modelLabel: "minimax",
		busy: false,
		paused: false,
		startedAt: 1_000,
		heartbeatAt: 1_000,
	};
}

/**
 * The stores of a fixture: a mailbox per agent and a store of the retained
 * handoffs, both in a temporary directory.
 */
function stores() {
	const base = temporary();
	const mailboxes = new Map();
	return {
		base,
		mailbox(agentId) {
			const existing = mailboxes.get(agentId);
			if (existing) return existing;
			const mailbox = new Mailbox(join(base, "mailboxes", agentId));
			mailboxes.set(agentId, mailbox);
			return mailbox;
		},
		retained: new PendingHandoffStore(join(base, "retained")),
		pairings: new PairingStore(join(base, "pairings.json")),
	};
}

test("the plan is queued in the mailbox of the only instance of the workspace", () => {
	const fixture = stores();
	const workspace = temporary();

	const result = deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		reference: join(workspace, "plan.md"),
		registrations: [registration("agent-a", "session-a", workspace)],
		host: "host-a",
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "queued");
	assert.equal(result.recipient?.agentId, "agent-a");

	const pending = fixture.mailbox("agent-a").pending();
	assert.equal(pending.length, 1);
	assert.equal(pending[0].message.recipient.agentId, "agent-a");
	assert.equal(pending[0].message.recipient.sessionId, "session-a");
});

test("the plan is retained when no instance runs in the workspace", () => {
	const fixture = stores();
	const workspace = temporary();

	const result = deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		registrations: [registration("agent-a", "session-a", temporary())],
		host: "host-a",
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "retained");
	assert.equal(result.candidates.length, 0);

	// The plan waits for an instance of its own workspace.
	const awaiting = fixture.retained.list();
	assert.equal(awaiting.length, 1);
	assert.equal(awaiting[0].state, "awaiting-recipient");
});

test("several instances in the workspace ask the user which one receives the plan", () => {
	const fixture = stores();
	const workspace = temporary();

	const result = deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		registrations: [
			registration("agent-a", "session-a", workspace),
			registration("agent-b", "session-b", workspace),
		],
		host: "host-a",
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "needs-recipient");
	assert.equal(result.candidates.length, 2);

	// The plan is not broadcast: no mailbox of any candidate received it.
	assert.equal(fixture.mailbox("agent-a").pending().length, 0);
	assert.equal(fixture.mailbox("agent-b").pending().length, 0);
});

test("the plan is never delivered to an instance of another project", () => {
	const fixture = stores();
	const workspace = temporary();
	const other = temporary();

	const result = deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		registrations: [registration("agent-other", "session-other", other)],
		host: "host-a",
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "retained");
	assert.equal(fixture.mailbox("agent-other").pending().length, 0);
});

test("the plan is never delivered to an instance of another host", () => {
	const fixture = stores();
	const workspace = temporary();

	const result = deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		registrations: [registration("agent-a", "session-a", workspace, "host-b")],
		host: "host-a",
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "retained");
});

test("a symlink of the workspace is the same workspace", () => {
	const fixture = stores();
	const base = temporary();
	const real = join(base, "real");
	const link = join(base, "link");
	mkdirSync(real, { recursive: true });
	symlinkSync(real, link);

	const result = deliverPlanToWorkspace({
		workspace: link,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		registrations: [registration("agent-a", "session-a", real)],
		host: "host-a",
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "queued");
	assert.equal(fixture.mailbox("agent-a").pending().length, 1);
});

test("the existing pairing of the user decides between the instances", () => {
	const fixture = stores();
	const workspace = temporary();

	const result = deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		registrations: [
			registration("agent-a", "session-a", workspace),
			registration("agent-b", "session-b", workspace),
		],
		host: "host-a",
		pairing: { agentId: "agent-b", sessionId: "session-b" },
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "queued");
	assert.equal(result.recipient?.agentId, "agent-b");
	assert.equal(fixture.mailbox("agent-b").pending().length, 1);
	assert.equal(fixture.mailbox("agent-a").pending().length, 0);
});

test("a pairing of a session that ended never decides", () => {
	const fixture = stores();
	const workspace = temporary();

	const result = deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		registrations: [
			registration("agent-a", "session-a", workspace),
			registration("agent-b", "session-b", workspace),
		],
		host: "host-a",
		pairing: { agentId: "agent-b", sessionId: "session-that-ended" },
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		now: () => 1_000,
	});

	assert.equal(result.decision, "needs-recipient");
});
