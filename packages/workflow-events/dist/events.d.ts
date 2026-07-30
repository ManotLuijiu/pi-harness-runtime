/**
 * Workflow Events — Semantic Event Builder
 */
interface SessionEvent {
    id: string;
    sessionId: string;
    timestamp: string;
    type: string;
    content?: string;
    metadata?: Record<string, unknown>;
}
interface SemanticEvent {
    kind: string;
    timestamp: string;
    [key: string]: unknown;
}
interface WorkflowState {
    id: string;
    status: string;
    tasks: string[];
    blockers: string[];
}
interface WorkflowTransition {
    from: string;
    to: string;
    trigger: string;
    timestamp: string;
}
export declare function buildSemanticEvents(events: SessionEvent[]): SemanticEvent[];
export declare class WorkflowStateMachine {
    private state;
    private history;
    transition(event: SemanticEvent): WorkflowTransition;
    getState(): WorkflowState;
    getHistory(): WorkflowTransition[];
}
export {};
//# sourceMappingURL=events.d.ts.map