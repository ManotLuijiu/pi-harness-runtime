/**
 * Workflow Events — Pipeline (self-contained)
 */

export class WorkflowPipeline {
	private state = { id: "main", status: "idle", tasks: [] as string[], blockers: [] as string[] };
	private history: Array<{ from: string; to: string; trigger: string; timestamp: string }> = [];

	transition(kind: string, data: Record<string, unknown> = {}): void {
		const prev = this.state.status;
		if (kind === "TaskStarted") {
			this.state.status = "running";
			if (data.taskId) this.state.tasks.push(data.taskId as string);
		} else if (kind === "WorkflowFinished") {
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
