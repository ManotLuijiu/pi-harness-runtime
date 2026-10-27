/**
 * The children that were really dispatched.
 *
 * The harness does not dispatch anything: the agent sends the measured
 * groups to the sub-agent tool. The harness watches the tool events, so
 * that a delegation is only reported when a child really ran.
 *
 * Everything in here is observed. The model of a child is the model the
 * extension reported, never one that was guessed.
 */

/**
 * One child that the agent dispatched.
 */
export interface DelegationChild {
	/** The id of the tool call that dispatched the child. */
	toolCallId: string;
	/** The tool that dispatched the child. */
	toolName: string;
	/** The group of the plan that the child works on, when the task names one. */
	groupId?: string;
	/** The task the child received, bounded to a readable length. */
	task?: string;
	/** The model the extension reported for the child, when it reported one. */
	model?: string;
	/** When the child started. */
	startedAt: number;
	/** When the child ended. */
	endedAt?: number;
	/** The state of the child. */
	status: "running" | "completed" | "failed";
	/** A bounded summary of what the child returned. */
	output?: string;
}

/** The longest task text that is kept. */
const MAX_TASK_LENGTH = 400;

/** The longest output summary that is kept. */
const MAX_OUTPUT_LENGTH = 600;

/**
 * The model that a result names, when it names one.
 *
 * The result of a dispatch is a report of what the extension did. The
 * model is only recorded when the report carries it: a guess would be a
 * fact that nobody observed.
 */
export function modelFromResult(result: unknown): string | undefined {
	if (!result || typeof result !== "object") return undefined;
	const record = result as Record<string, unknown>;
	const candidates = [record.model, record.modelId, record.provider];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
	const nested = record.result;
	if (nested && typeof nested === "object") {
		const nestedModel = (nested as Record<string, unknown>).model;
		if (typeof nestedModel === "string" && nestedModel.length > 0) return nestedModel;
	}
	return undefined;
}

/**
 * A bounded summary of the output of a child.
 */
export function summarizeOutput(result: unknown): string | undefined {
	if (result === undefined || result === null) return undefined;
	let text: string;
	if (typeof result === "string") {
		text = result;
	} else {
		try {
			text = JSON.stringify(result);
		} catch {
			text = String(result);
		}
	}
	if (text.length === 0) return undefined;
	return text.length > MAX_OUTPUT_LENGTH ? `${text.slice(0, MAX_OUTPUT_LENGTH)}...` : text;
}

/**
 * The group of the plan that a task works on.
 *
 * The task is matched against the ids of the measured groups. A task that
 * names no group belongs to no group: the work is not guessed.
 */
export function groupOfTask(task: string | undefined, groupIds: string[]): string | undefined {
	if (!task) return undefined;
	return groupIds.find((id) => task.includes(id));
}

/**
 * The children of a delegation, as they were observed.
 */
export class DelegationObserver {
	private readonly children = new Map<string, DelegationChild>();
	private plan: { toolName: string; groupIds: string[] } | null = null;

	/**
	 * A plan was handed to the agent.
	 *
	 * @param toolName The tool that can dispatch a child.
	 * @param groupIds The ids of the measured groups.
	 */
	setPlan(toolName: string, groupIds: string[]): void {
		this.plan = { toolName, groupIds };
	}

	/**
	 * A tool call started.
	 *
	 * @returns The child that was opened, or null when the call is not a
	 *   dispatch of the current plan.
	 */
	noteStart(event: { toolCallId: string; toolName: string; args?: unknown }): DelegationChild | null {
		if (!this.plan || event.toolName !== this.plan.toolName) return null;
		const task = taskOfArgs(event.args);
		const child: DelegationChild = {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			groupId: groupOfTask(task, this.plan.groupIds),
			task,
			startedAt: Date.now(),
			status: "running",
		};
		this.children.set(event.toolCallId, child);
		return child;
	}

	/**
	 * A tool call ended.
	 *
	 * @returns The child that was closed, or null when no child of the
	 *   current plan was running under that id.
	 */
	noteEnd(event: {
		toolCallId: string;
		toolName: string;
		result?: unknown;
		isError?: boolean;
	}): DelegationChild | null {
		const child = this.children.get(event.toolCallId);
		if (!child) return null;
		child.endedAt = Date.now();
		child.status = event.isError ? "failed" : "completed";
		child.output = summarizeOutput(event.result);
		child.model = modelFromResult(event.result);
		return child;
	}

	/**
	 * The children that were observed.
	 */
	observed(): DelegationChild[] {
		return [...this.children.values()];
	}

	/**
	 * The number of children that really ran.
	 */
	get dispatchedCount(): number {
		return this.children.size;
	}
}

/**
 * The task that a dispatch received.
 */
function taskOfArgs(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["task", "prompt", "instructions", "description"]) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value.length > MAX_TASK_LENGTH ? `${value.slice(0, MAX_TASK_LENGTH)}...` : value;
		}
	}
	return undefined;
}
