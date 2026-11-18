/**
 * The receiver of the plans of an instance.
 *
 * The tests use temporary directories and a fake clock: no real session, no
 * real store, no provider.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deliverPlanToWorkspace } from "../harness/plan-handoff-delivery.ts";
import {
	claimPlan,
	receivePlans,
} from "../harness/plan-handoff-bridge.ts";
import {
	planDeliveryText,
	startPlanReceiver,
} from "../harness/plan-handoff-receiver.ts";
import {
	Mailbox,
	PairingStore,
	PendingHandoffStore,
} from "../packages/plan-handoff/dist/index.js";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "plan-handoff-receiver-"));
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
 * The stores of a fixture.
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

/**
 * Route a plan into the mailbox of the recipient the routing selects.
 */
function route(fixture, { workspace, registrations, pairing }) {
	return deliverPlanToWorkspace({
		workspace,
		sender: { agentId: "codex", sessionId: "codex-1" },
		summary: "Codex finished a plan",
		reference: join(workspace, "plan.md"),
		registrations,
		host: "host-a",
		mailbox: fixture.mailbox,
		retained: fixture.retained,
		...(pairing ? { pairing } : {}),
		now: () => 1_000,
	});
}

/**
 * A receiver of an instance, with the plans it was given.
 */
function receiverFor(fixture, reg, { hold, defer, deliver } = {}) {
	const delivered = [];
	const receiver = startPlanReceiver({
		registration: reg,
		mailbox: fixture.mailbox(reg.agentId),
		deliver: deliver ?? ((message) => {
			delivered.push(message);
		}),
		...(hold ? { hold } : {}),
		...(defer ? { defer } : {}),
	});
	return { receiver, delivered };
}

test("the receiver hands a plan that is addressed to it to the session", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const { receiver, delivered } = receiverFor(fixture, reg);
	const handed = await receiver.poll();

	assert.equal(handed, 1);
	assert.equal(delivered.length, 1);
	assert.equal(delivered[0].plan.reference, join(workspace, "plan.md"));
	assert.equal(
		fixture.mailbox("agent-a").read(delivered[0].id).state,
		"delivered",
	);
});

test("two rounds that overlap hand the plan over once", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const delivered = [];
	let release = () => {};
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const { receiver } = receiverFor(fixture, reg, {
		deliver: async (message) => {
			delivered.push(message);
			// The delivery waits: the second round runs while the plan is
			// on its way to the session.
			await gate;
		},
	});

	const first = receiver.poll();
	const second = receiver.poll();
	// The second round finds the round that is running and does nothing.
	await Promise.resolve();
	release();
	const [firstHanded, secondHanded] = await Promise.all([first, second]);
	assert.equal(firstHanded, 1);
	assert.equal(secondHanded, 0);
	// The plan was handed over exactly once.
	assert.equal(delivered.length, 1);
});

test("a plan that is deferred waits for the session to be free", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	let busy = true;
	const { receiver, delivered } = receiverFor(fixture, reg, {
		defer: () => busy,
	});

	// The session is busy on other work: the plan waits in the mailbox.
	assert.equal(await receiver.poll(), 0);
	assert.equal(delivered.length, 0);
	const waiting = fixture.mailbox("agent-a").pending();
	assert.equal(waiting.length, 1);
	assert.equal(waiting[0].state, "pending");

	// The session is free again: the plan is handed over.
	busy = false;
	assert.equal(await receiver.poll(), 1);
	assert.equal(delivered.length, 1);
});

test("the text of a plan respects its action", () => {
	const message = {
		id: "message-1",
		action: "inform",
		plan: {
			revision: "1",
			summary: "Codex finished a plan",
			reference: "/tmp/plan.md",
		},
	};
	const inform = planDeliveryText(message);
	assert.ok(inform.includes("/tmp/plan.md"));
	assert.ok(inform.includes("for your information"));
	assert.ok(
		!inform.includes("then carry it out"),
		"a plan that is for information is not an order to implement it",
	);

	const review = planDeliveryText({ ...message, action: "review" });
	assert.ok(review.includes("review"));
	assert.ok(!review.includes("then carry it out"));

	const implement = planDeliveryText({ ...message, action: "implement" });
	assert.ok(implement.includes("then carry it out"));
});

test("only the selected recipient executes the plan", async () => {
	const fixture = stores();
	const workspace = temporary();
	const local = registration("agent-a", "session-a", workspace);
	const selected = registration("agent-b", "session-b", workspace);

	// The pairing names the instance the user chose.
	const delivery = route(fixture, {
		workspace,
		registrations: [local, selected],
		pairing: { workspace, agentId: "agent-b", sessionId: "session-b" },
	});
	assert.equal(delivery.decision, "queued");
	assert.equal(delivery.recipient.agentId, "agent-b");

	// The instance that watched the plan does not execute it.
	const localReceiver = receiverFor(fixture, local);
	assert.equal(await localReceiver.receiver.poll(), 0);
	assert.equal(localReceiver.delivered.length, 0);

	// The selected instance executes it.
	const selectedReceiver = receiverFor(fixture, selected);
	assert.equal(await selectedReceiver.receiver.poll(), 1);
	assert.equal(selectedReceiver.delivered.length, 1);
});

test("the plan of another generation is never executed", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	// The instance restarted: it has a new generation.
	const restarted = { ...reg, generation: 2 };
	const { receiver, delivered } = receiverFor(fixture, restarted);

	assert.equal(await receiver.poll(), 0);
	assert.equal(delivered.length, 0);
});

test("a plan that was claimed but not acknowledged is delivered again", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });
	// A crash between the claim and the acknowledgement leaves the plan
	// claimed. The plan must not be lost.
	const pending = fixture.mailbox("agent-a").pending();
	fixture.mailbox("agent-a").claim(pending[0].message.id);

	const { receiver, delivered } = receiverFor(fixture, reg);
	assert.equal(await receiver.poll(), 1);
	assert.equal(delivered.length, 1);
});

test("a plan that was handed over is never handed over twice", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const delivered = [];
	// The acknowledgement fails: the plan stays in the mailbox, but it was
	// handed over already.
	const receiver = startPlanReceiver({
		registration: reg,
		mailbox: fixture.mailbox("agent-a"),
		deliver: (message) => {
			delivered.push(message);
		},
		bridge: {
			receive: (options) => receivePlans(options),
			claim: (agentId, messageId, mailbox) =>
				claimPlan(agentId, messageId, mailbox),
			acknowledge: () => {
				throw new Error("the store is not writable");
			},
		},
	});

	// The first round hands the plan over, the second one only retries the
	// acknowledgement.
	assert.equal(await receiver.poll(), 1);
	assert.equal(delivered.length, 1);
	assert.equal(await receiver.poll(), 0);
	assert.equal(delivered.length, 1);
});

test("a plan is handed over only once when the acknowledgement works", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const { receiver, delivered } = receiverFor(fixture, reg);
	assert.equal(await receiver.poll(), 1);
	assert.equal(await receiver.poll(), 0);
	assert.equal(delivered.length, 1);
});

test("a held plan stays pending and is never claimed", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const { receiver, delivered } = receiverFor(fixture, reg, {
		hold: () => true,
	});

	assert.equal(await receiver.poll(), 0);
	assert.equal(delivered.length, 0);
	assert.equal(fixture.mailbox("agent-a").pending().length, 1);
	assert.equal(fixture.mailbox("agent-a").pending()[0].state, "pending");
});

test("the delivery text names the plan and its reference", () => {
	const text = planDeliveryText({
		schemaVersion: 1,
		id: "plan-1",
		correlationId: "plan-1",
		createdAt: "2026-11-17T00:00:00.000Z",
		sender: { agentId: "codex", sessionId: "codex-1" },
		recipient: { agentId: "agent-a", sessionId: "session-a", generation: 1 },
		workspace: "/tmp/workspace",
		plan: {
			revision: "1",
			hash: "abc",
			summary: "Codex finished a plan",
			reference: "/tmp/workspace/plan.md",
		},
		action: "inform",
	});

	assert.match(text, /Codex finished a plan/);
	assert.match(text, /\/tmp\/workspace\/plan\.md/);
});
