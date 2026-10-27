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
 *
 * A commit that was merged by a workflow has no push side check at all.
 * GitHub does not start a new workflow run for a push that the token of
 * a workflow made, so the merge of the merge gate never produces a
 * check of the merge commit. The release of such a commit waits for a
 * check that can never arrive, and it would wait for nothing.
 *
 * The release therefore has two controls, and this script is the first
 * one of them:
 *
 *   - the check of the commit, when there is one. A check that failed
 *     stops the release, and so does a check that has not finished: an
 *     unfinished check is an unknown result, and an unknown result is
 *     not a passed check.
 *   - the scan of the release itself, over the whole tree of the
 *     released commit and over the commit messages of the released
 *     range. That scan runs in the release workflow, it fails closed
 *     when the term list is unavailable, and it covers the same ground
 *     as the check of a push.
 *
 * `--allow-missing` tells this script that the second control is there
 * and that it is the one that decides when the first control does not
 * exist. It changes nothing for a check that exists: a failed check
 * still stops the release, and so does a check that is still running.
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
 * @param {{allowMissing?: boolean}} [options]
 */
export function verdict(evaluation, options = {}) {
	if (evaluation.missing.length > 0) {
		if (options.allowMissing) {
			// No check exists for this commit. The release scans the
			// tree and the commit messages itself, and that scan is
			// the control that decides.
			return {
				passed: true,
				reason: `${SENSITIVE_TERMS_CHECK} did not run for this commit; the release scans the tree and the commit messages itself`,
			};
		}
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
	// A commit that no workflow ever pushed has no check. The release
	// scans the tree itself, so the missing check does not stop it.
	const allowMissing = process.argv.includes("--allow-missing");

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
			// A check that exists is waited for. A commit that has no
			// check at all would be waited for forever, so the wait
			// is short when a missing check is allowed.
			timeoutMs: allowMissing ? 120_000 : 900_000,
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

	const result = verdict(evaluation, { allowMissing });
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
