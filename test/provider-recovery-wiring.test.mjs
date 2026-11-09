/**
 * The wiring of the bounded recovery in the runtime.
 *
 * The policy of the recovery (the quadratic waits, the budget of four
 * attempts, the lower bounds) lives in `harness/provider-recovery.ts` and is
 * tested there with an injected clock. The behaviour of the runtime (the
 * pause, the settled boundary, the ownership of the dispatch) lives in
 * `harness/provider-recovery-runtime.ts` and is tested there with a fake
 * clock. This suite checks the wiring: the runtime classifies the failure,
 * hands it to the runtime of the recovery, and the recovery uses the
 * existing auto-resume executor instead of a second resume loop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const proactiveCompactSource = readFileSync(
	new URL("../proactive-compact.ts", import.meta.url),
	"utf8",
);
const providerFailureSource = readFileSync(
	new URL("../harness/provider-failure.ts", import.meta.url),
	"utf8",
);
const runtimeSource = readFileSync(
	new URL("../harness/provider-recovery-runtime.ts", import.meta.url),
	"utf8",
);

test("the runtime classifies the failure of a turn", () => {
	assert.match(
		indexSource,
		/classifyProviderFailure\(/,
		"the runtime classifies the provider failure",
	);
	assert.match(
		providerFailureSource,
		/failure\.recovery === "bounded-recovery"/,
		"the bounded recovery is entered by the classification, not by a guess",
	);
});

test("the recovery reuses the existing auto-resume executor", () => {
	assert.match(
		indexSource,
		/queueAutoResume\(reason, PROVIDER_OVERLOAD_RESUME_PROMPT, "followUp"\)/,
		"the recovery sends the established resume message through the established executor",
	);
	assert.match(
		proactiveCompactSource,
		/const PROVIDER_OVERLOAD_RESUME_PROMPT = "resume"/,
		"the message is the established one",
	);
});

test("the pending action shows the deadline the timer uses", () => {
	assert.match(
		runtimeSource,
		/id: this\.options\.recoveryActionId,[\s\S]{0,400}?dueAt,/,
		"the pending action carries the absolute deadline",
	);
	assert.match(
		runtimeSource,
		/const delayMs = Math\.max\(0, dueAt - this\.now\(\)\);/,
		"the timer waits exactly until that deadline",
	);
});

test("a successful turn resets the cycle", () => {
	assert.match(
		indexSource,
		/providerRecoveryRuntime\?\.noteSuccess\(/,
		"a successful turn ends the cycle",
	);
	assert.match(
		indexSource,
		/providerRecovery\.clear\(\)/,
		"the session shutdown ends the cycles",
	);
});

test("the cycle and the successful turn name the provider the same way", () => {
	assert.match(
		runtimeSource,
		/provider: provider\.toLowerCase\(\)/,
		"the cycle is keyed by the id of the provider",
	);
	assert.match(
		runtimeSource,
		/provider: provider\.toLowerCase\(\),/,
		"a successful turn ends the cycle of the same provider",
	);
});

test("the exhausted budget is visible as a blocked action", () => {
	assert.match(
		runtimeSource,
		/state: "blocked",[\s\S]{0,400}?recovery attempts exhausted/,
		"the blocked row names the exhausted budget",
	);
});

test("the countdown of the recovery is removed when the attempt runs", () => {
	assert.match(
		runtimeSource,
		/this\.recoveryTimer = this\.setTimer\(\(\) => \{[\s\S]{0,300}?this\.options\.actions\.remove\(this\.options\.recoveryActionId\)/,
		"a fired attempt leaves the countdown",
	);
});

test("the resume of a job registers the deadline it schedules", () => {
	assert.match(
		indexSource,
		/scheduleAutoResume\(\s*"minimax",[\s\S]{0,200}?quotaResumeObserver/,
		"the job resume reports the deadline it scheduled",
	);
	assert.match(
		indexSource,
		/id: jobQuotaResumeActionId\(jobId\),[\s\S]{0,200}?dueAt: resumeAt,/,
		"the pending action carries the deadline of the resume",
	);
});

test("the countdown of the GLM quota registers the reset it waits for", () => {
	assert.match(
		indexSource,
		/getGLMQuotaCountdown\(\)\.onTick\(/,
		"the countdown reports its own deadline",
	);
	assert.match(
		indexSource,
		/id: glmQuotaActionId\(event\.jobId\),[\s\S]{0,300}?dueAt: resetAtEpoch,/,
		"the pending action carries the reset of the countdown",
	);
	assert.match(
		indexSource,
		/getGLMQuotaCountdown\(\)\.onEnd\(/,
		"the row leaves when the countdown ends",
	);
});

test("a continuation without a deadline shows that it is queued", () => {
	assert.match(
		indexSource,
		/function registerQueuedContinuation[\s\S]{0,400}?state: "queued"/,
		"a continuation that runs right away is queued, never counted down",
	);
	assert.match(
		indexSource,
		/registerQueuedContinuation\(\s*OUTPUT_LIMIT_CONTINUATION_ID/,
		"the continuation of the output limit is registered",
	);
	assert.match(
		indexSource,
		/registerQueuedContinuation\(\s*POST_COMPACTION_CONTINUATION_ID/,
		"the continuation of the compaction is registered",
	);
});

test("the classification decides which executor owns a failure", () => {
	assert.match(
		indexSource,
		/boundedEligible: usesBoundedRecovery\(providerFailure\),/,
		"the wiring asks the classification which executor owns the failure",
	);
	assert.doesNotMatch(
		indexSource,
		/providerFailure\.recovery === "bounded-recovery" \|\|/,
		"the wiring does not repeat the policy of the classification",
	);
});

test("an overload keeps its own executor", () => {
	assert.match(
		indexSource,
		/shouldQueueProviderOverloadResume\([\s\S]{0,300}?detected:/,
		"the overload executor takes the verdict of the classification",
	);
	assert.match(
		indexSource,
		/providerFailure\.kind === "overload" &&/,
		"only an overload is detected as an overload",
	);
	assert.match(
		indexSource,
		/!isProviderRetryFailedReport\(readMessageText\(event\.message\)\)/,
		"the report of exhausted retries of the SDK is not a fresh failure",
	);
});

test("the recovery starts at the settled boundary, not at the failed attempt", () => {
	assert.match(
		indexSource,
		/pi\.on\("agent_settled",[\s\S]{0,900}?providerRecoveryRuntime\?\.noteSettled\(\)/,
		"the recovery starts when the run settles",
	);
	assert.match(
		indexSource,
		/pi\.on\("agent_settled",[\s\S]{0,900}?activeRunAbortSignal\?\.aborted === true[\s\S]{0,400}?providerRecoveryRuntime\?\.cancel\(\)[\s\S]{0,400}?providerRecoveryRuntime\?\.noteSettled\(\)/,
		"an aborted run is read before the recovery starts",
	);
	assert.doesNotMatch(
		indexSource,
		/scheduleProviderRecovery\(/,
		"the failed attempt does not schedule a recovery on its own",
	);
	assert.match(
		runtimeSource,
		/noteSettled\(\)[\s\S]{0,900}?this\.startRecovery\(candidate\)/,
		"the runtime starts the cycle at the settled boundary",
	);
});

test("a pause of the user cancels the pending resumes", () => {
	assert.match(
		indexSource,
		/detectExplicitPause\(userMessage\)[\s\S]{0,600}?providerRecoveryRuntime\?\.cancel\(\)/,
		"a pause of the user cancels the pending resumes",
	);
});

test("the dispatch checks the ownership before it resumes", () => {
	assert.match(
		runtimeSource,
		/mayDispatchResume\(\{/,
		"the dispatch asks whether the resume still owns the session",
	);
	assert.match(
		runtimeSource,
		/if \(state\.current\.explicitlyPaused\)/,
		"an explicit pause of the user stops the resume",
	);
	assert.match(
		runtimeSource,
		/if \(state\.current\.questionPending\)/,
		"a question that waits for the user stops the resume",
	);
	assert.match(
		runtimeSource,
		/if \(state\.scheduledSessionId !== state\.current\.sessionId\)/,
		"a resume of another session is skipped",
	);
});

test("the runtime of the recovery owns the timers", () => {
	assert.match(
		runtimeSource,
		/this\.recoveryTimer = this\.setTimer\(/,
		"the runtime owns the timer of the attempt",
	);
	assert.match(
		runtimeSource,
		/this\.overloadTimer = this\.setTimer\(/,
		"the runtime owns the timer of the overload",
	);
	assert.doesNotMatch(
		indexSource,
		/providerRecoveryTimer = setTimeout\(/,
		"the wiring does not keep a second timer",
	);
});

test("the abort of the user is read from the signal of the run", () => {
	assert.match(
		indexSource,
		/activeRunAbortSignal = ctx\.signal \?\? activeRunAbortSignal/,
		"the harness keeps the signal of the run that is going",
	);
	assert.match(
		indexSource,
		/activeRunAbortSignal\?\.aborted === true/,
		"the settled boundary reads the abort of the signal",
	);
	assert.match(
		indexSource,
		/m\.stopReason === "aborted" \|\| ctx\.signal\?\.aborted === true/,
		"an aborted turn is a decision of the user, not a failure",
	);
	assert.match(
		indexSource,
		/m\.stopReason === "aborted"[\s\S]{0,300}?providerRecoveryRuntime\?\.cancel\(\)/,
		"an aborted turn clears the candidate of the recovery",
	);
});

test("a cancelled retry of Pi leaves no recovery behind", () => {
	assert.match(
		indexSource,
		/piRetryExpected: expectsPiRetry\(/,
		"the harness tells the runtime whether Pi would retry the failure",
	);
	assert.match(
		indexSource,
		/piRetryAttempted: providerFailureAttemptsInRun > 1/,
		"the harness tells the runtime whether Pi made the attempt",
	);
	assert.match(
		runtimeSource,
		/if \(candidate\.piRetryExpected && !candidate\.piRetryAttempted\)[\s\S]{0,400}?return;/,
		"a retry that Pi announces and never makes starts no recovery",
	);
});

test("a permanent failure supersedes the retry of an earlier failure", () => {
	assert.match(
		indexSource,
		/\} else \{\s*\n\s*\/\/ No automatic retry can fix this failure[\s\S]{0,600}?providerRecoveryRuntime\?\.cancelPending\(\)/,
		"a failure that no retry can fix cancels the pending recovery",
	);
});
