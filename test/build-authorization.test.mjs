/**
 * The build delegation.
 *
 * A build is a build of the workspace it was recorded in: the build of the
 * bench, or the build script of the project. The delegation of a build
 * covers that build and nothing else, so a question that names another
 * operation beside the build stays blocked, and a script the project does
 * not have is not a build of the project.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DelegationStore } from "../harness/delegation-store.ts";
import { ApprovalDecisionStore } from "../harness/approval-decision-store.ts";
import { DelegatedApprovalRuntime } from "../harness/delegated-approval-runtime.ts";
import { coveredBuildForm } from "../harness/build-authorization.ts";
import { parseDelegationCommand } from "../harness/delegation-command.ts";
import {
	buildFormOf,
	operationKindsFor,
} from "../harness/delegated-approval-types.ts";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "build-authorization-"));
}

/**
 * A project with a build script.
 */
function project(dir) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "fixture", scripts: { build: "tsc" } }),
	);
	return dir;
}

/**
 * A bench.
 */
function bench(dir) {
	mkdirSync(join(dir, "sites"), { recursive: true });
	return dir;
}

/**
 * A runtime with a pinned clock and a temporary store.
 */
function makeRuntime(dir, overrides = {}) {
	let now = 1000;
	const delegations = new DelegationStore(dir);
	const decisions = new ApprovalDecisionStore(dir);
	const resumes = [];
	const runtime = new DelegatedApprovalRuntime({
		now: () => now,
		delegations,
		decisions,
		deliver: async () => ({ delivered: true, failures: [] }),
		resume: (request, decision) => {
			resumes.push({ request, decision });
		},
		...overrides,
	});
	return { runtime, delegations, resumes, setNow: (value) => (now = value) };
}

/**
 * A request of a build.
 */
function buildRequest(workspace, overrides = {}) {
	return {
		requestId: "q-1",
		workspace,
		sessionId: "session-1",
		generation: 3,
		kind: "build",
		kinds: ["build"],
		operation: "bench build",
		blocked: ["bench build"],
		deadlineAt: 1000,
		...overrides,
	};
}

test("a build command is an operation that a delegation can name", () => {
	assert.deepEqual(operationKindsFor("May I run bench build?"), ["build"]);
	assert.deepEqual(operationKindsFor("May I run yarn run build?"), ["build"]);
	assert.deepEqual(operationKindsFor("May I run npm run build?"), ["build"]);
	// The word "build" alone is not a build: it asks for work.
	assert.deepEqual(operationKindsFor("May I build the project?"), []);
	// A mention of the past names no operation.
	assert.deepEqual(operationKindsFor("the build I ran yesterday"), []);
});

test("only a standalone build command is a covered build", () => {
	assert.equal(buildFormOf("May I run bench build?"), "bench build");
	assert.equal(buildFormOf("may i run bench build --app erpnext?"), "bench build");
	assert.equal(buildFormOf("Can you run bench build please?"), "bench build");
	assert.equal(buildFormOf("May I run yarn run build?"), "package build");
	assert.equal(buildFormOf("May I run npm run build?"), "package build");
	// Another operation beside the build names no build: the delegation of
	// a build may not cover an operation the user never delegated.
	assert.equal(buildFormOf("May I run bench build and restart the app?"), undefined);
	assert.equal(buildFormOf("May I run bench build --force?"), undefined);
	assert.equal(buildFormOf("May I run bench migrate?"), undefined);
});

test("the build of a bench and the build script of a project are covered", () => {
	const dir = temporary();
	try {
		const benchDir = bench(join(dir, "bench"));
		const projectDir = project(join(dir, "project"));
		assert.equal(
			coveredBuildForm("May I run bench build?", benchDir),
			"bench build",
		);
		assert.equal(
			coveredBuildForm("May I run yarn run build?", projectDir),
			"package build",
		);
		// The bench build of a project that is not a bench is not covered.
		assert.equal(
			coveredBuildForm("May I run bench build?", projectDir),
			undefined,
		);
		// The build script of a project that has none is not covered.
		const empty = join(dir, "empty");
		mkdirSync(empty, { recursive: true });
		assert.equal(
			coveredBuildForm("May I run yarn run build?", empty),
			undefined,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the user can delegate a build", () => {
	const plan = parseDelegationCommand("add build continue");
	assert.equal(plan.action, "add");
	assert.deepEqual(plan.kinds, ["build"]);
	assert.equal(plan.defaultOutcome, "continue");
});

test("the deadline continues a build that the workspace has", async () => {
	const dir = temporary();
	try {
		const workspace = bench(join(dir, "bench"));
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace,
			kinds: ["build"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(buildRequest(workspace));
		const decision = runtime.expire("q-1");
		assert.ok(decision);
		assert.equal(decision.source, "delegated-timeout");
		assert.equal(decision.outcome, "yes");
		assert.equal(decision.delegationId, "d-1");
		assert.equal(resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline continues the build script of the project", async () => {
	const dir = temporary();
	try {
		const workspace = project(join(dir, "project"));
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace,
			kinds: ["build"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(
			buildRequest(workspace, { operation: "yarn run build" }),
		);
		const decision = runtime.expire("q-1");
		assert.ok(decision);
		assert.equal(decision.outcome, "yes");
		assert.equal(resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline keeps a build that the workspace does not have blocked", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir, "empty");
		mkdirSync(workspace, { recursive: true });
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace,
			kinds: ["build"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(
			buildRequest(workspace, { operation: "yarn run build" }),
		);
		const decision = runtime.expire("q-1");
		assert.equal(decision, null);
		assert.equal(resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline keeps a mixed operation blocked", async () => {
	const dir = temporary();
	try {
		const workspace = project(join(dir, "project"));
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace,
			kinds: ["build"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(
			buildRequest(workspace, {
				operation: "bench build and then restart the app",
			}),
		);
		const decision = runtime.expire("q-1");
		assert.equal(decision, null);
		assert.equal(resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation for a build does not cover a commit", async () => {
	const dir = temporary();
	try {
		const workspace = project(join(dir, "project"));
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace,
			kinds: ["build"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(
			buildRequest(workspace, {
				kind: "commit",
				kinds: ["commit"],
				operation: "commit the change",
			}),
		);
		const decision = runtime.expire("q-1");
		assert.equal(decision, null);
		assert.equal(resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
