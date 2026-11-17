/**
 * The routing of a plan handoff.
 *
 * The tests are the acceptance of the design: two projects with the same
 * model label, two sessions in one project, a symlink alias, two worktrees
 * of one repository, a changed working directory, an expired heartbeat and a
 * reused process id, a restarted instance with a new generation.
 *
 * Synthetic fixtures only: a temporary directory, a fake host, a fake clock.
 * No provider, no network, no real session.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPlanHandoffMessage,
	detectWorkspace,
	hashPlanPayload,
	MAX_PLAN_PAYLOAD_BYTES,
	PLAN_HANDOFF_SCHEMA_VERSION,
	RegistrationStore,
	resolveRecipient,
	validatePlanHandoffMessage,
	validateRecipientIdentity,
	type AgentRegistration,
	type PlanHandoffAction,
	type PlanHandoffMessage,
	type PlanHandoffPlan,
	type PlanHandoffRecipientIdentity,
	type PlanHandoffScope,
} from "../src/index.js";

/**
 * The workspace of the sender and of the instances of the fixture.
 */
const WORKSPACE = temporary("plan-handoff-routing-");

/**
 * Another workspace: a plan is never routed into it.
 */
const OTHER_WORKSPACE = temporary("plan-handoff-other-");

/**
 * A registration of an instance, with the fields the router reads.
 */
function registration(
	overrides: Partial<AgentRegistration> & { agentId: string },
): AgentRegistration {
	return {
		sessionId: "session-1",
		generation: 1,
		workspace: WORKSPACE,
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

describe("the routing of a plan", () => {
	it("selects the only live instance of the workspace", () => {
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({ agentId: "agent-b", workspace: OTHER_WORKSPACE }),
			],
		});
		expect(result.status).toBe("selected");
		expect(result.registration?.agentId).toBe("agent-a");
	});

	it("never delivers a plan to another project", () => {
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [
				registration({
					agentId: "agent-other",
					workspace: OTHER_WORKSPACE,
				}),
			],
		});
		expect(result.status).toBe("awaiting");
		expect(result.registration).toBeUndefined();
		expect(result.candidates).toHaveLength(0);
	});

	it("never decides by the model label", () => {
		// Two instances of two projects carry the same label.
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({
					agentId: "agent-b",
					workspace: OTHER_WORKSPACE,
				}),
			],
		});
		expect(result.status).toBe("selected");
		expect(result.registration?.agentId).toBe("agent-a");
	});

	it("asks which one when several instances share the workspace", () => {
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({ agentId: "agent-b", sessionId: "session-2" }),
			],
		});
		expect(result.status).toBe("ambiguous");
		expect(result.registration).toBeUndefined();
		expect(result.candidates.map((entry) => entry.agentId)).toEqual([
			"agent-a",
			"agent-b",
		]);
	});

	it("uses an existing pairing when several instances share the workspace", () => {
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({ agentId: "agent-b", sessionId: "session-2" }),
			],
			pairing: { agentId: "agent-b", sessionId: "session-2" },
		});
		expect(result.status).toBe("selected");
		expect(result.registration?.agentId).toBe("agent-b");
	});

	it("ignores a pairing that names a session that ended", () => {
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-a" }),
				registration({ agentId: "agent-b", sessionId: "session-2" }),
			],
			pairing: { agentId: "agent-b", sessionId: "session-old" },
		});
		expect(result.status).toBe("ambiguous");
	});

	it("retains the plan when no instance matches", () => {
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [],
		});
		expect(result.status).toBe("awaiting");
		expect(result.reason).toContain("retained");
	});

	it("never selects an instance of another host", () => {
		const result = resolveRecipient({
			workspace: WORKSPACE,
			host: "host-a",
			registrations: [registration({ agentId: "agent-a", host: "host-b" })],
		});
		expect(result.status).toBe("awaiting");
	});
});

describe("the canonical workspace", () => {
	it("treats a symlink of the workspace as the same workspace", () => {
		const base = temporary("plan-handoff-link-");
		const real = join(base, "real");
		const link = join(base, "link");
		mkdirSync(real, { recursive: true });
		symlinkSync(real, link);

		const result = resolveRecipient({
			workspace: link,
			host: "host-a",
			registrations: [registration({ agentId: "agent-a", workspace: real })],
		});
		expect(result.status).toBe("selected");
	});

	it("keeps two worktrees of one repository apart", () => {
		const base = temporary("plan-handoff-worktree-");
		const first = join(base, "worktree-a");
		const second = join(base, "worktree-b");
		for (const worktree of [first, second]) {
			mkdirSync(join(worktree, ".git"), { recursive: true });
			writeFileSync(
				join(worktree, ".git", "config"),
				"[remote \"origin\"]\n\turl = git@example.invalid:owner/repo.git\n",
			);
		}

		const result = resolveRecipient({
			workspace: first,
			host: "host-a",
			registrations: [
				registration({ agentId: "agent-b", workspace: second }),
			],
		});
		expect(result.status).toBe("awaiting");
	});

	it("follows a changed working directory", () => {
		const base = temporary("plan-handoff-cwd-");
		const before = detectWorkspace(base);
		const after = detectWorkspace(join(base, "other"));
		expect(before.path).not.toBe(after.path);
	});
});

describe("the store of the registrations", () => {
	it("keeps only the registrations whose heartbeat is alive", () => {
		const directory = join(temporary("plan-handoff-store-"), "agents");
		const store = new RegistrationStore(directory, {
			ttlMs: 1_000,
			now: () => 5_000,
		});
		store.upsert(
			registration({ agentId: "agent-a", heartbeatAt: 4_500 }),
		);
		store.upsert(
			registration({ agentId: "agent-b", heartbeatAt: 1_000 }),
		);

		const live = store.live(5_000);
		expect(live.map((entry) => entry.agentId)).toEqual(["agent-a"]);
	});

	it("does not trust a reused process id", () => {
		const directory = join(temporary("plan-handoff-store-"), "agents");
		const store = new RegistrationStore(directory, {
			ttlMs: 1_000,
			now: () => 5_000,
		});
		store.upsert(
			registration({ agentId: "agent-a", pid: 7, heartbeatAt: 1_000 }),
		);

		// The process id belongs to another process now: the heartbeat is the
		// proof of life, and it expired.
		expect(store.live(5_000)).toHaveLength(0);
	});

	it("replaces the registration of the same agent and removes it", () => {
		const directory = join(temporary("plan-handoff-store-"), "agents");
		const store = new RegistrationStore(directory);
		store.upsert(registration({ agentId: "agent-a", heartbeatAt: 1 }));
		store.upsert(registration({ agentId: "agent-a", heartbeatAt: 2 }));
		expect(store.list()).toHaveLength(1);
		expect(store.list()[0].heartbeatAt).toBe(2);

		store.remove("agent-a");
		expect(store.list()).toHaveLength(0);
	});
});

describe("the message of a plan", () => {
	const recipient = registration({ agentId: "agent-a" });

	function message(
		overrides: {
			plan?: Partial<PlanHandoffPlan>;
			action?: PlanHandoffAction;
			scope?: PlanHandoffScope;
			recipient?: Partial<PlanHandoffRecipientIdentity>;
		} = {},
	): PlanHandoffMessage {
		return createPlanHandoffMessage({
			sender: {
				agentId: "codex-1",
				sessionId: "codex-session-1",
				workspace: WORKSPACE,
			},
			recipient: {
				agentId: recipient.agentId,
				sessionId: recipient.sessionId,
				generation: recipient.generation,
				workspace: recipient.workspace,
				...overrides.recipient,
			},
			plan: {
				revision: "r1",
				summary: "the plan in one line",
				payload: "the plan itself",
				...overrides.plan,
			},
			action: overrides.action ?? "inform",
			scope: overrides.scope,
		});
	}

	it("carries the identity of both sides and the correlation id", () => {
		const built = message();
		expect(built.schemaVersion).toBe(PLAN_HANDOFF_SCHEMA_VERSION);
		expect(built.sender.agentId).toBe("codex-1");
		expect(built.recipient.agentId).toBe("agent-a");
		expect(built.correlationId.length).toBeGreaterThan(0);
		expect(built.id.length).toBeGreaterThan(0);
	});

	it("hashes the payload so a change is detectable", () => {
		const built = message();
		expect(built.plan.hash).toBe(hashPlanPayload("the plan itself"));

		const changed = { ...built, plan: { ...built.plan, payload: "other" } };
		const result = validatePlanHandoffMessage(changed);
		expect(result.ok).toBe(false);
		expect(result.reasons.join(" ")).toContain("hash");
	});

	it("refuses a message of another schema version", () => {
		const result = validatePlanHandoffMessage({
			...message(),
			schemaVersion: 99,
		});
		expect(result.ok).toBe(false);
	});

	it("refuses an unknown action", () => {
		const result = validatePlanHandoffMessage(
			message({ action: "push" as never }),
		);
		expect(result.ok).toBe(false);
	});

	it("refuses a payload that is too large", () => {
		const result = validatePlanHandoffMessage(
			message({
				plan: {
					revision: "r1",
					summary: "big",
					payload: "x".repeat(MAX_PLAN_PAYLOAD_BYTES + 1),
				},
			}),
		);
		expect(result.ok).toBe(false);
		expect(result.reasons.join(" ")).toContain("payload");
	});

	it("refuses a reference that lies outside the workspace", () => {
		const result = validatePlanHandoffMessage(
			message({
				plan: {
					revision: "r1",
					summary: "a plan",
					reference: "/etc/passwd",
				},
			}),
		);
		expect(result.ok).toBe(false);
		expect(result.reasons.join(" ")).toContain("outside the workspace");
	});

	it("refuses a scope that lies outside the workspace", () => {
		const result = validatePlanHandoffMessage(
			message({ scope: { paths: ["/other/file"] } }),
		);
		expect(result.ok).toBe(false);
	});

	it("accepts a message that is addressed to this instance", () => {
		const result = validateRecipientIdentity(message(), recipient);
		expect(result.ok).toBe(true);
	});

	it("refuses a message of another session", () => {
		const result = validateRecipientIdentity(
			message({
				recipient: { ...message().recipient, sessionId: "session-other" },
			}),
			recipient,
		);
		expect(result.ok).toBe(false);
	});

	it("refuses a message of a restarted instance", () => {
		const restarted = registration({
			agentId: recipient.agentId,
			generation: 2,
		});
		const result = validateRecipientIdentity(message(), restarted);
		expect(result.ok).toBe(false);
		expect(result.reasons.join(" ")).toContain("generation");
	});

	it("refuses a message of another workspace", () => {
		const elsewhere = registration({
			agentId: recipient.agentId,
			workspace: OTHER_WORKSPACE,
		});
		const result = validateRecipientIdentity(message(), elsewhere);
		expect(result.ok).toBe(false);
	});
});
