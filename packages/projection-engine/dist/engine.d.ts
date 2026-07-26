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
export declare class ProjectionEngine {
    private decisions;
    private taskStates;
    private agentTimelines;
    private messages;
    private tools;
    private topics;
    private sessionId;
    addEvent(event: SessionEvent): void;
    getDecisions(): Decision[];
    getTaskStates(): TaskState[];
    getSummary(): SessionSummary;
    getTimeline(agentId?: string): AgentTimeline[];
    reset(): void;
}
export {};
//# sourceMappingURL=engine.d.ts.map