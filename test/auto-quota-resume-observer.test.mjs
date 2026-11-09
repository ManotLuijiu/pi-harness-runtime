/**
 * The observer of the scheduled job resumes.
 *
 * The module that schedules the resume stays independent of the display: it
 * reports the deadline it scheduled and the moment the pending resume
 * ended. The observer is the seam the status row uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cancelAutoResume, scheduleAutoResume } from "../harness/auto-quota-resume.ts";

/** The mirror store of a provider whose 5h window resets in an hour. */
function createMirror(resetEpoch) {
	return {
		readAll: () => ({ minimax: { h5_resets_at_epoch: resetEpoch } }),
		readProvider: () => null,
		writeProvider: () => {},
	};
}

/** The state machine of a paused job. */
function createMachine(jobId = "job-1") {
	return {
		getCheckpoint: () => ({ jobId, status: "paused_quota" }),
		setResumeTime: () => {},
		transition: async () => ({ success: true }),
	};
}

/** An observer that records what it is told. */
function createObserver() {
	const scheduled = [];
	const ended = [];
	return {
		scheduled,
		ended,
		observer: {
			scheduled: (jobId, provider, resumeAt) => {
				scheduled.push({ jobId, provider, resumeAt });
			},
			ended: (jobId, provider) => {
				ended.push({ jobId, provider });
			},
		},
	};
}

test("the observer is told the deadline the resume really uses", () => {
	const resetEpoch = Date.now() + 60 * 60_000;
	const machine = createMachine();
	const mirror = createMirror(resetEpoch);
	const { scheduled, observer } = createObserver();

	scheduleAutoResume("minimax", machine, mirror, observer);

	assert.equal(scheduled.length, 1);
	assert.equal(scheduled[0].jobId, "job-1");
	assert.equal(scheduled[0].provider, "minimax");
	// The resume runs a little before the reset, and the deadline that is
	// reported is the deadline of the resume, not the reset of the quota.
	assert.ok(
		scheduled[0].resumeAt <= resetEpoch,
		"the resume does not run after the reset",
	);
	assert.ok(
		scheduled[0].resumeAt > resetEpoch - 30_000,
		"the resume runs just before the reset",
	);

	cancelAutoResume("job-1");
});

test("a cancelled resume ends the pending one", () => {
	const mirror = createMirror(Date.now() + 60 * 60_000);
	const machine = createMachine();
	const { ended, observer } = createObserver();

	scheduleAutoResume("minimax", machine, mirror, observer);
	cancelAutoResume("job-1");

	assert.equal(ended.length, 1);
	assert.equal(ended[0].jobId, "job-1");
	assert.equal(ended[0].provider, "minimax");
});

test("cancelling a resume that is not there ends nothing", () => {
	const { ended, observer } = createObserver();
	const mirror = createMirror(Date.now() + 60 * 60_000);
	const machine = createMachine();

	scheduleAutoResume("minimax", machine, mirror, observer);
	cancelAutoResume("job-1");
	cancelAutoResume("job-1");

	assert.equal(ended.length, 1, "the second cancel has nothing to end");
});

test("a resume without a reset epoch is not scheduled", () => {
	const machine = createMachine();
	const mirror = { readAll: () => ({}), readProvider: () => null, writeProvider: () => {} };
	const { scheduled, observer } = createObserver();

	const result = scheduleAutoResume("minimax", machine, mirror, observer);

	assert.equal(result, null);
	assert.equal(scheduled.length, 0, "nothing was scheduled, so nothing is reported");
});
