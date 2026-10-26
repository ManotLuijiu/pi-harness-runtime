/**
 * The sensitive term workflow holds a secret, so its shape is a safety
 * property and not a matter of taste.
 *
 * `pull_request_target` is the trigger that makes the repository secret
 * available to a pull request from a fork. It is also the trigger that
 * runs a workflow in the context of the base branch while the pull
 * request is untrusted code. The two facts sit next to each other, so
 * the invariants below are the ones that keep the second one harmless:
 *
 *   - the head of the pull request is never checked out,
 *   - nothing of the pull request is built, installed or executed,
 *   - the credential of the checkout is not persisted,
 *   - the secret reaches one step and is never printed.
 *
 * The workflow is parsed as text. A YAML parser is not a dependency of
 * this package, and the invariants that matter here are about which
 * strings appear and how the file is shaped.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const workflow = readFileSync(
	join(ROOT, ".github", "workflows", "sensitive-terms.yml"),
	"utf8",
);

test("the workflow runs on pull_request_target, so a fork gets the secret", () => {
	assert.match(workflow, /pull_request_target:/);
	// A plain pull_request workflow gets no secret for a fork, and a
	// fork is where a pull request usually comes from.
	assert.equal(/^\s{2}pull_request:/m.test(workflow), false);
});

test("the workflow also runs on a push to a merge target", () => {
	// A required check has to be able to pass for a direct push. Without
	// a run of its own the check is never reported for the pushed
	// commit, and a branch that requires the check then refuses every
	// direct push.
	assert.match(workflow, /push:\n {4}branches: \[develop, main\]/);
});

test("one job and one check name serve both events", () => {
	// Two jobs under one name would let a skipped job replace the
	// result of the job that really scanned, and a skipped check counts
	// as a passed check.
	assert.equal((workflow.match(/name: No sensitive terms/g) ?? []).length, 1);
	assert.match(workflow, /^ {4}name: No sensitive terms$/m);
	// One job, so one check run per event. The name of a job is at four
	// spaces, the name of a step at six.
	const jobNames = workflow.match(/^ {4}name: .*$/gm) ?? [];
	assert.equal(jobNames.length, 1);
});

test("the pushed commit is the tree that is scanned", () => {
	// The content of a push is what has to be checked, so the tree of
	// the pushed commit is the tree the scanner reads.
	assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
	// The commit messages of the pushed commits are public too, so the
	// history has to come with the checkout.
	assert.match(workflow, /fetch-depth: 0/);
});

test("the checkout of the pushed commit only runs for a push", () => {
	// The checkout of the base branch belongs to the pull request path.
	// The two must not be mixed: one of them holds untrusted code in a
	// job that has a secret.
	assert.match(
		workflow,
		/- name: Checkout the pushed commit\n {8}if: github\.event_name == 'push'/,
	);
	assert.match(
		workflow,
		/- name: Checkout the base branch\n {8}if: github\.event_name == 'pull_request_target'/,
	);
});

test("the push path scans the tree and the commit messages of the push", () => {
	assert.match(workflow, /--tree \./);
	assert.match(workflow, /--commits "\$BEFORE_SHA\.\.\$HEAD_SHA"/);
});

test("a push without a base commit stops the check", () => {
	// A range that cannot be resolved would report a clean result for a
	// check that never ran.
	assert.match(workflow, /BEFORE_SHA" = "\$empty"/);
	assert.match(workflow, /exit 2/);
});

test("the workflow runs again when the pull request changes", () => {
	assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/);
});

test("the head of the pull request is never checked out", () => {
	// The head is untrusted code. A job that holds a secret must not
	// run it.
	assert.equal(workflow.includes("pull_request.head.sha"), false);
	assert.equal(workflow.includes("pull_request.head.ref"), false);
	assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.ref \}\}/);
});

test("the checkout is the current base branch and not the stale base commit", () => {
	// `base.sha` is the commit the pull request was opened against. It
	// can be months old, and the tree at that commit does not hold the
	// scanner - the check failed for exactly that reason on the first
	// run against a real pull request.
	assert.equal(workflow.includes("pull_request.base.sha"), false);
	// The current tip of the base branch.
	assert.match(workflow, /github\.event\.pull_request\.base\.ref/);
});

test("the check only runs for a pull request against a merge target", () => {
	// The tree that is checked out is the base branch, and the script
	// that runs comes out of that tree. A pull request against an
	// internal branch must not be scanned with it.
	assert.match(
		workflow,
		/github\.event\.pull_request\.base\.ref == 'develop'/,
	);
	assert.match(
		workflow,
		/github\.event\.pull_request\.base\.ref == 'main'/,
	);
});

test("the run says when the scanner is missing instead of failing on it", () => {
	// A missing scanner is a different fact from a finding, and the
	// log should say which one it is.
	assert.match(workflow, /test -f scripts\/check-sensitive-terms\.mjs/);
});

test("the checkout does not keep a credential", () => {
	assert.match(workflow, /persist-credentials: false/);
});

test("the workflow installs nothing and builds nothing", () => {
	for (const forbidden of [
		"bun install",
		"npm install",
		"npm ci",
		"npm run build",
		"bun run build",
		"tsc ",
	]) {
		assert.equal(
			workflow.includes(forbidden),
			false,
			`the workflow must not run "${forbidden}" in a job that holds a secret`,
		);
	}
});

test("the secret reaches the scan step and nothing else", () => {
	const steps = workflow.split(/\n {6}- name: /).slice(1);
	assert.ok(steps.length >= 2, "the workflow has a checkout and a scan step");
	const withSecret = steps.filter((step) => step.includes("secrets.SENSITIVE_TERMS"));
	assert.equal(withSecret.length, 1, "exactly one step reads the terms");
	assert.match(withSecret[0], /check-sensitive-terms\.mjs/);
});

test("the workflow never prints the terms", () => {
	// The log of a workflow run is public. A term that reaches it is
	// published a second time.
	assert.equal(/echo[^"'\n]*SENSITIVE_TERMS/.test(workflow), false);
	// The value is read exactly once, by the scan step.
	assert.equal((workflow.match(/secrets\.SENSITIVE_TERMS/g) ?? []).length, 1);
	// And it is bound to the environment of that step, nowhere else.
	assert.equal((workflow.match(/^\s+SENSITIVE_TERMS: /gm) ?? []).length, 1);
});

test("the workflow asks for no more than it reads", () => {
	assert.match(workflow, /permissions:\n {2}contents: read\n {2}pull-requests: read/);
	assert.equal(/write/.test(workflow), false);
});

test("the scan step runs the script of the tree that was checked out", () => {
	// For a pull request the script is the one of the base branch, so
	// a pull request cannot change the check that judges it. For a push
	// it is the one of the pushed commit, which is the tree that holds
	// the content that has to be checked.
	assert.match(workflow, /node scripts\/check-sensitive-terms\.mjs --pr "\$PR_NUMBER"/);
});
