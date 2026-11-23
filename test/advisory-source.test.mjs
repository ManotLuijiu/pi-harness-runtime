/**
 * The source of an advisory travels with the advisory.
 *
 * An advisory is an observation, and the harness has more than one source
 * of observations: the exploration guard and the bd handoff watcher. The
 * transport has to tell them apart, and it can only do that when the
 * source arrives with the message.
 *
 * The contract this suite protects:
 *
 * - the metadata of an advisory reaches the advisory transport,
 * - the source of the advisory decides the custom type of the message,
 * - an advisory does not consume the attempt budget of a task,
 * - the guards of a guarded dispatch still hold for an advisory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	TodoContinuationController,
	ADVISORY_SOURCE_BD_HANDOFF,
	ADVISORY_SOURCE_EXPLORATION_GUARD,
} from "../packages/jev-judge/dist/index.js";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * A todo provider with a single open item.
 */
function fakeProvider(items) {
	return {
		availability: async () => ({ available: true, provider: "fake" }),
		getSnapshot: async () => ({
			items: items.map((item) => ({ ...item })),
			sessionId: "session-advisory",
			revision: 1,
			createdAt: new Date(),
		}),
		getByStatus: async (status) =>
			items.filter((item) => item.status === status),
		getInProgress: async () =>
			items.filter((item) => item.status === "in_progress"),
		getPending: async () =>
			items.filter((item) => item.status === "pending"),
		getCompleted: async () =>
			items.filter((item) => item.status === "completed"),
		getReady: async () =>
			items.filter((item) => item.status === "pending"),
		getBlocked: async () => [],
		getHistory: async () => [],
	};
}

/**
 * A controller that records every message and every metadata block.
 */
function makeController(overrides = {}) {
	const advisories = [];
	const dispatched = [];
	const items = [{ id: 1, subject: "Ship the repair", status: "in_progress" }];
	const continuation = new TodoContinuationController(
		{
			sessionManager: {
				getSessionId: () => "session-advisory",
				getBranch: () => [],
			},
			isIdle: () => true,
			hasPendingMessages: () => false,
		},
		{
			dispatch: async (content) => {
				dispatched.push(content);
			},
			advisoryDispatch: async (content, meta) => {
				advisories.push({ content, meta });
			},
			todoProvider: fakeProvider(items),
			...overrides,
		},
	);
	return { continuation, advisories, dispatched, items };
}

/**
 * Let the guarded dispatch settle.
 */
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

test("the two sources have their own names", () => {
	assert.equal(ADVISORY_SOURCE_EXPLORATION_GUARD, "exploration-guard");
	assert.equal(ADVISORY_SOURCE_BD_HANDOFF, "bd-handoff");
	assert.notEqual(ADVISORY_SOURCE_EXPLORATION_GUARD, ADVISORY_SOURCE_BD_HANDOFF);
});

test("the metadata of an advisory reaches the transport", async () => {
	const { continuation, advisories } = makeController();
	const result = await continuation.dispatchAdvisory("a handoff waits", {
		meta: {
			reason: "bd-handoff",
			requestGeneration: "gen-7",
			source: ADVISORY_SOURCE_BD_HANDOFF,
		},
	});
	await settle();
	assert.equal(result.dispatched, true);
	assert.equal(advisories.length, 1);
	assert.equal(advisories[0].content, "a handoff waits");
	assert.equal(advisories[0].meta.source, ADVISORY_SOURCE_BD_HANDOFF);
	assert.equal(advisories[0].meta.reason, "bd-handoff");
	assert.equal(advisories[0].meta.requestGeneration, "gen-7");
});

test("an advisory without a source keeps the old source", async () => {
	const { continuation, advisories } = makeController();
	await continuation.dispatchAdvisory("a reminder", { meta: { reason: "read-loop" } });
	await settle();
	assert.equal(advisories.length, 1);
	// The source is undefined, so the transport falls back to the
	// exploration guard. The default is the source that existed first.
	assert.equal(advisories[0].meta.source, undefined);
});

test("an advisory does not consume the attempt budget of a task", async () => {
	const { continuation } = makeController();
	const before = continuation.getDiagnostics();
	await continuation.dispatchAdvisory("an observation", {
		meta: { source: ADVISORY_SOURCE_BD_HANDOFF },
	});
	await settle();
	const after = continuation.getDiagnostics();
	assert.equal(after.totalAttempts, before.totalAttempts);
	assert.equal(
		after.steerAttemptsForCurrentItem,
		before.steerAttemptsForCurrentItem,
	);
});

test("the guards of a guarded dispatch still hold for an advisory", async () => {
	const { continuation, advisories } = makeController({
		// A busy session never receives an advisory.
	});
	continuation.explicitPause();
	const result = await continuation.dispatchAdvisory("a reminder", {
		meta: { source: ADVISORY_SOURCE_EXPLORATION_GUARD },
	});
	await settle();
	assert.equal(result.dispatched, false);
	assert.equal(advisories.length, 0);
});

test("the transport of the harness picks the custom type by the source", () => {
	// The harness selects the custom type of the message from the source
	// of the advisory: a handoff of the store is not an exploration.
	assert.ok(
		indexSource.includes("ADVISORY_SOURCE_BD_HANDOFF"),
		"the harness names the source of a handoff",
	);
	assert.ok(
		indexSource.includes('"harness:bd-handoff"'),
		"the harness has a custom type for the traffic of the store",
	);
	assert.ok(
		indexSource.includes('"harness:exploration-guard"'),
		"the traffic of the exploration keeps its own custom type",
	);
	const selection = indexSource.indexOf(
		'source === ADVISORY_SOURCE_BD_HANDOFF',
	);
	assert.ok(selection > 0, "the harness selects the custom type by the source");
	// The default is the exploration guard: the source of the traffic that
	// existed before the field did.
	assert.ok(
		indexSource.includes(
			"meta?.source ?? ADVISORY_SOURCE_EXPLORATION_GUARD",
		),
		"the default source is the exploration guard",
	);
});
