/**
 * Workflow Events — Semantic Event Builder
 */
export function buildSemanticEvents(events) {
    const semantic = [];
    for (const evt of events) {
        if (evt.type === "tool_end" && evt.content?.includes("task-")) {
            const match = evt.content.match(/task-[a-z0-9-]+/i);
            if (match) {
                semantic.push({
                    kind: "TaskCompleted",
                    taskId: match[0],
                    workerId: evt.metadata?.model ?? "unknown",
                    result: { delivered: true },
                    timestamp: evt.timestamp,
                });
            }
        }
    }
    return semantic;
}
export class WorkflowStateMachine {
    state = { id: "main", status: "idle", tasks: [], blockers: [] };
    history = [];
    transition(event) {
        const prev = this.state.status;
        if (event.kind === "TaskStarted") {
            this.state.status = "running";
            this.state.tasks.push(event.taskId);
        }
        else if (event.kind === "WorkflowFinished") {
            this.state.status = "finished";
        }
        const t = {
            from: prev,
            to: this.state.status,
            trigger: event.kind,
            timestamp: new Date().toISOString(),
        };
        this.history.push(t);
        return t;
    }
    getState() { return { ...this.state }; }
    getHistory() { return [...this.history]; }
}
//# sourceMappingURL=events.js.map