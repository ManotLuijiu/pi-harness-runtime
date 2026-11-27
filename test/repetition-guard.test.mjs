/**
 * The guard of a repeated output.
 *
 * The tests use a synthetic stream: a paid model is not needed to
 * reproduce a stream that repeats one symbol.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
	GenerationLoopGuard,
	REPETITION_MIN_REPEATS,
	RepetitionDetector,
	classifyRunStop,
	contextWithoutRepetitiveTail,
	textDeltaOf,
	withoutRepetitiveTail,
} from "../harness/repetition-guard.ts";
import { RepetitionGuardRuntime } from "../harness/repetition-guard-runtime.ts";
import { decideRepetitionRecovery } from "../harness/repetition-recovery.ts";

/**
 * A stream of one symbol.
 */
function symbolStream(count, symbol = "×") {
	return symbol.repeat(count);
}

test("a stream that repeats one symbol is found", () => {
	const detector = new RepetitionDetector();
	const finding = detector.push(symbolStream(REPETITION_MIN_REPEATS + 10));
	assert.ok(finding);
	assert.equal(finding.motif, "×");
	assert.ok(finding.repeats >= REPETITION_MIN_REPEATS);
});

test("a run that is one symbol short of the threshold does not fire", () => {
	// The threshold is a deliberate number: a change of it is a change of
	// the guard, not a detail of the test.
	assert.equal(REPETITION_MIN_REPEATS, 128);
	const detector = new RepetitionDetector();
	// The threshold is the reason of the detection: one symbol less is an
	// ordinary answer.
	assert.equal(detector.push(symbolStream(REPETITION_MIN_REPEATS - 1)), undefined);
});

test("the repetition is found across the boundary of the chunks", () => {
	const detector = new RepetitionDetector();
	let finding;
	// The symbol is split over the chunks: the tail has to be kept.
	for (let index = 0; index < 200; index += 1) {
		finding = detector.push("×") ?? finding;
	}
	assert.ok(finding);
});

test("an ordinary answer does not fire the guard", () => {
	const detector = new RepetitionDetector();
	const answer = [
		"Here is the plan of the work:",
		"- read the file",
		"- change the file",
		"- run the tests",
		"",
		"```ts",
		"const x = 1;".repeat(40),
		"```",
	].join("\n");
	assert.equal(detector.push(answer), undefined);
});

test("a word that repeats is not a failure of the model", () => {
	const detector = new RepetitionDetector();
	assert.equal(detector.push("resume ".repeat(200)), undefined);
});

test("a long run of the same mark is the degeneration of the model", () => {
	const detector = new RepetitionDetector();
	const finding = detector.push("|".repeat(140));
	assert.ok(finding, "the run of the same mark is a repetition");
	assert.equal(finding?.motif, "|");
});

test("a table with cells is not a repetition", () => {
	const detector = new RepetitionDetector();
	const table = ["| a | b |", "|---|---|", "| c | d |"].join("\n");
	assert.equal(detector.push(table.repeat(60)), undefined);
});

test("the degeneration of the ASCII marks and digits is caught", () => {
	const marks = new RepetitionDetector();
	assert.ok(marks.push("=".repeat(200)), "a run of the equals sign is caught");
	const dashes = new RepetitionDetector();
	assert.ok(dashes.push("-".repeat(200)), "a run of the dash is caught");
	const digits = new RepetitionDetector();
	assert.ok(digits.push("0".repeat(200)), "a run of the zero is caught");
});

test("the guard forgets the stream", () => {
	const detector = new RepetitionDetector();
	detector.push("hello");
	detector.reset();
	assert.equal(detector.tail(), "");
});

test("the state of the run is marked before it is stopped", () => {
	const guard = new GenerationLoopGuard();
	const state = guard.mark({
		sessionId: "session-1",
		requestGeneration: 7,
		messageId: "message-1",
		finding: { motif: "×", repeats: 200, tail: "×".repeat(200) },
		now: () => 42,
	});
	assert.equal(state.detectedAt, 42);
	assert.equal(guard.current()?.messageId, "message-1");
});

test("the run gets one recovery", () => {
	const guard = new GenerationLoopGuard();
	guard.mark({
		sessionId: "session-1",
		requestGeneration: 7,
		finding: { motif: "×", repeats: 200, tail: "×".repeat(200) },
	});
	assert.equal(guard.claimRecovery(), true);
	assert.equal(guard.claimRecovery(), false);
});

test("a new request forgets the state of the old run", () => {
	const guard = new GenerationLoopGuard();
	guard.mark({
		sessionId: "session-1",
		requestGeneration: 7,
		finding: { motif: "×", repeats: 200, tail: "×".repeat(200) },
	});
	guard.reset();
	assert.equal(guard.current(), undefined);
});

test("the tail of the noise is kept out of the next context", () => {
	const tail = "×".repeat(200);
	const finding = { motif: "×", repeats: 200, tail };
	const messages = [
		{ role: "user", content: "do the work" },
		{ role: "assistant", content: [{ type: "text", text: `before ${tail}` }] },
	];
	const cleaned = contextWithoutRepetitiveTail(messages, finding);
	assert.equal(cleaned[0], messages[0]);
	const text = JSON.stringify(cleaned[1]);
	assert.ok(!text.includes(tail));
	assert.match(text, /repeated/);
});

test("the transcript of the session keeps the noise", () => {
	const tail = "×".repeat(200);
	const finding = { motif: "×", repeats: 200, tail };
	const message = { role: "assistant", content: [{ type: "text", text: tail }] };
	const cleaned = withoutRepetitiveTail(message, finding);
	assert.notEqual(cleaned.content, message.content);
	// The original is not touched.
	assert.equal(message.content[0].text, tail);
});

test("a message without the tail is not changed", () => {
	const finding = { motif: "×", repeats: 200, tail: "×".repeat(200) };
	const message = { role: "assistant", content: [{ type: "text", text: "a normal answer" }] };
	assert.equal(withoutRepetitiveTail(message, finding), message);
});

test("only the text of the answer is a delta of the output", () => {
	assert.equal(
		textDeltaOf({ type: "text_delta", contentIndex: 0, delta: "hello" }),
		"hello",
	);
	// The thinking of the model is not the answer, and the arguments of a
	// tool call may well repeat a sign.
	assert.equal(
		textDeltaOf({ type: "thinking_delta", contentIndex: 0, delta: "×" }),
		undefined,
	);
	assert.equal(
		textDeltaOf({ type: "toolcall_delta", contentIndex: 0, delta: "×" }),
		undefined,
	);
	assert.equal(textDeltaOf({ type: "text_delta", delta: "" }), undefined);
	assert.equal(textDeltaOf(undefined), undefined);
	assert.equal(textDeltaOf("text"), undefined);
});

test("the stop of the guard is not the stop of the human", () => {
	// The guard stopped the run: the stop may be recovered.
	assert.equal(
		classifyRunStop({
			stoppedByGuard: true,
			stopReason: "aborted",
			signalAborted: true,
		}),
		"guard",
	);
	// The human stopped the run: the stop may not be recovered.
	assert.equal(
		classifyRunStop({
			stoppedByGuard: false,
			stopReason: "aborted",
			signalAborted: true,
		}),
		"human",
	);
	// The signal alone does not tell a guard from a human: the guard has
	// to have marked the run.
	assert.equal(
		classifyRunStop({
			stoppedByGuard: false,
			stopReason: "stop",
			signalAborted: true,
		}),
		"human",
	);
	// A run that ended on its own was not stopped.
	assert.equal(
		classifyRunStop({
			stoppedByGuard: false,
			stopReason: "stop",
			signalAborted: false,
		}),
		"none",
	);
});

test("the guard marks the run before it stops it", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	let markedWhenStopped;
	let stops = 0;
	const state = runtime.observeDelta("×".repeat(200), () => {
		stops += 1;
		// Only the first stop is read: the guard has to be marked before
		// the run is stopped, and the run is stopped once.
		if (stops > 1) return;
		markedWhenStopped = runtime.state();
	});
	assert.ok(state);
	assert.equal(stops, 1, "the run must be stopped once");
	assert.ok(markedWhenStopped);
	assert.equal(markedWhenStopped.requestGeneration, 7);
	assert.equal(runtime.stoppedByGuard(), true);
});

test("the guard fires once per run and the claim of the recovery survives it", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	const first = runtime.observeDelta("×".repeat(200), () => {});
	assert.ok(first);
	// The same run does not fire a second time.
	assert.equal(runtime.observeDelta("×".repeat(200), () => {}), undefined);
	// The claim of the recovery is asked before it is taken.
	assert.equal(runtime.recoveryTried(), false);
	assert.equal(runtime.claimRecovery(), true);
	assert.equal(runtime.recoveryTried(), true);
	assert.equal(runtime.claimRecovery(), false);
	// A new message is a new run of the model: the guard may fire again,
	// and the claim of the recovery survives it. The fact that the guard
	// stopped a run stays until it is read: the abort of the run that
	// repeated itself can arrive after the start of the next message.
	runtime.newMessage();
	assert.equal(runtime.stoppedByGuard(), true);
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	assert.equal(runtime.recoveryTried(), true);
	assert.equal(runtime.claimRecovery(), false);
});

test("the tail that straddles two blocks of the context is removed", () => {
	const tail = "×".repeat(REPETITION_MIN_REPEATS + 5);
	// The transcript of a session can split the run of the noise over two
	// blocks: the noise belongs out of the context as well.
	const message = {
		role: "assistant",
		content: [
			{ type: "text", text: `the answer starts ${"x".repeat(40)}` },
			{ type: "text", text: tail.slice(0, 60) },
			{ type: "text", text: tail.slice(60) },
		],
	};
	const finding = {
		motif: "×",
		repeats: REPETITION_MIN_REPEATS + 5,
		tail,
	};
	const without = withoutRepetitiveTail(message, finding);
	const text = without.content.map((block) => block.text).join("");
	// The run of the noise is gone: the note of the guard names the motif,
	// but the run itself is not in the context any more.
	assert.doesNotMatch(text, /×{10}/);
	assert.match(text, /repeated/);
	// The rest of the answer is untouched.
	assert.match(text, /the answer starts/);
});

test("the stop of the guard is taken by the boundary of the run", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 1,
		},
	});
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	// The fact survives the start of a message that Pi queued: the abort of
	// the run that repeated itself can arrive after it.
	runtime.newMessage();
	assert.equal(runtime.stoppedByGuard(), true);
	// The boundary of the run takes it: the next run of the model does not
	// inherit the stop of the guard, so a human that stops that run is not
	// mistaken for the guard.
	assert.equal(runtime.takeStoppedByGuard(), true);
	assert.equal(runtime.stoppedByGuard(), false);
	assert.equal(runtime.takeStoppedByGuard(), false);
});

test("the noise of another session is not the noise of this one", () => {
	let session = "session-1";
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => session,
			requestGeneration: () => 1,
		},
	});
	const state = runtime.observeDelta("×".repeat(200), () => {});
	assert.ok(state);
	const tail = state.finding.tail;
	const message = { role: "assistant", content: `the answer ${tail}` };
	// The noise of the session of the run belongs out of the context.
	const quarantined = runtime.quarantine([message]);
	assert.doesNotMatch(JSON.stringify(quarantined), /×{10}/);
	// The run is over: the decision took the repetition of the run.
	runtime.takeState();
	// The session changed: the noise of the old session does not belong to
	// the new one, and the message is left alone.
	session = "session-2";
	const other = runtime.quarantine([message]);
	assert.equal(other[0].content, `the answer ${tail}`);
});

test("the noise of the run that is alive survives the change of the session", () => {
	let session = "session-1";
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => session,
			requestGeneration: () => 1,
		},
	});
	const state = runtime.observeDelta("×".repeat(200), () => {});
	assert.ok(state);
	const tail = state.finding.tail;
	const message = { role: "assistant", content: `the answer ${tail}` };
	// The session is replaced while the run goes on: the noise of that run
	// still belongs out of the context.
	session = "session-2";
	const quarantined = runtime.quarantine([message]);
	assert.doesNotMatch(JSON.stringify(quarantined), /×{10}/);
});

test("the fact of the stop is recorded only when the run was stopped", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 1,
		},
	});
	// The repetition was found, but nothing was stopped: the guard had no
	// means to stop the run, and no run was stopped by it.
	assert.ok(runtime.observeDelta("×".repeat(200)));
	assert.equal(runtime.stoppedByGuard(), false);
});

test("the block of the gate keeps the fact that would refuse the recovery", () => {
	const decision = decideRepetitionRecovery({
		detected: true,
		recoveryTried: true,
		requestMatches: true,
		work: "unfinished",
		paused: false,
		questionOpen: false,
		budgetSpent: true,
	});
	assert.equal(decision.action, "block");
	assert.match(decision.reason, /after the recovery/);
	assert.match(decision.reason, /budget/);
});

test("only the last block that carries the tail is replaced", () => {
	const tail = "×".repeat(REPETITION_MIN_REPEATS + 5);
	const message = {
		role: "assistant",
		content: [
			{ type: "text", text: `first ${tail}` },
			{ type: "text", text: `second ${tail}` },
		],
	};
	const finding = {
		motif: "×",
		repeats: REPETITION_MIN_REPEATS + 5,
		tail,
	};
	const without = withoutRepetitiveTail(message, finding);
	// The first run of the noise is kept: the trailing noise is the one
	// that is replaced.
	assert.match(without.content[0].text, /×{10}/);
	assert.doesNotMatch(without.content[1].text, /×{10}/);
	assert.match(without.content[1].text, /repeated/);
});

test("the decision consumes the live repetition, and the noise stays out of the context", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	const finding = runtime.observeDelta("×".repeat(200), () => {});
	assert.ok(finding);
	assert.ok(runtime.state(), "the repetition of the run is live");
	assert.equal(runtime.claimRecovery(), true);
	// The decision takes the repetition: it sees it once.
	const taken = runtime.takeState();
	assert.ok(taken, "the decision sees the repetition");
	assert.equal(runtime.state(), undefined, "the repetition is consumed");
	assert.equal(runtime.takeState(), undefined, "the decision sees it once");
	// The noise of the run that repeated itself stays out of the context
	// of the recovery.
	const quarantined = runtime.quarantine([
		{ role: "user", content: "the request" },
		{ role: "assistant", content: `×${"×".repeat(200)}` },
	]);
	assert.equal(
		quarantined.length,
		2,
		"the message of the run stays in the context",
	);
	assert.equal(
		String(quarantined[1]?.content ?? "").includes("×".repeat(200)),
		false,
		"the tail of the noise is out of the context",
	);
});

test("a continuation that starts before the run settles does not swallow the repetition", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	// Pi starts the message of a queued continuation before the run that
	// repeated itself settles.
	runtime.newMessage();
	assert.ok(
		runtime.state(),
		"the repetition survives the start of the next message",
	);
	assert.ok(runtime.takeState(), "the decision sees the repetition");
});

test("a repetition that comes back after the recovery is live again", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	assert.equal(runtime.claimRecovery(), true);
	runtime.newMessage();
	assert.equal(runtime.takeState() !== undefined, true);
	// The model repeats itself again: the gate of the recovery sees it.
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	assert.ok(runtime.state(), "the second repetition is live");
});

test("the noise of a run of the old request stays out of the context", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	assert.ok(runtime.takeState());
	// The human sends a new request: the run of the old request is over.
	runtime.resetRun();
	// The transcript of the session keeps the noise, and the context of the
	// next call of the model does not.
	const quarantined = runtime.quarantine([
		{ role: "user", content: "the request" },
		{ role: "assistant", content: `×${"×".repeat(200)}` },
	]);
	assert.equal(
		String(quarantined[1]?.content ?? "").includes("×".repeat(200)),
		false,
		"the tail of the noise is out of the context of the next request",
	);
});

test("the trailing noise of a message is the one that is replaced", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	const tail = "×".repeat(200);
	const quarantined = runtime.quarantine([
		{ role: "assistant", content: `${tail} and the answer and ${tail}` },
	]);
	const content = String(quarantined[0]?.content ?? "");
	// The first run of the message is not the noise of the finding: the
	// trailing one is.
	assert.ok(content.includes(tail), "the first run of the message stays");
	assert.equal(
		content.endsWith(tail),
		false,
		"the trailing run of the message is replaced",
	);
});

test("every repetition of the run is kept out of the context", () => {
	const runtime = new RepetitionGuardRuntime({
		identity: {
			sessionId: () => "session-1",
			requestGeneration: () => 7,
		},
	});
	assert.ok(runtime.observeDelta("×".repeat(200), () => {}));
	assert.equal(runtime.claimRecovery(), true);
	runtime.newMessage();
	assert.ok(runtime.takeState());
	// The model repeats itself again with another noise.
	assert.ok(runtime.observeDelta("=".repeat(200), () => {}));
	const quarantined = runtime.quarantine([
		{ role: "user", content: "the request" },
		{ role: "assistant", content: `×${"×".repeat(200)}` },
		{ role: "assistant", content: `=${"=".repeat(200)}` },
	]);
	assert.equal(
		String(quarantined[1]?.content ?? "").includes("×".repeat(200)),
		false,
		"the noise of the first repetition is out of the context",
	);
	assert.equal(
		String(quarantined[2]?.content ?? "").includes("=".repeat(200)),
		false,
		"the noise of the second repetition is out of the context",
	);
});

test("the recovery is decided by the facts of the session", () => {
	const base = {
		detected: true,
		recoveryTried: false,
		requestMatches: true,
		work: "unfinished",
		paused: false,
		questionOpen: false,
		budgetSpent: false,
	};
	assert.equal(decideRepetitionRecovery(base).action, "recover");
	// The work is complete: there is nothing to recover.
	assert.equal(
		decideRepetitionRecovery({ ...base, work: "complete" }).action,
		"skip",
	);
	// The work is paused or a question waits: the recovery waits too.
	assert.equal(decideRepetitionRecovery({ ...base, paused: true }).action, "skip");
	assert.equal(
		decideRepetitionRecovery({ ...base, questionOpen: true }).action,
		"skip",
	);
	// The budget of the work is spent: the recovery would spend more of a
	// budget that is over.
	assert.equal(
		decideRepetitionRecovery({ ...base, budgetSpent: true }).action,
		"skip",
	);
	// The request that repeated itself was replaced: the recovery would
	// continue a request that is not the one of the human.
	assert.equal(
		decideRepetitionRecovery({ ...base, requestMatches: false }).action,
		"skip",
	);
	// The repetition came back after the recovery: the run is blocked, not
	// recovered a second time.
	const blocked = decideRepetitionRecovery({ ...base, recoveryTried: true });
	assert.equal(blocked.action, "block");
	assert.match(blocked.reason, /after the recovery/);
	// Nothing was detected: there is nothing to decide.
	assert.equal(
		decideRepetitionRecovery({ ...base, detected: false }).action,
		"skip",
	);
	// The repetition came back and the budget is spent: the block is the
	// state of the loop, and it is reported even when another fact would
	// refuse the recovery.
	const blockedAndSpent = decideRepetitionRecovery({
		...base,
		recoveryTried: true,
		budgetSpent: true,
	});
	assert.equal(blockedAndSpent.action, "block");
	// The state of the work is unknown: the uncertainty is preserved and
	// the reason does not claim that the work is unfinished.
	const unknown = decideRepetitionRecovery({ ...base, work: "unknown" });
	assert.equal(unknown.action, "recover");
	assert.doesNotMatch(unknown.reason, /unfinished/);
});

test("a request that waits for its review is not recovered", () => {
	const base = {
		detected: true,
		recoveryTried: false,
		requestMatches: true,
		work: "unfinished",
		paused: false,
		questionOpen: false,
		budgetSpent: false,
	};
	// The request waits for the review phase of its workflow: the harness
	// must not recover it into a step that is not the work of the agent.
	const decision = decideRepetitionRecovery({ ...base, work: "pending" });
	assert.equal(decision.action, "skip");
	assert.match(decision.reason, /review phase/);
});
