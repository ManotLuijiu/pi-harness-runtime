/**
 * The dispatch of a Frappe operation.
 *
 * The decision of the policy is carried into the paths the harness owns:
 * the operation runs, the confirmation counts down, the human is asked,
 * or the operation is refused. The question of a Frappe operation has no
 * deadline: the answer of the human is the only way out of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	dispatchFrappeOperation,
	frappeApprovalRequestId,
	runFrappeOperation,
} from "../harness/frappe-approval.ts";
import { assessFrappeOperation } from "../harness/frappe-lifecycle-policy.ts";
import { DelegationStore } from "../harness/delegation-store.ts";
import { ApprovalDecisionStore } from "../harness/approval-decision-store.ts";
import { DelegatedApprovalRuntime } from "../harness/delegated-approval-runtime.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";

/** The owner of a DocType of the app of the operation. */
const ownOwnership = {
	doctype: "Item",
	ownerApp: "warehouse_app",
	namespace: "warehouse_app",
	module: "stock",
	sourceJson:
		"/bench/apps/warehouse_app/warehouse_app/stock/doctype/item/item.json",
	standard: true,
	databaseOnly: false,
	customFields: [],
	fixtures: [],
	evidence: [],
	ambiguous: false,
};

/** The base of an operation. */
function baseInput(overrides = {}) {
	return {
		requestGeneration: 7,
		proposal: "bench --site demo.local execute warehouse_app.setup.install.after_install",
		mechanism: "hook",
		target: {
			bench: "/bench",
			app: "warehouse_app",
			namespace: "warehouse_app",
			module: "stock",
			site: "demo.local",
			function: "warehouse_app.setup.install.after_install",
		},
		ownership: ownOwnership,
		insideConvention: {
			inside: true,
			reason: "the routine is in the setup directory",
			verified: true,
		},
		registration: { hook: "after_install" },
		workload: { bounded: true, steps: 3, verified: true },
		idempotency: "verified",
		verification: "unverified",
		...overrides,
	};
}

/** A runtime of the delegated approval with a pinned clock. */
function makeRuntime(dir) {
	let now = 1000;
	const delegations = new DelegationStore(dir);
	const decisions = new ApprovalDecisionStore(dir);
	const delivered = [];
	const resumes = [];
	const runtime = new DelegatedApprovalRuntime({
		now: () => now,
		delegations,
		decisions,
		deliver: async (request) => {
			delivered.push(request);
			return { delivered: true, failures: [] };
		},
		resume: (request, decision) => {
			resumes.push({ request, decision });
		},
	});
	return { runtime, delivered, resumes, setNow: (value) => (now = value) };
}

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "frappe-approval-"));
}

test("an operation with a permission that stands runs", async () => {
	const assessment = assessFrappeOperation(baseInput({ mechanism: "source-json" }));
	const dispatch = await dispatchFrappeOperation({
		assessment,
		context: {
			now: 1000,
			projectRule: "allow",
			standingGrant: {
				source: "standing",
				scope: "the source of the app",
				site: "demo.local",
				app: "warehouse_app",
				effects: ["native-source"],
			},
		},
		workspace: "/bench",
		sessionId: "session-1",
		now: 1000,
	});
	assert.equal(dispatch.kind, "execute");
	assert.match(dispatch.reason, /permission that stands/);
});

test("an operation without a permission asks the human", async () => {
	const dir = temporary();
	try {
		const { runtime, delivered } = makeRuntime(dir);
		const assessment = assessFrappeOperation(
			baseInput({ mechanism: "source-json" }),
		);
		const dispatch = await dispatchFrappeOperation({
			assessment,
			context: { now: 1000, projectRule: "allow" },
			workspace: "/bench",
			sessionId: "session-1",
			now: 1000,
			approval: runtime,
		});
		assert.equal(dispatch.kind, "approval");
		assert.equal(dispatch.delivered, true);
		assert.equal(delivered.length, 1);
		assert.equal(
			delivered[0].requestId,
			frappeApprovalRequestId(dispatch.identity),
		);
		assert.equal(
			delivered[0].deadlineAt,
			undefined,
			"the question of a Frappe operation has no deadline",
		);
		assert.match(delivered[0].reason, /no permission covers/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline of a Frappe question never decides it", async () => {
	const dir = temporary();
	try {
		const { runtime, setNow, resumes } = makeRuntime(dir);
		const assessment = assessFrappeOperation(
			baseInput({ mechanism: "source-json" }),
		);
		const dispatch = await dispatchFrappeOperation({
			assessment,
			context: { now: 1000, projectRule: "allow" },
			workspace: "/bench",
			sessionId: "session-1",
			now: 1000,
			approval: runtime,
		});
		setNow(10_000_000);
		const decision = runtime.expire(dispatch.requestId);
		assert.equal(decision, null, "no deadline decides the question");
		assert.equal(resumes.length, 0);
		assert.equal(runtime.get(dispatch.requestId).state, "pending");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a destructive operation needs the answer of the human, even with a permission", async () => {
	const dir = temporary();
	try {
		const { runtime, delivered } = makeRuntime(dir);
		const assessment = assessFrappeOperation(
			baseInput({ mechanism: "destructive" }),
		);
		const dispatch = await dispatchFrappeOperation({
			assessment,
			context: {
				now: 1000,
				projectRule: "allow",
				standingGrant: {
					source: "standing",
					scope: "everything of the site",
					site: "demo.local",
					effects: ["destructive", "native-source", "customization"],
				},
			},
			workspace: "/bench",
			sessionId: "session-1",
			now: 1000,
			approval: runtime,
		});
		assert.equal(dispatch.kind, "approval");
		assert.match(dispatch.reason, /destroys data/);
		assert.equal(delivered.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a confirmation counts down in the pending actions and is asked once", async () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		const pending = createPendingActionRegistry();
		const assessment = assessFrappeOperation(
			baseInput({ mechanism: "source-json" }),
		);
		const context = {
			now: 1000,
			projectRule: "confirm",
			standingGrant: {
				source: "standing",
				scope: "the source of the app",
				site: "demo.local",
				app: "warehouse_app",
				effects: ["native-source"],
			},
		};
		const first = await dispatchFrappeOperation({
			assessment,
			context,
			workspace: "/bench",
			sessionId: "session-1",
			now: 1000,
			approval: runtime,
			pending,
			countdownMs: 5000,
		});
		assert.equal(first.kind, "countdown");
		assert.equal(first.deadlineAt, 6000);
		const second = await dispatchFrappeOperation({
			assessment,
			context,
			workspace: "/bench",
			sessionId: "session-1",
			now: 2000,
			approval: runtime,
			pending,
			countdownMs: 5000,
		});
		assert.equal(second.actionId, first.actionId);
		assert.equal(pending.list().length, 1, "the action is one move, not two");
		const action = pending.get(first.actionId);
		assert.equal(action.kind, "resume");
		assert.equal(action.state, "scheduled");
		assert.equal(action.dueAt, 7000);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an operation with incomplete evidence is refused before anything runs", async () => {
	const assessment = assessFrappeOperation(
		baseInput({
			mechanism: "source-json",
			ownership: {
				...ownOwnership,
				ambiguous: true,
				reason: "the apps ledger_app, warehouse_app define the DocType Item",
			},
		}),
	);
	const dispatch = await dispatchFrappeOperation({
		assessment,
		context: {
			now: 1000,
			projectRule: "allow",
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["native-source"],
			},
		},
		workspace: "/bench",
		sessionId: "session-1",
		now: 1000,
	});
	assert.equal(dispatch.kind, "blocked");
	assert.match(dispatch.reason, /incomplete|define the DocType/);
});

test("the operation that runs is the operation that was assessed", async () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "source-json" }),
	);
	let ran = 0;
	const result = await runFrappeOperation({
		assessment,
		state: {
			requestGeneration: 7,
			now: 1000,
		},
		run: async () => {
			ran += 1;
		},
	});
	assert.equal(result.ok, true);
	assert.equal(ran, 1);
});

test("a request that was cancelled or replaced stops the operation", async () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "source-json" }),
	);
	let ran = 0;
	const result = await runFrappeOperation({
		assessment,
		state: {
			requestGeneration: 8,
			now: 1000,
		},
		run: async () => {
			ran += 1;
		},
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /not the request that runs/);
	assert.equal(ran, 0);
});
