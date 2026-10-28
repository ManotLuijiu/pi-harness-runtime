import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	PendingQuestionCountdown,
	decisionDeadlineAt,
	formatRemainingTime,
} from "../harness/pending-countdown.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * A clock with the timers of the countdown.
 *
 * The clock only moves when the test moves it, and a timer fires as often as
 * its interval allows - exactly like a real interval timer. The clock also
 * counts the timers it hands out, so a test can prove that a timer was
 * released and that no timer was registered outside the injected API.
 */
function createClock(start = 1_700_000_000_000) {
	let current = start;
	let nextId = 1;
	const timers = new Map();
	const started = [];
	let startCalls = 0;
	let stopCalls = 0;

	return {
		now: () => current,
		setInterval: (callback, ms) => {
			startCalls += 1;
			const id = nextId++;
			timers.set(id, { callback, ms });
			started.push(ms);
			return id;
		},
		clearInterval: (handle) => {
			stopCalls += 1;
			timers.delete(handle);
		},
		/** Move the clock forward and fire the timers that are due. */
		advance(ms) {
			const target = current + ms;
			for (const [id, timer] of [...timers]) {
				while (timers.has(id) && current + timer.ms <= target) {
					current += timer.ms;
					timer.callback();
				}
			}
			current = target;
		},
		/** How many timers are still running. */
		get pendingTimers() {
			return timers.size;
		},
		/** The intervals of the timers that were registered. */
		get startedIntervals() {
			return [...started];
		},
		/** How many timers were registered. */
		get startCalls() {
			return startCalls;
		},
		/** How many timers were released. */
		get stopCalls() {
			return stopCalls;
		},
	};
}

/**
 * A countdown with the recording of what it did.
 *
 * The countdown owns the two policies of the wait: the deadline of the
 * decision (five minutes) and the interval of the next attempt (a minute).
 */
function createCountdown(clock, overrides = {}) {
	const views = [];
	const deadlines = [];
	const errors = [];
	let pending = true;

	const countdown = new PendingQuestionCountdown({
		waitMinutes: 5,
		recheckIntervalMs: 60_000,
		now: clock.now,
		setInterval: clock.setInterval,
		clearInterval: clock.clearInterval,
		render: (view) => views.push(view),
		onDeadline: (requestId) => deadlines.push(requestId),
		isPending: () => pending,
		onError: (error) => errors.push(error),
		...overrides,
	});

	return {
		countdown,
		views,
		deadlines,
		errors,
		setPending: (value) => {
			pending = value;
		},
	};
}

/** The last view the countdown drew. */
function lastView(views) {
	return views[views.length - 1];
}

test("the deadline is derived from the moment the wait started", () => {
	assert.equal(decisionDeadlineAt(0, 5), 300_000);
	assert.equal(decisionDeadlineAt(1_000, 5), 301_000);
	assert.equal(decisionDeadlineAt(1_000, 0), 1_000);
	assert.equal(decisionDeadlineAt(1_000, -3), 1_000, "a negative wait is no wait");
	assert.equal(decisionDeadlineAt(Number.NaN, 5), 300_000, "a broken start falls back to the epoch");
});

test("the remaining time is shown as minutes and seconds", () => {
	assert.equal(formatRemainingTime(305_000), "05:05");
	assert.equal(formatRemainingTime(59_000), "00:59");
	assert.equal(formatRemainingTime(0), "00:00");
	assert.equal(formatRemainingTime(-1), "00:00", "a negative time is no time");
	assert.equal(formatRemainingTime(Number.NaN), "00:00", "a broken time is no time");
	assert.equal(formatRemainingTime(Number.POSITIVE_INFINITY), "00:00", "an endless time is no time");
});

test("the countdown shows the remaining time at once", () => {
	const clock = createClock();
	const { countdown, views } = createCountdown(clock);

	countdown.start("q-1", clock.now());

	assert.equal(views.length, 1, "the row is drawn without waiting for the first tick");
	assert.equal(views[0].remaining, "05:00");
	assert.equal(views[0].remainingMs, 300_000);
	assert.equal(views[0].requestId, "q-1");
	assert.equal(views[0].mode, "initial");
});

test("the countdown refreshes once per second", () => {
	const clock = createClock();
	const { countdown, views } = createCountdown(clock);

	countdown.start("q-1", clock.now());

	assert.deepEqual(
		clock.startedIntervals,
		[1_000],
		"the countdown asks for one tick per second and nothing else",
	);

	const before = views.length;
	clock.advance(1_000);
	assert.equal(views.length, before + 1, "one second is one refresh");
	assert.equal(lastView(views).remaining, "04:59");

	clock.advance(1_000);
	assert.equal(views.length, before + 2, "the refresh does not stop");
	assert.equal(lastView(views).remaining, "04:58");

	clock.advance(30_000);
	assert.equal(views.length, before + 32, "thirty seconds are thirty refreshes");
	assert.equal(lastView(views).remaining, "04:28");
});

test("the countdown reaches its zero and starts the decision", () => {
	const clock = createClock();
	const { countdown, views, deadlines } = createCountdown(clock);

	countdown.start("q-1", clock.now());
	clock.advance(300_000);

	assert.deepEqual(deadlines, ["q-1"], "the decision starts exactly at the deadline");
	assert.equal(lastView(views).remaining, "00:00", "the countdown reaches its zero");
	assert.equal(lastView(views).remainingMs, 0);
	for (const view of views) {
		assert.ok(view.remainingMs >= 0, "the countdown never shows a negative time");
	}
});

test("a deadline that is already past starts the decision at once", () => {
	const clock = createClock();
	const { countdown, views, deadlines } = createCountdown(clock);

	// The wait started ten minutes ago: the deadline is in the past.
	countdown.start("q-1", clock.now() - 600_000);

	assert.deepEqual(deadlines, ["q-1"]);
	for (const view of views) {
		assert.ok(view.remainingMs >= 0, "the countdown never shows a negative time");
	}
	assert.equal(lastView(views).remaining, "00:00");
});

test("the countdown stays engaged after its deadline", () => {
	const clock = createClock();
	const { countdown, deadlines } = createCountdown(clock);

	countdown.start("q-1", clock.now());
	clock.advance(300_000);

	assert.equal(deadlines.length, 1);
	assert.equal(countdown.active, true, "the countdown owns the wait until the decision resolves");
	assert.equal(countdown.fired, true, "the deadline fired and the decision is still due");

	countdown.stop();
	assert.equal(countdown.active, false, "a stopped countdown owns nothing");
	assert.equal(countdown.fired, false);
	assert.equal(clock.pendingTimers, 0, "the timer of the countdown is released");
});

test("the decision starts exactly once", () => {
	const clock = createClock();
	const { countdown, deadlines } = createCountdown(clock);

	countdown.start("q-1", clock.now());
	clock.advance(600_000);

	assert.equal(deadlines.length, 1, "a deadline that passed does not fire twice");
});

test("a question that is answered before the deadline starts no decision", () => {
	const clock = createClock();
	const { countdown, views, deadlines, setPending } = createCountdown(clock);

	countdown.start("q-1", clock.now());
	clock.advance(100_000);
	setPending(false);
	clock.advance(300_000);

	assert.deepEqual(deadlines, [], "an answered question starts no decision");
	assert.equal(countdown.active, false, "the countdown of an answered question is over");
	assert.equal(clock.pendingTimers, 0, "the timer is released with the question");
	assert.ok(
		views.every((view) => view.remaining !== "00:00"),
		"the countdown of an answered question never reaches its zero",
	);
});

test("a question that is answered during the deadline starts no decision", () => {
	const clock = createClock();
	const { countdown, deadlines, setPending } = createCountdown(clock);

	countdown.start("q-1", clock.now());
	setPending(false);
	clock.advance(300_000);

	assert.deepEqual(deadlines, [], "the answer of the human wins over the deadline");
});

test("a replaced question does not draw its status and starts no decision", () => {
	const clock = createClock();
	const { countdown, views, deadlines } = createCountdown(clock);

	countdown.start("q-1", clock.now());
	clock.advance(1_000);
	const viewsBefore = views.length;

	countdown.start("q-2", clock.now());
	assert.equal(clock.pendingTimers, 1, "the timer of the replaced question is released");
	assert.equal(clock.startCalls, 2, "every start registers its own timer");
	assert.equal(clock.stopCalls, 1, "the replaced timer was released");

	clock.advance(300_000);
	assert.deepEqual(deadlines, ["q-2"], "the replaced question starts no decision");
	assert.ok(
		views.slice(viewsBefore).every((view) => view.requestId === "q-2"),
		"the replaced question draws no status any more",
	);
});

test("a pending check that stops the countdown draws no status", () => {
	const clock = createClock();
	const { countdown, views, deadlines } = createCountdown(clock, {
		isPending: () => {
			countdown.stop();
			return true;
		},
	});

	countdown.start("q-1", clock.now());
	clock.advance(300_000);

	assert.deepEqual(deadlines, [], "a stopped countdown starts no decision");
	assert.equal(views.length, 0, "a stopped countdown draws no status");
	assert.equal(clock.pendingTimers, 0);
});

test("a failing status row stops the countdown", () => {
	const clock = createClock();
	const { countdown, errors } = createCountdown(clock, {
		render: () => {
			throw new Error("the footer is gone");
		},
	});

	countdown.start("q-1", clock.now());

	assert.equal(errors.length, 1, "the failure is reported");
	assert.match(String(errors[0]), /the footer is gone/);
	assert.equal(clock.pendingTimers, 0, "the timer is released with the failing row");
	assert.equal(countdown.active, false);
});

test("a failing row in a later tick stops the countdown", () => {
	const clock = createClock();
	let renders = 0;
	const { countdown, errors } = createCountdown(clock, {
		render: () => {
			renders += 1;
			if (renders > 1) throw new Error("the footer is gone");
		},
	});

	countdown.start("q-1", clock.now());
	clock.advance(1_000);

	assert.equal(errors.length, 1, "the failure of a later tick is reported too");
	assert.equal(clock.pendingTimers, 0, "the timer is released with the failing row");
});

test("a failing pending check stops the countdown", () => {
	const clock = createClock();
	const { countdown, errors, deadlines } = createCountdown(clock, {
		isPending: () => {
			throw new Error("the controller is gone");
		},
	});

	countdown.start("q-1", clock.now());
	clock.advance(300_000);

	assert.equal(errors.length, 1, "the failure is reported");
	assert.match(String(errors[0]), /the controller is gone/);
	assert.equal(clock.pendingTimers, 0, "the timer is released with the failing check");
	assert.deepEqual(deadlines, [], "a failing check starts no decision");
});

test("a failing decision handler is reported and releases the countdown", () => {
	const clock = createClock();
	const { countdown, errors } = createCountdown(clock, {
		onDeadline: () => {
			throw new Error("the decision failed");
		},
	});

	countdown.start("q-1", clock.now());
	clock.advance(300_000);

	assert.equal(errors.length, 1, "the failure is reported");
	assert.equal(countdown.active, false, "the countdown does not own the wait any more");
	assert.equal(clock.pendingTimers, 0);
});

test("a failing report does not become a new failure", () => {
	const clock = createClock();
	const { countdown } = createCountdown(clock, {
		render: () => {
			throw new Error("the footer is gone");
		},
		onError: () => {
			throw new Error("the report failed");
		},
	});

	countdown.start("q-1", clock.now());
	clock.advance(1_000);

	assert.equal(countdown.active, false, "the countdown is over");
	assert.equal(clock.pendingTimers, 0);
});

test("a timer that cannot be created leaves no countdown behind", () => {
	const clock = createClock();
	let cleared = 0;
	const { countdown, errors } = createCountdown(clock, {
		setInterval: () => {
			throw new Error("the timer failed");
		},
		onStop: () => {
			cleared += 1;
		},
	});

	countdown.start("q-1", clock.now());

	assert.equal(errors.length, 1, "the failure is reported");
	assert.equal(countdown.active, false, "the countdown owns nothing");
	assert.equal(clock.pendingTimers, 0);
	assert.equal(cleared, 1, "the row is cleared with the countdown that never ran");
});

test("a timer that cannot be released is reported and the countdown is gone", () => {
	const clock = createClock();
	const { countdown, errors } = createCountdown(clock, {
		clearInterval: () => {
			throw new Error("the timer failed");
		},
	});

	countdown.start("q-1", clock.now());
	countdown.stop();

	assert.equal(errors.length, 1, "the failure is reported");
	assert.equal(countdown.active, false);
	countdown.stop();
	assert.equal(countdown.active, false, "stopping stays idempotent");
});

test("stopping the countdown is idempotent", () => {
	const clock = createClock();
	const { countdown } = createCountdown(clock);

	countdown.start("q-1", clock.now());
	countdown.stop();
	countdown.stop();
	countdown.stop();

	assert.equal(countdown.active, false);
	assert.equal(clock.pendingTimers, 0, "no timer is left behind");
	assert.equal(clock.startCalls, 1, "the countdown registered one timer");
});

test("stopping a countdown that never started is a no-op", () => {
	const clock = createClock();
	const { countdown } = createCountdown(clock);

	countdown.stop();

	assert.equal(countdown.active, false);
	assert.equal(countdown.requestId, null);
	assert.equal(clock.pendingTimers, 0);
	assert.equal(clock.startCalls, 0, "a countdown that never started registers no timer");
});

test("the recheck counts down to the next attempt", () => {
	const clock = createClock();
	const { countdown, views, deadlines } = createCountdown(clock);

	countdown.startRecheck("q-1");

	assert.equal(views.length, 1, "the row is drawn at once");
	assert.equal(views[0].mode, "recheck");
	assert.equal(views[0].remaining, "01:00");
	assert.equal(views[0].remainingMs, 60_000);

	clock.advance(60_000);
	assert.deepEqual(deadlines, ["q-1"], "the next attempt starts at its deadline");
});

test("a stopped countdown clears the row", () => {
	const clock = createClock();
	let cleared = 0;
	let stoppedFor = null;
	const { countdown } = createCountdown(clock, {
		onStop: (requestId) => {
			cleared += 1;
			stoppedFor = requestId;
		},
	});

	countdown.start("q-1", clock.now());
	countdown.stop();

	assert.equal(cleared, 1, "the row is cleared with the countdown");
	assert.equal(stoppedFor, "q-1", "the row is cleared for the request of the countdown");
});

test("a countdown that stops does not clear the row of another request", () => {
	const clock = createClock();
	const cleared = [];
	const { countdown } = createCountdown(clock, {
		onStop: (requestId) => {
			cleared.push(requestId);
		},
	});

	countdown.start("q-1", clock.now());
	// The countdown of q-1 is replaced by the one of q-2.
	countdown.start("q-2", clock.now());
	countdown.stop();

	assert.deepEqual(cleared, ["q-2"], "only the row of the stopped countdown is cleared");
});

test("the deadline of the countdown and the decision share one timestamp", () => {
	assert.match(
		indexSource,
		/const startedAt = waitingForUserSince\?\.getTime\(\) \?\? Date\.now\(\);/,
		"the countdown counts from the moment the wait started",
	);
	assert.match(
		indexSource,
		/pendingCountdown\.start\(requestId, startedAt\);/,
		"the countdown is started with that timestamp",
	);
	assert.match(
		indexSource,
		/const waitMinutes = \(Date\.now\(\) - waitingForUserSince\.getTime\(\)\) \/ 60000;/,
		"the judge measures the same wait",
	);
	assert.match(
		indexSource,
		/isEligibleForDecision\?\.\(waitMinutes, MIN_WAIT_MINUTES\)/,
		"the judge uses the same threshold as the countdown",
	);
	assert.ok(
		!/pendingCountdown\.start\(\{/.test(indexSource),
		"the caller cannot hand a deadline of its own to the countdown",
	);
});

test("the fallback poll waits for the countdown", () => {
	assert.match(
		indexSource,
		/if \(source === "poll" && pendingCountdown\.active\) return;/,
		"the poll does not start a decision while the countdown owns the wait",
	);
	assert.match(
		indexSource,
		/checkAndAutoContinue\("countdown"\)/,
		"the deadline starts the decision itself",
	);
});

test("a decision that did not start is armed again", () => {
	assert.match(
		indexSource,
		/if \(pendingCountdown\.fired && pendingCountdown\.requestId === requestId\) \{/,
		"a decision that did not start does not lose the deadline",
	);
	assert.match(
		indexSource,
		/pendingCountdown\.startRecheck\(requestId\);/,
		"the countdown is armed again",
	);
});

test("the countdown is stopped on every way out of the wait", () => {
	const waysOut = [
		["// must never clear a valid pending wait.", "the answer of a human"],
		["// The countdown of the answered question is over with it.", "an answer over a channel"],
		["// The user answered in Pi: the wait and the countdown of", "a message of the user"],
		["// The request expired: the wait and the countdown", "the expiry of the request"],
		["// The stale decision is discarded: the wait and", "a discarded decision"],
		["// The work pauses for a human: the wait and the", "the pause of the judge"],
		["// The question is closed: the wait and the countdown of", "the judge that continues"],
		['endWait("session-switched")', "the switch of the session"],
		['endWait("session-ended")', "the end of the session"],
	];

	// The code that follows the comment of a way out is the way out
	// itself: the release of the wait has to be there.
	const codeAfter = (marker) => {
		const at = indexSource.indexOf(marker);
		assert.notEqual(at, -1, `the way out "${marker}" exists`);
		const lines = indexSource.slice(at).split("\n");
		let i = 0;
		while (i < lines.length && /^\s*\/\//.test(lines[i])) i++;
		return lines.slice(i, i + 3).join("\n");
	};

	for (const [marker, label] of waysOut) {
		assert.match(
			codeAfter(marker),
			/clearWait\(|releaseWait\(|endWait\(|pendingCountdown\??\.stop\(\)/,
			`the way out "${label}" stops the countdown`,
		);
	}

	const shutdown = indexSource.indexOf('pi.on("session_shutdown"');
	assert.notEqual(shutdown, -1, "the shutdown of the session exists");
	assert.ok(
		indexSource.slice(shutdown, shutdown + 800).includes('endWait("session-ended")'),
		"the shutdown of the session stops the countdown",
	);
});

test("the settled continuation does not stop the countdown", () => {
	const idle = indexSource.match(/if \(state === "IDLE"\) \{[^}]*\}/);
	assert.ok(idle, "the idle branch of the status exists");
	assert.ok(
		!idle[0].includes("pendingCountdown.stop()"),
		"clearing the row does not stop the countdown of a pending question",
	);
	assert.ok(
		/if \(!pendingCountdown\.active\) \{/.test(idle[0]),
		"the row of a live countdown is kept",
	);
});

test("the recheck of the judge starts a new countdown", () => {
	assert.match(
		indexSource,
		/startRecheckCountdown\(questionContext\.requestId\);/,
		"a wait outcome of the judge counts down to the next attempt",
	);
	assert.match(
		indexSource,
		/function startRecheckCountdown\(requestId: string\): void \{[^}]*pendingCountdown\.startRecheck\(requestId\);/,
		"the recheck uses the policy of the countdown",
	);
});

test("the row of the countdown is cleared with it", () => {
	const onStop = indexSource.slice(
		indexSource.indexOf("onStop: (requestId: string | null) => {"),
		indexSource.indexOf("onError:", indexSource.indexOf("onStop: (requestId: string | null) => {")),
	);
	assert.notEqual(onStop.length, 0, "the stop of the countdown is wired");
	assert.match(
		onStop,
		/_currentAutoContinueState\.startsWith\("\[WAIT\]"\)/,
		"the countdown clears the row of the footer when it stops",
	);
	assert.match(
		onStop,
		/_setAutoContinueStatus\?\.\(undefined\);/,
		"the row of the footer is cleared with the countdown",
	);
});

test("a decision that failed releases the countdown", () => {
	const rejected = indexSource.match(
		/\.catch\(\(error\) => \{[^}]*"The decision failed:"[^}]*\}/,
	);
	assert.ok(rejected, "a failed decision is caught");
	assert.ok(
		/pendingCountdown\.stop\(\);/.test(rejected[0]),
		"a failed decision releases the countdown, so the fallback poll recovers",
	);
});

test("the row of a newer state survives the countdown", () => {
	const onStop = indexSource.slice(
		indexSource.indexOf("onStop: (requestId: string | null) => {"),
		indexSource.indexOf("onError:", indexSource.indexOf("onStop: (requestId: string | null) => {")),
	);
	assert.match(
		onStop,
		/_countdownRowRequestId !== requestId/,
		"the countdown only clears the row that belongs to it",
	);
});

test("the row names the deadline of the judge and the next check", () => {
	assert.match(
		indexSource,
		/`Jev decision in \$\{view\.remaining\}`/,
		"the row names the deadline of the decision",
	);
	assert.match(
		indexSource,
		/`Jev will recheck in \$\{view\.remaining\}`/,
		"the row names the next check after the judge asked to wait",
	);
});

test("the pending check of the countdown is bound to the request", () => {
	assert.match(
		indexSource,
		/current\.requestId === requestId &&/,
		"the check names the request of the countdown",
	);
	assert.match(
		indexSource,
		/current\.state === "pending" \|\| current\.state === "evaluating"/,
		"the check accepts only a question that is still open",
	);
	assert.match(
		indexSource,
		/if \(_countdownSessionId !== _piSessionId\) return false;/,
		"the check refuses the countdown of a session that is gone",
	);
});

test("the ticks update the TUI only", () => {
	const start = indexSource.indexOf("render: (view: CountdownView) => {");
	const end = indexSource.indexOf("onDeadline:", start);
	assert.notEqual(start, -1, "the render of the countdown exists");
	assert.notEqual(end, -1, "the render of the countdown ends");
	const render = indexSource.slice(start, end);
	assert.ok(
		!/sendUserMessage|pi\.send|console\.log|addHarnessMessage/.test(render),
		"a tick of the countdown only draws the row",
	);
});
