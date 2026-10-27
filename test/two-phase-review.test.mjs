/**
 * The two-phase workflow must keep the implementation and the review apart.
 *
 * A review that is requested while the implementation runs is queued, not
 * executed. The shipped packages ship their compiled output (`dist/`), so
 * this test exercises the dist and asserts that it is in sync with the
 * source.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const packageRoot = join(repoRoot, "packages", "two-phase-review");

const {
	classifyTodo,
	implementationTodos,
	hasOpenImplementationWork,
	detectReviewInvocation,
	isComprehensiveReviewTool,
	explicitReviewRequest,
	recordSignal,
	hasQueuedReview,
	transitionToReviewPending,
	transitionToTestPending,
	markChunkDone,
	startReview,
	collectScope,
	chunkScope,
	createState,
	buildPhaseInstruction,
	buildPhaseView,
	buildDeferralReason,
	buildReviewTodoSubject,
	formatPhaseStatus,
	validationGateSatisfied,
	TWO_PHASE_CONTRACT,
} = await import(join(packageRoot, "dist", "index.js"));

const runtimeSource = readFileSync(join(repoRoot, "index.ts"), "utf8");

function git(root, ...args) {
	// The ambient Git configuration must not decide whether the fixture works:
	// a global identity, a signing key or a hook would break the commit.
	execFileSync(
		"git",
		[
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=Test",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{ cwd: root, stdio: "ignore" },
	);
}

function makeRepo() {
	// The fixture lives in the repository, never in the shared `/tmp`: a long
	// test run can lose a temporary directory there while the test is running.
	const root = mkdtempSync(join(process.cwd(), ".test-two-phase-root-"));
	git(root, "init", "-q");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "user.name", "Test");
	mkdirSync(join(root, "packages", "notification"), { recursive: true });
	writeFileSync(join(root, "packages", "notification", "index.ts"), "export const a = 1;\n");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "base");
	return root;
}

test("a queued review item is never implementation work", () => {
	const todos = [
		{ id: 1, subject: "[IMPLEMENT] Add the storage", status: "pending" },
		{ id: 2, subject: "[REVIEW] Review the task diff (queued)", status: "pending" },
		{ id: 3, subject: "[REVIEW-FIX] Fix the stale race", status: "pending" },
	];

	assert.equal(classifyTodo(todos[1]), "review");
	assert.equal(classifyTodo(todos[2]), "review_fix");
	assert.deepEqual(
		implementationTodos(todos).map((todo) => todo.id),
		[1],
	);
	assert.equal(hasOpenImplementationWork(todos), true);
	assert.equal(hasOpenImplementationWork([todos[1], todos[2]]), false);
});

test("a comprehensive review is recognized, a task check is not", () => {
	assert.equal(isComprehensiveReviewTool("code-reviewer"), true);
	assert.equal(isComprehensiveReviewTool("lens_diagnostics"), false);
	assert.equal(isComprehensiveReviewTool("bash"), false);

	const review = detectReviewInvocation("code-reviewer", { files: ["index.ts"] });
	assert.equal(review.source, "code-reviewer");
	assert.deepEqual(review.files, ["index.ts"]);

	assert.equal(detectReviewInvocation("lens_diagnostics", { paths: ["index.ts"] }), null);
	assert.equal(detectReviewInvocation("bash", { command: "npx tsc --noEmit" }), null);
});

test("the intent of the user wins over the phase order", () => {
	assert.equal(explicitReviewRequest("please review the diff now"), true);
	assert.equal(explicitReviewRequest("fix the failing test"), false);
});

test("a signal is recorded once and the phase does not change", () => {
	const signal = {
		source: "code-reviewer",
		files: ["index.ts"],
		reason: "a comprehensive review was requested with code-reviewer",
		at: "2026-10-25T00:00:00.000Z",
	};
	const once = recordSignal(createState("task"), signal);
	const twice = recordSignal(once, signal);

	assert.equal(twice.signals.length, 1);
	assert.equal(twice.phase, "implementation");
	assert.equal(hasQueuedReview(twice), true);
});

test("the deferral reason keeps the implementation running", () => {
	const state = recordSignal(createState("task"), {
		source: "code-reviewer",
		files: [],
		reason: "requested",
		at: "2026-10-25T00:00:00.000Z",
	});
	const reason = buildDeferralReason(state, {
		source: "code-reviewer",
		implementationOpen: 2,
	});

	assert.match(reason, /Phase 1 \(implementation\) is still running/);
	assert.match(reason, /2 implementation todo\(s\) are open/);
	assert.match(reason, /queued and starts after the implementation todos are done/);
});

test("the review starts only after the implementation is done", () => {
	const root = makeRepo();
	try {
		writeFileSync(join(root, "packages", "notification", "index.ts"), "export const a = 2;\n");
		writeFileSync(join(root, "packages", "notification", "extra.ts"), "export const b = 1;\n");

		const scope = collectScope(root, null);
		assert.equal(scope.detected, true);
		assert.deepEqual(scope.files, [
			"packages/notification/extra.ts",
			"packages/notification/index.ts",
		]);

		const chunks = chunkScope(scope.files);
		assert.equal(chunks.length, 1);
		assert.equal(chunks[0].files.length, 2);

		const pending = transitionToReviewPending(createState("task"), scope.files);
		assert.equal(pending.phase, "review_pending");

		const review = startReview(pending, chunks);
		assert.equal(review.phase, "review");

		const instruction = buildPhaseInstruction(
			review,
			buildPhaseView(review, []),
		);
		assert.match(instruction, /Phase 2 \(review\)/);
		assert.match(instruction, /never the whole repository/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the workflow tells the agent what the phase is", () => {
	const state = createState("task");
	const view = buildPhaseView(state, [
		{ id: 1, subject: "Add the storage", status: "pending" },
	]);
	const instruction = buildPhaseInstruction(state, view);

	assert.match(instruction, /Phase 1 \(implementation\)/);
	assert.match(instruction, /Do not start a comprehensive review/);
	assert.match(TWO_PHASE_CONTRACT, /Phase 2/);
	assert.match(formatPhaseStatus(state), /\[PHASE\] implementation/);
});

test("the validation of the task is a phase of its own", () => {
	const pending = transitionToReviewPending(createState("task"), [
		"packages/app/index.ts",
	]);
	const review = startReview(pending, chunkScope(["packages/app/index.ts"]));
	const done = markChunkDone(review, review.chunks[0].id);

	// The review ran over its chunk, but the validation is still open.
	const waiting = transitionToTestPending(done);
	assert.equal(waiting.phase, "test_pending");

	const view = buildPhaseView(waiting, [
		{ id: 1, subject: "[TEST] Validate the task", status: "pending" },
	]);
	assert.equal(view.testOpen, 1);
	const instruction = buildPhaseInstruction(waiting, view);
	assert.match(instruction, /Phase 3 \(validation\)/);
	assert.match(instruction, /final tier/);

	// A gate that cannot be read is not a gate that passed.
	assert.equal(
		validationGateSatisfied({
			available: false,
			pendingFinalTier: 0,
			failedFinalTier: 0,
			incompletePlan: 0,
		}),
		false,
	);
	assert.equal(
		validationGateSatisfied({
			available: true,
			pendingFinalTier: 0,
			failedFinalTier: 0,
			incompletePlan: 0,
		}),
		true,
	);

	// The test item is never implementation work.
	assert.deepEqual(
		implementationTodos([
			{ id: 1, subject: "[TEST] Validate the task", status: "pending" },
		]),
		[],
	);
});

test("there is exactly one queued review item", () => {
	const state = recordSignal(createState("task"), {
		source: "code-reviewer",
		files: ["index.ts"],
		reason: "requested",
		at: "2026-10-25T00:00:00.000Z",
	});
	const subject = buildReviewTodoSubject(state);

	assert.match(subject, /^\[REVIEW\]/);
	assert.match(subject, /code-reviewer/);
});

test("the runtime wires the workflow into the session", () => {
	// The session loads the compiled package and registers the runtime.
	assert.match(runtimeSource, /initTwoPhaseReview/);
	assert.match(runtimeSource, /packages\/two-phase-review\/dist\/index\.js/);
	// The handlers are registered before the extension is ready, so a session
	// that starts right away is covered.
	assert.match(runtimeSource, /await initTwoPhaseReview\(pi\)/);

	// The review is gated while the implementation runs.
	const runtime = readFileSync(join(packageRoot, "src", "runtime.ts"), "utf8");
	assert.match(runtime, /block: true/);
	assert.match(runtime, /detectReviewInvocation/);
	// The status line names the phase.
	assert.match(runtime, /harness-review/);
	// The phase rules reach the agent.
	assert.match(runtime, /before_agent_start/);
	assert.match(runtime, /TWO_PHASE_CONTRACT/);
	// The state is persisted before the runtime believes it.
	assert.match(runtime, /persist\(next\)/);
});

test("the compiled package is in sync with the source", () => {
	const source = readFileSync(join(packageRoot, "src", "rules.ts"), "utf8");
	const compiled = readFileSync(join(packageRoot, "dist", "rules.js"), "utf8");

	for (const marker of ["buildDeferralReason", "formatPhaseStatus", "TWO_PHASE_CONTRACT"]) {
		assert.ok(source.includes(marker), `the source is missing ${marker}`);
		assert.ok(compiled.includes(marker), `the compiled artifact is missing ${marker}`);
	}
});
