#!/usr/bin/env node
/**
 * Merge a pull request - but only when every gate is green.
 *
 * The change is merged by this script, when the gates are green. The
 * auto merge of GitHub is not used: it merges a pull request as soon as
 * it may, and "as soon as it may" is not "when the gates of this
 * repository are green" - the gates of this repository are the required
 * checks of the branch only when an administrator made them so.
 *
 * The merge names the head commit that was checked. A pull request that
 * moved on after the check is refused by GitHub, so the commit that was
 * checked is the commit that is merged.
 *
 * The gates are the checks of the head commit of the pull request. Two
 * of them decide:
 *
 *   - "No sensitive terms" - the check that keeps a client name out of
 *     the change. A change that holds a name never reaches a merge.
 *   - "Tests" - the CI of this repository.
 *
 * A check that does not exist yet is not a passed check. The script
 * waits for the checks of the head commit to finish, because a workflow
 * that starts when a pull request is pushed runs before the checks of
 * that push exist.
 *
 * The script never runs the code of the pull request, and it never
 * prints a client name: it reads check names and conclusions, nothing
 * else. The check that holds the names does the reading.
 */

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	CI_CHECK,
	SENSITIVE_TERMS_CHECK,
	disableAutoMerge,
	evaluateChecks,
	fetchPullRequest,
	mergePullRequest,
	waitForChecks,
} from "./lib/github-checks.mjs";

/** The checks that have to be green before a change is merged. */
export const REQUIRED_CHECKS = [SENSITIVE_TERMS_CHECK, CI_CHECK];

/**
 * The branches a change is merged into.
 *
 * The release branch is `main`, and `main` is the branch that npm
 * publishes. A change reaches it from `develop` through the merge gate,
 * so the merge gate is what moves a reviewed change from `develop` into
 * `main`. A pull request into `develop` is merged by a human: the
 * working branch is where the work happens, and a change there is
 * reviewed by the person who wrote it.
 */
export const MERGE_TARGETS = ["main"];

/**
 * What to do with a pull request: merge it, or let it wait.
 *
 * The decision is a pure function of what is known about the pull
 * request and about its checks, so it can be tested without a network.
 *
 * @param {{evaluation: ReturnType<typeof evaluateChecks>,
 *   pullRequest: Record<string, any> | null, repository: string}} options
 */
export function decideAutoMerge({ evaluation, pullRequest, repository }) {
	if (!pullRequest) {
		return { action: "skip", reasons: ["the pull request could not be read"] };
	}
	if (pullRequest.merged) {
		return { action: "skip", reasons: ["the pull request is merged"] };
	}
	if (pullRequest.state !== "open") {
		return {
			action: "skip",
			reasons: [`the pull request is ${pullRequest.state}`],
		};
	}
	if (pullRequest.draft) {
		return { action: "skip", reasons: ["the pull request is a draft"] };
	}
	const base = pullRequest.base && pullRequest.base.ref;
	if (!MERGE_TARGETS.includes(base)) {
		return {
			action: "skip",
			reasons: [`the merge target ${base ?? "unknown"} is not a release branch`],
		};
	}
	const head = pullRequest.head && pullRequest.head.repo;
	if (head && head.full_name && head.full_name !== repository) {
		// A change from another repository is merged by a human. The
		// gates of this repository say nothing about what a stranger
		// wrote, and a stranger gets no auto merge.
		return {
			action: "skip",
			reasons: ["the change comes from another repository"],
		};
	}
	if (evaluation.failed.length > 0) {
		return {
			action: "disable",
			reasons: evaluation.failed.map(
				(failure) => `${failure.name} concluded ${failure.conclusion}`,
			),
		};
	}
	if (!evaluation.ready) {
		const reasons = [];
		if (evaluation.missing.length > 0) {
			reasons.push(`${evaluation.missing.join(", ")} did not run`);
		}
		if (evaluation.pending.length > 0) {
			reasons.push(`${evaluation.pending.join(", ")} did not finish`);
		}
		return { action: "disable", reasons };
	}
	return { action: "enable", reasons: ["every gate is green"] };
}

/**
 * The report of the run. It names the checks and their conclusions and
 * never a client name.
 *
 * @param {{decision: {action: string, reasons: string[]},
 *   evaluation: ReturnType<typeof evaluateChecks>}} options
 */
export function buildSummary({ decision, evaluation }) {
	const lines = [];
	lines.push("## Auto merge");
	lines.push("");
	lines.push(`Decision: **${decision.action}**`);
	lines.push("");
	for (const reason of decision.reasons) {
		lines.push(`- ${reason}`);
	}
	lines.push("");
	lines.push("| Check | Status | Conclusion |");
	lines.push("| --- | --- | --- |");
	for (const check of evaluation.checks) {
		lines.push(
			`| ${check.name} | ${check.status} | ${check.conclusion ?? "-"} |`,
		);
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

/**
 * Write the report to the summary of the run, when there is one.
 *
 * @param {string} text
 */
function writeSummary(text) {
	const path = process.env.GITHUB_STEP_SUMMARY;
	if (!path) return;
	try {
		appendFileSync(path, text);
	} catch {
		// A missing summary is not a reason to fail the run.
	}
}

async function main() {
	const token = process.env.GITHUB_TOKEN;
	const repository = process.env.GITHUB_REPOSITORY;
	const number = Number(process.env.PR_NUMBER);

	if (!token || !repository || !Number.isInteger(number)) {
		console.error(
			"auto merge needs GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER.",
		);
		process.exit(2);
	}

	let pullRequest = null;
	try {
		pullRequest = await fetchPullRequest({
			repo: repository,
			number,
			token,
		});
	} catch (error) {
		console.error(String(error && error.message ? error.message : error));
		process.exit(2);
	}

	const headSha = pullRequest.head && pullRequest.head.sha;
	if (!headSha) {
		console.error("the pull request has no head commit.");
		process.exit(2);
	}

	console.log(
		`The checks of ${headSha} are read until they have finished.`,
	);
	const evaluation = await waitForChecks({
		repo: repository,
		sha: headSha,
		names: REQUIRED_CHECKS,
		token,
	});

	// The pull request is read again: it can have been merged while the
	// checks were running, and a merged pull request has no auto merge.
	try {
		pullRequest = await fetchPullRequest({
			repo: repository,
			number,
			token,
		});
	} catch {
		// The state that was read first is used. It is older, and it
		// can only lead to a merge that GitHub then refuses.
	}

	const decision = decideAutoMerge({ evaluation, pullRequest, repository });
	writeSummary(buildSummary({ decision, evaluation }));

	for (const reason of decision.reasons) {
		console.log(reason);
	}

	if (decision.action === "enable") {
		// The merge is done here, with the head commit that was
		// checked.
		//
		// The auto merge of GitHub is not used: it merges a pull
		// request as soon as it may, and "as soon as it may" is not
		// "when the gates of this repository are green" - the gates of
		// this repository are not the required checks of the branch
		// unless an administrator made them so. The merge here happens
		// only after the gates were read and found green, and the head
		// commit that was checked is the head commit that is merged.
		const merged = await mergePullRequest({
			repo: repository,
			number,
			headSha,
			token,
		});
		if (merged.merged) {
			console.log("The pull request is merged.");
			return;
		}
		console.log(`The pull request was not merged: ${merged.message}`);
		console.log("It waits for a human.");
		// The job did not merge anything, and a job that merged nothing
		// is not a success. A red check on the pull request says so.
		process.exit(1);
	}

	if (decision.action === "disable") {
		try {
			await disableAutoMerge({ nodeId: pullRequest.node_id, token });
			console.log(
				"The auto merge is off. The pull request waits for a human.",
			);
		} catch (error) {
			// The auto merge could not be taken back - the token is not
			// allowed to. There was no auto merge of this workflow, so
			// there is nothing that has to be taken back.
			const message = String(
				error && error.message ? error.message : error,
			);
			console.log(`The auto merge was left as it is: ${message}`);
			console.log("The pull request waits for a human.");
		}
		// The job did not merge anything, and a job that merged nothing
		// is not a success. A red check on the pull request says so.
		process.exit(1);
	}

	console.log("The pull request is not merged by this workflow.");
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await main();
}
