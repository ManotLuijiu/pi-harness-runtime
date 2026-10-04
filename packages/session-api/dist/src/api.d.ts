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
    events: Array<{
        timestamp: string;
        type: string;
        message: string;
    }>;
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
export declare class SessionServiceImpl implements SessionService {
    private events;
    private decisions;
    private tasks;
    private summary;
    loadEvents(events: SessionEvent[]): void;
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
export {};
//# sourceMappingURL=api.d.ts.map