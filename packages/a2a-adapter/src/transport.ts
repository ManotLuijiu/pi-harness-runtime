/**
 * A2A Adapter — HTTP Transport (RFC-0069)
 */

import { wellKnownAgentUrl } from "./protocol.js";
import type { AgentCard, A2AClientConfig, TaskHandle } from "./types.js";

/**
 * HTTP client for A2A protocol
 */
export class A2ATransport {
	private baseUrl: string;
	private config: A2AClientConfig;

	constructor(baseUrl: string, config: A2AClientConfig = {}) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.config = config;
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
			...this.config.headers,
		};

		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(this.config.timeout ?? 30000),
		} as RequestInit);

		if (!response.ok) {
			throw new Error(
				`A2A HTTP error: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Fetch agent card from well-known endpoint
	 */
	async getAgentCard(): Promise<AgentCard> {
		return this.request<AgentCard>("GET", "/.well-known/agent.json");
	}

	/**
	 * Send a task message to an agent
	 */
	async sendTask(params: {
		taskId?: string;
		sessionId?: string;
		message: { role: string; content: string };
	}): Promise<TaskHandle> {
		return this.request<TaskHandle>("POST", "/a2a/tasks/send", {
			jsonrpc: "2.0",
			method: "tasks/send",
			params,
		});
	}

	/**
	 * Send task with streaming subscription
	 */
	async sendTaskSubscribe(params: {
		taskId?: string;
		sessionId?: string;
		message: { role: string; content: string };
	}): Promise<TaskHandle> {
		return this.request<TaskHandle>("POST", "/a2a/tasks/sendSubscribe", {
			jsonrpc: "2.0",
			method: "tasks/sendSubscribe",
			params,
		});
	}

	/**
	 * Get task status
	 */
	async getTask(taskId: string): Promise<unknown> {
		return this.request("GET", `/a2a/tasks/${taskId}`);
	}

	/**
	 * Cancel a task
	 */
	async cancelTask(
		taskId: string,
	): Promise<{ taskId: string; status: string }> {
		return this.request("POST", `/a2a/tasks/${taskId}/cancel`);
	}

	/**
	 * SSE stream for task updates
	 */
	async *streamTaskUpdates(taskId: string): AsyncGenerator<unknown> {
		const url = `${this.baseUrl}/a2a/tasks/${taskId}/stream`;
		const response = await fetch(url, {
			headers: {
				Accept: "text/event-stream",
				...this.config.headers,
			},
			signal: AbortSignal.timeout(this.config.timeout ?? 60000),
		} as RequestInit);

		if (!response.ok || !response.body) {
			throw new Error(`Stream error: ${response.status}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = JSON.parse(line.slice(6));
						yield data;
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}
}
