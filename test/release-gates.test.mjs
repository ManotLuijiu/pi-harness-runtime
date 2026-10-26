/**
 * The gates that stand between a commit and npm.
 *
 * Two scripts decide whether a release may publish:
 *
 *   - `verify-release-version.mjs` asks the registry what it has and
 *     says whether the version of the manifest can be published. A
 *     version that is already published, or one that is older than the
 *     newest published one, publishes nothing.
 *   - `verify-sensitive-check.mjs` reads the conclusion of the check
 *     that keeps a client name out, for the commit that is about to be
 *     published. A check that did not run is not a passed check.
 *
 * Both fail closed: an unreadable registry or an unreadable check
 * stops the release instead of letting it publish blind.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	VERSION_PATTERN,
	compareVersions,
	parseVersion,
} from "../scripts/verify-release-version.mjs";
import { verdict } from "../scripts/verify-sensitive-check.mjs";
import { SENSITIVE_TERMS_CHECK } from "../scripts/lib/github-checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** The evaluation of a check that concluded in a given way. */
function evaluationOf(conclusion, status = "completed") {
	return {
		checks: [
			{
				name: SENSITIVE_TERMS_CHECK,
				present: true,
				status,
				conclusion,
			},
		],
		missing: [],
		pending: status === "completed" ? [] : [SENSITIVE_TERMS_CHECK],
		failed:
			status === "completed" && conclusion !== "success"
				? [{ name: SENSITIVE_TERMS_CHECK, conclusion }]
				: [],
		ready: status === "completed",
		passed: status === "completed" && conclusion === "success",
	};
}

test("a version npm accepts is recognised", () => {
	for (const version of ["1.2.3", "0.0.1", "1.2.3-beta.1", "1.2.3+build.5"]) {
		assert.ok(VERSION_PATTERN.test(version), `${version} is not a version`);
	}
	for (const version of ["1.2", "v1.2.3", "1.2.3.4", "latest", ""]) {
		assert.equal(VERSION_PATTERN.test(version), false, `${version} is a version`);
	}
});

test("the parts of a version are read", () => {
	assert.deepEqual(parseVersion("1.2.3"), {
		major: 1,
		minor: 2,
		patch: 3,
		prerelease: [],
	});
	assert.deepEqual(parseVersion("1.2.3-beta.1").prerelease, ["beta", "1"]);
	assert.equal(parseVersion("nonsense"), null);
});

test("the order of two versions is the order npm uses", () => {
	assert.ok(compareVersions("1.2.3", "1.2.4") < 0);
	assert.ok(compareVersions("1.3.0", "1.2.9") > 0);
	assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
	// A prerelease is older than the release it belongs to.
	assert.ok(compareVersions("1.2.3-beta.1", "1.2.3") < 0);
	assert.ok(compareVersions("1.2.3-beta.2", "1.2.3-beta.1") > 0);
});

test("a check that concluded success lets the release through", () => {
	const result = verdict(evaluationOf("success"));
	assert.equal(result.passed, true);
	assert.match(result.reason, /concluded success/);
});

test("a check that did not run stops the release", () => {
	const evaluation = evaluationOf("success");
	evaluation.missing = [SENSITIVE_TERMS_CHECK];
	const result = verdict(evaluation);
	assert.equal(result.passed, false);
	assert.match(result.reason, /did not run/);
});

test("a check that is still running stops the release", () => {
	const result = verdict(evaluationOf(null, "in_progress"));
	assert.equal(result.passed, false);
	assert.match(result.reason, /did not finish/);
});

test("a check that did not succeed stops the release", () => {
	for (const conclusion of ["failure", "cancelled", "skipped", "neutral"]) {
		const result = verdict(evaluationOf(conclusion));
		assert.equal(result.passed, false, `${conclusion} let the release through`);
		assert.match(result.reason, /concluded/);
	}
});

test("the reason never carries a term", () => {
	const result = verdict(evaluationOf("failure"));
	assert.equal(result.reason.includes("sensitive"), true);
	// The reason names the check, not the list.
	assert.equal(result.reason.includes("SENSITIVE_TERMS"), false);
});

test("the gate scripts are in the repository", () => {
	for (const script of [
		"verify-release-version.mjs",
		"verify-sensitive-check.mjs",
	]) {
		assert.ok(
			existsSync(join(ROOT, "scripts", script)),
			`the repository has no scripts/${script}`,
		);
	}
});

test("the version gate fails closed when the registry cannot be read", () => {
	const source = readFileSync(
		join(ROOT, "scripts", "verify-release-version.mjs"),
		"utf8",
	);
	// A release that cannot tell whether its version exists must not
	// publish.
	assert.match(source, /could not be read/);
	assert.match(source, /process\.exit\(1\)/);
});

test("the check gate fails closed when the check cannot be read", () => {
	const source = readFileSync(
		join(ROOT, "scripts", "verify-sensitive-check.mjs"),
		"utf8",
	);
	assert.match(source, /could not be read/);
	assert.match(source, /process\.exit\(1\)/);
});
