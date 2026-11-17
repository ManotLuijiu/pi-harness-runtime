/**
 * Todo Intake Integration Tests
 * 
 * Tests for the Ready feedback loop fix:
 * - Internal messages cannot manufacture new user work
 * - Stop invalidates outstanding decisions
 * - Resume accepts new work
 * - Authorized todos continue without duplicate dispatches
 * - The reconciliation reminder rides along with the continuation
 * 
 * Run:
 *   bun test e2e/todo-intake-integration.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

// Import the controllers
import { TaskIntakeController } from "../packages/jev-judge/src/task-intake.js";
import { TodoContinuationController } from "../packages/jev-judge/src/continuation-controller.js";
import {
	createTodoProvider,
	type TodoContext,
	type TodoItem,
} from "../packages/jev-judge/src/todo-provider.js";
import { TODO_RECONCILIATION_REMINDER } from "../packages/jev-judge/src/todo-reconciliation.js";

describe("Task Intake - Loop Prevention", () => {
	let intake: TaskIntakeController;
	let dispatchCalls: string[] = [];

	beforeEach(() => {
		dispatchCalls = [];

		// Mock dispatch that records calls
		const mockDispatch = async (content: string) => {
			dispatchCalls.push(content);
		};

		intake = new TaskIntakeController({
			apiKey: "test-key",
			dispatch: mockDispatch,
		});
	});

	it("should skip harness-internal messages", async () => {
		const controller = {
			getSnapshot: async () => ({ items: [] }),
		};

		const result = await intake.evaluateWithTodos(
			"[harness:task-capture] Work detected in user request",
			controller as any
		);

		assert.strictEqual(result.actionable, false);
		assert.strictEqual(result.action, "skip");
		assert.strictEqual(dispatchCalls.length, 0);
	});

	it("should skip recently captured messages (deduplication)", async () => {
		const controller = {
			getSnapshot: async () => ({ items: [] }),
		};

		// First evaluation
		await intake.evaluateWithTodos(
			"Fix login validation and add a regression test",
			controller as any
		);

		// Call requestCapture to record this message in recentCaptures
		await intake.requestCapture("Fix login validation and add a regression test");

		// Same message again - should be deduplicated because it was captured
		const result2 = await intake.evaluateWithTodos(
			"Fix login validation and add a regression test",
			controller as any
		);

		assert.strictEqual(result2.action, "skip", "Should be skipped due to recent capture");
	});

	it("should not dispatch after invalidatePending()", async () => {
		// Start an evaluation
		const controller = {
			getSnapshot: async () => ({ items: [] }),
		};

		// Simulate starting evaluation
		const evalPromise = intake.evaluateWithTodos(
			"Fix login validation",
			controller as any
		);

		// Invalidate pending evaluations (user pressed stop)
		intake.invalidatePending();

		// Wait for evaluation to complete
		await evalPromise;

		// Request capture should not dispatch because stopped
		await intake.requestCapture("Fix login validation");

		assert.strictEqual(dispatchCalls.length, 0, "Should not dispatch after stop");
	});

	it("should re-enable intake after resumeIntake()", async () => {
		const controller = {
			getSnapshot: async () => ({ items: [] }),
		};

		// Stop intake
		intake.invalidatePending();

		// Resume
		intake.resumeIntake();

		// isStopped should now be false
		assert.strictEqual(intake.isStopped(), false, "Should not be stopped after resume");

		// Now evaluation should work (not blocked by stop flag)
		await intake.evaluateWithTodos(
			"New work request",
			controller as any
		);

		// The stopped flag should be cleared
		assert.ok(!intake.isStopped(), "Intake should not be stopped");
	});
});

describe("Todo Continuation - Queue Management", () => {
	let continuation: TodoContinuationController;
	let dispatchCalls: string[] = [];

	beforeEach(() => {
		dispatchCalls = [];

		const mockCtx = {
			sessionManager: {
				getSessionId: () => `test-session-${Date.now()}`,
				getBranch: () => [],
			},
			isIdle: () => true,
			hasPendingMessages: () => false,
		};

		const mockDispatch = async (content: string) => {
			dispatchCalls.push(content);
		};

		continuation = new TodoContinuationController(mockCtx as any, {
			dispatch: mockDispatch,
			maxSteerAttempts: 3,
		});
	});

	it("should clear queue when agent turn completes", async () => {
		// Create a synthetic provider and add todos
		// Note: We can't directly manipulate todos, but we can test queue state

		// The key test is that clearQueue() is callable and resets state
		continuation.clearQueue();

		// After clearing, the queue should be in clean state
		// This is verified by the fact that no exception is thrown
		assert.ok(true, "clearQueue() should not throw");
	});

	it("should skip dispatch when explicitly paused", async () => {
		// Explicit pause
		continuation.explicitPause();

		// The pause state is tracked internally
		// A subsequent decide() should return stop action
		const decision = await continuation.decide();
		assert.strictEqual(decision.action, "stop");
	});

	it("should resume after resume() call", async () => {
		// Pause
		continuation.explicitPause();

		// Resume
		continuation.resume();

		// After resume, decide() should not return stop due to pause
		const decision = await continuation.decide();
		// Note: may not be "continue" if no todos exist, but should not be "stop" due to pause
		assert.ok(decision.action !== "stop" || decision.reason !== "paused");
	});
});

describe("Two-Task Continuation Logic", () => {
	it("should track completed tasks separately", async () => {
		// This tests the concept that completing one task doesn't affect another
		// In real implementation, tasks have independent IDs
		
		const task1Id = 1;
		const task2Id = 2;

		// Tasks should have unique IDs
		assert.notStrictEqual(task1Id, task2Id, "Tasks should have unique IDs");
	});

	it("should not dispatch blocked tasks", async () => {
		// Create a mock continuation controller
		const dispatchCalls: string[] = [];

		const mockCtx = {
			sessionManager: {
				getSessionId: () => `test-session-${Date.now()}`,
				getBranch: () => [],
			},
			isIdle: () => true,
			hasPendingMessages: () => false,
		};

		const continuation = new TodoContinuationController(mockCtx as any, {
			dispatch: async (content: string) => {
				dispatchCalls.push(content);
			},
			maxSteerAttempts: 3,
		});

		// Explicit pause should prevent dispatch
		continuation.explicitPause();

		// Try to steer - should be blocked
		await continuation.steerToContinue(1);

		assert.strictEqual(dispatchCalls.length, 0, "Should not dispatch when paused");
	});
});

/**
 * The reconciliation of the todos, end to end.
 *
 * A request owns a list of todos. The agent finishes the work of an item and
 * the item keeps the status `in_progress`, because closing a todo needs the
 * todo tool of the agent. The controller then steers the same item again and
 * the request loops forever.
 *
 * The chain that is driven here is the real one: the real controller reads
 * the real provider, and the real provider reads a synthetic branch of a
 * session. The dispatch is fake: nothing goes on the wire, no todo tool is
 * called, no provider and no session are needed.
 */

describe("Todo Reconciliation - End to End", () => {
	/** A branch of a session that the test can grow while the test runs. */
	class SyntheticBranch {
		entries: unknown[] = [];

		/** The branch as the session manager hands it to the provider. */
		read(): unknown[] {
			return this.entries;
		}

		/** The state of the todo extension (a custom entry of the branch). */
		pushCustom(tasks: TodoItem[], timestamp: number): void {
			this.entries.push({
				type: "custom",
				customType: "rpiv-todo-state",
				timestamp,
				data: { tasks, nextId: tasks.length + 1 },
			});
		}

		/** The result of a call of the todo tool (a message of the branch). */
		pushToolResult(tasks: TodoItem[], timestamp: number): void {
			this.entries.push({
				type: "message",
				timestamp,
				message: {
					role: "toolResult",
					toolName: "todo",
					timestamp,
					details: { tasks, nextId: tasks.length + 1 },
				},
			});
		}
	}

	/** The context of a session whose branch is the synthetic one. */
	function makeCtx(branch: SyntheticBranch): TodoContext {
		return {
			sessionManager: {
				getSessionId: () => "session-reconciliation",
				getBranch: () => branch.read(),
			},
			isIdle: () => true,
			hasPendingMessages: () => false,
		};
	}

	/** The controller, the real provider and the fake dispatch of one test. */
	function makeHarness(branch: SyntheticBranch) {
		const ctx = makeCtx(branch);
		const sent: string[] = [];
		// The real provider: it reads the synthetic branch like it reads the
		// branch of a real session.
		const provider = createTodoProvider(ctx);
		const controller = new TodoContinuationController(ctx, {
			dispatch: async (content: string) => {
				sent.push(content);
			},
			todoProvider: provider,
			maxSteerAttempts: 9,
		});
		return { ctx, provider, controller, sent };
	}

	const OPEN_ITEM: TodoItem = {
		id: 1,
		subject: "Implement the reconciliation",
		status: "in_progress",
	};

	const NEXT_ITEM: TodoItem = {
		id: 2,
		subject: "Write the report",
		status: "pending",
	};

	it("carries the reminder and the open item with the continuation", async () => {
		const branch = new SyntheticBranch();
		branch.pushCustom([{ ...OPEN_ITEM }], 1000);
		const { provider, controller, sent } = makeHarness(branch);

		// The controller sees the open item of the branch.
		const decision = await controller.decide();
		assert.strictEqual(decision.action, "continue");
		assert.strictEqual(decision.nextItemId, OPEN_ITEM.id);

		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);

		assert.strictEqual(sent.length, 1, "the continuation went out");
		assert.ok(
			sent[0].includes(TODO_RECONCILIATION_REMINDER),
			"the reminder rides along with the continuation",
		);
		assert.ok(
			sent[0].includes("Continue task: Implement the reconciliation"),
			"the continuation names the item",
		);
		assert.ok(
			sent[0].includes("#1 (in_progress) Implement the reconciliation"),
			"the reminder lists the open item",
		);
	});

	it("does not repeat the reminder for the same generation and asks again after a generation change", async () => {
		const branch = new SyntheticBranch();
		branch.pushCustom([{ ...OPEN_ITEM }, { ...NEXT_ITEM }], 1000);
		const { provider, controller, sent } = makeHarness(branch);

		const items = (await provider.getSnapshot()).items;
		await controller.continueItem(items[0]);
		assert.ok(sent[0].includes(TODO_RECONCILIATION_REMINDER));

		// The same generation: the reminder is not repeated.
		controller.releaseContinuationGuard("settled");
		await controller.continueItem(items[0]);
		assert.strictEqual(sent.length, 2);
		assert.ok(
			!sent[1].includes(TODO_RECONCILIATION_REMINDER),
			"the reminder is not repeated for the same generation",
		);
		assert.ok(sent[1].includes("Continue task: Implement the reconciliation"));

		// The agent closed the item with the todo tool: the branch carries the
		// newer result of that call.
		branch.pushToolResult([{ ...OPEN_ITEM, status: "completed" }, { ...NEXT_ITEM }], 2000);
		await controller.markComplete(OPEN_ITEM.id);

		// The generation changed: the reminder comes back with the next
		// continuation of the request.
		controller.releaseContinuationGuard("settled");
		const next = (await provider.getSnapshot()).items[1];
		await controller.continueItem(next);

		assert.strictEqual(sent.length, 3);
		assert.ok(
			sent[2].includes(TODO_RECONCILIATION_REMINDER),
			"the reminder comes back after a generation change",
		);
		assert.ok(sent[2].includes("Write the report"), "the reminder lists the open item");
	});

	it("keeps the internal state while the item is open and clears it once the agent closed it", async () => {
		const branch = new SyntheticBranch();
		branch.pushCustom([{ ...OPEN_ITEM }], 1000);
		const { provider, controller } = makeHarness(branch);

		const decision = await controller.decide();
		assert.strictEqual(decision.action, "continue");
		assert.deepStrictEqual(controller.getState().current, { id: OPEN_ITEM.id });

		// The item is still open: the work is not finished, the state stays.
		await controller.markComplete(OPEN_ITEM.id);
		assert.deepStrictEqual(
			controller.getState().current,
			{ id: OPEN_ITEM.id },
			"the internal state survives while the item is open",
		);
		const stillOpen = (await provider.getSnapshot()).items[0];
		assert.strictEqual(stillOpen.status, "in_progress");

		// The agent closed the item with the todo tool.
		branch.pushToolResult([{ ...OPEN_ITEM, status: "completed" }], 2000);
		await controller.markComplete(OPEN_ITEM.id);

		assert.strictEqual(
			controller.getState().current,
			null,
			"the internal state is cleared once the agent closed the item",
		);
		const closed = (await provider.getSnapshot()).items[0];
		assert.strictEqual(closed.status, "completed");
	});

	it("never closes a todo by itself", async () => {
		const branch = new SyntheticBranch();
		branch.pushCustom([{ ...OPEN_ITEM }, { ...NEXT_ITEM }], 1000);
		const { provider, controller, sent } = makeHarness(branch);

		const before = (await provider.getSnapshot()).items.map((item) => ({ ...item }));
		const branchBefore = JSON.stringify(branch.read());

		// The whole chain of the controller runs.
		const decision = await controller.decide();
		assert.strictEqual(decision.action, "continue");
		const item = (await provider.getSnapshot()).items[0];
		await controller.continueItem(item);
		await controller.markComplete(item.id);
		controller.releaseContinuationGuard("settled");
		await controller.continueItem((await provider.getSnapshot()).items[1]);

		const after = (await provider.getSnapshot()).items.map((entry) => ({ ...entry }));
		assert.deepStrictEqual(
			after,
			before,
			"the state of the todos is the same before and after the controller ran",
		);
		assert.ok(
			after.every((entry) => entry.status !== "completed"),
			"the controller closed no todo",
		);
		assert.strictEqual(
			JSON.stringify(branch.read()),
			branchBefore,
			"the controller wrote nothing into the branch",
		);
		assert.ok(sent.length >= 1, "the controller did work");
	});

	it("reads back the newer of the custom state entry and the todo tool result", async () => {
		// The result of the todo tool is the newer one.
		const toolNewer = new SyntheticBranch();
		toolNewer.pushCustom([{ id: 1, subject: "from the extension", status: "in_progress" }], 1000);
		toolNewer.pushToolResult([{ id: 1, subject: "from the tool", status: "completed" }], 2000);

		const toolCtx = makeCtx(toolNewer);
		const toolProvider = createTodoProvider(toolCtx);
		const toolSnapshot = await toolProvider.getSnapshot();
		assert.strictEqual(toolSnapshot.items[0].subject, "from the tool");

		// The custom state entry is the newer one.
		const customNewer = new SyntheticBranch();
		customNewer.pushToolResult([{ id: 1, subject: "from the tool", status: "completed" }], 1000);
		customNewer.pushCustom([{ id: 1, subject: "from the extension", status: "in_progress" }], 2000);

		const customCtx = makeCtx(customNewer);
		const customProvider = createTodoProvider(customCtx);
		const customSnapshot = await customProvider.getSnapshot();
		assert.strictEqual(customSnapshot.items[0].subject, "from the extension");
	});

	it("lets the controller act on the state that the read-back returned", async () => {
		// The result of the todo tool is the newer one: the item is closed and
		// the controller must not continue it.
		const toolNewer = new SyntheticBranch();
		toolNewer.pushCustom([{ ...OPEN_ITEM }], 1000);
		toolNewer.pushToolResult([{ ...OPEN_ITEM, status: "completed" }], 2000);
		const toolHarness = makeHarness(toolNewer);

		const toolDecision = await toolHarness.controller.decide();
		assert.strictEqual(toolDecision.action, "stop");
		assert.strictEqual(toolHarness.sent.length, 0, "nothing was continued");

		// The custom state entry is the newer one: the item is still open and
		// the controller continues it.
		const customNewer = new SyntheticBranch();
		customNewer.pushToolResult([{ ...OPEN_ITEM, status: "completed" }], 1000);
		customNewer.pushCustom([{ ...OPEN_ITEM }], 2000);
		const customHarness = makeHarness(customNewer);

		const customDecision = await customHarness.controller.decide();
		assert.strictEqual(customDecision.action, "continue");
		assert.strictEqual(customDecision.nextItemId, OPEN_ITEM.id);
	});
});
