/**
 * The auto merge of a pull request from `develop` into `main`.
 *
 * `main` is the branch npm publishes, so a change that reaches it is a
 * change that can be published. The merge is therefore not a matter of
 * taste: the gates have to be green before it happens, and the gates
 * are named, because a check that does not exist is not a check that
 * passed.
 *
 * The decision is a pure function of what is known about the pull
 * request and about its checks, so it is tested here without a network.
 * The workflow around it is read as text, because the invariants that
 * matter are about its shape: what triggers it, what it is allowed to
 * do, and what it never runs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	CI_CHECK,
	SENSITIVE_TERMS_CHECK,
	evaluateChecks,
	findCheckRun,
	mergePullRequest,
} from "../scripts/lib/github-checks.mjs";
import {
	MERGE_TARGETS,
	REQUIRED_CHECKS,
	buildSummary,
	decideAutoMerge,
} from "../scripts/auto-merge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const workflow = readFileSync(
	join(ROOT, ".github", "workflows", "auto-merge.yml"),
	"utf8",
);

/** The pull request the tests work with. */
function pullRequest(overrides = {}) {
	return {
		node_id: "PR_node",
		number: 7,
		state: "open",
		draft: false,
		merged: false,
		base: { ref: "main" },
		head: {
			sha: "abc1234",
			repo: { full_name: "ManotLuijiu/pi-harness-runtime" },
		},
		...overrides,
	};
}

/** The check runs that say every gate is green. */
function greenChecks() {
	return [
		{ name: SENSITIVE_TERMS_CHECK, status: "completed", conclusion: "success" },
		{ name: CI_CHECK, status: "completed", conclusion: "success" },
	];
}

test("the gates are the two named checks", () => {
	assert.deepEqual(REQUIRED_CHECKS, [SENSITIVE_TERMS_CHECK, CI_CHECK]);
	assert.equal(SENSITIVE_TERMS_CHECK, "No sensitive terms");
	assert.equal(CI_CHECK, "Tests");
});

test("the merge target is the release branch", () => {
	assert.deepEqual(MERGE_TARGETS, ["main"]);
});

test("a check that is missing is not a passed check", () => {
	const evaluation = evaluateChecks([], REQUIRED_CHECKS);
	assert.equal(evaluation.ready, false);
	assert.equal(evaluation.passed, false);
	assert.deepEqual(evaluation.missing, [
		SENSITIVE_TERMS_CHECK,
		CI_CHECK,
	]);
});

test("a check that is running is not a passed check", () => {
	const evaluation = evaluateChecks(
		[
			{
				name: SENSITIVE_TERMS_CHECK,
				status: "in_progress",
				conclusion: null,
			},
			{ name: CI_CHECK, status: "completed", conclusion: "success" },
		],
		REQUIRED_CHECKS,
	);
	assert.equal(evaluation.ready, false);
	assert.equal(evaluation.passed, false);
	assert.deepEqual(evaluation.pending, [SENSITIVE_TERMS_CHECK]);
});

test("every conclusion that is not success is a failure", () => {
	for (const conclusion of [
		"failure",
		"cancelled",
		"skipped",
		"neutral",
		"timed_out",
		"action_required",
		"stale",
	]) {
		const evaluation = evaluateChecks(
			[
				{
					name: SENSITIVE_TERMS_CHECK,
					status: "completed",
					conclusion,
				},
				{ name: CI_CHECK, status: "completed", conclusion: "success" },
			],
			REQUIRED_CHECKS,
		);
		assert.equal(evaluation.passed, false, `${conclusion} counted as green`);
		assert.equal(evaluation.failed.length, 1);
	}
});

test("both checks green means the change is ready", () => {
	const evaluation = evaluateChecks(greenChecks(), REQUIRED_CHECKS);
	assert.equal(evaluation.ready, true);
	assert.equal(evaluation.passed, true);
});

test("the check that is found is the check that is named", () => {
	const runs = [{ name: "Something else" }, { name: SENSITIVE_TERMS_CHECK }];
	assert.equal(findCheckRun(runs, SENSITIVE_TERMS_CHECK)?.name, SENSITIVE_TERMS_CHECK);
	assert.equal(findCheckRun(runs, CI_CHECK), undefined);
});

test("a green pull request is merged", () => {
	const decision = decideAutoMerge({
		evaluation: evaluateChecks(greenChecks(), REQUIRED_CHECKS),
		pullRequest: pullRequest(),
		repository: "ManotLuijiu/pi-harness-runtime",
	});
	assert.equal(decision.action, "enable");
});

test("a change from another repository waits for a human", () => {
	const decision = decideAutoMerge({
		evaluation: evaluateChecks(greenChecks(), REQUIRED_CHECKS),
		pullRequest: pullRequest({
			head: {
				sha: "abc1234",
				repo: { full_name: "someone-else/pi-harness-runtime" },
			},
		}),
		repository: "ManotLuijiu/pi-harness-runtime",
	});
	assert.equal(decision.action, "skip");
});

test("a draft, a closed and a merged pull request are left alone", () => {
	for (const overrides of [
		{ draft: true },
		{ state: "closed" },
		{ merged: true },
	]) {
		const decision = decideAutoMerge({
			evaluation: evaluateChecks(greenChecks(), REQUIRED_CHECKS),
			pullRequest: pullRequest(overrides),
			repository: "ManotLuijiu/pi-harness-runtime",
		});
		assert.equal(decision.action, "skip");
	}
});

test("a pull request into another branch is left alone", () => {
	const decision = decideAutoMerge({
		evaluation: evaluateChecks(greenChecks(), REQUIRED_CHECKS),
		pullRequest: pullRequest({ base: { ref: "develop" } }),
		repository: "ManotLuijiu/pi-harness-runtime",
	});
	assert.equal(decision.action, "skip");
});

test("a missing gate turns the auto merge off", () => {
	const decision = decideAutoMerge({
		evaluation: evaluateChecks(
			[
				{
					name: SENSITIVE_TERMS_CHECK,
					status: "completed",
					conclusion: "success",
				},
			],
			REQUIRED_CHECKS,
		),
		pullRequest: pullRequest(),
		repository: "ManotLuijiu/pi-harness-runtime",
	});
	assert.equal(decision.action, "disable");
});

test("a failed gate turns the auto merge off", () => {
	const decision = decideAutoMerge({
		evaluation: evaluateChecks(
			[
				{
					name: SENSITIVE_TERMS_CHECK,
					status: "completed",
					conclusion: "failure",
				},
				{ name: CI_CHECK, status: "completed", conclusion: "success" },
			],
			REQUIRED_CHECKS,
		),
		pullRequest: pullRequest(),
		repository: "ManotLuijiu/pi-harness-runtime",
	});
	assert.equal(decision.action, "disable");
});

test("a gate that is still running turns the auto merge off", () => {
	const decision = decideAutoMerge({
		evaluation: evaluateChecks(
			[
				{
					name: SENSITIVE_TERMS_CHECK,
					status: "in_progress",
					conclusion: null,
				},
				{ name: CI_CHECK, status: "completed", conclusion: "success" },
			],
			REQUIRED_CHECKS,
		),
		pullRequest: pullRequest(),
		repository: "ManotLuijiu/pi-harness-runtime",
	});
	assert.equal(decision.action, "disable");
});

test("the report names the checks and never the terms", () => {
	const summary = buildSummary({
		decision: decideAutoMerge({
			evaluation: evaluateChecks(greenChecks(), REQUIRED_CHECKS),
			pullRequest: pullRequest(),
			repository: "ManotLuijiu/pi-harness-runtime",
		}),
		evaluation: evaluateChecks(greenChecks(), REQUIRED_CHECKS),
	});
	assert.match(summary, /No sensitive terms/);
	assert.match(summary, /Tests/);
	assert.match(summary, /enable/);
});

test("the workflow runs on the pull request, not on its code", () => {
	// `pull_request_target` runs the workflow with the base of the
	// repository and the rights of the repository. `pull_request` would
	// run the code of the change, which is the thing the guard is for.
	assert.match(workflow, /pull_request_target:/);
	assert.doesNotMatch(workflow, /^\s{2}pull_request:/m);
});

test("the workflow checks out the base and keeps no credentials", () => {
	assert.match(workflow, /actions\/checkout@v4/);
	assert.match(workflow, /persist-credentials: false/);
	// The checkout is of the base of the pull request.
	assert.match(workflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.ref\s*\}\}/);
});

test("the workflow runs only the script of the base", () => {
	assert.match(workflow, /scripts\/auto-merge\.mjs/);
	// Nothing of the change is installed, built or run.
	assert.doesNotMatch(workflow, /bun install/);
	assert.doesNotMatch(workflow, /npm install/);
	assert.doesNotMatch(workflow, /build-packages/);
});

test("the workflow has the rights it needs and no more", () => {
	assert.match(workflow, /contents:\s*read/);
	assert.match(workflow, /pull-requests:\s*write/);
	assert.match(workflow, /checks:\s*read/);
	// The merge of a pull request writes to the repository contents.
	// The permission is on the job that merges, and that job runs the
	// merger of the base branch - never the code of the pull request.
	assert.match(workflow, /contents:\s*write/);
	// The scanner of the sensitive terms is the privileged workflow that
	// looks at the change of somebody else. It only reads.
	const scanner = readFileSync(
		join(ROOT, ".github", "workflows", "sensitive-terms.yml"),
		"utf8",
	);
	assert.doesNotMatch(scanner, /contents:\s*write/);
	assert.doesNotMatch(scanner, /pull-requests:\s*write/);
});

test("the workflow waits for the checks of the pull request", () => {
	// The checks of the reviewed commit are the gates, and a new push
	// changes the commit.
	assert.match(workflow, /PR_NUMBER/);
	assert.match(workflow, /GITHUB_TOKEN/);
});

test("the workflow merges only the release branch", () => {
	assert.match(workflow, /branches:\s*\[main\]/);
	assert.doesNotMatch(workflow, /branches:\s*\[[^\]]*develop/);
});

test("a manual run can open the release pull request", () => {
	// The token of a machine does not always have the permission to
	// open a pull request. The token of a workflow has it.
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /open_release_pr/);
	assert.match(workflow, /gh pr create --base main --head develop/);
	// The pull request is opened once, not again and again.
	assert.match(workflow, /gh pr list --base main --head develop/);
});

test("the manual run never runs the change it pulls", () => {
	// The job that opens the pull request checks out the branch the
	// release was prepared on. It names the head of the pull request
	// and does nothing else with it.
	const job = workflow.slice(
		workflow.indexOf("open-release-pr:"),
		workflow.length,
	);
	assert.match(job, /ref:\s*\$\{\{\s*github\.ref\s*\}\}/);
	// It opens a pull request, it does not merge one by itself.
	assert.doesNotMatch(job, /gh pr merge/);
	// The merge is the auto merge of GitHub, and it is turned on by the
	// judge of the repository.
	assert.match(job, /scripts\/auto-merge\.mjs/);
	assert.match(job, /PR_NUMBER/);
});

test("the manual run and the merge are separate jobs", () => {
	// The merge only happens for a pull request event, so a manual run
	// cannot merge anything by accident.
	assert.match(
		workflow,
		/merge:\n[\s\S]*?if:\s*github\.event_name == 'pull_request_target'/,
	);
	assert.match(
		workflow,
		/open-release-pr:\n[\s\S]*?if:\s*github\.event_name == 'workflow_dispatch'/,
	);
});

test("the merge is bound to the head commit that was checked", async () => {
	// The merge names the head commit. A pull request that moved on
	// after the check is refused by GitHub, so the commit that was
	// checked is the commit that is merged.
	let seen = null;
	const fetchImpl = async (url, init) => {
		seen = { url, body: JSON.parse(init.body) };
		return {
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ merged: true, message: "Pull Request successfully merged" }),
		};
	};

	const result = await mergePullRequest({
		repo: "owner/repo",
		number: 7,
		headSha: "abc123",
		token: "t",
		fetchImpl,
	});

	assert.equal(result.merged, true);
	assert.equal(seen.url, "https://api.github.com/repos/owner/repo/pulls/7/merge");
	assert.equal(seen.body.sha, "abc123");
	assert.equal(seen.body.merge_method, "merge");
});

test("a refused merge is a report and not a crash", async () => {
	// A branch rule can refuse the merge. That is not an error of the
	// script: the pull request waits for a human.
	const fetchImpl = async () => ({
		ok: false,
		status: 405,
		text: async () => JSON.stringify({ message: "Pull Request is not mergeable" }),
	});

	const result = await mergePullRequest({
		repo: "owner/repo",
		number: 7,
		headSha: "abc123",
		token: "t",
		fetchImpl,
	});

	assert.equal(result.merged, false);
	assert.equal(result.status, 405);
	assert.match(result.message, /not mergeable/);
});
