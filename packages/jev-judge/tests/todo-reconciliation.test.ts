/**
 * The reconciliation of the todos before the continuation.
 *
 * A request owns a list of todos. The agent finishes the work of an item and
 * the item keeps the status `in_progress`, because closing a todo needs the
 * todo tool of the agent. The controller then steers the same item again and
 * the work loops forever.
 *
 * The reconciliation checkpoint breaks that loop: the agent is asked to
 * compare every open item with the work and the validation that already
 * happened, and it closes the verified items itself. The controller never
 * closes a todo by itself.
 *
 * The tests drive the controller with a fake provider and a fake dispatch:
 * no network, no provider, no todo tool call.
 */

import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TodoContinuationController } from "../src/continuation-controller.js";
import { MockTodoProvider, createTodoProvider, type TodoContext, type TodoItem } from "../src/todo-provider.js";
import {
	TODO_RECONCILIATION_REMINDER,
	buildTodoReconciliationBlock,
	todoReconciliationItems,
} from "../src/todo-reconciliation.js";
import { ValidationLedger } from "../src/validation-ledger.js";

function makeCtx(overrides: Partial<TodoContext> = {}): TodoContext {
	return {
		sessionManager: {
			getSessionId: () => "session-test",
			getBranch: () => [],
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		...overrides,
	};
}

function makeController(opts: {
	provider: MockTodoProvider;
	sent: string[];
	ledger?: ValidationLedger;
}) {
	return new TodoContinuationController(makeCtx(), {
		dispatch: async (content) => {
			opts.sent.push(content);
		},
		todoProvider: opts.provider,
		validationLedger: opts.ledger,
		maxSteerAttempts: 9,
	});
}

/** A branch entry that holds the state of the todo extension. */
function customEntry(tasks: unknown[], timestamp?: unknown) {
	return {
		type: "custom",
		customType: "rpiv-todo-state",
		...(timestamp === undefined ? {} : { timestamp }),
		data: { tasks, nextId: 2 },
	};
}

/** A branch entry that holds the result of a call of the todo tool. */
function toolEntry(tasks: unknown[], timestamp?: unknown) {
	return {
		type: "message",
		...(timestamp === undefined ? {} : { timestamp }),
		message: {
			role: "toolResult",
			toolName: "todo",
			...(timestamp === undefined ? {} : { timestamp }),
			details: { tasks, nextId: 2 },
		},
	};
}

describe("the reminder of the reconciliation", () => {
	it("is the fixed text of the checkpoint", () => {
		expect(TODO_RECONCILIATION_REMINDER).toBe(
			"Before continuing or reporting completion, reconcile this request's open todos with the work already performed. " +
				"Update completed items using the todo tool. Preserve unfinished checks and blockers. " +
				"Do not repeat completed work or start unrelated backlog items.",
		);
	});

	it("is empty when nothing is open", () => {
		expect(buildTodoReconciliationBlock([])).toBe("");
	});

	it("lists the open items and leaves the finished ones out", () => {
		const tasks: TodoItem[] = [
			{ id: 1, subject: "Implement the reconciliation", status: "in_progress" },
			{ id: 2, subject: "Write the report", status: "pending" },
			{ id: 3, subject: "Old work", status: "completed" },
		];
		const open = todoReconciliationItems(tasks);
		expect(open.map((item) => item.id)).toEqual([1, 2]);

		const block = buildTodoReconciliationBlock(open);
		expect(block).toContain(TODO_RECONCILIATION_REMINDER);
		expect(block).toContain("Implement the reconciliation");
		expect(block).toContain("Write the report");
		expect(block).not.toContain("Old work");
	});

	it("never carries a credential or a path", () => {
		const block = buildTodoReconciliationBlock([
			{
				id: 1,
				subject: "deploy with api_key=sk-secret-value from /home/user/private",
				status: "in_progress",
			},
		]);
		expect(block).not.toContain("sk-secret-value");
		expect(block).not.toContain("/home/user/private");
	});

	it("is empty when every item of the list is closed", () => {
		const tasks: TodoItem[] = [
			{ id: 1, subject: "Implement the reconciliation", status: "completed" },
			{ id: 2, subject: "Write the report", status: "deleted" },
		];
		expect(todoReconciliationItems(tasks)).toEqual([]);
		expect(buildTodoReconciliationBlock(todoReconciliationItems(tasks))).toBe("");
	});
});

describe("the continuation carries the reconciliation", () => {
	it("sends the reminder and the open items with the continuation", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain(TODO_RECONCILIATION_REMINDER);
		expect(sent[0]).toContain("Implement the reconciliation");
		expect(sent[0]).toContain("Continue task: Implement the reconciliation");
	});

	it("does not repeat the reminder for the same generation", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);
		controller.releaseContinuationGuard("settled");
		await controller.continueItem(item);

		expect(sent).toHaveLength(2);
		expect(sent[0]).toContain(TODO_RECONCILIATION_REMINDER);
		expect(sent[1]).not.toContain(TODO_RECONCILIATION_REMINDER);
	});

	it("asks again after a generation change", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);

		// The agent closed the item: the request moves on to the next one.
		provider.setStatus(item.id, "completed");
		await controller.markComplete(item.id);
		provider.addItem({ subject: "Write the report", status: "pending" } as never);
		const next = (await provider.getSnapshot()).items[1];

		controller.releaseContinuationGuard("settled");
		await controller.continueItem(next);

		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain(TODO_RECONCILIATION_REMINDER);
		expect(sent[1]).toContain("Write the report");
	});

	it("lists the open items and leaves the finished ones out", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		provider.addItem({ subject: "Write the report", status: "completed" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("Implement the reconciliation");
		expect(sent[0]).not.toContain("Write the report");
	});
});

describe("the controller never closes a todo by itself", () => {
	it("keeps the internal state while the item is still open", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		const decision = await controller.decide();
		expect(decision.action).toBe("continue");
		expect(controller.getState().current).toEqual({ id: 1 });

		await controller.markComplete(1);

		// The work is not finished: the state stays and the item stays open.
		expect(controller.getState().current).toEqual({ id: 1 });
		const items = (await provider.getSnapshot()).items;
		expect(items[0].status).toBe("in_progress");
		expect(await provider.getCompleted()).toHaveLength(0);
	});

	it("asks for a reconciliation when the item is still open", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);
		expect(sent[0]).toContain(TODO_RECONCILIATION_REMINDER);

		// The item was reported complete but it is still open.
		await controller.markComplete(item.id);

		controller.releaseContinuationGuard("settled");
		await controller.continueItem(item);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain(TODO_RECONCILIATION_REMINDER);
	});

	it("clears the internal state after the agent closed the item", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		await controller.decide();
		expect(controller.getState().current).toEqual({ id: 1 });

		// The agent closed the item with the real todo tool.
		provider.setStatus(1, "completed");
		await controller.markComplete(1);

		expect(controller.getState().current).toBeNull();
		expect(await provider.getCompleted()).toHaveLength(1);
	});
});

describe("the validation evidence of an open item", () => {
	it("names the missing validation instead of hiding it", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement the reconciliation", status: "in_progress" } as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent });

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);

		expect(sent[0]).toContain("validation: no evidence");
	});

	it("carries the state of the tiers that ran", async () => {
		const ledger = new ValidationLedger({ path: join(tmpdir(), `todo-reconciliation-${Date.now()}.jsonl`) });
		const provider = new MockTodoProvider();
		provider.addItem({
			subject: "Run the tiers",
			status: "in_progress",
			metadata: {
				validationPlan: {
					fast: { command: "bun test tests/fast" },
					full: { command: "bun test tests/full" },
					finalTierRequired: true,
				},
			},
		} as never);
		const sent: string[] = [];
		const controller = makeController({ provider, sent, ledger });

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);

		// The validation never ran: the item stays open and the block says so.
		expect(sent[0]).toContain("fast=not-run");
		expect(sent[0]).toContain("full=not-run");
		expect(sent[0]).toContain("final tier pending");
	});
});

describe("the reader of the state of the list", () => {
	it("returns the newer tool result when the custom entry is older", async () => {
		const provider = createTodoProvider(
			makeCtx({
				sessionManager: {
					getSessionId: () => "session-test",
					getBranch: () =>
						[
							customEntry([{ id: 1, subject: "Implement login", status: "pending" }]),
							toolEntry([{ id: 1, subject: "Implement login", status: "completed" }]),
						] as never,
				},
			}),
		);

		const snapshot = await provider.getSnapshot();
		expect(snapshot.items).toHaveLength(1);
		expect(snapshot.items[0].status).toBe("completed");
	});

	it("returns the newer custom entry when it is newer", async () => {
		const provider = createTodoProvider(
			makeCtx({
				sessionManager: {
					getSessionId: () => "session-test",
					getBranch: () =>
						[
							toolEntry([{ id: 1, subject: "Implement login", status: "pending" }]),
							customEntry([{ id: 1, subject: "Implement login", status: "completed" }]),
						] as never,
				},
			}),
		);

		const snapshot = await provider.getSnapshot();
		expect(snapshot.items).toHaveLength(1);
		expect(snapshot.items[0].status).toBe("completed");
	});

	it("uses the timestamp of the entries as the order", async () => {
		// The custom entry is the later one in the branch but carries the
		// older timestamp: the timestamp is the order.
		const provider = createTodoProvider(
			makeCtx({
				sessionManager: {
					getSessionId: () => "session-test",
					getBranch: () =>
						[
							customEntry([{ id: 1, subject: "Implement login", status: "pending" }], 200),
							toolEntry([{ id: 1, subject: "Implement login", status: "completed" }], 100),
						] as never,
				},
			}),
		);

		const snapshot = await provider.getSnapshot();
		expect(snapshot.items[0].status).toBe("pending");
	});
});
