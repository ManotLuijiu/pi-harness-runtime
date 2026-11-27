/**
 * The consumption of an obsolete continuation.
 *
 * A continuation that was queued while a request ran can be consumed after
 * that request finished. It must not reach the provider then, and the run
 * that carried nothing else must not cost a provider call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	consumeObsoleteContinuation,
	hasHumanRequestAfter,
} from "../harness/obsolete-continuation.ts";

const resume = {
	role: "custom",
	customType: "harness:auto-resume",
	content: "continue the work",
	display: false,
	details: { reason: "pending-work", scope: "request", nonce: "n1" },
};

const userMessage = (text) => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: 1,
});

const assistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "the request is complete" }],
	timestamp: 2,
};

test("the obsolete continuation is removed from the messages", () => {
	const messages = [assistantMessage, resume];
	const consumption = consumeObsoleteContinuation({ messages, index: 1 });
	assert.equal(consumption.messages.length, 1);
	assert.equal(consumption.messages[0], assistantMessage);
});

test("a run that carried the continuation alone is aborted", () => {
	const consumption = consumeObsoleteContinuation({
		messages: [assistantMessage, resume],
		index: 1,
	});
	assert.equal(consumption.abort, true);
	assert.match(consumption.reason, /obsolete continuation only/);
});

test("a request of the human after the continuation keeps the run alive", () => {
	const messages = [assistantMessage, resume, userMessage("and now the docs")];
	const consumption = consumeObsoleteContinuation({ messages, index: 1 });
	assert.equal(consumption.abort, false);
	assert.match(consumption.reason, /request of the human/);
	assert.equal(consumption.messages.length, 2);
});

test("a message of the harness is not a request of the human", () => {
	const messages = [
		assistantMessage,
		resume,
		userMessage("The request of the user is already complete."),
	];
	const consumption = consumeObsoleteContinuation({
		messages,
		index: 1,
		isHarnessText: (text) => text.startsWith("The request of the user"),
	});
	assert.equal(consumption.abort, true);
});

test("a request of the human is found after the continuation", () => {
	const messages = [resume, userMessage("do the thing")];
	assert.equal(hasHumanRequestAfter(messages, 0), true);
	assert.equal(hasHumanRequestAfter([resume, assistantMessage], 0), false);
});

test("a continuation that is not there is not consumed", () => {
	const consumption = consumeObsoleteContinuation({
		messages: [assistantMessage],
		index: -1,
	});
	assert.equal(consumption.abort, false);
	assert.equal(consumption.messages.length, 1);
});
