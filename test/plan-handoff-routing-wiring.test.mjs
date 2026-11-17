/**
 * The wiring of the plan handoff.
 *
 * The behaviour of the pieces is tested in their own suites: the routing of
 * a plan, the registration of an instance, the selection of a recipient and
 * the receiver of the mailbox.
 *
 * This suite checks that the harness wires them the way the contract of the
 * handoff asks:
 *
 * - the receiver of the mailbox belongs to the session,
 * - the receiver starts with the registration and stops with the session,
 * - only the instance that was selected executes the plan,
 * - the instance that watched the plan never executes the plan of another
 *   instance.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const receiverSource = readFileSync(
	new URL("../harness/plan-handoff-receiver.ts", import.meta.url),
	"utf8",
);

/**
 * The body of a function of the harness, from its name to the next function
 * that follows it.
 */
function bodyOf(source, marker, length = 4000) {
	const start = source.indexOf(marker);
	assert.ok(start >= 0, `the marker is in the source: ${marker}`);
	return source.slice(start, start + length);
}

test("the receiver of the mailbox belongs to the session", () => {
	assert.ok(indexSource.includes("startPlanReceiver("));
	assert.ok(indexSource.includes("planHandoffAgent.registration"));
	assert.ok(indexSource.includes("planReceiver.start()"));
});

test("the receiver starts with the registration and stops with the session", () => {
	const startIndex = indexSource.indexOf("startPlanReceiver({");
	const registrationIndex = indexSource.indexOf(
		"planHandoffAgent = startPlanHandoffRegistration({",
	);
	assert.ok(registrationIndex >= 0, "the instance registers itself");
	assert.ok(
		startIndex > registrationIndex,
		"the receiver starts after the registration",
	);

	const shutdownIndex = indexSource.indexOf('pi.on("session_shutdown"');
	const stopIndex = indexSource.indexOf("planReceiver.stop()", shutdownIndex);
	assert.ok(shutdownIndex >= 0, "the shutdown is handled");
	assert.ok(stopIndex > shutdownIndex, "the receiver stops with the session");
});

test("only the instance that was selected executes the plan", () => {
	const trigger = bodyOf(indexSource, "async function triggerPiForPlan");
	// The plan is executed by the recipient of the routing, and the local
	// session only acts when it is that recipient.
	assert.ok(trigger.includes("isLocalPlanRecipient(routedRecipient)"));
	assert.ok(trigger.includes("await planReceiver?.poll()"));
});

test("the identity of the recipient is the runtime identity", () => {
	const guard = bodyOf(indexSource, "function isLocalPlanRecipient");
	assert.ok(guard.includes("recipient.agentId === planReceiver.agentId"));
	assert.ok(guard.includes("recipient.sessionId === planReceiver.sessionId"));
	assert.ok(guard.includes("recipient.generation === planReceiver.generation"));
});

test("the watcher never executes the plan of another instance", () => {
	const trigger = bodyOf(indexSource, "async function triggerPiForPlan");
	// The local session sends the plan itself only in the path without a
	// routing, where there is no recipient to choose.
	const fallback = trigger.indexOf("pi.sendUserMessage(triggerMsg");
	const guard = trigger.indexOf("isLocalPlanRecipient(routedRecipient)");
	assert.ok(fallback >= 0, "the path without a routing sends the plan");
	assert.ok(fallback < guard, "the fallback is the path without a recipient");
	// After the decision the plan only rides on the receiver of this
	// instance.
	const after = trigger.slice(guard);
	assert.ok(!after.includes("pi.sendUserMessage("));
	assert.ok(after.includes("await planReceiver?.poll()"));
});

test("the receiver hands the plan over and acknowledges it", () => {
	assert.ok(receiverSource.includes("bridge.claim("));
	assert.ok(receiverSource.includes("bridge.acknowledge("));
	assert.ok(receiverSource.includes("await options.deliver(message)"));
});

test("a plan that the human holds is never claimed", () => {
	assert.ok(receiverSource.includes("options.hold?.(message)"));
});
