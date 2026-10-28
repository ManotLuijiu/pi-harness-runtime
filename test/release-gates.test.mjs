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
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	VERSION_PATTERN,
	compareVersions,
	parseVersion,
} from "../scripts/verify-release-version.mjs";
import { verdict } from "../scripts/verify-sensitive-check.mjs";
import { SENSITIVE_TERMS_CHECK, evaluateChecks } from "../scripts/lib/github-checks.mjs";
import { scanTree } from "../scripts/check-sensitive-terms.mjs";

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

test("the release gate reads the runs of a check, not one of them", () => {
	// The check of a commit can be reported by more than one run: the
	// push of the branch and the pull request of the merge ref. The
	// release gate reads the runs of the check, so a second run that is
	// red stops the release and a run that is still going stops it too.
	const check = (run, overrides) => ({
		name: SENSITIVE_TERMS_CHECK,
		status: "completed",
		conclusion: "success",
		details_url: `https://github.com/ManotLuijiu/pi-harness-runtime/actions/runs/${run}/job/1`,
		started_at: "2026-10-28T18:00:00Z",
		...overrides,
	});
	const green = evaluateChecks([check(1, {})], [SENSITIVE_TERMS_CHECK]);
	assert.equal(verdict(green).passed, true);

	const withRed = evaluateChecks(
		[
			check(1, { id: 100 }),
			check(2, { id: 200, conclusion: "failure" }),
		],
		[SENSITIVE_TERMS_CHECK],
	);
	const red = verdict(withRed);
	assert.equal(red.passed, false);
	assert.match(red.reason, /concluded/);

	const withRunning = evaluateChecks(
		[
			check(1, { id: 100 }),
			check(2, { id: 200, status: "in_progress", conclusion: null }),
		],
		[SENSITIVE_TERMS_CHECK],
	);
	assert.equal(verdict(withRunning).passed, false);
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

test("a commit without a check is decided by the scan of the release", () => {
	// A commit that a workflow merged has no push side check: GitHub
	// starts no run for a push that the token of a workflow made. The
	// release scans the tree itself, so a missing check is not a
	// failure - but only when that scan is there.
	const evaluation = evaluationOf("success");
	evaluation.missing = [SENSITIVE_TERMS_CHECK];
	const result = verdict(evaluation, { allowMissing: true });
	assert.equal(result.passed, true);
	assert.match(result.reason, /did not run/);
	assert.match(result.reason, /scans the tree/);
});

test("a missing check without the scan of the release still stops it", () => {
	const evaluation = evaluationOf("success");
	evaluation.missing = [SENSITIVE_TERMS_CHECK];
	const result = verdict(evaluation);
	assert.equal(result.passed, false);
});

test("a failed or unfinished check stops the release even with the scan", () => {
	// The scan of the release is the control for a commit that has no
	// check. A check that exists and failed is a different thing: it is
	// a known bad result, and the release does not publish it.
	const failed = verdict(evaluationOf("failure"), { allowMissing: true });
	assert.equal(failed.passed, false);
	assert.match(failed.reason, /concluded failure/);

	const pending = verdict(evaluationOf(null, "in_progress"), {
		allowMissing: true,
	});
	assert.equal(pending.passed, false);
	assert.match(pending.reason, /did not finish/);
});

test("the release scans the whole tree of the released commit", () => {
	const workflow = readFileSync(
		join(ROOT, ".github", "workflows", "release.yml"),
		"utf8",
	);
	// The tree of the released commit is scanned with the secret, and
	// the scan is what replaces the check that a workflow merge cannot
	// produce.
	assert.match(workflow, /check-sensitive-terms\.mjs --tree \./);
	// The check of the commit may be missing - the tree scan is there.
	assert.match(workflow, /verify-sensitive-check\.mjs --allow-missing/);
	// The scan of the tree runs before the publish.
	const scan = workflow.indexOf("check-sensitive-terms.mjs --tree .");
	const publish = workflow.lastIndexOf("npm publish");
	assert.ok(scan > 0 && publish > 0, "the workflow has both steps");
	assert.ok(scan < publish, "the tree is scanned before the publish");
});

test("a tree scan finds a term in the name of a file", () => {
	// A file that carries a name in its name leaks the name, and the
	// content of the file says nothing about it.
	const dir = mkdtempSync(join(tmpdir(), "tree-name-"));
	writeFileSync(join(dir, "placeholder-name.txt"), "nothing here\n");
	const hits = scanTree(dir, ["placeholder-name"]);
	assert.equal(hits.hits.length, 1);
	assert.equal(hits.hits[0].line, 0);
	rmSync(dir, { recursive: true, force: true });
});
