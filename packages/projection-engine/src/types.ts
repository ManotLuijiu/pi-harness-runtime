/**
 * Projection Engine — Types
 */

export interface Projection<T> {
	project(events: unknown[]): T;
	reset(): void;
	get(): T;
}

export interface Decision {
	id: string;
	sessionId: string;
	timestamp: string;
	text: string;
	confidence: number;
	sources: string[];
}

export interface TaskState {
	id: string;
	sessionId: string;
	status: "pending" | "running" | "completed" | "failed";
	createdAt: string;
	completedAt?: string;
	result?: {
		delivered?: boolean;
		files?: string[];
		summary?: string;
	};
}

export interface KnowledgeExtraction {
	id: string;
	sessionId: string;
	timestamp: string;
	concept: string;
	content: string;
	confidence: number;
	approved: boolean;
}

export interface AgentTimeline {
	agentId: string;
	events: Array<{
		timestamp: string;
		type: string;
		message: string;
	}>;
}

export interface SessionSummary {
	sessionId: string;
	durationMs: number;
	messageCount: number;
	toolCount: number;
	decisionCount: number;
	taskCount: number;
	topics: string[];
}
