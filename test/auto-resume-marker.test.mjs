/**
 * The marker of an automatic resume.
 *
 * The resume is a message of the harness, not a message of the human. It
 * carries a marker, so the harness can recognize a resume that is consumed
 * after the request finished and neutralize it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	HARNESS_AUTO_RESUME_TYPE,
	autoResumeDetails,
	buildAutoResumeMessage,
	findAutoResumeIndex,
	isAutoResumeMessage,
	NEUTRALIZED_RESUME_TEXT,
	neutralizeAutoResume,
} from "../harness/auto-resume-marker.ts";

const userMessage = {
	role: "user",
	content: [{ type: "text", text: "do the thing" }],
	timestamp: 1,
};

const assistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "done" }],
	timestamp: 2,
};

test("a resume of the harness carries the marker", () => {
	const message = buildAutoResumeMessage({
		content: "resume",
		reason: "provider-overload",
		scope: "request",
		nonce: "n-1",
	});
	assert.equal(message.role, "custom");
	assert.equal(message.customType, HARNESS_AUTO_RESUME_TYPE);
	assert.equal(message.display, false);
	assert.equal(message.content, "resume");
	assert.equal(isAutoResumeMessage(message), true);
});

test("only the explicit marker is a resume", () => {
	assert.equal(
		isAutoResumeMessage({ role: "user", content: "resume" }),
		false,
		"a message of the human that says resume is ordinary text",
	);
	assert.equal(
		isAutoResumeMessage({
			role: "custom",
			customType: "something-else",
			content: "resume",
		}),
		false,
	);
	assert.equal(isAutoResumeMessage(null), false);
	assert.equal(isAutoResumeMessage("resume"), false);
});

test("the details of a resume say why it was queued", () => {
	const message = buildAutoResumeMessage({
		content: "resume",
		reason: "output-limit",
		scope: "turn",
		nonce: "n-2",
	});
	assert.deepEqual(autoResumeDetails(message), {
		reason: "output-limit",
		scope: "turn",
		nonce: "n-2",
	});
});

test("a resume without usable details is still a resume", () => {
	const message = { role: "custom", customType: HARNESS_AUTO_RESUME_TYPE };
	assert.equal(isAutoResumeMessage(message), true);
	assert.equal(autoResumeDetails(message), undefined);
});

test("the scope of a resume without a scope is the request", () => {
	const message = {
		role: "custom",
		customType: HARNESS_AUTO_RESUME_TYPE,
		details: { reason: "post-compact" },
	};
	assert.equal(autoResumeDetails(message)?.scope, "request");
});

test("the last resume is the one that is consumed", () => {
	const first = buildAutoResumeMessage({
		content: "resume",
		reason: "a",
		scope: "request",
		nonce: "n-1",
	});
	const second = buildAutoResumeMessage({
		content: "resume",
		reason: "b",
		scope: "request",
		nonce: "n-2",
	});
	assert.equal(findAutoResumeIndex([userMessage, first, assistantMessage, second]), 3);
	assert.equal(findAutoResumeIndex([userMessage, assistantMessage]), -1);
	assert.equal(findAutoResumeIndex([]), -1);
	assert.equal(findAutoResumeIndex(null), -1);
});

test("the neutralization replaces the resume and keeps the ending valid", () => {
	const resume = buildAutoResumeMessage({
		content: "resume",
		reason: "post-compact",
		scope: "request",
		nonce: "n-1",
	});
	const messages = [userMessage, assistantMessage, resume];
	const result = neutralizeAutoResume(messages, 2);
	assert.equal(result.length, 3);
	// The message that is not the resume is not touched.
	assert.equal(result[0], userMessage);
	assert.equal(result[1], assistantMessage);
	// The resume is gone and the array ends with a user message, so the
	// call of the provider stays well formed.
	const last = result[2];
	assert.equal(last.role, "user");
	assert.match(last.content[0].text, /already complete/);
	assert.equal(last.content[0].text, NEUTRALIZED_RESUME_TEXT);
});

test("the neutralization of an index outside the array changes nothing", () => {
	const messages = [userMessage];
	assert.deepEqual(neutralizeAutoResume(messages, 5), messages);
	assert.deepEqual(neutralizeAutoResume(messages, -1), messages);
	assert.deepEqual(neutralizeAutoResume(null, 0), []);
});

test("the neutralization does not change the array that it received", () => {
	const messages = [userMessage];
	neutralizeAutoResume(messages, 0);
	assert.equal(messages[0], userMessage);
});
