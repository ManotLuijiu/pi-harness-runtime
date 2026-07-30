/**
 * Session API — Safe API for agents
 */

interface SessionEvent {
	id: string;
	sessionId: string;
	timestamp: string;
	type: string;
	content?: string;
	role?: string;
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

interface WorkflowState {
	id: string;
	status: string;
	tasks: string[];
	blockers: string[];
}

interface ArchitectureDecision {
	id: string;
	decision: string;
	timestamp: string;
}

export interface SessionService {
	getLatestDecision(): Promise<Decision | null>;
	getLatestTask(): Promise<TaskState | null>;
	getRecentFailures(limit?: number): Promise<SessionEvent[]>;
	getArchitectureHistory(): Promise<ArchitectureDecision[]>;
	getWorkflowState(): Promise<WorkflowState>;
	getLatestSummary(): Promise<SessionSummary>;
	search(query: string): Promise<SessionEvent[]>;
	getAgentTimeline(agentId: string): Promise<AgentTimeline>;
	getSessionTimeline(limit?: number): Promise<SessionEvent[]>;
}

export class SessionServiceImpl implements SessionService {
	private events: SessionEvent[] = [];
	private decisions: Decision[] = [];
	private tasks: TaskState[] = [];
	private summary: SessionSummary = {
		sessionId: "",
		durationMs: 0,
		messageCount: 0,
		toolCount: 0,
		decisionCount: 0,
		taskCount: 0,
		topics: [],
	};

	loadEvents(events: SessionEvent[]): void {
		this.events = events;
	}

	async getLatestDecision(): Promise<Decision | null> {
		return this.decisions[this.decisions.length - 1] ?? null;
	}
	async getLatestTask(): Promise<TaskState | null> {
		return this.tasks[this.tasks.length - 1] ?? null;
	}
	async getRecentFailures(limit = 10): Promise<SessionEvent[]> {
		return this.events.filter((e) => e.type === "tool_error").slice(-limit);
	}
	async getArchitectureHistory(): Promise<ArchitectureDecision[]> {
		return [];
	}
	async getWorkflowState(): Promise<WorkflowState> {
		return { id: "main", status: "running", tasks: [], blockers: [] };
	}
	async getLatestSummary(): Promise<SessionSummary> {
		return this.summary;
	}
	async search(query: string): Promise<SessionEvent[]> {
		const q = query.toLowerCase();
		return this.events.filter((e) => e.content?.toLowerCase().includes(q));
	}
	async getAgentTimeline(agentId: string): Promise<AgentTimeline> {
		return { agentId, events: [] };
	}
	async getSessionTimeline(limit = 100): Promise<SessionEvent[]> {
		return this.events.slice(-limit);
	}
}
