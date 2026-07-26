/**
 * Workflow Events — Pipeline (self-contained)
 */
export declare class WorkflowPipeline {
    private state;
    private history;
    transition(kind: string, data?: Record<string, unknown>): void;
    getState(): {
        id: string;
        status: string;
        tasks: string[];
        blockers: string[];
    };
    getHistory(): {
        from: string;
        to: string;
        trigger: string;
        timestamp: string;
    }[];
}
//# sourceMappingURL=pipeline.d.ts.map