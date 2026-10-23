/**
 * Regression tests for the continuation guard lifecycle.
 *
 * Bug under test: the dispatch guard was set on a successful dispatch and only
 * released via clearQueue() on a non-continue path, so the *next* dispatch was
 * blocked forever - while the retry budget was still consumed by every blocked
 * attempt. Result: one continuation, then a silent stop.
 */

import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoContinuationController } from "../src/continuation-controller.js";
import { MockTodoProvider, type TodoContext } from "../src/todo-provider.js";
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
	dispatch: (content: string) => Promise<void>;
	ctx?: TodoContext;
	maxSteerAttempts?: number;
	circuitBreakerCooldownMs?: number;
	guardReleaseTimeoutMs?: number;
	guardReleaseAfterDropMs?: number;
	inFlightTimeoutMs?: number;
	maxConsecutiveFailures?: number;
}) {
	return new TodoContinuationController(opts.ctx ?? makeCtx(), {
		dispatch: opts.dispatch,
		todoProvider: opts.provider,
		maxSteerAttempts: opts.maxSteerAttempts ?? 3,
		circuitBreakerCooldownMs: opts.circuitBreakerCooldownMs,
		guardReleaseTimeoutMs: opts.guardReleaseTimeoutMs,
		guardReleaseAfterDropMs: opts.guardReleaseAfterDropMs,
		inFlightTimeoutMs: opts.inFlightTimeoutMs,
		maxConsecutiveFailures: opts.maxConsecutiveFailures,
	});
}

describe("TodoContinuationController - guard lifecycle", () => {
	it("dispatches on every settled cycle until the attempt budget is spent", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		// Four consecutive idle cycles: decide -> dispatch -> (agent settles)
		for (let cycle = 1; cycle <= 4; cycle++) {
			controller.releaseContinuationGuard(`settled ${cycle}`);
			const result = await controller.decide();

			if (result.action === "continue" && result.nextItemId) {
				const steer = await controller.steerToContinue(result.nextItemId);
				expect(steer.dispatched).toBe(true);
			} else {
				expect(result.action).toBe("stop");
				expect(result.reason).toContain("max attempts");
			}
		}

		// 3 successful dispatches, then the budget stops further attempts
		expect(sent.length).toBe(3);
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(3);
	});

	it("does not consume the attempt budget when a dispatch is blocked", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let busy = false;
		const sent: string[] = [];
		const controller = makeController({
			provider,
			ctx: makeCtx({ isIdle: () => !busy }),
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		// One real dispatch spends one attempt.
		const first = await controller.steerToContinue(1);
		expect(first.dispatched).toBe(true);
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(1);

		// The guard blocks the next dispatch because the session is busy.
		busy = true;
		const blocked = await controller.steerToContinue(1);
		expect(blocked.dispatched).toBe(false);
		expect(blocked.reason).toContain("session not idle");
		expect(blocked.blockedDispatches).toBeGreaterThan(0);
		// The counter is untouched: a blocked attempt is not an attempt.
		expect(blocked.attempts).toBe(1);
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(1);
		expect(sent.length).toBe(1);
	});

	it("blocks a duplicate dispatch until the guard is released", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const first = await controller.steerToContinue(1);
		expect(first.dispatched).toBe(true);

		// A second settle without releasing the guard must not dispatch again
		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(false);
		expect(sent.length).toBe(1);

		// Releasing the guard (the verified lifecycle transition) allows the next one
		controller.releaseContinuationGuard("agent_settled");
		const third = await controller.steerToContinue(1);
		expect(third.dispatched).toBe(true);
		expect(sent.length).toBe(2);
		expect(third.attempts).toBe(2);
	});

	it("does not dispatch while explicitly paused and resumes afterwards", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		controller.explicitPause();
		const paused = await controller.steerToContinue(1);
		expect(paused.dispatched).toBe(false);
		expect(sent.length).toBe(0);

		controller.resume();
		const resumed = await controller.steerToContinue(1);
		expect(resumed.dispatched).toBe(true);
		expect(sent.length).toBe(1);
	});

	it("skips an item that was completed before the dispatch", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const controller = makeController({
			provider,
			dispatch: async () => {
				throw new Error("must not dispatch");
			},
		});

		provider.setStatus(1, "completed");
		const result = await controller.steerToContinue(1);
		expect(result.dispatched).toBe(false);
		expect(result.blockedDispatches).toBeGreaterThan(0);
	});

	it("reports a failed send with the real reason and spends no attempt", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const controller = makeController({
			provider,
			dispatch: async () => {
				throw new Error("transport is down");
			},
		});

		const result = await controller.steerToContinue(1);
		expect(result.dispatched).toBe(false);
		// The reason must name the real failure, not "blocked by guard".
		expect(result.reason).toContain("dispatch failed");
		expect(result.reason).toContain("transport is down");
		expect(result.attempts).toBe(0);
		expect(result.blockedDispatches).toBe(0);
		expect(controller.getDiagnostics().continuationQueued).toBe(false);
	});

	it("keeps the in-flight guard while a dispatch is on the wire", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseDispatch: (() => void) | null = null;
		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
				await new Promise<void>((resolve) => {
					releaseDispatch = resolve;
				});
			},
		});

		const first = controller.steerToContinue(1);
		// Let the dispatch reach the in-flight state.
		await new Promise((r) => setTimeout(r, 5));
		expect(controller.getDiagnostics().inFlight).toBe(true);

		// A settle arriving while the dispatch is in flight must NOT release the
		// in-flight guard - otherwise a duplicate continuation can be sent.
		controller.releaseContinuationGuard("agent_settled");
		expect(controller.getDiagnostics().inFlight).toBe(true);

		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(false);
		expect(second.reason).toContain("in flight");
		expect(sent.length).toBe(1);

		releaseDispatch?.();
		const firstResult = await first;
		expect(firstResult.dispatched).toBe(true);
		expect(controller.getDiagnostics().inFlight).toBe(false);
	});

	it("routes continueItem() through the guarded dispatch", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const item = { id: 1, subject: "keep going", status: "in_progress" } as never;
		await controller.continueItem(item);
		expect(sent.length).toBe(1);
		expect(sent[0]).toContain("keep going");
		// A successful continuation consumes one attempt.
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(1);
		// The guard is armed: a second continuation is blocked.
		await controller.continueItem(item);
		expect(sent.length).toBe(1);
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(1);

		// After the guard is released the next continuation is allowed again.
		controller.releaseContinuationGuard("agent_settled");
		await controller.continueItem(item);
		expect(sent.length).toBe(2);
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(2);
	});

	it("does not spend an attempt when continueItem() is blocked", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			ctx: makeCtx({ isIdle: () => false }),
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const item = { id: 1, subject: "keep going", status: "in_progress" } as never;
		await controller.continueItem(item);
		expect(sent.length).toBe(0);
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(0);
		expect(controller.getDiagnostics().blockedDispatches).toBeGreaterThan(0);
	});

	it("cancels the guard timer on pause", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const controller = makeController({
			provider,
			dispatch: async () => {},
		});

		await controller.steerToContinue(1);
		expect(controller.getDiagnostics().continuationQueued).toBe(true);

		controller.explicitPause();
		// A pause must disarm the guard completely: a queued-but-cancelled
		// release timer would leave the queue flag stuck at true and block
		// every later dispatch.
		expect(controller.getDiagnostics().continuationQueued).toBe(false);

		// A paused controller must not dispatch again.
		const paused = await controller.steerToContinue(1);
		expect(paused.dispatched).toBe(false);
		expect(paused.reason).toContain("paused");
	});

	it("keeps the in-flight guard when the queue is cleared mid-dispatch", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseDispatch: (() => void) | null = null;
		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
				await new Promise<void>((resolve) => {
					releaseDispatch = resolve;
				});
			},
		});

		const first = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));
		expect(controller.getDiagnostics().inFlight).toBe(true);

		// clearQueue() must NOT release the in-flight guard - otherwise two
		// continuations can be on the wire at the same time.
		controller.clearQueue();
		expect(controller.getDiagnostics().inFlight).toBe(true);

		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(false);
		expect(second.reason).toContain("in flight");
		expect(sent.length).toBe(1);

		releaseDispatch?.();
		await first;
		expect(controller.getDiagnostics().inFlight).toBe(false);
		// The cancelled dispatch must not leave the guard armed.
		expect(controller.getDiagnostics().continuationQueued).toBe(false);
	});

	it("does not disarm the guard of a later dispatch after an idle clearQueue()", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		// A clearQueue() while NO dispatch is running must not cancel the guard
		// of the NEXT dispatch.
		controller.clearQueue();

		await controller.steerToContinue(1);
		expect(sent.length).toBe(1);
		expect(controller.getDiagnostics().continuationQueued).toBe(true);

		// The guard is armed: a second continuation is refused.
		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(false);
		expect(sent.length).toBe(1);
	});

	it("drops a guard release that arrives while a dispatch is in flight", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseDispatch: (() => void) | null = null;
		const controller = makeController({
			provider,
			dispatch: async () => {
				await new Promise<void>((resolve) => {
					releaseDispatch = resolve;
				});
			},
		});

		const first = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));

		// A release that arrives mid-dispatch belongs to the turn that was
		// already running - it must NOT disarm the guard of the dispatch that
		// is settling now.
		controller.releaseContinuationGuard("agent_settled");
		expect(controller.getDiagnostics().continuationQueued).toBe(true);

		releaseDispatch?.();
		await first;

		// The guard of the completed dispatch is still armed; the next settle
		// releases it.
		expect(controller.getDiagnostics().continuationQueued).toBe(true);
		controller.releaseContinuationGuard("agent_settled");
		expect(controller.getDiagnostics().continuationQueued).toBe(false);
	});

	it("opens the circuit breaker after repeated send failures", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let fail = true;
		let sends = 0;
		const controller = makeController({
			provider,
			dispatch: async () => {
				sends++;
				if (fail) throw new Error("transport is down");
			},
		});

		const reasons: string[] = [];
		for (let i = 0; i < 3; i++) {
			const result = await controller.steerToContinue(1);
			expect(result.dispatched).toBe(false);
			reasons.push(result.reason ?? "");
		}

		// The first failures are reported verbatim; the third one trips the
		// breaker.
		expect(reasons[0]).toContain("dispatch failed");
		expect(reasons[2]).toContain("circuit breaker open after 3 consecutive failures");
		// A failing transport never consumes the attempt budget.
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(0);
		expect(controller.getDiagnostics().circuitBreakerOpen).toBe(true);

		// The breaker really breaks: the next continuation is refused BEFORE
		// the transport is used at all.
		const blocked = await controller.steerToContinue(1);
		expect(blocked.dispatched).toBe(false);
		expect(blocked.reason).toContain("circuit breaker open");
		expect(sends).toBe(3);

		// An explicit resume closes the breaker and a dispatch succeeds again.
		fail = false;
		controller.resume();
		const ok = await controller.steerToContinue(1);
		expect(ok.dispatched).toBe(true);
		expect(sends).toBe(4);
	});

	it("keeps the attempt counter when a later attempt is blocked", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);
		provider.addItem({ subject: "other work", status: "pending" } as never);

		let busy = false;
		const sent: string[] = [];
		const controller = makeController({
			provider,
			ctx: makeCtx({ isIdle: () => !busy }),
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		// One real dispatch consumes one attempt.
		const first = await controller.steerToContinue(1);
		expect(first.dispatched).toBe(true);
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(1);

		// A blocked attempt must not change the counter.
		busy = true;
		const blocked = await controller.steerToContinue(1);
		expect(blocked.dispatched).toBe(false);
		expect(blocked.reason).toContain("not idle");
		expect(controller.getDiagnostics().steerAttemptsForCurrentItem).toBe(1);
		expect(sent.length).toBe(1);

		// The budget is per item: another item starts with a fresh budget.
		busy = false;
		controller.releaseContinuationGuard("agent settled");
		const other = await controller.steerToContinue(2);
		expect(other.dispatched).toBe(true);
		expect(other.attempts).toBe(1);
	});

	it("stops after the session-wide attempt cap even when items alternate", async () => {
		const provider = new MockTodoProvider();
		// Four items: the per-item budget alone (3 each) would allow 12
		// dispatches, the session-wide cap (9) stops the run.
		for (let i = 0; i < 4; i++) {
			provider.addItem({ subject: `item ${i}`, status: "pending" } as never);
		}

		const sent: string[] = [];
		const controller = makeController({
			provider,
			maxSteerAttempts: 3,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		// Alternate between the items: the per-item budget never runs out.
		let stopReason = "";
		for (let i = 0; i < 20; i++) {
			controller.releaseContinuationGuard(`settled ${i}`);
			const result = await controller.steerToContinue((i % 4) + 1);
			if (!result.dispatched) {
				stopReason = result.reason ?? "";
				break;
			}
		}

		expect(controller.getDiagnostics().totalAttempts).toBe(9);
		expect(sent.length).toBe(9);
		expect(stopReason).toContain("max total attempts");
	});

	it("releases the in-flight guard when a dispatch hangs and keeps a newer dispatch safe", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseFirst: (() => void) | null = null;
		let sends = 0;
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async () => {
				sends++;
				if (sends === 1) {
					await new Promise<void>((resolve) => {
						releaseFirst = resolve;
					});
				}
			},
		});

		const first = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 60));

		// The watchdog released the hung dispatch.
		expect(controller.getDiagnostics().inFlight).toBe(false);

		// The next continuation is dispatched again.
		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(true);
		expect(sends).toBe(2);

		// The stale dispatch settles late: it must not clear the guard of the
		// newer dispatch.
		releaseFirst?.();
		await first;
		expect(controller.getDiagnostics().continuationQueued).toBe(true);
		expect(controller.getDiagnostics().inFlight).toBe(false);
	});

	it("aborts a dispatch that was cancelled while the snapshot was read", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseSnapshot: (() => void) | null = null;
		const original = provider.getSnapshot.bind(provider);
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			await new Promise<void>((resolve) => {
				releaseSnapshot = resolve;
			});
			return original();
		};

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const pending = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));

		// The queue is cleared while the snapshot read is still pending.
		controller.clearQueue();
		releaseSnapshot?.();
		const result = await pending;

		expect(result.dispatched).toBe(false);
		expect(result.reason).toContain("cancelled before send");
		expect(sent.length).toBe(0);
	});

	it("aborts a dispatch that was paused while the snapshot was read", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseSnapshot: (() => void) | null = null;
		const original = provider.getSnapshot.bind(provider);
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			await new Promise<void>((resolve) => {
				releaseSnapshot = resolve;
			});
			return original();
		};

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const pending = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));

		// The user sends a message while the snapshot read is pending.
		controller.tempPause();
		releaseSnapshot?.();
		const result = await pending;

		expect(result.dispatched).toBe(false);
		expect(result.reason).toContain("paused before send");
		expect(sent.length).toBe(0);
	});

	it("releases the guard when the todo read hangs", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		// The provider never answers the FIRST read: the dispatch must not hold
		// the guard forever.
		const original = provider.getSnapshot.bind(provider);
		let hang = true;
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			if (hang) {
				hang = false;
				await new Promise<void>(() => {});
			}
			return original();
		};

		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async () => {},
		});

		const pending = controller.steerToContinue(1);
		pending.catch(() => {});  // The read never answers: the promise stays pending
		await new Promise((r) => setTimeout(r, 60));

		// The watchdog released the guard even though the read never finished.
		expect(controller.getDiagnostics().inFlight).toBe(false);
		expect(controller.getDiagnostics().continuationQueued).toBe(false);

		// A later dispatch is possible again.
		const next = await controller.steerToContinue(1);
		expect(next.dispatched).toBe(true);
	});

	it("does not let a stale failure clear the guard of a newer dispatch", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let rejectFirst: ((err: Error) => void) | null = null;
		let sends = 0;
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async () => {
				sends++;
				if (sends === 1) {
					await new Promise<void>((_resolve, reject) => {
						rejectFirst = reject;
					});
				}
			},
		});

		const first = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 60));

		// The watchdog released the hung dispatch; a new one takes over.
		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(true);
		expect(controller.getDiagnostics().continuationQueued).toBe(true);

		// The stale dispatch fails late: it must not disarm the new guard.
		rejectFirst?.(new Error("transport died"));
		const firstResult = await first;
		expect(firstResult.dispatched).toBe(false);
		expect(controller.getDiagnostics().continuationQueued).toBe(true);
	});

	it("clears a cancel intent raised while the dispatch hung", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let hangSend = true;
		const sent: string[] = [];
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async (content) => {
				sent.push(content);
				if (hangSend) await new Promise<void>(() => {});
			},
		});

		const stalled = controller.steerToContinue(1);
		stalled.catch(() => {});
		await new Promise((r) => setTimeout(r, 5));

		// A cancel intent for the hung dispatch.
		controller.clearQueue();
		expect(controller.getDiagnostics().cancelRequested).toBe(true);

		// The watchdog force-releases the dispatch and drops the intent: the
		// next legitimate dispatch must not be cancelled by it.
		await new Promise((r) => setTimeout(r, 60));
		expect(controller.getDiagnostics().cancelRequested).toBe(false);

		hangSend = false;
		const next = await controller.steerToContinue(1);
		expect(next.dispatched).toBe(true);
	});

	it("does not let a stale failure trip the circuit breaker", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let rejectStale: ((err: Error) => void) | null = null;
		let call = 0;
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async () => {
				call++;
				if (call === 1) {
					// The first send hangs and fails LATE.
					await new Promise<void>((_resolve, reject) => {
						rejectStale = reject;
					});
				}
				throw new Error("transport is down");
			},
		});

		const stale = controller.steerToContinue(1);
		stale.catch(() => {});
		await new Promise((r) => setTimeout(r, 60));
		// The watchdog released the first dispatch.
		expect(controller.getDiagnostics().consecutiveFailures).toBe(0);

		// The second dispatch fails for real: one failure.
		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(false);
		expect(controller.getDiagnostics().consecutiveFailures).toBe(1);

		// The stale failure arrives late: it must not count.
		rejectStale?.(new Error("late failure"));
		await new Promise((r) => setTimeout(r, 10));
		expect(controller.getDiagnostics().consecutiveFailures).toBe(1);
	});

	it("does not let a stale dispatch consume the cancel intent of a newer one", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const original = provider.getSnapshot.bind(provider);
		const resolvers: (() => void)[] = [];
		let reads = 0;
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			reads++;
			if (reads <= 2) {
				// The first two reads hang: dispatch A and dispatch B.
				await new Promise<void>((resolve) => {
					resolvers.push(resolve);
				});
			}
			return original();
		};

		const sent: string[] = [];
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		// Dispatch A hangs in the todo read.
		const pendingA = controller.steerToContinue(1);
		pendingA.catch(() => {});
		await new Promise((r) => setTimeout(r, 60));
		// The watchdog released A: it is now a stale dispatch.
		expect(controller.getDiagnostics().inFlight).toBe(false);

		// Dispatch B takes the guard and hangs in the todo read as well.
		const pendingB = controller.steerToContinue(1);
		pendingB.catch(() => {});
		await new Promise((r) => setTimeout(r, 5));

		// A cancel intent is raised for dispatch B.
		controller.clearQueue();
		expect(controller.getDiagnostics().cancelRequested).toBe(true);

		// A wakes up: it must report "superseded" and must NOT steal B's
		// cancel intent.
		resolvers[0]?.();
		const staleResult = await pendingA;
		expect(staleResult.dispatched).toBe(false);
		expect(staleResult.reason).toContain("superseded");
		expect(controller.getDiagnostics().cancelRequested).toBe(true);
		expect(sent.length).toBe(0);
	});

	it("marks a retry after a stalled dispatch and clears the stall afterwards", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let hangSend = true;
		const sent: string[] = [];
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async (content) => {
				sent.push(content);
				if (hangSend) await new Promise<void>(() => {});
			},
		});

		// The send hangs: the watchdog force-releases the dispatch.
		const stalled = controller.steerToContinue(1);
		stalled.catch(() => {});
		await new Promise((r) => setTimeout(r, 60));
		expect(sent.length).toBe(1);
		expect(sent[0]).not.toContain("retry after a stalled dispatch");

		// The retry warns about the possible duplicate.
		hangSend = false;
		const retry = await controller.steerToContinue(1);
		expect(retry.dispatched).toBe(true);
		expect(sent.length).toBe(2);
		expect(sent[1]).toContain("retry after a stalled dispatch");

		// The stall is cleared: a third attempt is a normal continuation.
		controller.releaseContinuationGuard("settled");
		const third = await controller.steerToContinue(1);
		expect(third.dispatched).toBe(true);
		expect(sent[2]).not.toContain("retry after a stalled dispatch");
	});

	it("marks a retry after a stalled dispatch on the continueItem path too", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let hangSend = true;
		const sent: string[] = [];
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async (content) => {
				sent.push(content);
				if (hangSend) await new Promise<void>(() => {});
			},
		});

		const item = (await provider.getSnapshot()).items[0];
		const stalled = controller.continueItem(item);
		stalled.catch(() => {});
		await new Promise((r) => setTimeout(r, 60));

		hangSend = false;
		await controller.continueItem(item);
		expect(sent.length).toBe(2);
		expect(sent[1]).toContain("retry after a stalled dispatch");

		// The stall marker is cleared: the next continuation is a normal one.
		controller.releaseContinuationGuard("settled");
		await controller.continueItem(item);
		expect(sent.length).toBe(3);
		expect(sent[2]).not.toContain("retry after a stalled dispatch");
	});

	it("does not clear the temporary pause while a dispatch is in flight", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseSnapshot: (() => void) | null = null;
		const original = provider.getSnapshot.bind(provider);
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			await new Promise<void>((resolve) => {
				releaseSnapshot = resolve;
			});
			return original();
		};

		const controller = makeController({ provider, dispatch: async () => {} });

		const pending = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));

		// A user message arrives while the dispatch reads the snapshot.
		controller.tempPause();
		// A decision that runs concurrently must not drop the pause.
		await controller.decide();
		expect(controller.getDiagnostics().userPaused).toBe(true);

		releaseSnapshot?.();
		const result = await pending;
		expect(result.dispatched).toBe(false);
		expect(result.reason).toContain("paused before send");
	});

	it("records the dropped guard release in the diagnostics", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseSend: (() => void) | null = null;
		const controller = makeController({
			provider,
			dispatch: async () => {
				await new Promise<void>((resolve) => {
					releaseSend = resolve;
				});
			},
		});

		const pending = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));

		// A release arrives while the dispatch is on the wire.
		controller.releaseContinuationGuard("agent settled");
		expect(controller.getDiagnostics().pendingGuardRelease).toBe("agent settled");

		releaseSend?.();
		await pending;

		expect(controller.getDiagnostics().pendingGuardRelease).toBeNull();
		expect(controller.getDiagnostics().lastDroppedGuardRelease).toBe("agent settled");
	});

	it("releases the guard shortly after a dropped mid-dispatch release", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseSend: (() => void) | null = null;
		const controller = makeController({
			provider,
			guardReleaseAfterDropMs: 30,
			guardReleaseTimeoutMs: 60_000,
			dispatch: async () => {
				await new Promise<void>((resolve) => {
					releaseSend = resolve;
				});
			},
		});

		const pending = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));
		controller.releaseContinuationGuard("agent settled");
		releaseSend?.();
		await pending;

		// Right after the drop the guard is still armed...
		expect(controller.getDiagnostics().continuationQueued).toBe(true);
		// ...but it is released after the short delay, not after the 60s safety
		// net: the auto-continue must not stall for a minute.
		await new Promise((r) => setTimeout(r, 60));
		expect(controller.getDiagnostics().continuationQueued).toBe(false);
	});

	it("does not mark an item as stalled when the todo read hangs", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const original = provider.getSnapshot.bind(provider);
		let hang = true;
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			if (hang) {
				hang = false;
				await new Promise<void>(() => {});
			}
			return original();
		};

		const sent: string[] = [];
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const pending = controller.steerToContinue(1);
		pending.catch(() => {});
		await new Promise((r) => setTimeout(r, 60));

		// The read hung: no message was ever on the wire, so the retry must
		// NOT warn about a possible duplicate.
		const next = await controller.steerToContinue(1);
		expect(next.dispatched).toBe(true);
		expect(sent[0]).not.toContain("retry after a stalled dispatch");
	});

	it("does not let a stale success close an open circuit breaker", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseStale: (() => void) | null = null;
		let call = 0;
		const controller = makeController({
			provider,
			inFlightTimeoutMs: 30,
			maxConsecutiveFailures: 1,
			dispatch: async () => {
				call++;
				if (call === 1) {
					// The first send hangs and succeeds LATE.
					await new Promise<void>((resolve) => {
						releaseStale = resolve;
					});
					return;
				}
				throw new Error("transport is down");
			},
		});

		const stale = controller.steerToContinue(1);
		stale.catch(() => {});
		await new Promise((r) => setTimeout(r, 60));
		expect(controller.getDiagnostics().consecutiveFailures).toBe(0);

		// The second dispatch fails: with maxConsecutiveFailures = 1 the
		// breaker opens.
		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(false);
		expect(controller.getDiagnostics().consecutiveFailures).toBe(1);
		expect(controller.getDiagnostics().circuitBreakerOpen).toBe(true);

		// The stale success arrives late: it must not close the breaker.
		releaseStale?.();
		await new Promise((r) => setTimeout(r, 10));
		expect(controller.getDiagnostics().consecutiveFailures).toBe(1);
		expect(controller.getDiagnostics().circuitBreakerOpen).toBe(true);
	});

	it("reports a todo item with id 0 in the state", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "zero", status: "in_progress" } as never);
		// A provider whose item has the id 0 (a falsy but valid id).
		const original = provider.getSnapshot.bind(provider);
		const originalInProgress = provider.getInProgress.bind(provider);
		const originalReady = provider.getReady.bind(provider);
		const zeroed = <T extends { id: number }>(items: T[]): T[] =>
			items.map((i) => ({ ...i, id: 0 }));
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			const snapshot = await original();
			return { ...snapshot, items: zeroed(snapshot.items) };
		};
		(provider as unknown as { getInProgress: () => Promise<unknown> }).getInProgress = async () =>
			zeroed(await originalInProgress());
		(provider as unknown as { getReady: () => Promise<unknown> }).getReady = async () =>
			zeroed(await originalReady());

		const controller = makeController({ provider, dispatch: async () => {} });
		const result = await controller.decide();
		expect(result.action).toBe("continue");
		// id 0 must not be reported as "no item".
		expect(controller.getState().current).toEqual({ id: 0 });
		expect(controller.getState().next).toEqual({ id: 0 });
	});

	it("clears the selected item from the state when there is nothing to do", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const controller = makeController({ provider, dispatch: async () => {} });
		const result = await controller.decide();
		expect(result.action).toBe("continue");
		expect(controller.getState().current).not.toBeNull();

		// The work is done: the next decision stops and the state no longer
		// reports the last continued item.
		provider.setStatus(1, "completed");
		const stopped = await controller.decide();
		expect(stopped.action).toBe("stop");
		expect(controller.getState().current).toBeNull();
		expect(controller.getState().next).toBeNull();
	});

	it("reports the delivered message only after a successful send", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const controller = makeController({
			provider,
			dispatch: async () => {
				throw new Error("transport died");
			},
		});

		await controller.steerToContinue(1);
		expect(controller.getDiagnostics().lastSteerMessage).toBeNull();
	});

	it("resets the cancel intent and the diagnostics on dispose()", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let releaseSnapshot: (() => void) | null = null;
		const original = provider.getSnapshot.bind(provider);
		(provider as unknown as { getSnapshot: () => Promise<unknown> }).getSnapshot = async () => {
			await new Promise<void>((resolve) => {
				releaseSnapshot = resolve;
			});
			return original();
		};

		const controller = makeController({ provider, dispatch: async () => {} });

		const pending = controller.steerToContinue(1);
		await new Promise((r) => setTimeout(r, 5));
		controller.clearQueue();
		expect(controller.getDiagnostics().cancelRequested).toBe(true);

		controller.dispose();
		expect(controller.getDiagnostics().cancelRequested).toBe(false);
		expect(controller.getDiagnostics().disposed).toBe(true);

		releaseSnapshot?.();
		await pending;
	});

	it("auto-releases the guard when the release timer expires", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const controller = makeController({
			provider,
			guardReleaseTimeoutMs: 30,
			dispatch: async () => {},
		});

		await controller.steerToContinue(1);
		expect(controller.getDiagnostics().continuationQueued).toBe(true);

		// The safety net for a lost agent_settled event.
		await new Promise((r) => setTimeout(r, 60));
		expect(controller.getDiagnostics().continuationQueued).toBe(false);
	});

	it("does not dispatch while a temporary pause is active and resumes afterwards", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		controller.tempPause();
		const blocked = await controller.steerToContinue(1);
		expect(blocked.dispatched).toBe(false);
		expect(blocked.reason).toContain("user input pending");
		expect(sent.length).toBe(0);

		// The next decision clears the temporary pause.
		await controller.decide();
		const ok = await controller.steerToContinue(1);
		expect(ok.dispatched).toBe(true);
		expect(sent.length).toBe(1);
	});

	it("does not dispatch after dispose()", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		controller.dispose();
		const result = await controller.steerToContinue(1);
		expect(result.dispatched).toBe(false);
		expect(result.reason).toContain("disposed");
		expect(sent.length).toBe(0);
	});

	it("allows a trial dispatch after the circuit breaker cooldown", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		let fail = true;
		let sends = 0;
		const controller = makeController({
			provider,
			circuitBreakerCooldownMs: 30,
			dispatch: async () => {
				sends++;
				if (fail) throw new Error("transport is down");
			},
		});

		for (let i = 0; i < 3; i++) await controller.steerToContinue(1);
		expect(controller.getDiagnostics().circuitBreakerOpen).toBe(true);

		await new Promise((r) => setTimeout(r, 60));
		expect(controller.getDiagnostics().circuitBreakerOpen).toBe(false);

		// The transport is still broken: the trial fails and the breaker opens
		// again.
		fail = true;
		const trial = await controller.steerToContinue(1);
		expect(trial.dispatched).toBe(false);
		expect(sends).toBe(4);
	});
});

describe("TodoContinuationController - staged validation context", () => {
	it("adds the declared validation plan to the continuation message", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({
			subject: "seed data",
			status: "in_progress",
			metadata: {
				validationPlan: {
					fast: { command: "bun test tests/fast", expectedDurationMs: 18_000, datasetSize: 100 },
					full: { command: "bun test tests/full", expectedDurationMs: 2_400_000, datasetSize: 10_000 },
					budgetMinutes: 90,
					finalTierRequired: true,
				},
			},
		} as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const result = await controller.steerToContinue(1);
		expect(result.dispatched).toBe(true);
		expect(sent.length).toBe(1);

		const message = sent[0];
		expect(message).toContain("Continue todo item ID 1.");
		expect(message).toContain("VALIDATION PLAN (staged)");
		expect(message).toContain("bun test tests/fast");
		expect(message).toContain("bun test tests/full");
		expect(message).toContain("Run the fast tier after every edit");
		expect(message).toContain("Time budget: 90m");
	});

	it("leaves the message untouched when no plan is declared", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({ subject: "keep going", status: "in_progress" } as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		await controller.steerToContinue(1);
		expect(sent[0]).toBe("Continue todo item ID 1.");
		expect(sent[0]).not.toContain("VALIDATION PLAN");
	});
});

describe("TodoContinuationController - validation budget and ledger", () => {
	it("pauses the item when the declared time budget is spent", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({
			subject: "budgeted work",
			status: "in_progress",
			metadata: {
				validationPlan: {
					fast: { command: "bun test tests/fast" },
					budgetMinutes: 0,
				},
			},
		} as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		const result = await controller.decide();
		expect(result.action).toBe("stop");
		expect(result.reason).toContain("budget exhausted");
		expect(result.budget?.exhausted).toBe(true);
		expect(sent.length).toBe(0);
	});

	it("does not put a continuation on the wire when the budget is spent", async () => {
		const provider = new MockTodoProvider();
		provider.addItem({
			subject: "budgeted work",
			status: "in_progress",
			metadata: {
				validationPlan: {
					fast: { command: "bun test tests/fast" },
					budgetMinutes: 0.001, // 60ms
				},
			},
		} as never);

		const sent: string[] = [];
		const controller = makeController({
			provider,
			dispatch: async (content) => {
				sent.push(content);
			},
		});

		// The first continuation is inside the budget.
		const first = await controller.steerToContinue(1);
		expect(first.dispatched).toBe(true);
		expect(sent.length).toBe(1);

		// After the budget is spent the item pauses at a safe boundary.
		await new Promise((resolve) => setTimeout(resolve, 90));
		controller.releaseContinuationGuard("settled");
		const second = await controller.steerToContinue(1);
		expect(second.dispatched).toBe(false);
		expect(second.reason).toContain("budget exhausted");
		expect(sent.length).toBe(1);
	});

	it("reports the recorded tier state in the continuation message", async () => {
		const dir = mkdtempSync(join(tmpdir(), "validation-ledger-"));
		try {
			const provider = new MockTodoProvider();
			provider.addItem({
				subject: "staged work",
				status: "in_progress",
				metadata: {
					validationPlan: {
						fast: { command: "bun test tests/fast" },
						full: { command: "bun test tests/full" },
						finalTierRequired: true,
					},
				},
			} as never);

			const ledger = new ValidationLedger({ path: join(dir, "runs.jsonl") });
			ledger.record({ tier: "fast", status: "passed", itemId: 1 });

			const sent: string[] = [];
			const controller = new TodoContinuationController(makeCtx(), {
				dispatch: async (content) => {
					sent.push(content);
				},
				todoProvider: provider,
				validationLedger: ledger,
			});

			await controller.steerToContinue(1);
			expect(sent[0]).toContain("Fast tier: passed");
			expect(sent[0]).toContain("do not complete this todo while it is pending or failed");

			// Once the final tier passed, the message says so.
			ledger.record({ tier: "full", status: "passed", itemId: 1 });
			controller.releaseContinuationGuard("settled");
			await controller.steerToContinue(1);
			expect(sent[1]).toContain("Full tier: passed");
			expect(sent[1]).toContain("The final tier already passed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
