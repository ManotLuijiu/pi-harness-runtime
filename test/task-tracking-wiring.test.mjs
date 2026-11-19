/**
 * The wiring of the task list and of the reminder.
 *
 * The behaviour of the pieces is tested in their own suites: the decision
 * of the reminder, the counters of the activity, the status of the task
 * list and the scope of a request.
 *
 * This suite checks that the harness wires them the way the contract asks:
 *
 * - the reminder reads the todos of the request that is running, so an
 *   old task of an earlier request cannot silence it,
 * - the status of the task list is read through the guarded refresh of
 *   the controller, so a late read cannot replace a newer state,
 * - the row of the footer forgets the session and the request that ended,
 * - the reminder checks the request and the session again when its
 *   asynchronous read of the task list returns.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const reminderSource = readFileSync(
	new URL("../harness/task-memory-reminder.ts", import.meta.url),
	"utf8",
);
const trackerSource = readFileSync(
	new URL("../harness/jev-request-scope.ts", import.meta.url),
	"utf8",
);

test("the reminder reads the todos of the request that is running", () => {
	assert.match(indexSource, /todoReader = async \(ctx: unknown\) => \{/);
	// The list of the session is filtered through the scope of the
	// request: an old task of an earlier request is not the work of this
	// one.
	assert.match(
		indexSource,
		/itemsOfRequest\(\s*snapshot\.todos[\s\S]*?scope,/,
		"the reader of the reminder filters the list through the scope",
	);
	assert.match(
		trackerSource,
		/async scope\(\): Promise<JevRequestScope \| null>/,
		"the tracker hands out the scope of the running request",
	);
});

test("the status of the task list is read through the guarded refresh", () => {
	assert.match(
		indexSource,
		/await taskTracking\.refresh\(async \(\) => \{/,
		"the status reads through the controller",
	);
	assert.doesNotMatch(
		indexSource,
		/taskTracking\.stateChanged\(/,
		"the status never writes around the fence of the controller",
	);
});

test("the row of the footer forgets the request and the session that ended", () => {
	const resets = indexSource.match(/taskTracking\.reset\(\)/g) ?? [];
	assert.ok(resets.length >= 2, "the row is reset for a request and for a session");
	assert.match(
		indexSource,
		/function beginHumanRequest\(\): void \{[\s\S]*?taskTracking\.reset\(\)/,
		"a new request of the human resets the row",
	);
	assert.match(
		indexSource,
		/pi\.on\("session_start", \(\) => \{\s*taskTracking\.reset\(\)/,
		"a new session resets the row",
	);
});

test("the validation of the work is read from the ledger", () => {
	assert.match(
		indexSource,
		/sharedState\.validationReader = async \(todos: TwoPhaseTodoLike\[\]\) => \{/,
		"the reader of the validations is published",
	);
	assert.match(
		indexSource,
		/validationPending:[\s\S]*?pendingFinalTier > 0/,
		"the row names the validation that has not passed",
	);
	assert.match(
		indexSource,
		/validationFailed:[\s\S]*?failedFinalTier > 0/,
		"the row names the validation that failed",
	);
});

test("the readers of the runtime name the failure of a read", () => {
	// The provider answers with an empty list when it could not read the
	// list, so the readers must look at the error of the provider.
	assert.match(
		indexSource,
		/const failure = todoReadFailure\(provider\.lastError\);/,
		"the reader of the phase of the work names the failure",
	);
	assert.match(
		indexSource,
		/if \(todoReadFailure\(controller\.lastError\)\) return null;/,
		"the reader of the scope names the failure",
	);
});

test("the reminder checks the request and the session when its read returns", () => {
	assert.match(
		reminderSource,
		/if \(options\.requestGeneration\(\) !== generation\) return undefined;/,
		"a reminder of a request that ended is dropped",
	);
	assert.match(
		reminderSource,
		/if \(!reminder\.isCurrentRequest\(generation\)\) return undefined;/,
		"a reminder of a session that ended is dropped",
	);
});
