import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CI_CHECK, SENSITIVE_TERMS_CHECK, fetchPullRequest, mergePullRequest, waitForChecks } from "./lib/github-checks.mjs";

/** Eligibility is separate from the release merger: develop is not a release target. */
export function dependencyEligibility({ pullRequest: pr, repository, metadata, files }) {
	if (!pr || pr.state !== "open" || pr.merged || pr.draft) return "the dependency PR is not open and ready";
	if (pr.base?.ref !== "develop" || pr.head?.repo?.full_name !== repository) return "the dependency PR is not a same-repository change into develop";
	if (pr.user?.login !== "dependabot[bot]" || pr.user?.type !== "Bot") return "the PR was not opened by Dependabot";
	if (!pr.head?.ref?.startsWith("dependabot/bun/")) return "the branch is not a Bun Dependabot branch";
	if (metadata.ecosystem !== "bun" || metadata.targetBranch !== "develop") return "the verified metadata does not describe a Bun update into develop";
	if (!["version-update:semver-minor", "version-update:semver-patch"].includes(metadata.updateType)) return "major or unknown dependency updates require review";
	if (metadata.maintainerChanges !== "false") return "maintainer changes or unknown metadata require review";
	const names = metadata.dependencyNames?.split(",").map((name) => name.trim()).filter(Boolean);
	if (!names?.length) return "verified dependency names are missing";
	if (names.some((name) => name.startsWith("@earendil-works/"))) return "Pi runtime API migrations require review";
	if (!files?.length || files.length !== pr.changed_files) return "the complete dependency diff was not read";
	if (files.some((file) => file.status !== "modified" || !/^(?:bun\.lock|package\.json|packages\/[^/]+\/package\.json)$/.test(file.filename))) return "the PR changes files outside dependency manifests and the lockfile";
	return null;
}

/** Independently reject manifest edits beyond stable minor/patch version changes. */
export function manifestSafety(before, after) {
	const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
	const other = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => !sections.includes(key)));
	if (!isDeepStrictEqual(other(before), other(after))) return "the manifest changes non-dependency settings";
	for (const section of sections) {
		const old = before[section] ?? {};
		const next = after[section] ?? {};
		for (const name of new Set([...Object.keys(old), ...Object.keys(next)])) {
			if (old[name] === next[name]) continue;
			const from = /^[~^]?(\d+)\.(\d+)\.(\d+)$/.exec(old[name] ?? "");
			const to = /^[~^]?(\d+)\.(\d+)\.(\d+)$/.exec(next[name] ?? "");
			if (!from || !to) return "a dependency was added, removed or changed to an unclassified range";
			const a = from.slice(1).map(Number), b = to.slice(1).map(Number);
			if (a[0] !== b[0] || b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])) return "the manifest contains a major update or downgrade";
		}
	}
	return null;
}

export async function mergeDependencyPr({ repository, number, token, expectedHead, metadata, fetchImpl = fetch, waitImpl = waitForChecks, mergeImpl = mergePullRequest }) {
	if (!repository || !token || !Number.isSafeInteger(number) || number < 1 || !/^[a-f0-9]{40}$/.test(expectedHead ?? "")) throw new Error("repository, PR number, token and captured head are required");
	let pr = await fetchPullRequest({ repo: repository, number, token, fetchImpl });
	if (pr.head?.sha !== expectedHead) throw new Error("the PR head changed after metadata capture");
	const files = [];
	for (let page = 1; page <= 30; page++) {
		const response = await fetchImpl(`https://api.github.com/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`, {
			headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}` },
		});
		if (!response.ok) throw new Error(`dependency diff could not be read: HTTP ${response.status}`);
		const batch = await response.json();
		if (!Array.isArray(batch)) throw new Error("dependency diff is not readable");
		files.push(...batch);
		if (batch.length < 100) break;
	}
	let reason = dependencyEligibility({ pullRequest: pr, repository, metadata, files });
	if (reason) return { action: "skip", reason };
	if (!/^[a-f0-9]{40}$/.test(pr.base?.sha ?? "")) throw new Error("the base commit could not be identified");
	for (const file of files.filter((item) => item.filename.endsWith("package.json"))) {
		const manifests = await Promise.all([pr.base.sha, expectedHead].map(async (ref) => {
			const response = await fetchImpl(`https://api.github.com/repos/${repository}/contents/${file.filename}?ref=${ref}`, {
				headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}` },
			});
			if (!response.ok) throw new Error(`dependency manifest could not be read: HTTP ${response.status}`);
			const body = await response.json();
			if (body.encoding !== "base64") throw new Error("dependency manifest is not readable");
			return JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
		}));
		reason = manifestSafety(...manifests);
		if (reason) return { action: "skip", reason };
	}
	const evaluation = await waitImpl({ repo: repository, sha: expectedHead, names: [CI_CHECK, SENSITIVE_TERMS_CHECK], token, fetchImpl });
	if (!evaluation.passed) return { action: "hold", reason: "Tests and No sensitive terms must both pass on the captured head" };
	pr = await fetchPullRequest({ repo: repository, number, token, fetchImpl });
	if (pr.merged) return { action: "skip", reason: "the dependency PR is already merged" };
	if (pr.head?.sha !== expectedHead) throw new Error("the PR head changed while waiting for checks");
	reason = dependencyEligibility({ pullRequest: pr, repository, metadata, files });
	if (reason) return { action: "skip", reason };
	const result = await mergeImpl({ nodeId: pr.node_id, headSha: expectedHead, token, fetchImpl });
	if (!result.merged) throw new Error("GitHub refused the checked dependency merge");
	return { action: "merge", reason: "verified minor/patch dependency update passed both exact-head gates" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const result = await mergeDependencyPr({
			repository: process.env.GITHUB_REPOSITORY,
			number: Number(process.env.PR_NUMBER),
			token: process.env.GITHUB_TOKEN,
			expectedHead: process.env.EXPECTED_HEAD,
			metadata: {
				ecosystem: process.env.DEPENDENCY_ECOSYSTEM,
				targetBranch: process.env.DEPENDENCY_TARGET,
				updateType: process.env.DEPENDENCY_UPDATE_TYPE,
				dependencyNames: process.env.DEPENDENCY_NAMES,
				maintainerChanges: process.env.DEPENDENCY_MAINTAINER_CHANGES,
			},
		});
		console.log(`${result.action}: ${result.reason}`);
		if (result.action === "hold") process.exitCode = 1;
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
