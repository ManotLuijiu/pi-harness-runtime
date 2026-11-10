/**
 * The history of the todo list.
 *
 * The list says what the work is now. The history says what a change
 * touched, also when the item is back in the state it had before: a todo
 * that was reopened and finished again is work of the request that did it.
 *
 * Without the history the reader sees a list that looks untouched, and it
 * reads the work of an earlier request as the work of the request that is
 * running.
 */

import { describe, it, expect } from "bun:test";
import {
	MockTodoProvider,
	createTodoProvider,
	type TodoContext,
} from "../src/todo-provider.js";

/** A branch that holds the result of every call of the todo tool. */
function branchWith(...states: { tasks: unknown[]; nextId: number }[]) {
	return states.map((state) => ({
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todo",
			details: state,
		},
	}));
}

function makeCtx(branch: unknown[]): TodoContext {
	return {
		sessionManager: {
			getSessionId: () => "session-test",
			getBranch: () => branch as never,
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
	};
}

describe("the history of the todo list", () => {
	it("remembers the state of the list after every change", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "Implement login", status: "pending" } as never);
		provider.setStatus(1, "in_progress");
		provider.setStatus(1, "completed");

		const history = await provider.getHistory();
		expect(history).toHaveLength(3);
		expect(history[0].items[0].status).toBe("pending");
		expect(history[1].items[0].status).toBe("in_progress");
		expect(history[2].items[0].status).toBe("completed");
	});

	it("reads the history of the branch of the session", async () => {
		const provider = createTodoProvider(
			makeCtx(
				branchWith(
					{ tasks: [{ id: 1, subject: "Implement login", status: "pending" }], nextId: 2 },
					{ tasks: [{ id: 1, subject: "Implement login", status: "completed" }], nextId: 2 },
				),
			),
		);

		const history = await provider.getHistory();
		expect(history).toHaveLength(2);
		expect(history[0].items[0].status).toBe("pending");
		expect(history[1].items[0].status).toBe("completed");
	});

	it("reads the state of the todo extension as a state of the list", async () => {
		// The extension writes the state of the list into the branch. It is
		// the state the provider reports, so it belongs to the history.
		const provider = createTodoProvider(
			makeCtx([
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo",
						details: { tasks: [{ id: 1, subject: "Implement login", status: "pending" }], nextId: 2 },
					},
				},
				{
					type: "custom",
					customType: "rpiv-todo-state",
					data: { tasks: [{ id: 1, subject: "Implement login", status: "completed" }], nextId: 2 },
				},
			]),
		);

		const history = await provider.getHistory();
		expect(history).toHaveLength(2);
		expect(history[1].items[0].status).toBe("completed");
	});

	it("ignores the entries that are not the result of the todo tool", async () => {
		const provider = createTodoProvider(
			makeCtx([
				{ type: "custom", customType: "rpiv-todo-state", data: { tasks: [], nextId: 1 } },
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "other",
						details: { tasks: [{ id: 1, subject: "x", status: "pending" }], nextId: 2 },
					},
				},
			]),
		);

		// Only the state of the todo extension is a state of the list: the
		// result of another tool is not.
		const history = await provider.getHistory();
		expect(history).toHaveLength(1);
		expect(history[0].items).toEqual([]);
	});

	it("has no history when the todo extension is not available", async () => {
		const provider = createTodoProvider({
			isIdle: () => true,
			hasPendingMessages: () => false,
		} as unknown as TodoContext);
		expect(await provider.getHistory()).toEqual([]);
	});
});
