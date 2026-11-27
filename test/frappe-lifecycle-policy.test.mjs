/**
 * The policy of a Frappe lifecycle operation.
 *
 * The decision is deterministic and the evidence comes first: the owner of
 * a DocType decides the mechanism, the mechanism decides the effect, and
 * the effect decides what may happen. Nothing here runs a command of a
 * bench and nothing here writes to a site.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	assessFrappeOperation,
	decideFrappeOperation,
	frappeOperationIdentity,
	grantCovers,
	recheckFrappeOperation,
} from "../harness/frappe-lifecycle-policy.ts";

/** The owner of a DocType of the app of the operation. */
const ownOwnership = {
	doctype: "Item",
	ownerApp: "warehouse_app",
	namespace: "warehouse_app",
	module: "stock",
	sourceJson: "/bench/apps/warehouse_app/warehouse_app/stock/doctype/item/item.json",
	standard: true,
	databaseOnly: false,
	customFields: [],
	fixtures: [],
	evidence: [],
	ambiguous: false,
};

/** The owner of a DocType of another app. */
const foreignOwnership = {
	...ownOwnership,
	doctype: "Journal",
	ownerApp: "ledger_app",
	namespace: "ledger_app",
	module: "accounts",
	sourceJson: "/bench/apps/ledger_app/ledger_app/accounts/doctype/journal/journal.json",
};

/** A DocType that only the database knows. */
const databaseOwnership = {
	doctype: "Ghost",
	ownerApp: undefined,
	namespace: undefined,
	module: undefined,
	sourceJson: undefined,
	standard: false,
	databaseOnly: true,
	customFields: [],
	fixtures: [],
	evidence: [],
	ambiguous: false,
	reason: "the DocType Ghost has no source JSON in the bench",
};

/** A DocType that two apps define. */
const ambiguousOwnership = {
	...ownOwnership,
	ambiguous: true,
	reason: "the apps ledger_app, warehouse_app define the DocType Item",
};

/** The base of an operation that changes a site. */
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

test("the change of the source of an owned DocType is a native source change", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "source-json" }),
	);
	assert.equal(assessment.effect, "native-source");
	assert.equal(assessment.risk, "low");
	assert.deepEqual(assessment.unknowns, []);
});

test("the source of the DocType of another app is not changed", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "source-json", ownership: foreignOwnership }),
	);
	assert.equal(assessment.effect, "unknown");
	assert.match(assessment.unknowns.join(" "), /belongs to the app ledger_app/);
});

test("the customization of the DocType of another app uses the Custom Field", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "custom-field", ownership: foreignOwnership }),
	);
	assert.equal(assessment.effect, "customization");
});

test("a native field is not duplicated by a Custom Field record", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "custom-field" }),
	);
	assert.equal(assessment.effect, "unknown");
	assert.match(assessment.unknowns.join(" "), /would duplicate it/);
});

test("a DocType of the database has no source JSON to edit", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "source-json", ownership: databaseOwnership }),
	);
	assert.equal(assessment.effect, "unknown");
	assert.match(assessment.unknowns.join(" "), /needs a migration or a Custom Field/);
});

test("an owner that is not clear blocks the operation", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "source-json", ownership: ambiguousOwnership }),
	);
	assert.equal(assessment.effect, "unknown");
	assert.match(assessment.unknowns.join(" "), /define the DocType Item/);
});

test("an operation without a site does not run", () => {
	const assessment = assessFrappeOperation(
		baseInput({ target: { app: "warehouse_app" } }),
	);
	assert.match(assessment.unknowns.join(" "), /site of the operation is not known/);
});

test("an operation whose size is unknown does not run", () => {
	const assessment = assessFrappeOperation(
		baseInput({ workload: { bounded: false, steps: 0 } }),
	);
	assert.match(assessment.unknowns.join(" "), /size of the work is not known/);
});

test("an operation that is not registered anywhere does not run", () => {
	const assessment = assessFrappeOperation(baseInput({ registration: {} }));
	assert.match(assessment.unknowns.join(" "), /not registered in a hook/);
});

test("an operation whose idempotency is unknown does not run", () => {
	const assessment = assessFrappeOperation(
		baseInput({ idempotency: "unknown" }),
	);
	assert.match(assessment.unknowns.join(" "), /run twice/);
});

test("an incomplete evidence blocks the operation", () => {
	const assessment = assessFrappeOperation(baseInput({ workload: {} }));
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "blocked");
	assert.match(decision.reason, /evidence of the operation is incomplete/);
});

test("the permission that stands lets the operation run", () => {
	const assessment = assessFrappeOperation(baseInput());
	const decision = decideFrappeOperation(assessment, {
		now: 1000,
		standingGrant: {
			source: "standing",
			scope: "the seeds of the demo site",
			site: "demo.local",
			app: "warehouse_app",
			effects: ["data-migration"],
		},
	});
	assert.equal(decision.decision, "execute");
	assert.equal(decision.requiresNotification, false);
});

test("without a permission the human is asked", () => {
	const assessment = assessFrappeOperation(baseInput());
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "approval-required");
	assert.equal(decision.requiresNotification, true);
});

test("a permission of another site does not cover the operation", () => {
	const assessment = assessFrappeOperation(baseInput());
	const decision = decideFrappeOperation(assessment, {
		now: 1000,
		standingGrant: {
			source: "standing",
			scope: "the seeds of another site",
			site: "other.local",
			effects: ["data-migration"],
		},
	});
	assert.equal(decision.decision, "approval-required");
});

test("an expired permission does not cover the operation", () => {
	const assessment = assessFrappeOperation(baseInput());
	const decision = decideFrappeOperation(assessment, {
		now: 2000,
		standingGrant: {
			source: "standing",
			scope: "the seeds of the demo site",
			site: "demo.local",
			effects: ["data-migration"],
			expiresAt: 1000,
		},
	});
	assert.equal(decision.decision, "approval-required");
});

test("the rule of the project asks for the approval of the human", () => {
	const assessment = assessFrappeOperation(baseInput());
	const decision = decideFrappeOperation(assessment, {
		now: 1000,
		projectRule: "require-approval",
		standingGrant: {
			source: "standing",
			scope: "the seeds of the demo site",
			site: "demo.local",
			effects: ["data-migration"],
		},
	});
	assert.equal(decision.decision, "approval-required");
});

test("the rule of the project asks for a confirmation", () => {
	const assessment = assessFrappeOperation(baseInput());
	const withoutGrant = decideFrappeOperation(assessment, {
		now: 1000,
		projectRule: "confirm",
	});
	assert.equal(withoutGrant.decision, "approval-required");
	const withGrant = decideFrappeOperation(assessment, {
		now: 1000,
		projectRule: "confirm",
		standingGrant: {
			source: "standing",
			scope: "the seeds of the demo site",
			site: "demo.local",
			effects: ["data-migration"],
		},
	});
	assert.equal(withGrant.decision, "countdown");
});

test("an operation that destroys data needs the human", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "destructive" }),
	);
	const decision = decideFrappeOperation(assessment, {
		now: 1000,
		projectRule: "confirm",
		standingGrant: {
			source: "standing",
			scope: "everything of the demo site",
			site: "demo.local",
			effects: ["destructive"],
		},
	});
	assert.equal(decision.decision, "approval-required");
	assert.match(decision.reason, /destroys data/);
});

test("the place of the routine does not permit an operation that destroys data", () => {
	const assessment = assessFrappeOperation(
		baseInput({
			mechanism: "destructive",
			insideConvention: {
				inside: true,
				reason: "the routine is in the commands directory of the namespace",
				verified: true,
			},
		}),
	);
	assert.equal(assessment.effect, "destructive");
	assert.equal(assessment.risk, "critical");
});

test("the claim of the idempotency is not evidence", () => {
	const assessment = assessFrappeOperation(baseInput({ idempotency: "claimed" }));
	assert.match(
		assessment.unknowns.join(" "),
		/the claim was not inspected/,
		"the claim of the request is not the inspection of the bench",
	);
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "blocked");
});

test("the place of the routine that was not inspected is unknown", () => {
	const assessment = assessFrappeOperation(
		baseInput({
			insideConvention: {
				inside: true,
				reason: "the routine is in the setup directory",
			},
		}),
	);
	assert.match(
		assessment.unknowns.join(" "),
		/the routine is in the setup directory/,
		"the reason of the claim names what was not inspected",
	);
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "blocked");
});

test("the size of the work that was not inspected is unknown", () => {
	const assessment = assessFrappeOperation(
		baseInput({ workload: { bounded: true, steps: 3 } }),
	);
	assert.match(assessment.unknowns.join(" "), /the size of the work was not inspected/);
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "blocked");
});

test("a routine outside the convention is blocked", () => {
	const assessment = assessFrappeOperation(
		baseInput({
			insideConvention: {
				inside: false,
				reason:
					"the path warehouse_app/utils/clean.py is not in the commands, the setup or a module of the namespace warehouse_app",
				verified: true,
			},
		}),
	);
	assert.deepEqual(assessment.unknowns, []);
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "blocked");
	assert.match(decision.reason, /not in the commands, the setup or a module/);
});

test("a routine that deletes records is destructive", () => {
	const assessment = assessFrappeOperation(
		baseInput({
			mechanism: "hook",
			calleeEffect: {
				destructive: true,
				reason: "the source of the routine deletes records",
			},
		}),
	);
	assert.equal(assessment.effect, "destructive");
	assert.equal(assessment.risk, "high");
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "approval-required");
});

test("the destructive effect does not need the evidence of the automatic path", () => {
	const assessment = assessFrappeOperation(
		baseInput({
			mechanism: "destructive",
			insideConvention: {
				inside: true,
				reason: "the routine is in the setup directory",
			},
			workload: { bounded: false, steps: 0 },
			idempotency: "unknown",
		}),
	);
	assert.deepEqual(assessment.unknowns, []);
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "approval-required");
	assert.match(decision.reason, /destroys data/);
});

test("the judge does not lift a restriction", () => {
	const assessment = assessFrappeOperation(
		baseInput({ mechanism: "source-json", ownership: foreignOwnership }),
	);
	const decision = decideFrappeOperation(assessment, {
		now: 1000,
		jev: { effect: "read-only", reason: "the judge believes the operation is safe" },
	});
	assert.equal(decision.decision, "blocked");
});

test("an operation that reads nothing runs", () => {
	const assessment = assessFrappeOperation(
		baseInput({
			mechanism: "read-only",
			target: { bench: "/bench", app: "warehouse_app" },
		}),
	);
	const decision = decideFrappeOperation(assessment, { now: 1000 });
	assert.equal(decision.decision, "execute");
});

test("the identity of an operation is the identity of the work", () => {
	const first = assessFrappeOperation(baseInput());
	const second = assessFrappeOperation(baseInput({ requestGeneration: 9 }));
	const other = assessFrappeOperation(
		baseInput({
			target: { ...baseInput().target, site: "other.local" },
		}),
	);
	assert.equal(first.identity, second.identity);
	assert.notEqual(first.identity, other.identity);
	assert.equal(frappeOperationIdentity(first), first.identity);
});

test("the permission that stands covers the operation it names", () => {
	const assessment = assessFrappeOperation(baseInput());
	const grant = {
		source: "standing",
		scope: "the seeds of the demo site",
		site: "demo.local",
		effects: ["data-migration"],
	};
	assert.ok(grantCovers(grant, assessment, 1000));
	assert.equal(grantCovers({ ...grant, site: "other.local" }, assessment, 1000), undefined);
	assert.equal(
		grantCovers({ ...grant, expiresAt: 500 }, assessment, 1000),
		undefined,
	);
	assert.equal(
		grantCovers({ ...grant, effects: ["customization"] }, assessment, 1000),
		undefined,
	);
});

test("the check before the dispatch lets a sound operation run", () => {
	const assessment = assessFrappeOperation(baseInput());
	const result = recheckFrappeOperation(assessment, {
		requestGeneration: assessment.requestGeneration,
		now: 1000,
		checksPassed: true,
	});
	assert.equal(result.ok, true);
});

test("a cancelled request stops the dispatch", () => {
	const assessment = assessFrappeOperation(baseInput());
	const result = recheckFrappeOperation(assessment, {
		requestGeneration: assessment.requestGeneration,
		now: 1000,
		cancelled: true,
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /cancelled/);
});

test("a new request stops the dispatch", () => {
	const assessment = assessFrappeOperation(baseInput());
	const result = recheckFrappeOperation(assessment, {
		requestGeneration: assessment.requestGeneration + 1,
		now: 1000,
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /not the request that runs/);
});

test("code that changed after the assessment stops the dispatch", () => {
	const assessment = assessFrappeOperation(
		baseInput({ reviewedHash: "abc" }),
	);
	const result = recheckFrappeOperation(assessment, {
		requestGeneration: assessment.requestGeneration,
		now: 1000,
		reviewedHash: "abc",
		currentHash: "def",
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /code changed/);
});

test("another operation of the same target stops the dispatch", () => {
	const assessment = assessFrappeOperation(baseInput());
	const result = recheckFrappeOperation(assessment, {
		requestGeneration: assessment.requestGeneration,
		now: 1000,
		conflictingOperation: true,
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /another operation/);
});

test("a permission that ended stops the dispatch", () => {
	const assessment = assessFrappeOperation(
		baseInput({
			authorization: {
				source: "standing",
				scope: "the seeds of the demo site",
				site: "demo.local",
				effects: ["data-migration"],
			},
		}),
	);
	const result = recheckFrappeOperation(assessment, {
		requestGeneration: assessment.requestGeneration,
		now: 1000,
		authorization: {
			source: "standing",
			scope: "the seeds of the demo site",
			site: "demo.local",
			effects: ["data-migration"],
			expiresAt: 500,
		},
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /not valid any more/);
});
