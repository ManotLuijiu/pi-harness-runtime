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
	acknowledgePlan,
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
function receiverFor(fixture, reg, { hold, defer, deliver, deliveryTimeoutMs } = {}) {
	const delivered = [];
	const receiver = startPlanReceiver({
		registration: reg,
		mailbox: fixture.mailbox(reg.agentId),
		deliver: deliver ?? ((message) => {
			delivered.push(message);
		}),
		...(hold ? { hold } : {}),
		...(defer ? { defer } : {}),
		...(deliveryTimeoutMs ? { deliveryTimeoutMs } : {}),
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

test("a plan without a reference carries its content and its action", () => {
	const message = {
		id: "message-1",
		action: "implement",
		plan: {
			revision: "1",
			summary: "Codex finished a plan",
			payload: "Step one: write the report. Step two: send it.",
		},
	};
	const text = planDeliveryText(message);
	// The plan travels with the message: the session gets the plan itself
	// and not a path to it.
	assert.ok(text.includes("Step one: write the report."));
	// The action of the message decides what the session is asked to do.
	assert.ok(text.includes("then carry it out"));
	assert.ok(
		!text.includes("Read the plan at:"),
		"a plan without a reference has no path to read",
	);
});

test("a callback that throws does not take the round down", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const { receiver, delivered } = receiverFor(fixture, reg, {
		hold: () => {
			throw new Error("the session is gone");
		},
		defer: () => {
			throw new Error("the context is torn down");
		},
	});

	// The round survives a callback that throws: the plan waits and the
	// session is not taken down.
	assert.equal(await receiver.poll(), 0);
	assert.equal(delivered.length, 0);
	assert.equal(fixture.mailbox("agent-a").pending().length, 1);
});

test("a delivery that never settles does not block the receiver", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const { receiver } = receiverFor(fixture, reg, {
		deliver: () => new Promise(() => {}),
		deliveryTimeoutMs: 50,
	});

	// The delivery is bounded: the round ends even when the delivery
	// never settles.
	const handed = await receiver.poll();
	assert.equal(handed, 0);
	// The plan is not lost: it stays in the mailbox.
	assert.equal(fixture.mailbox("agent-a").claimable().length, 1);
});

test("a plan whose delivery timed out is not delivered twice", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const mailbox = fixture.mailbox("agent-a");
	const messageId = mailbox.claimable()[0].message.id;

	let calls = 0;
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const { receiver } = receiverFor(fixture, reg, {
		deliver: () => {
			calls += 1;
			return pending;
		},
		deliveryTimeoutMs: 50,
	});

	// The first round times out: the delivery is still running.
	const handed = await receiver.poll();
	assert.equal(handed, 0);
	assert.equal(calls, 1);

	// The next round must not hand the same plan over a second time: the
	// first delivery may still reach the session.
	const again = await receiver.poll();
	assert.equal(again, 0);
	assert.equal(calls, 1);

	// The delivery settles late: the plan is acknowledged exactly once.
	release();
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(calls, 1);
	assert.equal(mailbox.read(messageId).state, "delivered");
});

test("the acknowledgement of a delivered plan is retried while the session is busy", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const mailbox = fixture.mailbox("agent-a");
	let acknowledgeFails = true;
	const bridge = {
		receive: (options) => receivePlans(options),
		claim: (agentId, messageId, box) => claimPlan(agentId, messageId, box),
		acknowledge: (agentId, messageId, box) => {
			if (acknowledgeFails) {
				acknowledgeFails = false;
				throw new Error("the store is not writable");
			}
			return acknowledgePlan(agentId, messageId, box);
		},
	};
	const delivered = [];
	let busy = false;
	const receiver = startPlanReceiver({
		registration: reg,
		mailbox: mailbox,
		bridge,
		defer: () => busy,
		deliver: (message) => {
			delivered.push(message);
		},
	});

	// The plan is handed over, but the acknowledgement fails.
	assert.equal(await receiver.poll(), 1);
	assert.equal(delivered.length, 1);
	assert.equal(mailbox.read(delivered[0].id).state, "claimed");

	// The session is busy on other work. The plan is not delivered again,
	// but its acknowledgement is retried: the entry does not stay in the
	// mailbox for good.
	busy = true;
	assert.equal(await receiver.poll(), 0);
	assert.equal(delivered.length, 1, "the plan was not delivered a second time");
	assert.equal(mailbox.read(delivered[0].id).state, "delivered");
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

test("a delivery that never settles is not delivered twice", async () => {
	const fixture = stores();
	const workspace = temporary();
	const reg = registration("agent-a", "session-a", workspace);

	route(fixture, { workspace, registrations: [reg] });

	const mailbox = fixture.mailbox("agent-a");
	const messageId = mailbox.claimable()[0].message.id;

	let calls = 0;
	let clock = 1_000;
	const receiver = startPlanReceiver({
		registration: reg,
		mailbox: fixture.mailbox(reg.agentId),
		// The delivery never settles: it may still reach the session.
		deliver: () => {
			calls += 1;
			return new Promise(() => {});
		},
		deliveryTimeoutMs: 50,
		now: () => clock,
		log: () => {},
	});

	// The first round times out: the delivery is still running.
	const handed = await receiver.poll();
	assert.equal(handed, 0);
	assert.equal(calls, 1);

	// The clock passes the bound of a stuck delivery (150 seconds): the
	// plan waits for the delivery that may still reach the session.
	clock += 200_000;
	const again = await receiver.poll();
	assert.equal(again, 0);
	assert.equal(calls, 1);
	assert.notEqual(mailbox.read(messageId).state, "delivered");
});
