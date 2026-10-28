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
 * One name can carry several runs. The push of a head commit and the
 * pull request of its merge ref are both reported on that commit, and
 * both are called "Tests". Every run of a required name counts, so the
 * gate does not depend on the order the API happens to list the runs
 * in, and the state of every run of the name is read: a run that is
 * still going is not green even when another run of the name is red.
 *
 * A run that is re-run keeps its number and gets a new attempt, and the
 * attempt that failed stays on the commit. The newest attempt of a run
 * is its state now, so a re-run of a failed job is what makes the gate
 * green again - the way GitHub itself reads the checks of a commit.
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
 * Every run of a named check.
 *
 * A name can carry more than one run. The push of a head commit and the
 * pull request of its merge ref are both reported on that commit, and
 * both are called "Tests": the first is the code of the branch, the
 * second is the code that would land on the release branch. A gate that
 * reads only one of them reads whichever the API happens to list first.
 *
 * @param {Array<{name?: string}>} checkRuns
 * @param {string} name
 * @returns {Array<{name?: string, status?: string, conclusion?: string|null}>}
 */
function findCheckRuns(checkRuns, name) {
	if (!Array.isArray(checkRuns)) return [];
	return checkRuns.filter((run) => run && run.name === name);
}

/**
 * The workflow run a check run belongs to.
 *
 * The url of a check run names the run it belongs to. A re-run of that
 * run keeps the number and gets a new attempt, so the attempts of one
 * run share it.
 *
 * @param {{details_url?: string, id?: number|string}} checkRun
 * @returns {string|null} the number of the run, or null when the url
 *   does not name one
 */
function runOf(checkRun) {
	const url = typeof checkRun?.details_url === "string" ? checkRun.details_url : "";
	const match = url.match(/\/actions\/runs\/(\d+)/);
	return match ? match[1] : null;
}

/**
 * Whether a check run is the newer of two attempts of one run.
 *
 * The attempt that started later is the state of the run now. The
 * number of the check run grows with every attempt, so it decides when
 * the times do not say.
 *
 * @param {{started_at?: string, id?: number|string}} candidate
 * @param {{started_at?: string, id?: number|string}} held
 */
function isNewer(candidate, held) {
	const started = Date.parse(candidate?.started_at ?? "");
	const heldStarted = Date.parse(held?.started_at ?? "");
	if (Number.isFinite(started) && Number.isFinite(heldStarted)) {
		if (started !== heldStarted) return started > heldStarted;
	}
	return Number(candidate?.id ?? 0) > Number(held?.id ?? 0);
}

/**
 * The newest attempt of every run among the check runs of a name.
 *
 * A re-run of a failed job leaves the attempt that failed on the
 * commit, and the attempt that is the newest is the state of the run
 * now. The attempts of one run therefore count once, and the newest one
 * decides - the way GitHub itself reads a check of a commit, where a
 * re-run of a failed job is what makes a protected branch mergeable
 * again.
 *
 * @param {Array<{details_url?: string, id?: number|string}>} runs
 */
function latestAttempts(runs) {
	const groups = new Map();
	runs.forEach((run, index) => {
		// A check run without a run of its own is its own group, so an
		// unknown run is counted instead of being merged into another.
		const key = runOf(run) ?? `check:${run?.id ?? index}`;
		const held = groups.get(key);
		if (!held || isNewer(run, held.run)) groups.set(key, { run, index });
	});
	return [...groups.values()].map((held) => held.run);
}

/**
 * The check runs of a name that decide the gate.
 *
 * @param {Array<{name?: string}>} checkRuns
 * @param {string} name
 */
function decidingRuns(checkRuns, name) {
	return latestAttempts(findCheckRuns(checkRuns, name));
}

/**
 * The worst of the runs that decide a check.
 *
 * A failure decides it, a run that is still going decides it, and only
 * when every run is green does the first one speak.
 *
 * @param {Array<{status?: string, conclusion?: string|null}>} runs
 */
function worstRun(runs) {
	if (runs.length === 0) return undefined;
	return (
		runs.find(
			(run) => run.status === "completed" && run.conclusion !== "success",
		) ??
		runs.find((run) => run.status !== "completed") ??
		runs[0]
	);
}

/**
 * The run of a named check that decides the gate.
 *
 * @param {Array<{name?: string}>} checkRuns
 * @param {string} name
 */
export function findCheckRun(checkRuns, name) {
	return worstRun(decidingRuns(checkRuns, name));
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
		// Every run of that name counts. The push of the head commit and
		// the pull request of its merge ref share the name, and the gate
		// must not depend on which of them the API lists first.
		const current = decidingRuns(runs, name);
		const deciding = worstRun(current);
		// The state of every run that counts, not only of the one that
		// decides: a run that is still going has to be seen even when
		// another run of the name is red.
		const failures = current.filter(
			(run) => run.status === "completed" && run.conclusion !== "success",
		);
		return {
			name,
			present: current.length > 0,
			status: deciding ? deciding.status : "missing",
			conclusion: deciding ? (deciding.conclusion ?? null) : null,
			runs: current.length,
			pending: current.some((run) => run.status !== "completed"),
			failures,
		};
	});
	const missing = checks
		.filter((check) => !check.present)
		.map((check) => check.name);
	const pending = checks
		.filter((check) => check.present && check.pending)
		.map((check) => check.name);
	const failed = checks
		.filter((check) => check.failures.length > 0)
		.map((check) => ({
			name: check.name,
			conclusion: check.failures[0].conclusion ?? "unknown",
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
