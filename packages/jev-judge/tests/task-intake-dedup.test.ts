/**
 * The reminder of the task list.
 *
 * The reminder asks the agent to record the work of a request. It is sent
 * once per request: a second reminder of the same work arrives as a new
 * request of the work, and the list of the session fills with the copies.
 */
import { test, expect } from "bun:test";
import { TaskIntakeController } from "../src/task-intake.js";

/** A controller that records the reminders it dispatches. */
function controllerWith(
	dispatched: string[],
	generation?: () => number | undefined,
): TaskIntakeController {
	return new TaskIntakeController({
		providers: [],
		dispatch: async (content: string) => {
			dispatched.push(content);
		},
		requestGeneration: generation,
	});
}

test("the reminder of a request is sent once", async () => {
	const dispatched: string[] = [];
	const controller = controllerWith(dispatched, () => 7);
	await controller.requestCapture("fix the phase of the workflow");
	await controller.requestCapture("fix the phase of the workflow");
	expect(dispatched.length).toBe(1);
});

test("a new request of the human is reminded again", async () => {
	const dispatched: string[] = [];
	let generation = 1;
	const controller = controllerWith(dispatched, () => generation);
	await controller.requestCapture("fix the phase of the workflow");
	generation = 2;
	await controller.requestCapture("fix the phase of the workflow");
	expect(dispatched.length).toBe(2);
});

test("another work of the same request is reminded", async () => {
	const dispatched: string[] = [];
	const controller = controllerWith(dispatched, () => 7);
	await controller.requestCapture("fix the phase of the workflow");
	await controller.requestCapture("and write the tests for it");
	expect(dispatched.length).toBe(2);
});

test("without a known request every reminder is sent", async () => {
	const dispatched: string[] = [];
	const controller = controllerWith(dispatched);
	await controller.requestCapture("fix the phase of the workflow");
	await controller.requestCapture("fix the phase of the workflow");
	expect(dispatched.length).toBe(2);
});

test("a reminder that could not be sent is sent again", async () => {
	const dispatched: string[] = [];
	let failures = 1;
	const controller = new TaskIntakeController({
		providers: [],
		dispatch: async (content: string) => {
			if (failures > 0) {
				failures -= 1;
				throw new Error("the channel is closed");
			}
			dispatched.push(content);
		},
		requestGeneration: () => 7,
	});

	// The first attempt fails: the request must keep its reminder.
	await expect(
		controller.requestCapture("fix the phase of the workflow"),
	).rejects.toThrow("the channel is closed");
	expect(dispatched.length).toBe(0);

	// The next attempt of the same request sends it.
	await controller.requestCapture("fix the phase of the workflow");
	expect(dispatched.length).toBe(1);

	// A reminder that was sent is not sent twice.
	await controller.requestCapture("fix the phase of the workflow");
	expect(dispatched.length).toBe(1);
});
