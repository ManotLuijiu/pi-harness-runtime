/**
 * The boundary of a request.
 *
 * The scope of a request tells the work of the request apart from the work
 * that was done before it. A request begins where the human asks for
 * something, and every path that carries the human into Pi is such a
 * place.
 *
 * The paths of a channel reach Pi as messages of the harness, so the
 * `input` event of Pi cannot tell them apart from the traffic of the
 * harness itself. A path that forgets the boundary leaves the scope of the
 * previous request in place, and the new request inherits the completion
 * of the old one: a question of the new request is a question about work
 * that was already done, and it is dropped without a notification.
 *
 * This suite checks the wiring: the scope is begun in one place only, and
 * every path of the human calls it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/** The source around a place, with a window before and after it. */
function around(needle, before = 0, after = 900) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

test("the scope of a request is begun in one place only", () => {
	const calls = indexSource.match(/requestScopeTracker\.begin\(\)/g) ?? [];
	assert.equal(
		calls.length,
		1,
		"the scope is begun by the helper, so a path cannot forget the rule",
	);
	assert.match(
		indexSource,
		/function beginHumanRequest\(\): void \{\n\trequestScopeTracker\.begin\(\);\n\}/,
		"the helper begins the scope of the request",
	);
});

test("the interactive input of the human begins a request", () => {
	const region = around('pi.on("input"');
	assert.ok(region, "the input event of Pi is registered");
	assert.match(region, /beginHumanRequest\(\)/, "the input begins a request");
	assert.match(
		region,
		/if \(event\.source === "extension"\) return;/,
		"the traffic of the harness begins nothing",
	);
});

test("a message of Telegram begins a request", () => {
	const region = around('logToFile("[TelegramInbound]"');
	assert.ok(region, "the inbound of Telegram is registered");
	assert.match(region, /beginHumanRequest\(\)/, "the message begins a request");
	assert.ok(
		region.indexOf("beginHumanRequest()") < region.indexOf("sendUserMessage(text"),
		"the scope begins before the message reaches Pi",
	);
});

test("a voice prompt of LINE begins a request", () => {
	const region = around('cmd.type === "voice-prompt"');
	assert.ok(region, "the voice queue of LINE is registered");
	assert.match(region, /beginHumanRequest\(\)/, "the voice prompt begins a request");
	assert.ok(
		region.indexOf("beginHumanRequest()") < region.indexOf("sendUserMessage(cmd.text"),
		"the scope begins before the prompt reaches Pi",
	);
});

test("the decision of the human on a Codex task begins a request", () => {
	// The window reaches before the message, so the order of the two is
	// visible.
	const approved = around("`Human approved. Proceed to implement:", 600);
	assert.ok(approved, "the approval of the human is forwarded to Pi");
	assert.match(approved, /beginHumanRequest\(\)/, "the approval begins a request");
	assert.ok(
		approved.indexOf("beginHumanRequest()") <
			approved.indexOf("`Human approved. Proceed to implement:"),
		"the scope begins before the message reaches Pi",
	);

	const review = around('"Human requests a review of the implementation."', 600);
	assert.ok(review, "the review request of the human is forwarded to Pi");
	assert.match(review, /beginHumanRequest\(\)/, "the review request begins a request");
});

test("the decision of the human on a proposal begins a request", () => {
	// The human answered a proposal of the harness, and the harness asks
	// the agent to carry it out. The answer of the human reaches Pi as a
	// message of the harness, so the boundary has to be here.
	const region = around("mod.buildToolingImplementationPrompt(context, workspaceRoot)", 400);
	assert.ok(region, "the proposal of the tooling is carried out");
	assert.match(region, /beginHumanRequest\(\)/, "the decision begins a request");
	assert.ok(
		region.indexOf("beginHumanRequest()") <
			region.indexOf("mod.buildToolingImplementationPrompt"),
		"the scope begins before the prompt reaches Pi",
	);
});

test("the answer of the human to a question continues the request", () => {
	// The answer of the human to a question of Jev is not a new request:
	// it continues the request that is running. A new scope would hide the
	// work of that request.
	const region = around('const message = answer === "yes" ? "yes" : "not yet";', 0, 400);
	assert.ok(region, "the answer of the human is forwarded to Pi");
	assert.ok(
		!region.includes("beginHumanRequest()"),
		"the answer continues the request that is running",
	);
});

test("the scope belongs to the session that is running", () => {
	// The todos of a session that ended are its history: the scope of that
	// session must not decide the work of the next one.
	const resets = indexSource.match(/requestScopeTracker\.reset\(\)/g) ?? [];
	assert.ok(resets.length >= 2, "the scope is dropped when a session starts and ends");
});

test("the messages of the harness begin no request", () => {
	// The harness continues the work of the request that is running: its
	// own messages do not open a new scope.
	for (const needle of [
		"pi.sendUserMessage(message, { deliverAs: \"steer\" })",
		"pi.sendUserMessage(instruction, { deliverAs: \"steer\" })",
	]) {
		const region = around(needle, 0, 120);
		assert.ok(
			!region.includes("beginHumanRequest()"),
			`the harness message does not begin a request: ${needle}`,
		);
	}
});
