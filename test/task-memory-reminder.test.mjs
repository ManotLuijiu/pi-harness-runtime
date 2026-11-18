import { test } from "node:test";
import assert from "node:assert/strict";
import { TODO_REMINDER_COOLDOWN_MS } from "../harness/todo-reminder.ts";
import { TASK_MEMORY_REMINDER, TaskMemoryReminder, registerTaskMemoryReminders } from "../harness/task-memory-reminder.ts";

test("a new request is reminded before exploration, and repeated context calls stay quiet", () => {
	const reminder = new TaskMemoryReminder();
	assert.equal(reminder.next("s:1"), "request-start");
	for (let i = 0; i < 30; i++) assert.equal(reminder.next("s:1"), undefined);
	assert.equal(reminder.next("s:2"), "request-start");
	assert.match(TASK_MEMORY_REMINDER, /exploration_checkpoint/);
});

test("eight completed turns trigger one periodic reminder", () => {
	const reminder = new TaskMemoryReminder();
	reminder.next("s:1");
	for (let i = 0; i < 7; i++) { reminder.turnEnded(); assert.equal(reminder.next("s:1"), undefined); }
	reminder.turnEnded();
	assert.equal(reminder.next("s:1"), "periodic");
	assert.equal(reminder.next("s:1"), undefined);
});

test("tool-heavy exploration triggers a checkpoint reminder without waiting eight turns", () => {
	const reminder = new TaskMemoryReminder();
	reminder.next("s:1");
	for (let i = 0; i < 11; i++) reminder.toolEnded();
	assert.equal(reminder.next("s:1"), undefined);
	reminder.toolEnded();
	assert.equal(reminder.next("s:1"), "periodic");
	assert.equal(reminder.next("s:1"), undefined);
});

test("context pressure triggers at 75 and 90 percent, once per tier", () => {
	const reminder = new TaskMemoryReminder();
	reminder.next("s:1", { tokens: 1000, contextWindow: 10000 });
	assert.equal(reminder.next("s:1", { tokens: 7499, contextWindow: 10000 }), undefined);
	assert.equal(reminder.next("s:1", { tokens: 7500, contextWindow: 10000 }), "context-pressure");
	assert.equal(reminder.next("s:1", { tokens: 8999, contextWindow: 10000 }), undefined);
	assert.equal(reminder.next("s:1", { tokens: 9000, contextWindow: 10000 }), "context-pressure");
	for (const tokens of [4000, 7600, 9500]) assert.equal(reminder.next("s:1", { tokens, contextWindow: 10000 }), undefined);
});

test("unknown or invalid context usage is not treated as full", () => {
	const reminder = new TaskMemoryReminder();
	reminder.next("s:1");
	for (const usage of [undefined, { tokens: null, contextWindow: 100 }, { tokens: NaN, contextWindow: 100 }, { tokens: 10, contextWindow: 0 }]) {
		assert.equal(reminder.next("s:1", usage), undefined);
	}
});

test("compaction restores once and resets the pressure threshold", () => {
	const reminder = new TaskMemoryReminder();
	reminder.next("s:1", { tokens: 90, contextWindow: 100 });
	reminder.recover();
	assert.equal(reminder.next("s:1"), "recovery");
	assert.equal(reminder.next("s:1"), undefined);
	assert.equal(reminder.next("s:1", { tokens: 75, contextWindow: 100 }), "context-pressure");
});

test("new requests do not inherit old recovery or activity", () => {
	const reminder = new TaskMemoryReminder();
	reminder.next("s:1");
	reminder.recover();
	for (let i = 0; i < 12; i++) reminder.toolEnded();
	assert.equal(reminder.next("s:2"), "request-start");
	assert.equal(reminder.next("s:2"), undefined);
});

function runtime(options = {}) {
	const handlers = new Map();
	let generation = "1";
	let checkpoint = "Saved finding: handler at src/example.ts; next: verify its caller.";
	let todos = options.todos;
	let now = options.now ?? 1_000_000;
	const pi = { on(event, handler) { handlers.set(event, handler); } };
	registerTaskMemoryReminders(pi, {
		requestGeneration: () => generation,
		recoveryText: () => checkpoint,
		todoList: options.todoList === null ? undefined : async () => todos,
		now: () => now,
	});
	const ctx = { signal: undefined, sessionManager: { getSessionId: () => "session" }, getContextUsage: () => ({ tokens: null, contextWindow: 10000 }) };
	const messages = [{ role: "user", content: "Investigate and fix the issue.", timestamp: 1 }];
	return {
		handlers, ctx, messages,
		generation(value) { generation = value; },
		checkpoint(value) { checkpoint = value; },
		todos(value) { todos = value; },
		advance(ms) { now += ms; },
		context() { return handlers.get("context")({ messages }, ctx); },
	};
}

test("the runtime appends to the next model call without mutating history or dispatching", async () => {
	const rt = runtime();
	const result = await rt.context();
	assert.equal(result.messages.length, 2);
	assert.equal(rt.messages.length, 1);
	assert.equal(result.messages[0], rt.messages[0]);
	assert.equal(result.messages[1].role, "custom");
	assert.equal(result.messages[1].display, false);
	assert.match(result.messages[1].content, /request-start/);
	assert.equal(await rt.context(), undefined);
	// Fake API deliberately has no sendUserMessage or sendMessage method.
});

test("successful tools count, failed tools do not, and cancelled calls consume no reminder", async () => {
	const rt = runtime();
	await rt.context();
	for (let i = 0; i < 12; i++) rt.handlers.get("tool_execution_end")({ isError: true });
	assert.equal(await rt.context(), undefined);
	for (let i = 0; i < 12; i++) rt.handlers.get("tool_execution_end")({ isError: false });
	rt.ctx.signal = { aborted: true };
	assert.equal(await rt.context(), undefined);
	rt.ctx.signal = undefined;
	assert.match((await rt.context()).messages[1].content, /periodic/);
});

test("compaction recovery reaches the next call even without a synthetic resume", async () => {
	const rt = runtime();
	await rt.context();
	rt.handlers.get("session_compact")({});
	assert.match((await rt.context()).messages[1].content, /Saved finding: handler at src\/example.ts/);
	assert.equal(await rt.context(), undefined);
});

test("session shutdown disables reminders and session resume restores bounded findings", async () => {
	const rt = runtime();
	await rt.context();
	rt.handlers.get("session_shutdown")();
	assert.equal(await rt.context(), undefined);
	rt.checkpoint("x".repeat(5000));
	rt.handlers.get("session_start")({ reason: "resume" });
	const text = (await rt.context()).messages[1].content;
	assert.match(text, /recovery/);
	assert.ok(text.length < TASK_MEMORY_REMINDER.length + 3100);
});

test("an unreadable checkpoint is reported without suppressing the reminder", async () => {
	const handlers = new Map();
	registerTaskMemoryReminders({ on(event, handler) { handlers.set(event, handler); } }, {
		requestGeneration: () => "1", recoveryText: () => { throw new Error("unreadable"); },
	});
	handlers.get("session_start")({ reason: "resume" });
	const result = await handlers.get("context")({ messages: [] }, { sessionManager: { getSessionId: () => "s" }, getContextUsage: () => undefined });
	assert.match(result.messages[0].content, /checkpoint is unavailable/);
	assert.match(result.messages[0].content, /exploration_checkpoint/);
});

test("the nudge about the task list asks for the work when the list does not hold it", async () => {
	const rt = runtime({ todos: [] });
	const text = (await rt.context()).messages[1].content;
	assert.match(text, /local Todos list/);
	assert.match(text, /context window/);
});

test("a session that already tracks its work is never nudged about the task list", async () => {
	const rt = runtime({ todos: [{ subject: "the work of the request", status: "in_progress" }] });
	const text = (await rt.context()).messages[1].content;
	assert.doesNotMatch(text, /local Todos list/);
	assert.match(text, /exploration_checkpoint/);
});

test("a session whose task list cannot be read is never nudged about the task list", async () => {
	const rt = runtime({ todoList: null });
	const text = (await rt.context()).messages[1].content;
	assert.doesNotMatch(text, /local Todos list/);
});

test("a successful capture of the work resets the counters of the activity", async () => {
	const rt = runtime({ todos: [] });
	await rt.context();
	for (let i = 0; i < 7; i++) rt.handlers.get("turn_end")();
	rt.handlers.get("tool_execution_start")({ toolCallId: "1", toolName: "todo", args: { action: "create" } });
	rt.handlers.get("tool_execution_end")({ toolCallId: "1", toolName: "todo", isError: false });
	// The capture reset the counters, so the eighth turn does not
	// trigger the periodic reminder.
	assert.equal(await rt.context(), undefined);
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	assert.match((await rt.context()).messages[1].content, /periodic/);
});

test("a failed write and a read of the list are not a capture", async () => {
	const rt = runtime({ todos: [] });
	await rt.context();
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	rt.handlers.get("tool_execution_start")({ toolCallId: "1", toolName: "todo", args: { action: "create" } });
	rt.handlers.get("tool_execution_end")({ toolCallId: "1", toolName: "todo", isError: true });
	rt.handlers.get("tool_execution_start")({ toolCallId: "2", toolName: "todo", args: { action: "list" } });
	rt.handlers.get("tool_execution_end")({ toolCallId: "2", toolName: "todo", isError: false });
	assert.match((await rt.context()).messages[1].content, /periodic/);
});

test("a saved checkpoint resets the counters but does not silence the nudge about the task list", async () => {
	const rt = runtime({ todos: [] });
	await rt.context();
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	rt.handlers.get("tool_execution_start")({ toolCallId: "1", toolName: "exploration_checkpoint", args: {} });
	rt.handlers.get("tool_execution_end")({ toolCallId: "1", toolName: "exploration_checkpoint", isError: false });
	// The checkpoint reset the counters of the reminder, so the next
	// occasion is eight turns away.
	assert.equal(await rt.context(), undefined);
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	rt.advance(TODO_REMINDER_COOLDOWN_MS);
	// The task list is still empty, so the request still needs its tasks.
	const text = (await rt.context()).messages[1].content;
	assert.match(text, /periodic/);
	assert.match(text, /local Todos list/);
});

test("a written task resets the nudge, so the work is not asked for again", async () => {
	const rt = runtime({ todos: [] });
	await rt.context();
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	rt.handlers.get("tool_execution_start")({ toolCallId: "1", toolName: "todo", args: { action: "create" } });
	rt.handlers.get("tool_execution_end")({ toolCallId: "1", toolName: "todo", isError: false });
	rt.todos([{ subject: "the work of the request", status: "pending" }]);
	rt.advance(TODO_REMINDER_COOLDOWN_MS);
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	const text = (await rt.context()).messages[1].content;
	assert.match(text, /periodic/);
	assert.doesNotMatch(text, /local Todos list/);
});

test("a removed task does not silence the nudge about the missing task", async () => {
	const rt = runtime({ todos: [] });
	await rt.context();
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	rt.handlers.get("tool_execution_start")({ toolCallId: "1", toolName: "todo", args: { action: "delete" } });
	rt.handlers.get("tool_execution_end")({ toolCallId: "1", toolName: "todo", isError: false });
	rt.advance(TODO_REMINDER_COOLDOWN_MS);
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	const text = (await rt.context()).messages[1].content;
	assert.match(text, /periodic/);
	assert.match(text, /local Todos list/);
});

test("the nudge waits for its pause before it goes out again", async () => {
	const rt = runtime({ todos: [] });
	assert.match((await rt.context()).messages[1].content, /local Todos list/);
	// A new request starts a new occasion, but the pause of the nudge
	// still holds, so the nudge stays away.
	rt.generation("2");
	assert.doesNotMatch((await rt.context()).messages[1].content, /local Todos list/);
	rt.advance(TODO_REMINDER_COOLDOWN_MS);
	for (let i = 0; i < 8; i++) rt.handlers.get("turn_end")();
	assert.match((await rt.context()).messages[1].content, /local Todos list/);
});
