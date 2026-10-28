import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { endPendingWait, releaseWait } from "../harness/pending-wait.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * The harness state of a wait, with the pieces the release touches.
 *
 * The state is what the judge reads: the question it would decide about
 * and the wait that makes the judge ask at all.
 */
function createWait() {
	const state = {
		question: { requestId: "q-old", state: "pending" },
		waitingSince: new Date(),
		stoppedCountdowns: 0,
		clearedStatuses: 0,
		transitions: [],
	};

	return {
		state,
		owner: {
			currentQuestion: () => state.question,
			expireQuestion: (requestId, reason) => {
				if (!state.question || state.question.requestId !== requestId) return false;
				state.question = null;
				state.expired = { requestId, reason };
				return true;
			},
			clearWaitState: () => {
				state.waitingSince = null;
			},
			stopCountdown: () => {
				state.stoppedCountdowns += 1;
			},
			clearStatus: () => {
				state.clearedStatuses += 1;
			},
			logTransition: (requestId, outcome, reason) => {
				state.transitions.push({ requestId, outcome, reason });
			},
		},
	};
}

/**
 * The guard of the fallback poll of the judge.
 *
 * The judge is asked about a question only while a wait is running. The
 * guard is the one of index.ts.
 */
function pollAsksTheJudge(wait) {
	return Boolean(wait.state.waitingSince);
}

test("a switch of the session ends the wait of the old session", () => {
	const wait = createWait();

	endPendingWait("session-switched", wait.owner);

	assert.equal(wait.state.waitingSince, null, "the wait of the old session is over");
	assert.equal(wait.state.question, null, "the old question cannot be decided about any more");
	assert.equal(wait.state.stoppedCountdowns, 1, "the countdown of the old session is stopped");
	assert.equal(wait.state.clearedStatuses, 1, "the row of the old wait is cleared");
	assert.deepEqual(
		wait.state.transitions,
		[{ requestId: "q-old", outcome: "expired", reason: "session-switched" }],
		"the transition of the old question names the way out",
	);
	assert.equal(
		pollAsksTheJudge(wait),
		false,
		"the fallback poll asks nothing about the old question",
	);
});

test("the question is closed before the wait is cleared", () => {
	const order = [];
	const wait = createWait();
	const owner = {
		...wait.owner,
		expireQuestion: (requestId, reason) => {
			order.push("expire");
			return wait.owner.expireQuestion(requestId, reason);
		},
		clearWaitState: () => {
			order.push("clear");
			wait.owner.clearWaitState();
		},
	};

	endPendingWait("session-switched", owner);

	assert.deepEqual(order, ["expire", "clear"], "nothing can decide about the question in between");
});

test("a question that is not pending is not closed again", () => {
	const wait = createWait();
	wait.state.question = { requestId: "q-old", state: "answered" };

	endPendingWait("session-switched", wait.owner);

	assert.deepEqual(wait.state.transitions, [], "an answered question has no transition");
	assert.equal(wait.state.question.state, "answered", "the answered question is left alone");
	assert.equal(wait.state.waitingSince, null, "the wait is over anyway");
});

test("the release works without a question", () => {
	const wait = createWait();
	wait.state.question = null;

	endPendingWait("session-switched", wait.owner);

	assert.equal(wait.state.waitingSince, null);
	assert.equal(wait.state.stoppedCountdowns, 1);
	assert.equal(wait.state.clearedStatuses, 1);
	assert.deepEqual(wait.state.transitions, []);
});

test("a question that cannot be closed is logged as closed", () => {
	const wait = createWait();
	const owner = {
		...wait.owner,
		expireQuestion: () => false,
	};

	endPendingWait("session-switched", owner);

	assert.deepEqual(
		wait.state.transitions,
		[{ requestId: "q-old", outcome: "closed", reason: "session-switched" }],
		"a question that could not be expired is recorded as closed",
	);
});

test("the session switch and the shutdown end the wait in the harness", () => {
	const switchHandler = indexSource.match(
		/if \(_piSessionId && _piSessionId !== sessionId\) \{[^}]*endWait\("session-switched"\);/,
	);
	assert.ok(switchHandler, "a changed session ends the wait of the old session");

	const shutdown = indexSource.indexOf('pi.on("session_shutdown"');
	assert.notEqual(shutdown, -1, "the shutdown of the session exists");
	assert.ok(
		indexSource.slice(shutdown, shutdown + 800).includes('endWait("session-ended")'),
		"the shutdown of the session ends the wait too",
	);
});

test("a release clears the wait state and stops the countdown", () => {
	let cleared = 0;
	let stopped = 0;

	releaseWait({
		clearWaitState: () => {
			cleared += 1;
		},
		stopCountdown: () => {
			stopped += 1;
		},
	});

	assert.equal(cleared, 1, "the wait state is cleared");
	assert.equal(stopped, 1, "the countdown of the wait is stopped");
});

test("a release that throws does not leave the countdown running", () => {
	let stopped = 0;

	assert.throws(() =>
		releaseWait({
			clearWaitState: () => {
				throw new Error("the state is gone");
			},
			stopCountdown: () => {
				stopped += 1;
			},
		}),
	);
	assert.equal(stopped, 0, "the countdown is not stopped after a failed release");
});

test("the wait state is cleared in one place only", () => {
	// Every way out of a wait goes through one release, so a way out that
	// forgets the countdown cannot be added without failing this check.
	const clears = [...indexSource.matchAll(/(?<![.\w])waitingForUserSince = null;/g)];
	assert.equal(clears.length, 1, "the wait state is cleared in one place only");

	const stateFn = indexSource.match(/function clearWaitState\(\): void \{[^}]*\}/);
	assert.ok(stateFn, "the shared release of the wait state exists");
	assert.ok(
		stateFn[0].includes("waitingForUserSince = null"),
		"the release of the wait state clears the wait",
	);

	const releaseFn = indexSource.match(/function clearWait\(\): void \{[\s\S]*?\n\t\t\}/);
	assert.ok(releaseFn, "the release of a wait exists");
	assert.ok(
		releaseFn[0].includes("releaseWait"),
		"the release of a wait goes through the shared release",
	);
	assert.ok(
		releaseFn[0].includes("stopCountdown"),
		"the release of a wait stops the countdown with the wait state",
	);
});

test("every way out of a wait goes through the shared release", () => {
	// The countdown is stopped by hand in three places, and they are the
	// ones that keep the wait: the countdown gives up and the fallback
	// poll takes over. The wait state is cleared in one place only, so
	// none of them clears it.
	const stops = [...indexSource.matchAll(/pendingCountdown\.stop\(\);/g)];
	assert.ok(stops.length >= 1, "the countdown is stopped somewhere");
	for (const stop of stops) {
		const around = indexSource.slice(Math.max(0, stop.index - 300), stop.index + 300);
		if (around.includes("clearWaitState")) continue;
		assert.ok(
			!/waitingForUserSince = null;/.test(around),
			"a countdown that is stopped by hand does not clear the wait state",
		);
	}
});

test("the wait of a session that is gone is never decided about", () => {
	// The judge reads the wait state and the question of the controller.
	// The release of a wait clears both, so the judge has nothing to
	// decide about after a switch of the session.
	assert.match(
		indexSource,
		/if \(!waitingForUserSince\) return;/,
		"the judge is asked only while a wait is running",
	);
	assert.match(
		indexSource,
		/function clearWaitState\(\): void \{\s*\n\s*waitingForUserSince = null;/,
		"the release of a wait clears the wait state",
	);
	assert.match(
		indexSource,
		/expireQuestion: \(requestId: string, why: string\) =>\s*\n\s*sharedState\.pqController\?\.expireByTimeout\?\.\(requestId, why\)/,
		"the release of a wait closes the question",
	);
});
