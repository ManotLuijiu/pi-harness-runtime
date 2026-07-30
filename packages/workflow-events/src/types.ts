/**
 * Workflow Events — Semantic Event Types
 */

export type SemanticEvent =
	| TaskAssigned
	| TaskStarted
	| TaskCompleted
	| TaskFailed
	| ReviewRequested
	| ReviewCompleted
	| ArchitectureDecision
	| CodeGenerated
	| TestsPassed
	| TestsFailed
	| HumanApprovalRequested
	| HumanApprovalGranted
	| WorkflowFinished;

export interface TaskAssigned {
	kind: "TaskAssigned";
	taskId: string;
	assignedTo: string;
	assignedBy: string;
	timestamp: string;
}

export interface TaskStarted {
	kind: "TaskStarted";
	taskId: string;
	workerId: string;
	timestamp: string;
}

export interface TaskCompleted {
	kind: "TaskCompleted";
	taskId: string;
	workerId: string;
	result: {
		delivered: boolean;
		files?: string[];
		summary?: string;
	};
	timestamp: string;
}

export interface TaskFailed {
	kind: "TaskFailed";
	taskId: string;
	workerId: string;
	error: string;
	timestamp: string;
}

export interface ReviewRequested {
	kind: "ReviewRequested";
	taskId: string;
	reviewer: string;
	rationale: string;
	timestamp: string;
}

export interface ReviewCompleted {
	kind: "ReviewCompleted";
	taskId: string;
	reviewer: string;
	verdict: "approved" | "rejected" | "changes_requested";
	comments?: string;
	timestamp: string;
}

export interface ArchitectureDecision {
	kind: "ArchitectureDecision";
	id: string;
	decision: string;
	rationale: string;
	approved: boolean;
	timestamp: string;
}

export interface CodeGenerated {
	kind: "CodeGenerated";
	taskId: string;
	files: string[];
	timestamp: string;
}

export interface TestsPassed {
	kind: "TestsPassed";
	taskId: string;
	testCount: number;
	timestamp: string;
}

export interface TestsFailed {
	kind: "TestsFailed";
	taskId: string;
	failedCount: number;
	failures: string[];
	timestamp: string;
}

export interface HumanApprovalRequested {
	kind: "HumanApprovalRequested";
	taskId: string;
	rationale: string;
	requestedAt: string;
}

export interface HumanApprovalGranted {
	kind: "HumanApprovalGranted";
	taskId: string;
	grantedBy: string;
	timestamp: string;
}

export interface WorkflowFinished {
	kind: "WorkflowFinished";
	workflowId: string;
	outcome: "success" | "cancelled" | "failed";
	timestamp: string;
}

export type WorkflowStatus = "idle" | "running" | "paused" | "finished";

export interface WorkflowState {
	id: string;
	status: WorkflowStatus;
	tasks: string[];
	currentTask?: string;
	blockers: string[];
}

export interface WorkflowTransition {
	from: WorkflowStatus;
	to: WorkflowStatus;
	trigger: string;
	timestamp: string;
}
