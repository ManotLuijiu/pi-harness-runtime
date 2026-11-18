import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	decideTodoReminder,
	type TodoReminderTodo,
} from "./todo-reminder.ts";

/**
 * The reminder that keeps the work of a request durable.
 *
 * The text asks; it does not instruct. It names the tool of the
 * checkpoint and the rule that a finding is only saved when the tool
 * says so.
 */
export const TASK_MEMORY_REMINDER = [
	"[harness:task-memory-reminder] Keep this request's work and findings durable.",
	"Before more exploration, use exploration_checkpoint to record findings with file locations, rejected hypotheses, open questions and the next action. Put essential evidence and continuation notes in the relevant todo descriptions too, so compaction does not force you to repeat completed exploration. Reuse saved findings; recheck files only when they changed or a specific question requires it.",
	"If either tool is unavailable, state that limitation instead of claiming that tasks or findings were saved. This reminder does not authorize new work, clear a pause or answer a pending approval.",
].join("\n");

type ReminderReason = "request-start" | "periodic" | "context-pressure" | "recovery";

/** The tool that saves the findings of an exploration. */
const CHECKPOINT_TOOL = "exploration_checkpoint";

/** The tool that holds the task list of the session. */
const TODO_TOOL = "todo";

/**
 * The actions of the task list that write the list.
 *
 * A read of the list is not a capture: it changes nothing.
 */
const CAPTURE_ACTIONS = new Set(["create", "update", "delete"]);

/**
 * The actions of the task list that record the work of the request.
 *
 * A removed task records nothing, so a removal does not silence the
 * nudge about the missing task.
 */
const RECORD_ACTIONS = new Set(["create", "update"]);

/**
 * The action of a call of the task list.
 */
function taskListAction(args: unknown): string {
	const action = (args as { action?: unknown } | undefined)?.action;
	return typeof action === "string" ? action : "";
}

/**
 * Is this call a capture of the work?
 *
 * A saved checkpoint and a written task are captures. The counters of
 * the activity reset after a capture, so an agent that is already
 * recording its work is not nagged about it.
 */
function isCapture(
	toolName: string,
	args: unknown,
): boolean {
	if (toolName === CHECKPOINT_TOOL) return true;
	if (toolName !== TODO_TOOL) return false;
	return CAPTURE_ACTIONS.has(taskListAction(args));
}

/**
 * Does this call record the work of the request in the task list?
 */
function recordsWork(
	toolName: string,
	args: unknown,
): boolean {
	if (toolName !== TODO_TOOL) return false;
	return RECORD_ACTIONS.has(taskListAction(args));
}

/** Counts work, never wall-clock time: an idle session cannot trigger a turn. */
export class TaskMemoryReminder {
	/**
	 * The clock of the reminder.
	 *
	 * The reminder counts work, not seconds. The clock only decides how
	 * far two nudges about the task list stay apart, and a test can
	 * replace it.
	 */
	private readonly clock: () => number;

	constructor(clock: () => number = Date.now) {
		this.clock = clock;
	}

	private scope: string | undefined;
	private turns = 0;
	private tools = 0;
	private pressureTier = 0;
	private recoveryPending = false;
	private stopped = false;
	/** When the last nudge about the task list went out. */
	private lastTodoNudgeAt = 0;
	/** The turns of the request since the last nudge about the task list. */
	private todoTurns = 0;
	/** The tools of the request since the last nudge about the task list. */
	private todoTools = 0;

	reset(): void {
		this.scope = undefined;
		this.turns = 0;
		this.tools = 0;
		this.pressureTier = 0;
		this.recoveryPending = false;
		this.stopped = false;
		this.lastTodoNudgeAt = 0;
		this.todoTurns = 0;
		this.todoTools = 0;
	}

	stop(): void { this.stopped = true; }
	turnEnded(): void {
		if (this.stopped) return;
		this.turns += 1;
		this.todoTurns += 1;
	}
	toolEnded(): void {
		if (this.stopped) return;
		this.tools += 1;
		this.todoTools += 1;
	}

	/**
	 * The findings of the exploration were saved.
	 *
	 * The counters of the activity start again: an agent that records
	 * its findings does not need a reminder about the work it just
	 * recorded. Only an observed capture resets them - a failed write
	 * and a mere invocation leave them alone.
	 */
	captured(): void {
		if (this.stopped) return;
		this.turns = 0;
		this.tools = 0;
	}

	/**
	 * The work of the request was written to the task list.
	 *
	 * The counters of the nudge about the task list start again, and
	 * only they: a saved finding says nothing about the task list.
	 */
	taskCaptured(): void {
		if (this.stopped) return;
		this.todoTurns = 0;
		this.todoTools = 0;
	}

	/**
	 * Is the nudge about the task list due?
	 *
	 * The nudge counts its own activity: an agent that saves findings
	 * but never writes a task keeps the nudge alive, and an agent that
	 * writes its tasks does not hear about it again.
	 */
	private todoNudgeDue(occasion: string): boolean {
		if (occasion === "request-start" || occasion === "recovery") return true;
		return this.todoTurns >= 8 || this.todoTools >= 12;
	}
	recover(): void {
		if (this.stopped) return;
		this.recoveryPending = true;
		this.pressureTier = 0;
	}

	/**
	 * The nudge that asks the agent to record its work in the task list.
	 *
	 * The nudge is occasional: it rides along with an occasion of the
	 * reminder, it only goes out when the task list does not hold the
	 * work, and a pause has passed since the last one. A session that
	 * already tracks its work is never nudged about it.
	 *
	 * @param todos The todos of the session. `undefined` means that the
	 * list cannot be read, and then no nudge goes out: an agent that
	 * cannot add a task cannot act on the nudge.
	 */
	todoNudge(
		todos: TodoReminderTodo[] | undefined,
		occasion: string,
	): string | undefined {
		if (this.stopped) return undefined;
		if (!this.todoNudgeDue(occasion)) return undefined;
		const decision = decideTodoReminder({
			todos,
			occasion,
			lastReminderAt: this.lastTodoNudgeAt || undefined,
			now: this.clock(),
		});
		if (!decision.remind || !decision.text) return undefined;
		this.lastTodoNudgeAt = this.clock();
		this.todoTurns = 0;
		this.todoTools = 0;
		return decision.text;
	}

	next(scope: string, usage?: { tokens: number | null; contextWindow: number }): ReminderReason | undefined {
		if (this.stopped) return undefined;
		const newScope = scope !== this.scope;
		if (newScope) {
			// A recovered checkpoint of the old request is not the new request's memory.
			if (this.scope !== undefined) this.recoveryPending = false;
			this.scope = scope;
			this.turns = 0;
			this.tools = 0;
			this.todoTurns = 0;
			this.todoTools = 0;
			this.pressureTier = 0;
		}
		const ratio = usage && typeof usage.tokens === "number" && Number.isFinite(usage.tokens) &&
			Number.isFinite(usage.contextWindow) && usage.contextWindow > 0
			? usage.tokens / usage.contextWindow : 0;
		const tier = ratio >= 0.9 ? 2 : ratio >= 0.75 ? 1 : 0;
		const reason = this.recoveryPending ? "recovery" : newScope ? "request-start" :
			tier > this.pressureTier ? "context-pressure" : this.turns >= 8 || this.tools >= 12 ? "periodic" : undefined;
		if (!reason) return undefined;
		this.recoveryPending = false;
		this.turns = 0;
		this.tools = 0;
		this.pressureTier = Math.max(this.pressureTier, tier);
		return reason;
	}
}

/**
 * The nudge that asks the agent to record its work in the task list.
 *
 * It rides along with an occasion of the reminder, and it only goes out
 * when the task list of the session does not hold the work of the
 * request. A session that already tracks its work is never nudged about
 * it.
 */
async function todoNudgeText(
	reminder: TaskMemoryReminder,
	todoList: ((ctx: unknown) => Promise<TodoReminderTodo[] | undefined>) | undefined,
	ctx: unknown,
	occasion: string,
): Promise<string> {
	if (!todoList) return "";
	try {
		return reminder.todoNudge(await todoList(ctx), occasion) ?? "";
	} catch {
		return "";
	}
}

/** Append only to an already scheduled model call; never send a synthetic user prompt. */
export function registerTaskMemoryReminders(pi: ExtensionAPI, options: {
	requestGeneration(): string;
	recoveryText(): string | undefined;
	/**
	 * The todos of the session.
	 *
	 * `undefined` means that the list cannot be read, and then the nudge
	 * about the task list stays away.
	 */
	todoList?(ctx: unknown): Promise<TodoReminderTodo[] | undefined>;
	/** The clock of the reminder. */
	now?(): number;
}): void {
	const reminder = new TaskMemoryReminder(options.now ?? Date.now);
	pi.on("session_start", (event) => {
		reminder.reset();
		if (event.reason === "resume" || event.reason === "reload" || event.reason === "fork") reminder.recover();
	});
	pi.on("session_shutdown", () => reminder.stop());
	pi.on("session_compact", () => reminder.recover());
	pi.on("turn_end", () => reminder.turnEnded());
	// The arguments of a call arrive with its start, and its result with
	// its end. A capture is only a capture when the write succeeded.
	const calls = new Map<string, { toolName: string; args: unknown }>();
	pi.on("tool_execution_start", (event) => {
		const toolEvent = event as { toolCallId?: string; toolName?: string; args?: unknown };
		calls.set(String(toolEvent.toolCallId ?? ""), {
			toolName: String(toolEvent.toolName ?? ""),
			args: toolEvent.args,
		});
	});
	pi.on("tool_execution_end", (event) => {
		const toolEvent = event as { toolCallId?: string; toolName?: string; isError?: boolean };
		if (toolEvent.isError) return;
		reminder.toolEnded();
		const call = calls.get(String(toolEvent.toolCallId ?? ""));
		const toolName = String(toolEvent.toolName ?? call?.toolName ?? "");
		if (isCapture(toolName, call?.args)) {
			reminder.captured();
			if (recordsWork(toolName, call?.args)) reminder.taskCaptured();
		}
		calls.delete(String(toolEvent.toolCallId ?? ""));
	});
	pi.on("context", async (event, ctx) => {
		if (ctx.signal?.aborted) return undefined;
		const scope = `${ctx.sessionManager.getSessionId()}:${options.requestGeneration()}`;
		const reason = reminder.next(scope, ctx.getContextUsage());
		if (!reason) return undefined;
		let recovery = "";
		if (reason === "recovery") {
			try { recovery = options.recoveryText()?.slice(0, 3000) ?? ""; }
			catch { recovery = "The saved exploration checkpoint is unavailable; do not assume it was restored."; }
		}
		// The nudge about the task list rides along with the reminder. It
		// is the part that asks for the work of the request as tasks, and
		// it only goes out when the task list does not hold that work.
		const nudge = await todoNudgeText(reminder, options.todoList, ctx, reason);
		const parts = [TASK_MEMORY_REMINDER];
		if (nudge) parts.push(nudge);
		if (recovery) parts.push(recovery);
		return {
			messages: [...event.messages, {
				role: "custom" as const,
				customType: "harness:task-memory-reminder",
				display: false,
				content: `${parts.join("\n\n")}\nReason: ${reason}.`,
				timestamp: Date.now(),
			}],
		};
	});
}
