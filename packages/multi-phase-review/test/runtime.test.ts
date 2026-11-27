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
import { TwoPhaseStateStore, createState } from "../src/state.js";
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

/** Run a Git command in a repository of the test. */
function gitIn(root: string, ...args: string[]): void {
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
}

/** A Git repository with one committed file. */
function makeRepo(root: string): void {
	gitIn(root, "init", "-q");
	mkdirSync(join(root, "packages", "app"), { recursive: true });
	writeFileSync(join(root, "packages", "app", "index.ts"), "export const a = 1;\n");
	gitIn(root, "add", "-A");
	gitIn(root, "commit", "-qm", "base");
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

	it("says that the phase gate is not active when the todo list cannot be read", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			const logs: string[] = [];
			await initTwoPhaseReview({
				pi,
				readTodos: reader([], false),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
				log: (message: string) => logs.push(message),
			});
			await pi.emit("session_start", {}, context());

			const prompt = (await pi.emit(
				"before_agent_start",
				{ systemPrompt: "base" },
				context(),
			))[0] as { systemPrompt?: string };

			// The agent is told that the work is not gated.
			expect(prompt?.systemPrompt).toMatch(/phase gate of the harness is not active/);
			expect(prompt?.systemPrompt).toMatch(/the todo provider is not available/);
			// The reason is reported once.
			expect(logs.some((line) => /the phase gate is not active/.test(line))).toBe(true);
		});
	});

	it("shows that the todo list is unavailable in the status line", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const pi = new FakePi();
			const statuses: string[] = [];
			const ctx = {
				sessionManager: { getSessionId: () => "session-1" },
				ui: {
					setStatus: (_key: string, value: string) => {
						statuses.push(value);
					},
				},
			};
			await initTwoPhaseReview({
				pi,
				readTodos: reader([], false),
				workspaceRoot: () => dir,
				store: new TwoPhaseStateStore(dir),
			});
			await pi.emit("session_start", {}, ctx);
			await pi.emit("turn_end", {}, ctx);

			expect(statuses.some((line) => line === "[?] TODOS unavailable")).toBe(true);
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

	it("waits for the final tier of a test item", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			makeRepo(dir);
			writeFileSync(join(dir, "packages", "app", "index.ts"), "export const a = 2;\n");
			const stateDir = makePlainTempDir("runtime-state");
			try {
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader([
						{ id: 1, subject: "[IMPLEMENT] Work", status: "completed" },
						{ id: 2, subject: "[REVIEW] chunk-1: app", status: "completed" },
						{ id: 3, subject: "[TEST] Validate the task", status: "pending" },
					]),
					// The final tier has not run yet.
					readValidation: async () => ({
						available: true,
						pendingFinalTier: 1,
						failedFinalTier: 0,
						incompletePlan: 0,
					}),
					workspaceRoot: () => dir,
					store: new TwoPhaseStateStore(stateDir),
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("turn_end", {}, context());
				expect(runtime.getState().phase).toBe("review");

				// The review ran over its chunk, but the final tier is pending.
				await pi.emit("turn_end", {}, context());
				expect(runtime.getState().phase).toBe("test_pending");
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("completes the task when the final tier passed", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			makeRepo(dir);
			writeFileSync(join(dir, "packages", "app", "index.ts"), "export const a = 2;\n");
			const stateDir = makePlainTempDir("runtime-state");
			try {
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader([
						{ id: 1, subject: "[IMPLEMENT] Work", status: "completed" },
						{ id: 2, subject: "[REVIEW] chunk-1: app", status: "completed" },
						{ id: 3, subject: "[TEST] Validate the task", status: "completed" },
					]),
					readValidation: async () => ({
						available: true,
						pendingFinalTier: 0,
						failedFinalTier: 0,
						incompletePlan: 0,
					}),
					workspaceRoot: () => dir,
					store: new TwoPhaseStateStore(stateDir),
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("turn_end", {}, context());
				await pi.emit("turn_end", {}, context());

				expect(runtime.getState().phase).toBe("complete");
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("keeps the task open when the validation state cannot be read", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			makeRepo(dir);
			writeFileSync(join(dir, "packages", "app", "index.ts"), "export const a = 2;\n");
			const stateDir = makePlainTempDir("runtime-state");
			try {
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader([
						{ id: 1, subject: "[IMPLEMENT] Work", status: "completed" },
						{ id: 2, subject: "[REVIEW] chunk-1: app", status: "completed" },
						{ id: 3, subject: "[TEST] Validate the task", status: "pending" },
					]),
					readValidation: async () => {
						throw new Error("the ledger is not readable");
					},
					workspaceRoot: () => dir,
					store: new TwoPhaseStateStore(stateDir),
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("turn_end", {}, context());
				await pi.emit("turn_end", {}, context());

				// A tier that cannot be read is not a tier that passed.
				expect(runtime.getState().phase).toBe("test_pending");
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
			expect(result?.systemPrompt).toMatch(/Three-phase implementation, review and validation/);
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

	it("starts a new workflow for the work that comes after a finished one", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			// The state of the workflow lives outside the workspace: inside it,
			// the state file would show up as an untracked change of the task.
			const stateDir = makePlainTempDir("runtime-state");
			try {
				// The finished workflow of the first task is written to the
				// store: the phase of a task depends on the measured scope of
				// the repository, so the test sets the finished workflow up
				// instead of waiting for one.
				const store = new TwoPhaseStateStore(stateDir);
				store.write({
					...createState("session-1"),
					phase: "complete",
					taskIdentity: "todos:1",
				});

				// The list of the session: the work of the first task is done
				// and the work of the second task is new.
				const todos: TodoReadResult["todos"] = [
					{ id: 1, subject: "[IMPLEMENT] The first task", status: "completed" },
					{ id: 2, subject: "[IMPLEMENT] The second task", status: "pending" },
				];
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader(todos),
					workspaceRoot: () => dir,
					store,
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("turn_end", {}, context());

				// The finished workflow belongs to the work it did: the new work
				// starts a new workflow.
				expect(runtime.getState().phase).toBe("implementation");
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("keeps the finished workflow when the human only clarifies", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const stateDir = makePlainTempDir("runtime-state");
			try {
				const store = new TwoPhaseStateStore(stateDir);
				store.write({
					...createState("session-1"),
					phase: "complete",
					taskIdentity: "todos:1",
				});

				// The human asks a question about the finished work: the question
				// creates no todo, so the work of the session is the same.
				const todos: TodoReadResult["todos"] = [
					{ id: 1, subject: "[IMPLEMENT] The first task", status: "completed" },
				];
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader(todos),
					workspaceRoot: () => dir,
					store,
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("turn_end", {}, context());

				expect(runtime.getState().phase).toBe("complete");
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("remembers the finished work across a restart", async () => {		await withTempDirAsync("runtime", async (dir) => {
			const stateDir = makePlainTempDir("runtime-state");
			try {
				const store = new TwoPhaseStateStore(stateDir);
				store.write({
					...createState("session-1"),
					phase: "complete",
					taskIdentity: "todos:1",
				});

				const todos: TodoReadResult["todos"] = [
					{ id: 1, subject: "[IMPLEMENT] The first task", status: "completed" },
				];
				const first = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi: first,
					readTodos: reader(todos),
					workspaceRoot: () => dir,
					store,
				});
				await first.emit("session_start", {}, context());

				// The session comes back with the state of the finished work.
				expect(runtime.getState().taskIdentity).toBe("todos:1");

				// The work that comes after the finished one starts a new
				// workflow, even after the restart.
				todos.push({ id: 2, subject: "[IMPLEMENT] The second task", status: "pending" });
				await first.emit("turn_end", {}, context());
				expect(runtime.getState().phase).toBe("implementation");
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("starts the implementation for the new work of a legacy session", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const stateDir = makePlainTempDir("runtime-state");
			try {
				// The state of a session that comes from the version before
				// the identity of the work: the file is the JSON of that
				// version, with the finished phase and without an identity.
				writeFileSync(
					join(stateDir, "session-1.json"),
					JSON.stringify(
						{
							phase: "complete",
							taskId: "session-1",
							startRevision: null,
							scopeFiles: [],
							chunks: [],
							signals: [],
							findings: [],
							updatedAt: new Date().toISOString(),
						},
						null,
						2,
					),
				);

				// The session continues with work that is pending.
				const todos: TodoReadResult["todos"] = [
					{ id: 42, subject: "[IMPLEMENT] The new work", status: "pending" },
				];
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader(todos),
					workspaceRoot: () => dir,
					store: new TwoPhaseStateStore(stateDir),
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("before_agent_start", { systemPrompt: "" }, context());

				// The work is new, so the implementation starts again instead
				// of the session pretending that it is done.
				expect(runtime.getPhase(todos)).toBe("implementation");
				expect(runtime.getState().taskIdentity).toBe("todos:42");
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("keeps the finished workflow of a legacy session when the human only clarifies", async () => {
		await withTempDirAsync("runtime", async (dir) => {
			const stateDir = makePlainTempDir("runtime-state");
			try {
				writeFileSync(
					join(stateDir, "session-1.json"),
					JSON.stringify(
						{
							phase: "complete",
							taskId: "session-1",
							startRevision: null,
							scopeFiles: [],
							chunks: [],
							signals: [],
							findings: [],
							updatedAt: new Date().toISOString(),
						},
						null,
						2,
					),
				);

				// The human asks about the finished work: the question
				// creates no todo, so the work of the session is the same.
				const todos: TodoReadResult["todos"] = [
					{ id: 42, subject: "[IMPLEMENT] The work that is done", status: "completed" },
				];
				const pi = new FakePi();
				const runtime = await initTwoPhaseReview({
					pi,
					readTodos: reader(todos),
					workspaceRoot: () => dir,
					store: new TwoPhaseStateStore(stateDir),
				});
				await pi.emit("session_start", {}, context());
				await pi.emit("before_agent_start", { systemPrompt: "" }, context());

				expect(runtime.getPhase(todos)).toBe("complete");
			} finally {
				rmSync(stateDir, { recursive: true, force: true });
			}
		});
	});

	it("reviews only the changes of the new work", async () => {
		for (const committed of [true, false]) {
			await withTempDirAsync("runtime", async (dir) => {
				makeRepo(dir);
				const stateDir = makePlainTempDir("runtime-state");
				try {
					const todos: TodoReadResult["todos"] = [
						{ id: 1, subject: "[IMPLEMENT] The first task", status: "completed" },
					];
					const pi = new FakePi();
					const runtime = await initTwoPhaseReview({
						pi,
						readTodos: reader(todos),
						readValidation: async () => ({
							available: true,
							pendingFinalTier: 0,
							failedFinalTier: 0,
							incompletePlan: 0,
						}),
						workspaceRoot: () => dir,
						store: new TwoPhaseStateStore(stateDir),
					});
					await pi.emit("session_start", {}, context());

					// The first task changes its own file. It either commits
					// it or leaves it in the workspace.
					writeFileSync(join(dir, "packages", "app", "first.ts"), "export const first = 1;\n");
					if (committed) {
						gitIn(dir, "add", "-A");
						gitIn(dir, "commit", "-qm", "the first task");
					}
					await pi.emit("turn_end", {}, context());

					// The review of the first task covers the file of the first
					// task.
					expect(runtime.getState().phase).toBe("review");
					expect(runtime.getState().scopeFiles).toContain("packages/app/first.ts");

					// The review of the first task is finished.
					todos.push({
						id: 2,
						subject: "[REVIEW] chunk-1: packages/app",
						status: "completed",
					});
					await pi.emit("turn_end", {}, context());
					expect(runtime.getState().phase).toBe("complete");

					// The second task changes another file.
					writeFileSync(join(dir, "packages", "app", "second.ts"), "export const second = 2;\n");
					todos.push({
						id: 3,
						subject: "[IMPLEMENT] The second task",
						status: "completed",
					});
					await pi.emit("turn_end", {}, context());

					// The review of the second task covers only the file of
					// the second task: the changes of the first task are not
					// reviewed again.
					expect(runtime.getState().phase).toBe("review");
					expect(runtime.getState().scopeFiles).toContain("packages/app/second.ts");
					expect(runtime.getState().scopeFiles).not.toContain("packages/app/first.ts");
				} finally {
					rmSync(stateDir, { recursive: true, force: true });
				}
			});
		}
	});
});
