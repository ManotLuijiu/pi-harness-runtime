/**
 * A2A Adapter Tests (RFC-0069)
 */

import { describe, it, expect } from "bun:test";
import {
	createAgentCard,
	routeTask,
	getTask,
	cancelTask,
	taskStatusUpdateSSE,
} from "../src/agent.js";
import { A2AClient } from "../src/client.js";
import { A2ATransport } from "../src/transport.js";
import {
	A2A_PROTOCOL_VERSION,
	WELL_KNOWN_AGENT_PATH,
} from "../src/protocol.js";
import type { TaskMessage } from "../src/types.js";

describe("A2A Protocol Constants", () => {
	it("exports protocol version", () => {
		expect(A2A_PROTOCOL_VERSION).toBe("1.0.0");
	});

	it("exports well-known agent path", () => {
		expect(WELL_KNOWN_AGENT_PATH).toBe("/.well-known/agent.json");
	});
});

describe("AgentCard", () => {
	it("creates agent card with defaults", () => {
		const card = createAgentCard({
			name: "pi-harness",
			description: "AI coding harness",
			url: "http://localhost:3000",
			version: "0.9.4",
		});
		expect(card.name).toBe("pi-harness");
		expect(card.capabilities.streaming).toBe(true);
		expect(card.skills.length).toBeGreaterThan(0);
		expect(card.skills[0].id).toBe("code-analysis");
	});

	it("creates agent card with custom skills", () => {
		const card = createAgentCard({
			name: "test-agent",
			description: "Test",
			url: "http://localhost:3001",
			version: "1.0.0",
			skills: [
				{
					id: "custom",
					name: "Custom",
					description: "Custom skill",
					tags: ["test"],
				},
			],
		});
		expect(card.skills).toHaveLength(1);
		expect(card.skills[0].id).toBe("custom");
	});

	it("merges custom capabilities", () => {
		const card = createAgentCard({
			name: "test",
			description: "Test",
			url: "http://localhost:3002",
			version: "1.0.0",
			capabilities: { pushNotifications: true },
		});
		expect(card.capabilities.streaming).toBe(true);
		expect(card.capabilities.pushNotifications).toBe(true);
	});
});

describe("Task Routing", () => {
	it("routes a task message", async () => {
		const message: TaskMessage = { role: "user", content: "Analyze this code" };
		const task = await routeTask(message);
		expect(task.id).toMatch(/^task-/);
		expect(task.status).toBe("completed");
		expect(task.artifacts).toHaveLength(1);
		expect(task.artifacts![0].parts[0].text).toContain("Analyze this code");
	});

	it("stores and retrieves task", async () => {
		const message: TaskMessage = { role: "user", content: "Test" };
		const task = await routeTask(message);
		const retrieved = getTask(task.id);
		expect(retrieved).not.toBeNull();
		expect(retrieved!.id).toBe(task.id);
	});

	it("returns null for unknown task", () => {
		expect(getTask("nonexistent-task")).toBeNull();
	});

	it("cancels a task", async () => {
		const message: TaskMessage = { role: "user", content: "Cancel test" };
		const task = await routeTask(message);
		expect(task.status).toBe("completed");
		const result = cancelTask(task.id);
		expect(result).toBe(true);
		expect(getTask(task.id)!.status).toBe("canceled");
	});

	it("returns false when canceling unknown task", () => {
		expect(cancelTask("nonexistent")).toBe(false);
	});

	it("generates SSE status update", async () => {
		const message: TaskMessage = { role: "user", content: "SSE test" };
		const task = await routeTask(message);
		const sse = taskStatusUpdateSSE(task.id);
		expect(sse).toContain("task_status_update");
		expect(sse).toContain(task.id);
		expect(sse).toContain("completed");
		expect(sse).toContain("final");
	});
});

describe("A2AClient", () => {
	it("creates client with URL", () => {
		const client = new A2AClient("http://localhost:3000");
		expect(client).toBeDefined();
	});

	it("sendTask throws on unreachable server", async () => {
		const client = new A2AClient("http://localhost:9999");
		await expect(client.sendTask("test")).rejects.toThrow();
	});

	it("findAgents returns empty array", async () => {
		const client = new A2AClient("http://localhost:3000");
		const results = await client.findAgents({ skill: "test" });
		expect(results).toEqual([]);
	});
});

describe("A2ATransport", () => {
	it("creates transport with config", () => {
		const t = new A2ATransport("http://localhost:3000", { timeout: 5000 });
		expect(t).toBeDefined();
	});

	it("getAgentCard throws on invalid URL", async () => {
		const t = new A2ATransport("http://localhost:9999", { timeout: 2000 });
		await expect(t.getAgentCard()).rejects.toThrow();
	});
});
