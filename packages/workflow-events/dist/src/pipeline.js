/**
 * Workflow Events — Pipeline (self-contained)
 */
export class WorkflowPipeline {
    state = { id: "main", status: "idle", tasks: [], blockers: [] };
    history = [];
    transition(kind, data = {}) {
        const prev = this.state.status;
        if (kind === "TaskStarted") {
            this.state.status = "running";
            if (data.taskId)
                this.state.tasks.push(data.taskId);
        }
        else if (kind === "WorkflowFinished") {
            this.state.status = "finished";
        }
        this.history.push({
            from: prev,
            to: this.state.status,
            trigger: kind,
            timestamp: new Date().toISOString(),
        });
    }
    getState() { return { ...this.state }; }
    getHistory() { return [...this.history]; }
}
//# sourceMappingURL=pipeline.js.map