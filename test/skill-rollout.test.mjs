/**
 * The rollout of the hybrid retrieval.
 *
 * The integration starts behind an opt-in flag. The tests prove that the
 * default is off, that an unknown value never opens the integration, that
 * the shadow compares the index with the lexical search without returning
 * its candidates, and that the rollback is the stage "off".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	compareShadow,
	decideRollout,
	ROLLOUT_FLAG,
	ROLLOUT_STAGES,
} from "../harness/skill-rollout.ts";

test("the hybrid retrieval is off by default", () => {
	const decision = decideRollout();
	assert.equal(decision.stage, "off");
	assert.equal(decision.useVector, false);
	assert.equal(decision.shadow, false);
});

test("an unknown stage never opens the integration", () => {
	const decision = decideRollout({ value: "everything" });
	assert.equal(decision.stage, "off");
	assert.equal(decision.useVector, false);
	assert.match(decision.reason, /unknown stage/);
});

test("the stages of the flag are the four of the plan", () => {
	assert.deepEqual(ROLLOUT_STAGES, ["off", "shadow", "pilot", "enabled"]);
	assert.equal(ROLLOUT_FLAG, "PI_SKILL_HYBRID_STAGE");
});

test("the shadow asks the index but leaves its candidates out", () => {
	const decision = decideRollout({ value: "shadow" });
	assert.equal(decision.stage, "shadow");
	assert.equal(decision.useVector, true);
	assert.equal(decision.shadow, true);
});

test("the pilot and the enabled stage return the fused candidates", () => {
	for (const value of ["pilot", "enabled"]) {
		const decision = decideRollout({ value });
		assert.equal(decision.useVector, true);
		assert.equal(decision.shadow, false);
	}
});

test("the rollback is the stage off and it touches nothing", () => {
	const decision = decideRollout({ value: "off" });
	assert.equal(decision.useVector, false);
	assert.match(decision.reason, /disabled/);
});

test("the comparison names the candidates the index would have added", () => {
	const comparison = compareShadow({
		lexical: ["a", "b"],
		index: ["b", "c"],
		fused: ["a", "b", "c"],
	});
	assert.equal(comparison.lexicalOnly, 2);
	assert.equal(comparison.indexOnly, 1);
	assert.equal(comparison.fused, 3);
	assert.equal(comparison.added, 1);
});
