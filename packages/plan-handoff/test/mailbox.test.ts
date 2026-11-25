/**
 * The durable mailbox of the plan handoff.
 *
 * The mailbox is the recoverable source of the delivery state. The tests
 * cover the properties the delivery needs: idempotency by the message id,
 * the claim that survives a crash, the cancellation and the replies of an
 * exchange.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPlanHandoffMessage,
	Mailbox,
	ReplyStore,
	type PlanHandoffMessage,
} from "../src/index.js";

/**
 * A temporary directory for a fixture.
 */
function temporary(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A message of a plan.
 */
function message(overrides: Partial<PlanHandoffMessage> = {}): PlanHandoffMessage {
	const built = createPlanHandoffMessage({
		sender: {
			agentId: "codex-1",
			sessionId: "codex-session-1",
			workspace: "/home/frappe/pi-harness-runtime",
		},
		recipient: {
			agentId: "agent-a",
			sessionId: "session-1",
			generation: 1,
			workspace: "/home/frappe/pi-harness-runtime",
		},
		plan: {
			revision: "r1",
			summary: "the plan in one line",
			payload: "the plan itself",
		},
		action: "inform",
	});
	return { ...built, ...overrides };
}

describe("the mailbox of a plan", () => {
	it("publishes a message as pending", () => {
		const mailbox = new Mailbox(join(temporary("plan-handoff-mailbox-"), "inbox"));
		const built = message();
		const entry = mailbox.publish(built);
		expect(entry.state).toBe("pending");
		expect(mailbox.pending()).toHaveLength(1);
		expect(mailbox.pending()[0].message.id).toBe(built.id);
	});

	it("publishes the same message only once", () => {
		const mailbox = new Mailbox(join(temporary("plan-handoff-mailbox-"), "inbox"));
		const built = message();
		mailbox.publish(built);
		mailbox.publish(built);
		expect(mailbox.entries()).toHaveLength(1);
	});

	it("keeps the state of a message that is published twice", () => {
		const mailbox = new Mailbox(join(temporary("plan-handoff-mailbox-"), "inbox"));
		const built = message();
		mailbox.publish(built);
		mailbox.claim(built.id);
		mailbox.publish(built);
		expect(mailbox.read(built.id)?.state).toBe("claimed");
	});

	it("claims a message and does not claim it twice", () => {
		const mailbox = new Mailbox(join(temporary("plan-handoff-mailbox-"), "inbox"));
		const built = message();
		mailbox.publish(built);
		const claimed = mailbox.claim(built.id);
		expect(claimed?.state).toBe("claimed");
		// A second claim returns the same message: a crash between the claim
		// and the acknowledgement does not lose the message.
		const again = mailbox.claim(built.id);
		expect(again?.state).toBe("claimed");
		expect(mailbox.pending()).toHaveLength(0);
	});

	it("acknowledges the delivery of a message", () => {
		const mailbox = new Mailbox(join(temporary("plan-handoff-mailbox-"), "inbox"));
		const built = message();
		mailbox.publish(built);
		mailbox.claim(built.id);
		const delivered = mailbox.acknowledge(built.id);
		expect(delivered?.state).toBe("delivered");
	});

	it("cancels a message", () => {
		const mailbox = new Mailbox(join(temporary("plan-handoff-mailbox-"), "inbox"));
		const built = message();
		mailbox.publish(built);
		expect(mailbox.cancel(built.id)?.state).toBe("cancelled");
		expect(mailbox.pending()).toHaveLength(0);
	});

	it("prunes the messages that were delivered", () => {
		const mailbox = new Mailbox(join(temporary("plan-handoff-mailbox-"), "inbox"));
		const first = message();
		const second = message();
		mailbox.publish(first);
		mailbox.publish(second);
		mailbox.acknowledge(first.id);
		expect(mailbox.prune()).toBe(1);
		expect(mailbox.entries()).toHaveLength(1);
		expect(mailbox.entries()[0].message.id).toBe(second.id);
	});

	it("keeps the mailboxes of the agents apart", () => {
		const base = temporary("plan-handoff-mailbox-");
		const first = new Mailbox(join(base, "agent-a"));
		const second = new Mailbox(join(base, "agent-b"));
		first.publish(message());
		expect(first.pending()).toHaveLength(1);
		expect(second.pending()).toHaveLength(0);
	});
});

describe("the replies of an exchange", () => {
	it("keeps the replies of two exchanges apart", () => {
		const store = new ReplyStore(join(temporary("plan-handoff-replies-"), "replies"));
		store.write({
			id: "r1",
			correlationId: "correlation-1",
			event: "received",
			createdAt: 1,
		});
		store.write({
			id: "r2",
			correlationId: "correlation-2",
			event: "received",
			createdAt: 1,
		});
		expect(store.read("correlation-1")).toHaveLength(1);
		expect(store.read("correlation-2")).toHaveLength(1);
	});

	it("returns the replies of an exchange oldest first", () => {
		const store = new ReplyStore(join(temporary("plan-handoff-replies-"), "replies"));
		store.write({
			id: "r2",
			correlationId: "correlation-1",
			event: "completed",
			createdAt: 20,
		});
		store.write({
			id: "r1",
			correlationId: "correlation-1",
			event: "received",
			createdAt: 10,
		});
		const replies = store.read("correlation-1");
		expect(replies.map((reply) => reply.event)).toEqual(["received", "completed"]);
	});

	it("returns nothing for an exchange without replies", () => {
		const store = new ReplyStore(join(temporary("plan-handoff-replies-"), "replies"));
		expect(store.read("correlation-unknown")).toHaveLength(0);
	});

	it("never reads outside of the store", () => {
		const root = temporary("plan-handoff-replies-");
		const store = new ReplyStore(join(root, "replies"));
		// A folder that is a sibling of the store, with a reply in it.
		mkdirSync(join(root, "outside"), { recursive: true });
		writeFileSync(
			join(root, "outside", "r1.json"),
			JSON.stringify({
				id: "r1",
				correlationId: "../outside",
				event: "result",
				createdAt: 1,
			}),
			"utf8",
		);
		// The id of an exchange is a name, never a path.
		expect(store.read("../outside")).toHaveLength(0);
		expect(store.read("..")).toHaveLength(0);
		expect(store.read("replies/../outside")).toHaveLength(0);
	});

	it("never writes outside of the store", () => {
		const root = temporary("plan-handoff-replies-");
		const store = new ReplyStore(join(root, "replies"));
		// A reply that carries an identity that is not a name is refused.
		expect(() =>
			store.write({
				id: "r1",
				correlationId: "../outside",
				event: "result",
				createdAt: 1,
			}),
		).toThrow();
		expect(existsSync(join(root, "outside"))).toBe(false);
	});

	it("does not read a reply of another exchange", () => {
		const root = temporary("plan-handoff-replies-");
		const store = new ReplyStore(join(root, "replies"));
		// A reply that lies about the exchange it belongs to.
		mkdirSync(join(root, "replies", "correlation-1"), { recursive: true });
		writeFileSync(
			join(root, "replies", "correlation-1", "r1.json"),
			JSON.stringify({
				id: "r1",
				correlationId: "correlation-2",
				event: "completed",
				createdAt: 1,
			}),
			"utf8",
		);
		expect(store.read("correlation-1")).toHaveLength(0);
	});
});
