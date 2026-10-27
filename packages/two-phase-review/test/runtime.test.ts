/**
 * The runtime of the two-phase workflow.
 *
 * The runtime is tested with a fake extension API: the handlers are called
 * the way the session calls them, so the behavior (blocking, persistence,
 * the phase transition, the steer and the prompt) is verified and not only
 * the presence of a few source lines.
 */

import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initTwoPhaseReview } from "../src/runtime.js";
import type {
	TodoReadResult,
	TwoPhaseExtensionApi,
	TwoPhaseRuntime,
} from "../src/runtime.js";
import { TwoPhaseStateStore } from "../src/state.js";
import { makePlainTempDir, withTempDirAsync } from "./helpers.js";

type Handler = (...args: any[]) => unknown;

/** A fake extension API that records what the runtime does. */
class FakePi implements TwoPhaseExtensionApi {
	handlers = new Map<string, Handler[]>();
	entries: { type: string; data: unknown }[] = [];
	messages: { content: string; options?: { deliverAs?: string } }[] = [];
	status: { key: string; value: string }[] = [];

	on(event: string, handler: Handler): void {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
	}

	appendEntry(type: string, data: unknown): void {
		this.entries.push({ type, data });
	}

	async sendUserMessage(
		content: string,
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		this.messages.push({ content, options });
	}

	/** Call every handler of the event. */
	async emit(event: string, ...args: unknown[]): Promise<unknown[]> {
		const list = this.handlers.get(event) ?? [];
		const results: unknown[] = [];
		for (const handler of list) results.push(await handler(...args));
		return results;
	}
}

/** A fake session context. */
function context(sessionId = "session-1") {
	return {
		sessionManager: { getSessionId: () => sessionId },
		ui: {
			setStatus: (key: string, value: string) => {
				// The status line is a convenience; it is recorded, not asserted.
			},
		},
	};
}

/** A Git repository with one committed file. */
function makeRepo(root: string): void {
	const git = (...args: string[]): void => {
		execFileSync(
			"git",
			[
				"-c",
				"user.email=test@example.com",
				"-c",
				"user.name=Test",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{ cwd: root, stdio: "ignore" },
		);
	};
	git("init", "-q");
	mkdirSync(join(root, "packages", "app"), { recursive: true });
	writeFileSync(join(root, "packages", "app", "index.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "base");
}

/** The todo list the runtime reads. */
function reader(items: TodoReadResult["todos"], available = true): (ctx: unknown) => Promise<TodoReadResult> {
	return async () => ({
		available,
		todos: available ? items : [],
		reason: available ? undefined : "the todo provider is not available",
	});
}

describe("the two-phase runtime", () => {
	it("blocks a comprehensive review while the implementation runs", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			const runtime = await initTwoPhaseReview({
				pi,
				readTodos: reader([
					{ id: 1, subject: "[IMPLEMENT] Add the storage", status: "pending" },
				]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());

			const result = (await pi.emit(
				"tool_call",
				{ toolName: "code-reviewer", input: { files: ["index.ts"] } },
				context(),
			))[0] as { block?: boolean; reason?: string };

			expect(result.block).toBe(true);
			expect(result.reason).toMatch(/Phase 1 \(implementation\) is still running/);
			// The signal is queued, not lost.
			expect(runtime.getState().signals.length).toBe(1);
			expect(runtime.getState().phase).toBe("implementation");
			// The queued review is part of the session.
			expect(pi.entries.length).toBe(1);
			expect(pi.entries[0].type).toBe("harness-two-phase-review");
		});
	});

	it("does not block a task level check", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			await initTwoPhaseReview({
				pi,
				readTodos: reader([{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" }]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());

			const result = (await pi.emit(
				"tool_call",
				{ toolName: "lens_diagnostics", input: { paths: ["index.ts"] } },
				context(),
			))[0] as { block?: boolean };

			expect(result).toEqual({});
		});
	});

	it("lets an explicit request of the human run the review", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			await initTwoPhaseReview({
				pi,
				readTodos: reader([{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" }]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());
			await pi.emit("message_end", {
				message: { role: "user", content: "please review the diff now" },
			});

			const result = (await pi.emit(
				"tool_call",
				{ toolName: "code-reviewer", input: { files: ["index.ts"] } },
				context(),
			))[0] as { block?: boolean };

			expect(result).toEqual({});
		});
	});

	it("ignores a request that the harness sent itself", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			await initTwoPhaseReview({
				pi,
				readTodos: reader([{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" }]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());
			await pi.emit("message_end", {
				message: { role: "user", content: "[harness:two-phase] please review the diff" },
			});

			const result = (await pi.emit(
				"tool_call",
				{ toolName: "code-reviewer", input: { files: ["index.ts"] } },
				context(),
			))[0] as { block?: boolean };

			expect(result.block).toBe(true);
		});
	});

	it("blocks the review when the todo list cannot be read", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			const runtime = await initTwoPhaseReview({
				pi,
				readTodos: reader([], false),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());

			const result = (await pi.emit(
				"tool_call",
				{ toolName: "code-reviewer", input: { files: ["index.ts"] } },
				context(),
			))[0] as { block?: boolean; reason?: string };

			expect(result.block).toBe(true);
			expect(result.reason).toMatch(/todo list of the session is not readable/);
			// The phase did not move either.
			expect(runtime.getState().phase).toBe("implementation");
		});
	});

	it("starts the review when the implementation is done", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			makeRepo(dir);
			writeFileSync(join(dir, "packages", "app", "index.ts"), "export const a = 2;\n");

			const pi = new FakePi();
			const runtime = await initTwoPhaseReview({
				pi,
				readTodos: reader([
					{ id: 1, subject: "[IMPLEMENT] Work", status: "completed" },
					{ id: 2, subject: "[REVIEW] Review the task diff", status: "pending" },
				]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());
			await pi.emit("turn_end", {}, context());

			expect(runtime.getState().phase).toBe("review");
			expect(runtime.getState().scopeFiles.length).toBeGreaterThan(0);
			// The review is started with a steer, not with a tool call.
			expect(pi.messages.length).toBe(1);
			expect(pi.messages[0].options?.deliverAs).toBe("steer");
			expect(pi.messages[0].content).toMatch(/Phase 2 \(review\) starts now/);
		});
	});

	it("starts the review on its own when the implementation is done", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			makeRepo(dir);
			writeFileSync(join(dir, "packages", "app", "index.ts"), "export const a = 2;\n");

			const pi = new FakePi();
			const runtime = await initTwoPhaseReview({
				pi,
				// No review signal and no queued review todo: the review starts
				// from the measured scope of the task.
				readTodos: reader([
					{ id: 1, subject: "[IMPLEMENT] Work", status: "completed" },
				]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());
			await pi.emit("turn_end", {}, context());

			expect(runtime.getState().phase).toBe("review");
			expect(runtime.getState().scopeFiles.length).toBeGreaterThan(0);
			expect(pi.messages.length).toBe(1);
			expect(pi.messages[0].content).toMatch(/Phase 2 \(review\) starts now/);
		});
	});

	it("waits for the evidence that the implementation ran", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			makeRepo(dir);
			writeFileSync(join(dir, "packages", "app", "index.ts"), "export const a = 2;\n");

			const pi = new FakePi();
			const runtime = await initTwoPhaseReview({
				pi,
				// An empty todo list is no proof that the implementation is over.
				readTodos: reader([]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());
			await pi.emit("turn_end", {}, context());

			expect(runtime.getState().phase).toBe("implementation");
			expect(pi.messages.length).toBe(0);
		});
	});

	it("completes a task that changed no file", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			makeRepo(dir);
			// The state of the workflow lives outside the workspace: inside it,
			// the state file would show up as an untracked change of the task.
			const stateDir = makePlainTempDir("runtime-state");
			try {
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader([
						{ id: 1, subject: "[IMPLEMENT] Work", status: "completed" },
					]),
					workspaceRoot: () => dir,
					store: new TwoPhaseStateStore(stateDir),
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("turn_end", {}, context());

				// There is no diff, so there is nothing a review could cover.
				expect(runtime.getState().phase).toBe("complete");
				expect(pi.messages.length).toBe(0);
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("does not start the review while the implementation is open", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			const runtime = await initTwoPhaseReview({
				pi,
				readTodos: reader([
					{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" },
					{ id: 2, subject: "[REVIEW] Review the task diff", status: "pending" },
				]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());
			await pi.emit("turn_end", {}, context());

			expect(runtime.getState().phase).toBe("implementation");
			expect(pi.messages.length).toBe(0);
		});
	});

	it("puts the rules and the phase into the system prompt", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			await initTwoPhaseReview({
				pi,
				readTodos: reader([{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" }]),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, context());

			const result = (await pi.emit(
				"before_agent_start",
				{ systemPrompt: "BASE PROMPT" },
				context(),
			))[0] as { systemPrompt?: string } | undefined;

			expect(result?.systemPrompt).toMatch(/^BASE PROMPT/);
			expect(result?.systemPrompt).toMatch(/Two-phase implementation and review/);
			expect(result?.systemPrompt).toMatch(/Phase 1 \(implementation\)/);
		});
	});

	it("keeps the state when it cannot be written", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			const store = new TwoPhaseStateStore(dir);
			const runtime = await initTwoPhaseReview({
				pi,
				readTodos: reader([{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" }]),
				workspaceRoot: () => dir,
				store: {
					path: store.path.bind(store),
					read: store.read.bind(store),
					clear: store.clear.bind(store),
					write: () => {
						throw new Error("the disk is full");
					},
				} as unknown as TwoPhaseStateStore,
			});
			await pi.emit("session_start", {}, context());

			const result = (await pi.emit(
				"tool_call",
				{ toolName: "code-reviewer", input: { files: ["index.ts"] } },
				context(),
			))[0] as { block?: boolean };

			// The review is still deferred, but nothing was queued.
			expect(result.block).toBe(true);
			expect(runtime.getState().signals.length).toBe(0);
			expect(pi.entries.length).toBe(0);
		});
	});

	it("keeps the state of the session across a restart", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const store = new TwoPhaseStateStore(dir);
			const first = new FakePi();
			const runtime: TwoPhaseRuntime = await initTwoPhaseReview({
				pi: first,
				readTodos: reader([{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" }]),
				workspaceRoot: () => dir,
				store,
			});
			await first.emit("session_start", {}, context("session-7"));
			await first.emit(
				"tool_call",
				{ toolName: "code-reviewer", input: { files: ["index.ts"] } },
				context("session-7"),
			);
			expect(runtime.getState().signals.length).toBe(1);

			const second = new FakePi();
			const restarted = await initTwoPhaseReview({
				pi: second,
				readTodos: reader([{ id: 1, subject: "[IMPLEMENT] Work", status: "pending" }]),
				workspaceRoot: () => dir,
				store,
			});
			await second.emit("session_start", {}, context("session-7"));

			expect(restarted.getState().signals.length).toBe(1);
			expect(restarted.getState().startRevision).toBe(runtime.getState().startRevision);
		});
	});
});
