/**
 * The publication of a plan and the retention of a plan without a recipient.
 *
 * The tests are synthetic: a temporary directory, a fake host, a fake clock.
 * No provider, no network, no real session.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	awaitingInWorkspace,
	describeCandidates,
	PendingHandoffStore,
	DEFAULT_HANDOFF_RETENTION_MS,
	publishPlan,
	validatePlanHandoffMessage,
	validateRecipientIdentity,
	type AgentRegistration,
	type PendingHandoff,
} from "../src/index.js";

/**
 * A registration of an instance.
 */
function registration(
	overrides: Partial<AgentRegistration> & { agentId: string },
): AgentRegistration {
	return {
		sessionId: "session-1",
		generation: 1,
		workspace: "/home/frappe/pi-harness-runtime",
		host: "host-a",
		pid: 4242,
		modelLabel: "minimax",
		startedAt: 1_000,
		heartbeatAt: 1_000,
		...overrides,
	};
}

/**
 * A temporary directory for a fixture.
 */
function temporary(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

describe("the publication of a plan", () => {
	const content = {
		plan: {
			revision: "r1",
			summary: "the plan in one line",
			payload: "the plan itself",
		},
		action: "inform" as const,
	};

	const sender = {
		agentId: "codex-1",
		sessionId: "codex-session-1",
	};

	it("addresses the only live instance of the workspace", () => {
		const result = publishPlan({
			plan: content,
			sender,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({
					agentId: "agent-b",
					workspace: "/home/frappe/other",
				}),
			],
		});
		expect(result.outcome).toBe("addressed");
		expect(result.recipient?.agentId).toBe("agent-a");
		expect(result.message?.recipient.agentId).toBe("agent-a");
		expect(result.message?.recipient.sessionId).toBe("session-1");
		expect(result.message?.recipient.generation).toBe(1);
	});

	it("publishes a valid message that the recipient accepts", () => {
		const result = publishPlan({
			plan: content,
			sender,
			host: "host-a",
			registrations: [registration({ agentId: "agent-a" })],
		});
		expect(result.message).toBeDefined();
		const validation = validatePlanHandoffMessage(result.message!);
		expect(validation.ok).toBe(true);
		const recipient = validateRecipientIdentity(
			result.message!,
			registration({ agentId: "agent-a" }),
		);
		expect(recipient.ok).toBe(true);
	});

	it("retains the plan when no instance matches", () => {
		const result = publishPlan({
			plan: content,
			sender,
			host: "host-a",
			registrations: [],
		});
		expect(result.outcome).toBe("retained");
		expect(result.message).toBeUndefined();
		expect(result.candidates).toHaveLength(0);
	});

	it("exposes the candidates when several instances match", () => {
		const result = publishPlan({
			plan: content,
			sender,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({ agentId: "agent-b", sessionId: "session-2" }),
			],
		});
		expect(result.outcome).toBe("needs-recipient");
		expect(result.message).toBeUndefined();
		expect(result.candidates).toHaveLength(2);
	});

	it("describes the candidates with their identity, not with their model", () => {
		const described = describeCandidates([
			registration({ agentId: "agent-a" }),
			registration({
				agentId: "agent-b",
				sessionId: "session-2",
				modelLabel: "minimax",
			}),
		]);
		expect(described[0]).toContain("agent-a");
		expect(described[0]).toContain("session-1");
		expect(described[1]).toContain("agent-b");
		expect(described[1]).toContain("session-2");
	});

	it("uses the pairing when several instances match", () => {
		const result = publishPlan({
			plan: content,
			sender,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({ agentId: "agent-b", sessionId: "session-2" }),
			],
			pairing: { agentId: "agent-b", sessionId: "session-2" },
		});
		expect(result.outcome).toBe("addressed");
		expect(result.recipient?.agentId).toBe("agent-b");
	});

	it("never addresses a plan to another project", () => {
		const result = publishPlan({
			plan: content,
			sender,
			host: "host-a",
			registrations: [
				registration({
					agentId: "agent-other",
					workspace: "/home/frappe/bunchee-laris",
				}),
			],
		});
		expect(result.outcome).toBe("retained");
		expect(result.message).toBeUndefined();
	});

	it("discovers the workspace of the sender from its working directory", () => {
		const directory = temporary("plan-handoff-publish-");
		const result = publishPlan({
			plan: content,
			sender: { ...sender, workspace: directory },
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a", workspace: directory }),
			],
		});
		expect(result.outcome).toBe("addressed");
		expect(result.message?.workspace).toBe(directory);
	});
});

describe("the retention of a plan without a recipient", () => {
	function handoff(overrides: Partial<PendingHandoff> = {}): PendingHandoff {
		return {
			id: "handoff-1",
			correlationId: "correlation-1",
			workspace: "/home/frappe/pi-harness-runtime",
			state: "awaiting-recipient",
			createdAt: 1_000,
			expiresAt: 100_000,
			summary: "the plan in one line",
			...overrides,
		};
	}

	it("keeps a handoff that waits for a recipient", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
		);
		store.retain(handoff());
		expect(store.awaiting(2_000)).toHaveLength(1);
	});

	it("gives a retained handoff the expiry of the store", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
			{ retentionMs: 5_000 },
		);
		const retained = store.retainWithExpiry(
			{
				id: "handoff-1",
				correlationId: "correlation-1",
				workspace: "/home/frappe/pi-harness-runtime",
				state: "awaiting-recipient",
				createdAt: 1_000,
				summary: "the plan in one line",
			},
			1_000,
		);
		expect(retained.expiresAt).toBe(6_000);
		expect(store.awaiting(2_000)).toHaveLength(1);
		expect(store.awaiting(7_000)).toHaveLength(0);
	});

	it("uses the default retention when the store names none", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
		);
		const retained = store.retainWithExpiry(
			{
				id: "handoff-1",
				correlationId: "correlation-1",
				workspace: "/home/frappe/pi-harness-runtime",
				state: "awaiting-recipient",
				createdAt: 1_000,
				summary: "the plan in one line",
			},
			1_000,
		);
		expect(retained.expiresAt).toBe(1_000 + DEFAULT_HANDOFF_RETENTION_MS);
	});

	it("drops a handoff that expired", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
		);
		store.retain(handoff());
		expect(store.awaiting(200_000)).toHaveLength(0);
		expect(store.prune(200_000)).toBe(1);
		expect(store.list()).toHaveLength(0);
	});

	it("claims a handoff explicitly and records the recipient", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
		);
		store.retain(handoff());
		const claimed = store.claim(
			"handoff-1",
			registration({ agentId: "agent-a" }),
			2_000,
		);
		expect(claimed?.state).toBe("claimed");
		expect(claimed?.requestedAgentId).toBe("agent-a");
		expect(store.awaiting(2_000)).toHaveLength(0);
	});

	it("never rebinds a handoff silently", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
		);
		store.retain(handoff());
		store.claim("handoff-1", registration({ agentId: "agent-a" }), 2_000);
		// A second claim finds nothing to claim: the handoff is not given to
		// another instance behind the back of the user.
		const second = store.claim(
			"handoff-1",
			registration({ agentId: "agent-b" }),
			2_000,
		);
		expect(second).toBeUndefined();
		expect(store.read("handoff-1")?.requestedAgentId).toBe("agent-a");
	});

	it("cancels a handoff", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
		);
		store.retain(handoff());
		expect(store.cancel("handoff-1")).toBe(true);
		expect(store.awaiting(2_000)).toHaveLength(0);
		expect(store.read("handoff-1")?.state).toBe("cancelled");
	});

	it("keeps the handoffs of the workspaces apart", () => {
		const store = new PendingHandoffStore(
			join(temporary("plan-handoff-pending-"), "handoffs"),
		);
		store.retain(handoff({ id: "h1", workspace: "/home/frappe/one" }));
		store.retain(handoff({ id: "h2", workspace: "/home/frappe/two" }));
		expect(awaitingInWorkspace(store, "/home/frappe/one", 2_000)).toHaveLength(1);
		expect(awaitingInWorkspace(store, "/home/frappe/two", 2_000)).toHaveLength(1);
		expect(awaitingInWorkspace(store, "/home/frappe/three", 2_000)).toHaveLength(0);
	});
});
