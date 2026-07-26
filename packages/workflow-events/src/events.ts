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

export function buildSemanticEvents(events: SessionEvent[]): SemanticEvent[] {
	const semantic: SemanticEvent[] = [];
	for (const evt of events) {
		if (evt.type === "tool_end" && evt.content?.includes("task-")) {
			const match = evt.content.match(/task-[a-z0-9-]+/i);
			if (match) {
				semantic.push({
					kind: "TaskCompleted",
					taskId: match[0],
					workerId: (evt.metadata?.model as string) ?? "unknown",
					result: { delivered: true },
					timestamp: evt.timestamp,
				});
			}
		}
	}
	return semantic;
}

export class WorkflowStateMachine {
	private state: WorkflowState = { id: "main", status: "idle", tasks: [], blockers: [] };
	private history: WorkflowTransition[] = [];

	transition(event: SemanticEvent): WorkflowTransition {
		const prev = this.state.status;
		if (event.kind === "TaskStarted") {
			this.state.status = "running";
			this.state.tasks.push(event.taskId as string);
		} else if (event.kind === "WorkflowFinished") {
			this.state.status = "finished";
		}
		const t: WorkflowTransition = {
			from: prev,
			to: this.state.status,
			trigger: event.kind,
			timestamp: new Date().toISOString(),
		};
		this.history.push(t);
		return t;
	}

	getState(): WorkflowState { return { ...this.state }; }
	getHistory(): WorkflowTransition[] { return [...this.history]; }
}
