/**
 * Session API — Types
 */

export interface SessionQuery {
	sessionId?: string;
	since?: string;
	types?: string[];
	limit?: number;
}

/** Placeholder — types are defined in sibling packages */
export interface SessionService {
	getLatestDecision(): Promise<unknown | null>;
	getLatestTask(): Promise<unknown | null>;
	getRecentFailures(limit?: number): Promise<unknown[]>;
	getArchitectureHistory(): Promise<unknown[]>;
	getWorkflowState(): Promise<unknown>;
	getLatestSummary(): Promise<unknown>;
	search(query: string): Promise<unknown[]>;
	getAgentTimeline(agentId: string): Promise<unknown>;
	getSessionTimeline(limit?: number): Promise<unknown[]>;
}
