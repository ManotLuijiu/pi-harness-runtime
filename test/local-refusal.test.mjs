/**
 * The refusal of a deletion of a temporary path.
 *
 * The harness refuses the deletion of a temporary path on its own: the
 * answer is always "No", so neither the judge nor the human is asked. The
 * refusal is a decision of the harness and not an answer of the human, so
 * the message that tells the agent the answer carries a marker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	buildLocalRefusalMessage,
	isLocalRefusalMessage,
	LOCAL_REFUSAL_ANSWER,
	HARNESS_LOCAL_REFUSAL_TYPE,
} from "../harness/local-refusal-marker.ts";
import { classifyTemporaryDeletionRequest } from "../packages/notification/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(needle, before = 0, after = 1200) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

test("the deletion of a temporary path is refused without the judge", () => {
	const verdict = classifyTemporaryDeletionRequest(
		"May I delete /tmp/pi-harness.log?",
	);
	assert.equal(verdict.applies, true);
});

test("a serious question waits for the human", () => {
	for (const question of [
		"May I clean up /tmp?",
		"May I delete /etc/pi-harness.conf?",
		"May I delete /tmp/credentials.json?",
		"May I delete /tmp/pi-harness.log and deploy the build?",
	]) {
		const verdict = classifyTemporaryDeletionRequest(question);
		assert.equal(
			verdict.applies,
			false,
			`${question} waits for the human`,
		);
	}
});

test("the refusal is a decision of the harness and not an answer of the human", () => {
	const message = buildLocalRefusalMessage({
		reason: "temporary-path-deletion",
		rule: "temporary-path-deletion-refusal",
	});
	assert.equal(message.customType, HARNESS_LOCAL_REFUSAL_TYPE);
	assert.equal(message.content, "No");
	assert.equal(message.content, LOCAL_REFUSAL_ANSWER);
	assert.equal(isLocalRefusalMessage(message), true);
	// A message of the human that says "No" carries no marker.
	assert.equal(isLocalRefusalMessage({ role: "user", content: "No" }), false);
});

test("the refusal closes the question with the answer 'No'", () => {
	const region = around("function refuseTemporaryDeletion(", 0, 3200);
	assert.ok(region, "the refusal of the harness is registered");
	assert.match(
		region,
		/controller\?\.resolveLocally\?\.\(\s*question\.requestId,\s*"no",/,
		"the question is closed with the answer 'No'",
	);
	assert.match(
		region,
		/buildLocalRefusalMessage\(\{/,
		"the agent is told the answer with a marked message",
	);
});

test("the refusal never asks the judge and never notifies a human", () => {
	const region = around("function refuseTemporaryDeletion(", 0, 3200);
	assert.doesNotMatch(
		region,
		/evaluatePendingQuestion|jevJudge|judge\.decide/,
		"the refusal does not spend a token",
	);
	assert.doesNotMatch(
		region,
		/notifyWithApproval|notifyWithButtons|_nc\?\.notify\(/,
		"the refusal does not interrupt the human",
	);
});

test("the refusal pauses the unfinished work", () => {
	const region = around("function refuseTemporaryDeletion(", 0, 3200);
	assert.match(
		region,
		/explicitPause\?\.\(\)/,
		"a refusal never continues the work on its own",
	);
});

test("the question is refused before it is notified", () => {
	const region = around("const temporaryDeletion =", 0, 1200);
	assert.ok(region, "the refusal is decided in the handler of the question");
	assert.match(
		region,
		/if \(temporaryDeletion\.applies\) \{[\s\S]*?refuseTemporaryDeletion\(result, questionKind\);\s*return;/,
		"the refused question never reaches the notification",
	);
});
