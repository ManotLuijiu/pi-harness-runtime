/**
 * Projection Engine — Core
 */

interface SessionEvent {
	id: string;
	sessionId: string;
	timestamp: string;
	type: string;
	role?: string;
	content?: string;
	metadata?: Record<string, unknown>;
}

interface Decision {
	id: string;
	sessionId: string;
	timestamp: string;
	text: string;
	confidence: number;
	sources: string[];
}

interface TaskState {
	id: string;
	sessionId: string;
	status: string;
	createdAt: string;
	completedAt?: string;
}

interface AgentTimeline {
	agentId: string;
	events: Array<{ timestamp: string; type: string; message: string }>;
}

interface SessionSummary {
	sessionId: string;
	durationMs: number;
	messageCount: number;
	toolCount: number;
	decisionCount: number;
	taskCount: number;
	topics: string[];
}

export class ProjectionEngine {
	private decisions: Decision[] = [];
	private taskStates: Map<string, TaskState> = new Map();
	private agentTimelines: Map<string, AgentTimeline> = new Map();
	private messages = 0;
	private tools = 0;
	private topics = new Set<string>();
	private sessionId = "";

	addEvent(event: SessionEvent): void {
		this.sessionId = event.sessionId;

		if (event.type === "message") {
			this.messages++;
			if (event.role === "assistant") {
				const text = event.content ?? "";
				if (/RFC|ADR|architecture decision|design choice/i.test(text)) {
					this.decisions.push({
						id: event.id,
						sessionId: this.sessionId,
						timestamp: event.timestamp,
						text,
						confidence: 0.8,
						sources: [],
					});
				}
				const topicKeywords = [
					"deploy",
					"test",
					"fix",
					"refactor",
					"migrate",
					"security",
				];
				for (const kw of topicKeywords) {
					if (text.toLowerCase().includes(kw)) this.topics.add(kw);
				}
			}
		}

		if (event.type === "tool_start") this.tools++;

		if (event.type === "assistant_end") {
			const id = (event.metadata?.model as string) ?? "unknown";
			if (!this.agentTimelines.has(id)) {
				this.agentTimelines.set(id, { agentId: id, events: [] });
			}
			this.agentTimelines.get(id)!.events.push({
				timestamp: event.timestamp,
				type: "assistant_end",
				message: event.content ?? "",
			});
		}
	}

	getDecisions(): Decision[] {
		return this.decisions;
	}
	getTaskStates(): TaskState[] {
		return [...this.taskStates.values()];
	}
	getSummary(): SessionSummary {
		return {
			sessionId: this.sessionId,
			durationMs: 0,
			messageCount: this.messages,
			toolCount: this.tools,
			decisionCount: this.decisions.length,
			taskCount: this.taskStates.size,
			topics: [...this.topics],
		};
	}
	getTimeline(agentId?: string): AgentTimeline[] {
		if (agentId)
			return [this.agentTimelines.get(agentId)].filter(
				Boolean,
			) as AgentTimeline[];
		return [...this.agentTimelines.values()];
	}
	reset(): void {
		this.decisions = [];
		this.taskStates.clear();
		this.agentTimelines.clear();
		this.messages = 0;
		this.tools = 0;
		this.topics.clear();
	}
}
