/**
 * The lifecycle of a request.
 *
 * The lifecycle is the single place that knows whether the request of the
 * human is finished. The tests are behavioural: they drive the controller
 * with a list of todos and count the continuations it sends, because the
 * symptom of the bug is a turn that happened, not a line of source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	DEFAULT_MAX_RECOVERIES,
	RequestLifecycleController,
	buildContinuationInstruction,
	decideContinuation,
	isOpenLifecycleTodo,
	readRequestWork,
} from "../harness/request-lifecycle.ts";

const todo = (id, status, subject = `task ${id}`) => ({
	id,
	status,
	subject,
});

test("an open todo of the request keeps the request open", () => {
	const view = readRequestWork({
		available: true,
		items: [todo(1, "completed"), todo(2, "pending")],
		ownItems: [todo(1, "completed"), todo(2, "pending")],
	});
	assert.equal(view.work, "unfinished");
	assert.equal(view.open.length, 1);
	assert.equal(view.open[0].id, 2);
});

test("the todos of an earlier request do not keep the request open", () => {
	const foreign = todo(9, "pending", "old work of another request");
	const view = readRequestWork({
		available: true,
		items: [todo(1, "completed"), foreign],
		ownItems: [todo(1, "completed")],
	});
	assert.equal(view.work, "complete");
	assert.equal(view.deferred.length, 1);
	assert.equal(view.deferred[0].id, 9);
});

test("a list that cannot be read is unknown, not complete", () => {
	const view = readRequestWork({
		available: false,
		items: null,
		reason: "the provider is not available",
	});
	assert.equal(view.work, "unknown");
	assert.equal(view.available, false);
	assert.match(view.reason, /not available/);
});

test("an empty list is unknown, not complete", () => {
	const view = readRequestWork({ available: true, items: [] });
	assert.equal(view.work, "unknown");
});

test("a required validation that has not passed keeps the request open", () => {
	const view = readRequestWork({
		available: true,
		items: [todo(1, "completed")],
		ownItems: [todo(1, "completed")],
		validationPending: () => true,
	});
	assert.equal(view.work, "unfinished");
	assert.match(view.reason, /validation/);
});

test("a deleted todo is not open work", () => {
	assert.equal(isOpenLifecycleTodo(todo(1, "deleted")), false);
	assert.equal(isOpenLifecycleTodo(todo(1, "completed")), false);
	assert.equal(isOpenLifecycleTodo(todo(1, "in_progress")), true);
	assert.equal(isOpenLifecycleTodo(todo(1, "pending")), true);
});

test("a todo with a status the provider does not know is not a completion", () => {
	// A blocked item is work that remains: a status that the lifecycle does
	// not know is never read as a finished item.
	assert.equal(isOpenLifecycleTodo(todo(1, "blocked")), true);
	const view = readRequestWork({
		available: true,
		items: [todo(1, "blocked")],
		ownItems: [todo(1, "blocked")],
	});
	assert.equal(view.work, "unfinished");
});

test("the instruction of a continuation names the open work and nothing else", () => {
	const view = readRequestWork({
		available: true,
		items: [todo(2, "pending", "write the tests")],
		ownItems: [todo(2, "pending", "write the tests")],
	});
	const instruction = buildContinuationInstruction(view);
	assert.match(instruction, /write the tests/);
	assert.match(instruction, /Do not start, resume or expand any other work/);
});

test("an unknown state is recovered a bounded number of times", () => {
	const view = readRequestWork({ available: false, items: null });
	const first = decideContinuation(view, { recoveries: 0 });
	assert.equal(first.action, "continue");
	const second = decideContinuation(view, {
		recoveries: DEFAULT_MAX_RECOVERIES,
	});
	assert.equal(second.action, "unverified");
});

test("the controller continues the work of the request exactly once", async () => {
	const sent = [];
	let items = [todo(1, "pending", "do the work")];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items,
			ownItems: items,
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
	});
	const first = await controller.settle();
	assert.equal(first.action, "continue");
	assert.equal(sent.length, 1);
	// The agent stops again without doing anything: the same open work must
	// not produce a second continuation.
	const second = await controller.settle();
	assert.equal(second.action, "idle");
	assert.equal(sent.length, 1);
});

test("the controller continues again when the open work changed", async () => {
	const sent = [];
	let items = [todo(1, "pending", "first"), todo(2, "pending", "second")];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items,
			ownItems: items,
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
	});
	await controller.settle();
	assert.equal(sent.length, 1);
	// The first item is done now: the request continues with the second.
	items = [todo(1, "completed", "first"), todo(2, "pending", "second")];
	const second = await controller.settle();
	assert.equal(second.action, "continue");
	assert.equal(sent.length, 2);
});

test("a finished request ends once and cancels its continuations", async () => {
	const cancelled = [];
	const sent = [];
	let items = [todo(1, "pending")];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items,
			ownItems: items,
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
		cancel: (generation) => {
			cancelled.push(generation);
		},
	});
	await controller.settle();
	items = [todo(1, "completed")];
	const decision = await controller.settle();
	assert.equal(decision.action, "idle");
	assert.equal(controller.terminal, true);
	assert.equal(cancelled.length, 1);
	// A producer that asks again gets the terminal answer and nothing is
	// sent.
	const again = await controller.settle();
	assert.equal(again.action, "idle");
	assert.equal(sent.length, 1);
});

test("a new request starts from a clean state", async () => {
	const sent = [];
	const items = [todo(1, "completed")];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items,
			ownItems: items,
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
	});
	await controller.settle();
	assert.equal(controller.terminal, true);
	controller.beginRequest(2);
	assert.equal(controller.terminal, false);
	const decision = await controller.settle();
	assert.equal(decision.action, "idle");
});

test("a request whose state is unknown is recovered once and then waits", async () => {
	const sent = [];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: false,
			items: null,
			reason: "the provider is not available",
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
	});
	const first = await controller.settle();
	assert.equal(first.action, "continue");
	const second = await controller.settle();
	assert.equal(second.action, "unverified");
	assert.equal(sent.length, 1);
});

test("the snapshot of a replaced request never ends the new request", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const sent = [];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => {
			// The read of the first request is in flight when the human
			// sends the next one.
			await gate;
			return {
				available: true,
				items: [todo(1, "completed")],
				ownItems: [todo(1, "completed")],
			};
		},
		dispatch: (instruction) => {
			sent.push(instruction);
		},
	});
	const settling = controller.settle();
	// The human sends a new request while the state of the old one is read.
	controller.beginRequest(2);
	release();
	const decision = await settling;
	assert.equal(decision.action, "idle");
	assert.equal(decision.work, "unknown");
	// The read of the old request ends nothing of the new one.
	assert.equal(controller.terminal, false);
	assert.equal(sent.length, 0);
	// The new request reads its own state and ends on its own terms.
	const own = await controller.settle();
	assert.equal(own.action, "idle");
	assert.equal(own.work, "complete");
	assert.equal(controller.terminal, true);
});

test("the view of a request is never the state of another request", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const controller = new RequestLifecycleController({
		readSnapshot: async () => {
			await gate;
			return {
				available: true,
				items: [todo(1, "completed")],
				ownItems: [todo(1, "completed")],
			};
		},
	});
	const reading = controller.readView();
	controller.beginRequest(2);
	release();
	const view = await reading;
	assert.equal(view.available, false);
	assert.equal(view.work, "unknown");
});

test("a validation that cannot be read never becomes a completion", () => {
	const view = readRequestWork({
		available: true,
		items: [todo(1, "completed")],
		ownItems: [todo(1, "completed")],
		validationPending: () => {
			throw new Error("the ledger is not readable");
		},
	});
	// The ledger is the source of the truth about the final tier: a read
	// that fails says that the state is unknown, not that it passed.
	assert.notEqual(view.work, "complete");
	assert.equal(view.work, "unknown");
	assert.match(view.reason, /validation/);
});

test("a ledger that is absent keeps the work of the request unknown", () => {
	const view = readRequestWork({
		available: true,
		items: [todo(1, "completed")],
		ownItems: [todo(1, "completed")],
		validationAvailability: "unknown",
	});
	assert.equal(view.work, "unknown");
	assert.match(view.reason, /validation/);
});

test("a readable ledger that has passed keeps the work complete", () => {
	const view = readRequestWork({
		available: true,
		items: [todo(1, "completed")],
		ownItems: [todo(1, "completed")],
		validationAvailability: "available",
		validationPending: () => false,
	});
	assert.equal(view.work, "complete");
});

test("the review work of the request keeps the request waiting", () => {
	const view = readRequestWork({
		available: true,
		items: [todo(1, "completed")],
		ownItems: [todo(1, "completed")],
		reviewPending: true,
	});
	// The implementation is done, but the review has not been materialized
	// yet: the request is not finished.
	assert.equal(view.work, "pending");
});

test("a continuation that was not sent may be sent again", async () => {
	const sent = [];
	let allow = false;
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items: [todo(1, "in_progress", "do the work")],
			ownItems: [todo(1, "in_progress", "do the work")],
		}),
		dispatch: (instruction) => {
			// The guard of the session refuses the first message.
			if (!allow) return false;
			sent.push(instruction);
			return true;
		},
	});
	const first = await controller.settle();
	assert.equal(first.action, "idle");
	assert.equal(sent.length, 0);
	// The message never reached the agent: the work stays continuable.
	allow = true;
	const second = await controller.settle();
	assert.equal(second.action, "continue");
	assert.equal(sent.length, 1);
});

test("the delivery of the continuation releases the queue entry", async () => {
	const sent = [];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items: [todo(1, "in_progress", "do the work")],
			ownItems: [todo(1, "in_progress", "do the work")],
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
	});
	const first = await controller.settle();
	assert.equal(first.action, "continue");
	assert.equal(sent.length, 1);
	// The queue entry is still outstanding: the same work is not continued
	// a second time before the run happened.
	const queued = await controller.settle();
	assert.equal(queued.action, "idle");
	assert.equal(sent.length, 1);
	// The run that carried the continuation happened: the work of the
	// request may be continued again.
	controller.acknowledgeDelivery();
	const again = await controller.settle();
	assert.equal(again.action, "continue");
	assert.equal(sent.length, 2);
});

test("a work that does not progress is continued a bounded number of times", async () => {
	const sent = [];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items: [todo(1, "in_progress", "do the work")],
			ownItems: [todo(1, "in_progress", "do the work")],
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
		maxContinuations: 3,
	});
	for (let round = 0; round < 3; round += 1) {
		const decision = await controller.settle();
		assert.equal(decision.action, "continue");
		// The run that carried the continuation happened, and the work did
		// not move.
		controller.acknowledgeDelivery();
	}
	assert.equal(sent.length, 3);
	// The fourth round pauses the request with a visible reason. The work
	// is unfinished, so the request does not end.
	const paused = await controller.settle();
	assert.equal(paused.action, "idle");
	assert.match(paused.reason, /without progress/);
	assert.equal(paused.work, "unfinished");
	assert.equal(controller.terminal, false);
	assert.equal(controller.stalled, true);
	assert.equal(sent.length, 3);
});

test("a work that does not progress never becomes completed work", async () => {
	// The defect of the second review: the exhaustion of the continuations
	// marked the request as finished, and the next read of the work
	// reported it as complete.
	const sent = [];
	const cancelled = [];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items: [todo(1, "in_progress", "do the work")],
			ownItems: [todo(1, "in_progress", "do the work")],
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
		cancel: (generation) => {
			cancelled.push(generation);
		},
		maxContinuations: 3,
	});
	for (let round = 0; round < 4; round += 1) {
		const decision = await controller.settle();
		if (round < 3) {
			assert.equal(decision.action, "continue");
			controller.acknowledgeDelivery();
			continue;
		}
		assert.equal(decision.action, "idle");
		assert.equal(decision.work, "unfinished");
	}
	// Every later read still reports the work as unfinished, and never as
	// complete.
	for (let round = 0; round < 3; round += 1) {
		const decision = await controller.settle();
		assert.equal(decision.action, "idle");
		assert.notEqual(decision.work, "complete");
		assert.equal(decision.work, "unfinished");
	}
	assert.equal(controller.terminal, false);
	// The request was not ended, so nothing was given back: the issues it
	// authorized and the countdowns it armed are still its own.
	assert.deepEqual(cancelled, []);
	assert.equal(sent.length, 3);
});

test("the pause of a request that did not progress can be lifted deliberately", async () => {
	const sent = [];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items: [todo(1, "in_progress", "do the work")],
			ownItems: [todo(1, "in_progress", "do the work")],
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
		maxContinuations: 2,
	});
	for (let round = 0; round < 2; round += 1) {
		await controller.settle();
		controller.acknowledgeDelivery();
	}
	const paused = await controller.settle();
	assert.equal(paused.action, "idle");
	assert.equal(controller.stalled, true);
	// The recovery does not need a new request of the human: the scope of
	// the request stays, and the request continues with the work that is
	// open.
	assert.equal(controller.resumeStalled(), true);
	assert.equal(controller.stalled, false);
	const again = await controller.settle();
	assert.equal(again.action, "continue");
	assert.equal(sent.length, 3);
});

test("a request that made progress leaves the pause on its own", async () => {
	const sent = [];
	let items = [todo(1, "in_progress", "do the work")];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items,
			ownItems: items,
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
		maxContinuations: 2,
	});
	for (let round = 0; round < 2; round += 1) {
		await controller.settle();
		controller.acknowledgeDelivery();
	}
	assert.equal((await controller.settle()).action, "idle");
	assert.equal(controller.stalled, true);
	// The work moved: the pause is lifted and the request continues.
	items = [todo(1, "in_progress", "do the work"), todo(2, "in_progress", "the next part")];
	const again = await controller.settle();
	assert.equal(again.action, "continue");
	assert.equal(controller.stalled, false);
	assert.equal(sent.length, 3);
});

test("a request that waits for its review sends no continuation and does not end", async () => {
	const sent = [];
	const controller = new RequestLifecycleController({
		readSnapshot: async () => ({
			available: true,
			items: [todo(1, "completed")],
			ownItems: [todo(1, "completed")],
			reviewPending: true,
		}),
		dispatch: (instruction) => {
			sent.push(instruction);
		},
	});
	const decision = await controller.settle();
	assert.equal(decision.action, "wait");
	assert.equal(sent.length, 0);
	assert.equal(controller.terminal, false);
});
