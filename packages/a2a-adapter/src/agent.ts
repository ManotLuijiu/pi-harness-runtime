/**
 * A2A Adapter — A2A Agent (RFC-0069)
 *
 * Expose this harness agent as an A2A-compatible agent.
 */

import type {
	AgentCard,
	A2AAgentConfig,
	Task,
	TaskMessage,
	TaskStatus,
	Skill,
} from "./types.js";
import { A2A_PROTOCOL_VERSION } from "./protocol.js";

/**
 * Task store — in-memory for now
 */
const taskStore = new Map<string, Task>();

let taskCounter = 0;

/**
 * Create an AgentCard for this harness agent
 */
export function createAgentCard(config: A2AAgentConfig): AgentCard {
	return {
		name: config.name,
		description: config.description,
		url: config.url,
		version: config.version,
		capabilities: {
			streaming: true,
			pushNotifications: false,
			stateTransitionHistory: false,
			...config.capabilities,
		},
		skills: config.skills ?? [
			{
				id: "code-analysis",
				name: "Code Analysis",
				description: "Analyze code structure, dependencies, and quality",
				tags: ["code", "analysis", "static-analysis"],
				inputModes: ["text"],
				outputModes: ["text"],
			},
			{
				id: "code-generation",
				name: "Code Generation",
				description: "Generate code from specifications",
				tags: ["code", "generation", "scaffolding"],
				inputModes: ["text"],
				outputModes: ["text"],
			},
		],
		defaultInputModes: ["text"],
		defaultOutputModes: ["text"],
	};
}

/**
 * Route incoming A2A task to harness skill-registry
 */
export async function routeTask(message: TaskMessage): Promise<Task> {
	const taskId = `task-${++taskCounter}-${Date.now()}`;
	const task: Task = {
		id: taskId,
		status: "working",
		kind: "message",
		artifacts: [],
	};
	taskStore.set(taskId, task);

	try {
		const response = await processMessage(message);
		task.artifacts = [
			{
				name: "response",
				description: "Agent response",
				parts: [{ type: "text", text: response }],
			},
		];
		task.status = "completed";
	} catch (err) {
		task.status = "failed";
		const msg = err instanceof Error ? err.message : String(err);
		task.artifacts = [{ parts: [{ type: "text", text: `Error: ${msg}` }] }];
	}

	taskStore.set(taskId, task);
	return task;
}

/**
 * Process message — stub for harness integration
 */
async function processMessage(message: TaskMessage): Promise<string> {
	return `[A2A Stub] Received: ${message.content}. This would be processed by the harness skill-registry.`;
}

/**
 * Get task by ID
 */
export function getTask(taskId: string): Task | null {
	return taskStore.get(taskId) ?? null;
}

/**
 * Cancel a task
 */
export function cancelTask(taskId: string): boolean {
	const task = taskStore.get(taskId);
	if (!task) return false;
	task.status = "canceled";
	taskStore.set(taskId, task);
	return true;
}

/**
 * Generate task status update SSE
 */
export function taskStatusUpdateSSE(taskId: string): string {
	const task = taskStore.get(taskId);
	if (!task) return "";
	// Inline SSE formatting to avoid dynamic require at module level
	return (
		`event: task_status_update\ndata: ` +
		JSON.stringify({
			taskId: task.id,
			status: task.status,
			final:
				task.status === "completed" ||
				task.status === "failed" ||
				task.status === "canceled",
		}) +
		"\n\n"
	);
}
