/**
 * The checks of a commit, read from the GitHub API.
 *
 * A check is a result GitHub reports for a commit: a workflow job, a code
 * scanner, a bot. Two facts decide a merge:
 *
 *   - which checks exist for the commit, and
 *   - what each of them concluded.
 *
 * A check that does not exist yet is not a passed check, and a check that
 * is still running is not a passed check. Both are "not green", so a
 * decision that only looks at the conclusion of the checks it found
 * would merge a change whose gate never ran.
 *
 * The evaluation is a pure function, so the decision can be tested without
 * a network, and the polling lives in one place.
 */

/** The check that keeps a client name out of a change. */
export const SENSITIVE_TERMS_CHECK = "No sensitive terms";

/** The check of the CI of this repository. */
export const CI_CHECK = "Tests";

const API = "https://api.github.com";

/**
 * The run of a named check.
 *
 * @param {Array<{name?: string}>} checkRuns
 * @param {string} name
 */
export function findCheckRun(checkRuns, name) {
	if (!Array.isArray(checkRuns)) return undefined;
	return checkRuns.find((run) => run && run.name === name);
}

/**
 * The state of the checks that gate a merge.
 *
 * @param {Array<{name?: string, status?: string, conclusion?: string|null}>} checkRuns
 * @param {string[]} requiredNames the checks that have to be green
 */
export function evaluateChecks(checkRuns, requiredNames) {
	const runs = Array.isArray(checkRuns) ? checkRuns : [];
	const names = Array.isArray(requiredNames) ? requiredNames : [];
	const checks = names.map((name) => {
		const run = findCheckRun(runs, name);
		return {
			name,
			present: Boolean(run),
			status: run ? run.status : "missing",
			conclusion: run ? (run.conclusion ?? null) : null,
		};
	});
	const missing = checks
		.filter((check) => !check.present)
		.map((check) => check.name);
	const pending = checks
		.filter((check) => check.present && check.status !== "completed")
		.map((check) => check.name);
	const failed = checks
		.filter(
			(check) =>
				check.present &&
				check.status === "completed" &&
				check.conclusion !== "success",
		)
		.map((check) => ({
			name: check.name,
			conclusion: check.conclusion ?? "unknown",
		}));
	return {
		checks,
		missing,
		pending,
		failed,
		// Every required check exists and has finished.
		ready: missing.length === 0 && pending.length === 0,
		// Every required check exists, has finished and succeeded.
		passed: missing.length === 0 && pending.length === 0 && failed.length === 0,
	};
}

/**
 * The check runs GitHub reports for a commit.
 *
 * @param {{repo: string, sha: string, token: string, fetchImpl?: typeof fetch}} options
 */
export async function fetchCheckRuns({
	repo,
	sha,
	token,
	fetchImpl = fetch,
}) {
	const response = await fetchImpl(
		`${API}/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
		{
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"user-agent": "pi-harness-runtime",
			},
		},
	);
	if (!response.ok) {
		throw new Error(
			`the checks of ${sha} could not be read: HTTP ${response.status}`,
		);
	}
	const body = await response.json();
	return Array.isArray(body.check_runs) ? body.check_runs : [];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until every required check of a commit has finished.
 *
 * A workflow that starts when a pull request is pushed runs before the
 * checks of that push exist, so a decision taken at that moment would be
 * taken on an empty list. Polling is what makes the decision a decision
 * about the finished state of the checks.
 *
 * The wait ends when the checks have finished, or when the deadline
 * passed. A timeout is not a pass: the evaluation says which checks were
 * still missing or still running, and the caller decides.
 *
 * @param {{repo: string, sha: string, names: string[], token: string,
 *   timeoutMs?: number, intervalMs?: number, fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>}} options
 */
export async function waitForChecks({
	repo,
	sha,
	names,
	token,
	timeoutMs = 1_200_000,
	intervalMs = 15_000,
	fetchImpl = fetch,
	sleepImpl = sleep,
}) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const runs = await fetchCheckRuns({ repo, sha, token, fetchImpl });
		const evaluation = evaluateChecks(runs, names);
		if (evaluation.ready) return evaluation;
		if (Date.now() >= deadline) return evaluation;
		await sleepImpl(intervalMs);
	}
}

/**
 * A pull request, read from the REST API.
 *
 * @param {{repo: string, number: number, token: string, fetchImpl?: typeof fetch}} options
 */
export async function fetchPullRequest({
	repo,
	number,
	token,
	fetchImpl = fetch,
}) {
	const response = await fetchImpl(
		`${API}/repos/${repo}/pulls/${number}`,
		{
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"user-agent": "pi-harness-runtime",
			},
		},
	);
	if (!response.ok) {
		throw new Error(
			`the pull request #${number} could not be read: HTTP ${response.status}`,
		);
	}
	return await response.json();
}

/**
 * Run a GraphQL mutation.
 *
 * @param {{query: string, variables: Record<string, unknown>, token: string,
 *   fetchImpl?: typeof fetch}} options
 */
export async function graphql({
	query,
	variables,
	token,
	fetchImpl = fetch,
}) {
	const response = await fetchImpl(`${API}/graphql`, {
		method: "POST",
		headers: {
			accept: "application/vnd.github+json",
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
			"user-agent": "pi-harness-runtime",
		},
		body: JSON.stringify({ query, variables }),
	});
	if (!response.ok) {
		throw new Error(`the GraphQL call failed: HTTP ${response.status}`);
	}
	const body = await response.json();
	if (body.errors && body.errors.length > 0) {
		const message = body.errors
			.map((error) => error.message)
			.filter(Boolean)
			.join("; ");
		throw new Error(message || "the GraphQL call reported an error");
	}
	return body.data;
}

/**
 * Merge a pull request.
 *
 * The merge is the GraphQL mutation `mergePullRequest`, not the REST
 * endpoint. The REST endpoint of this repository answers 404 for a
 * merge, with every token that was tried, while the mutation merges
 * the same pull request - so a workflow that used the endpoint never
 * merged anything and only reported a failure.
 *
 * `expectedHeadOid` binds the merge to the commit that was checked. A
 * push to the pull request changes the head, the merge is refused for
 * the new head, and the new head has to pass the gates again.
 *
 * The answer says whether the pull request was merged. A refusal is not
 * an error of this script: the pull request waits for a human, and the
 * report says so.
 *
 * @param {{nodeId: string, headSha: string, token: string, method?: string, fetchImpl?: typeof fetch}} options
 */
export async function mergePullRequest({
	nodeId,
	headSha,
	token,
	method = "MERGE",
	fetchImpl = fetch,
}) {
	try {
		await graphql({
			token,
			fetchImpl,
			query: `mutation Merge($pr: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
				mergePullRequest(input: {
					pullRequestId: $pr,
					mergeMethod: $method,
					expectedHeadOid: $head
				}) {
					pullRequest { number state merged }
				}
			}`,
			variables: {
				pr: nodeId,
				method,
				head: headSha,
			},
		});
		return {
			merged: true,
			message: "the pull request is merged",
		};
	} catch (error) {
		const message = String(error && error.message ? error.message : error);
		// A pull request that GitHub refuses to merge is not merged.
		// That is a report, not a crash.
		return { merged: false, message };
	}
}
