#!/usr/bin/env node
/**
 * The check of this repository that keeps a client name out of a change,
 * seen for the commit that is about to be published.
 *
 * The repository checks every push for a client name. The release
 * publishes the tree of a commit, so the release waits for the check of
 * that commit and stops when it did not pass.
 *
 * A check that never ran is not a passed check, and a check that was
 * skipped is not a passed check. The script reads the conclusion of the
 * check and nothing else: it never prints a term and never prints the
 * line that matched.
 *
 * The check of a push is reported for the pushed commit, so the commit
 * that is published is the commit that was checked.
 */

import {
	SENSITIVE_TERMS_CHECK,
	evaluateChecks,
	waitForChecks,
} from "./lib/github-checks.mjs";
import { pathToFileURL } from "node:url";

/**
 * The conclusion of the check, and whether it lets a release through.
 *
 * @param {ReturnType<typeof evaluateChecks>} evaluation
 */
export function verdict(evaluation) {
	if (evaluation.missing.length > 0) {
		return {
			passed: false,
			reason: `${SENSITIVE_TERMS_CHECK} did not run for this commit`,
		};
	}
	if (evaluation.pending.length > 0) {
		return {
			passed: false,
			reason: `${SENSITIVE_TERMS_CHECK} did not finish for this commit`,
		};
	}
	const failure = evaluation.failed[0];
	if (failure) {
		return {
			passed: false,
			reason: `${SENSITIVE_TERMS_CHECK} concluded ${failure.conclusion}`,
		};
	}
	return { passed: true, reason: `${SENSITIVE_TERMS_CHECK} concluded success` };
}

async function main() {
	const token = process.env.GITHUB_TOKEN;
	const repository = process.env.GITHUB_REPOSITORY;
	const sha = process.env.COMMIT_SHA || process.env.GITHUB_SHA;

	if (!token || !repository || !sha) {
		console.error(
			"the check gate needs GITHUB_TOKEN, GITHUB_REPOSITORY and COMMIT_SHA.",
		);
		process.exit(2);
	}

	console.log(`The check ${SENSITIVE_TERMS_CHECK} of ${sha} is read.`);

	let evaluation;
	try {
		evaluation = await waitForChecks({
			repo: repository,
			sha,
			names: [SENSITIVE_TERMS_CHECK],
			token,
			timeoutMs: 900_000,
			intervalMs: 15_000,
		});
	} catch (error) {
		console.error(
			`the checks of ${sha} could not be read: ${
				error && error.message ? error.message : String(error)
			}`,
		);
		// The check could not be read, so the release cannot know that
		// it passed. It stops.
		process.exit(1);
	}

	const result = verdict(evaluation);
	console.log(result.reason);
	if (!result.passed) {
		process.exit(1);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await main();
}
