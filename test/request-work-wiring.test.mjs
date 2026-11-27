/**
 * The wiring of the continuation of the request.
 *
 * The continuation of the request is a message of the harness, and it goes
 * through the guarded path of the controller of the todos: a pause, a
 * question of the human, a busy session, an exhausted budget and a
 * duplicate entry all stop it. The wiring is what proves that the
 * continuation does not bypass those guards, and that the request owns the
 * cleanup of what it queued.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");
const controllerSource = readFileSync(
	join(here, "..", "packages", "jev-judge", "src", "continuation-controller.ts"),
	"utf8",
);

/** The source around a place, with a window before and after it. */
function around(source, needle, before = 0, after = 1200) {
	const at = source.indexOf(needle);
	if (at === -1) return "";
	return source.slice(Math.max(0, at - before), at + after);
}

test("the continuation of the request goes through the guarded path", () => {
	const region = around(indexSource, "async function dispatchRequestContinuation(", 0, 3000);
	assert.ok(region, "the guarded continuation of the request is registered");
	assert.match(
		region,
		/controller\.decide\(\{ candidateIds \}\)/,
		"the eligible item is asked from the controller of the todos",
	);
	assert.match(
		region,
		/controller\.dispatchAdvisory\(/,
		"the continuation is sent through the guarded dispatch",
	);
	assert.match(
		region,
		/open: \[item\],/,
		"the message names the eligible item and not every pending item",
	);
});

test("the lifecycle of the request does not queue a resume of its own", () => {
	const region = around(indexSource, "requestLifecycle = new RequestLifecycleController(");
	assert.ok(region, "the lifecycle of the request is registered");
	assert.match(
		region,
		/dispatch: \(instruction, decision\) =>/,
		"the dispatch of the lifecycle is the guarded one",
	);
	assert.doesNotMatch(
		region,
		/queueAutoResume\("pending-work"/,
		"the lifecycle does not send the continuation around the guards",
	);
});

test("the cancellation of the request owns what it queued", () => {
	const region = around(indexSource, "cancel: (generation) => {");
	assert.ok(region, "the request cancels its own continuations");
	assert.match(
		region,
		/controller\?\.clearQueue\?\.\(\)/,
		"the queue of the controller is cleared",
	);
	assert.match(
		region,
		/controller\?\.releaseContinuationGuard\?\.\(/,
		"the guard of the controller is released",
	);
	assert.match(
		region,
		/pendingActions\.remove\(repetitionGuardActionId\(generation\)\)/,
		"the entry of the repetition guard of the request is removed",
	);
});

test("the delivery of the continuation is acknowledged", () => {
	const region = around(indexSource, 'msg.customType === "harness:request-work"');
	assert.ok(region, "the delivery of the continuation is observed");
	assert.match(
		region,
		/acknowledgeRequestContinuation\(msg\)/,
		"the acknowledgement is the helper of the lifecycle",
	);
	const helper = around(indexSource, "function acknowledgeRequestContinuation(");
	assert.match(
		helper,
		/requestLifecycle\?\.acknowledgeDelivery\(generation\)/,
		"the lifecycle releases the queue entry of the continuation",
	);
});

test("the controller of the todos can narrow the candidates of a decision", () => {
	const region = around(
		controllerSource,
		"async decide(options?: { candidateIds?: readonly number[] })",
		0,
		4000,
	);
	assert.ok(region, "the decision of the controller accepts the candidates");
	assert.match(
		region,
		/this\.eligibleItems\(\s*inProgress,/,
		"the in-progress items are narrowed to the candidates",
	);
	assert.match(
		region,
		/this\.eligibleItems\(ready, allItems, candidates\)/,
		"the ready items are narrowed to the candidates",
	);
});
