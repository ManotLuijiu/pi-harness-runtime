/**
 * Todo classification.
 *
 * The workflow must never confuse implementation work with queued review
 * work, and a queued review item must never block the implementation.
 */

import { describe, it, expect } from "bun:test";
import {
	IMPLEMENT_PREFIX,
	REVIEW_FIX_PREFIX,
	REVIEW_PREFIX,
	TEST_PREFIX,
	buildTodoSubject,
	classifyTodo,
	hasOpenImplementationWork,
	implementationTodos,
	reviewFixTodos,
	reviewTodos,
	summarizeTodos,
	testTodos,
} from "../src/classify.js";

describe("classifyTodo", () => {
	it("reads the kind from the metadata", () => {
		expect(classifyTodo({ subject: "anything", metadata: { kind: "review" } })).toBe("review");
		expect(classifyTodo({ subject: "anything", metadata: { kind: "implement" } })).toBe(
			"implement",
		);
		expect(classifyTodo({ subject: "anything", metadata: { kind: "review_fix" } })).toBe(
			"review_fix",
		);
		expect(classifyTodo({ subject: "anything", metadata: { kind: "test" } })).toBe("test");
	});

	it("reads the kind from the title prefix", () => {
		expect(classifyTodo({ subject: `${IMPLEMENT_PREFIX} Add storage` })).toBe("implement");
		expect(classifyTodo({ subject: `${REVIEW_PREFIX} Review the diff` })).toBe("review");
		expect(classifyTodo({ subject: `${REVIEW_FIX_PREFIX} Fix the race` })).toBe("review_fix");
		expect(classifyTodo({ subject: `${TEST_PREFIX} Validate the task` })).toBe("test");
	});

	it("keeps a review fix apart from a review", () => {
		expect(classifyTodo({ subject: `${REVIEW_FIX_PREFIX} x` })).not.toBe("review");
	});

	it("treats an unprefixed todo as other work", () => {
		expect(classifyTodo({ subject: "Add the preference storage" })).toBe("other");
		expect(classifyTodo({ subject: "Add the preference storage" })).not.toBe("implement");
	});

	it("survives a missing todo", () => {
		expect(classifyTodo(null)).toBe("other");
		expect(classifyTodo(undefined)).toBe("other");
	});
});

describe("implementation work", () => {
	const todos = [
		{ id: 1, subject: `${IMPLEMENT_PREFIX} Add storage`, status: "pending" },
		{ id: 2, subject: `${REVIEW_PREFIX} Review the diff (queued)`, status: "pending" },
		{ id: 3, subject: `${REVIEW_FIX_PREFIX} Fix the race`, status: "pending" },
		{ id: 4, subject: "Unprefixed work", status: "in_progress" },
		{ id: 5, subject: "Done already", status: "completed" },
		{ id: 6, subject: `${TEST_PREFIX} Validate the task`, status: "pending" },
	];

	it("counts the queued review work as no implementation work", () => {
		const open = implementationTodos(todos);
		expect(open.map((todo) => todo.id)).toEqual([1, 4]);
	});

	it("does not let the queued review block the implementation", () => {
		expect(hasOpenImplementationWork(todos)).toBe(true);
		expect(hasOpenImplementationWork([todos[1]])).toBe(false);
		expect(hasOpenImplementationWork([todos[2]])).toBe(false);
	});

	it("keeps the review and the fix items apart", () => {
		expect(reviewTodos(todos).map((todo) => todo.id)).toEqual([2]);
		expect(reviewFixTodos(todos).map((todo) => todo.id)).toEqual([3]);
	});

	it("never counts a test item as implementation work", () => {
		// The validation of the task belongs to the phase after the review.
		expect(implementationTodos(todos).map((todo) => todo.id)).toEqual([1, 4]);
		expect(hasOpenImplementationWork([todos[5]])).toBe(false);
		expect(testTodos(todos).map((todo) => todo.id)).toEqual([6]);
	});

	it("summarizes the open items", () => {
		expect(summarizeTodos(todos)).toEqual({
			implementation: 2,
			review: 1,
			reviewFix: 1,
			test: 1,
			// The totals count the finished items too: the status line
			// shows how much of the task is done.
			implementationTotal: 3,
			reviewTotal: 1,
			reviewFixTotal: 1,
			testTotal: 1,
		});
	});
});

describe("buildTodoSubject", () => {
	it("adds the prefix of the kind", () => {
		expect(buildTodoSubject("implement", "Add storage")).toBe(
			`${IMPLEMENT_PREFIX} Add storage`,
		);
		expect(buildTodoSubject("review", "Review the diff")).toBe(
			`${REVIEW_PREFIX} Review the diff`,
		);
		expect(buildTodoSubject("review_fix", "Fix the race")).toBe(
			`${REVIEW_FIX_PREFIX} Fix the race`,
		);
		expect(buildTodoSubject("test", "Validate the task")).toBe(
			`${TEST_PREFIX} Validate the task`,
		);
	});

	it("does not prefix twice", () => {
		expect(buildTodoSubject("review", `${REVIEW_PREFIX} Review`)).toBe(
			`${REVIEW_PREFIX} Review`,
		);
	});
});
