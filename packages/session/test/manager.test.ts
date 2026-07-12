/**
 * Session Manager - Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createSessionManager,
	createPolicyEngine,
	SDK_VERSION,
} from "../src/index.js";

describe("SessionManager", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("createSessionManager", () => {
		it("should create a session manager instance", () => {
			const manager = createSessionManager({
				rootDir: "/tmp/sessions-test",
			});
			expect(manager).toBeDefined();
		});
	});

	describe("session lifecycle", () => {
		const manager = createSessionManager({
			rootDir: "/tmp/session-lifecycle-test",
			sessionTtlMs: 60000,
			autoCleanup: false,
		});

		let sessionId: string;

		it("should create a session", async () => {
			const session = await manager.create("user-123", { project: "test" });

			expect(session).toBeDefined();
			expect(session.id).toBeDefined();
			expect(session.userId).toBe("user-123");
			expect(session.status).toBe("active");
			sessionId = session.id;
		});

		it("should get session", async () => {
			const session = await manager.get(sessionId);

			expect(session).toBeDefined();
			expect(session?.id).toBe(sessionId);
		});

		it("should get session context", async () => {
			const context = await manager.getContext(sessionId);

			expect(context).toBeDefined();
			expect(context?.messages).toBeDefined();
			expect(Array.isArray(context?.messages)).toBe(true);
		});

		it("should list sessions by user", async () => {
			const sessions = await manager.listByUser("user-123");

			expect(sessions.length).toBeGreaterThan(0);
			expect(sessions[0].userId).toBe("user-123");
		});

		it("should add messages", async () => {
			const message = await manager.addMessage(sessionId, {
				role: "user",
				content: "Hello, world!",
				timestamp: new Date().toISOString(),
			});

			expect(message).toBeDefined();
			expect(message?.content).toBe("Hello, world!");
		});

		it("should get messages", async () => {
			const messages = await manager.getMessages(sessionId);

			expect(messages.length).toBeGreaterThan(0);
			expect(messages[0].role).toBe("user");
		});

		it("should update token usage", async () => {
			await manager.updateTokenUsage(sessionId, {
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150,
				totalCost: 0.001,
			});

			const context = await manager.getContext(sessionId);
			expect(context?.tokenUsage.totalTokens).toBe(150);
		});

		it("should suspend session", async () => {
			await manager.suspend(sessionId, "User requested pause");

			const session = await manager.get(sessionId);
			expect(session?.status).toBe("suspended");
		});

		it("should resume session", async () => {
			await manager.resume(sessionId);

			const session = await manager.get(sessionId);
			expect(session?.status).toBe("active");
		});

		it("should end session", async () => {
			await manager.end(sessionId);

			const session = await manager.get(sessionId);
			expect(session?.status).toBe("closed");
		});
	});

	describe("event system", () => {
		const manager = createSessionManager({
			rootDir: "/tmp/session-events-test",
			autoCleanup: false,
		});

		let sessionId: string;
		let events: string[] = [];

		beforeEach(async () => {
			events = [];
			const session = await manager.create("user-events");
			sessionId = session.id;
		});

		it("should emit session:created event", async () => {
			manager.on("session:created", () => {
				events.push("session:created");
			});

			const session = await manager.create("new-user");
			expect(events).toContain("session:created");

			await manager.delete(session.id);
		});

		it("should emit message:added event", async () => {
			manager.on("message:added", () => {
				events.push("message:added");
			});

			await manager.addMessage(sessionId, {
				role: "user",
				content: "Test",
				timestamp: new Date().toISOString(),
			});

			expect(events).toContain("message:added");
		});
	});
});

describe("PolicyEngine", () => {
	describe("createPolicyEngine", () => {
		it("should create a policy engine instance", () => {
			const engine = createPolicyEngine();
			expect(engine).toBeDefined();
		});

		it("should create with custom config", () => {
			const engine = createPolicyEngine({
				maxRequestsPerMinute: 100,
				sessionBudget: 10,
			});
			expect(engine).toBeDefined();
		});
	});

	describe("rate limiting", () => {
		const engine = createPolicyEngine({
			maxRequestsPerMinute: 5,
		});

		it("should allow requests within limit", () => {
			expect(engine.canProceed("test-session", "message")).toBe(true);
		});

		it("should track remaining requests", () => {
			engine.recordAction("test-session", "message");

			const state = engine.getPolicyState("test-session");
			expect(state.rateLimitRemaining).toBeLessThan(5);
		});
	});

	describe("budget tracking", () => {
		const engine = createPolicyEngine({
			sessionBudget: 1,
		});

		it("should track budget", () => {
			engine.setSessionBudget("budget-session", 1, 60000);

			const state = engine.getPolicyState("budget-session");
			expect(state.budgetRemaining).toBeDefined();
		});
	});

	describe("suspension", () => {
		const engine = createPolicyEngine();

		it("should suspend session", () => {
			engine.suspend("suspended-session", "Violation");

			const state = engine.getPolicyState("suspended-session");
			expect(state.suspended).toBe(true);
			expect(state.suspensionReason).toBe("Violation");
		});

		it("should not allow actions on suspended session", () => {
			expect(engine.canProceed("suspended-session", "message")).toBe(false);
		});

		it("should resume session", () => {
			engine.resume("suspended-session");

			const state = engine.getPolicyState("suspended-session");
			expect(state.suspended).toBe(false);
			expect(engine.canProceed("suspended-session", "message")).toBe(true);
		});
	});
});
