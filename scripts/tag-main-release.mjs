import { pathToFileURL } from "node:url";
import { evaluateChecks, fetchCheckRuns, CI_CHECK, SENSITIVE_TERMS_CHECK } from "./lib/github-checks.mjs";

/** Tag only the main commit produced by a tested, same-repository release PR. */
export async function tagMainRelease({ repository, readToken, writeToken, fetchImpl = fetch }) {
	if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !readToken || !writeToken) {
		throw new Error("repository and both release credentials are required");
	}
	const base = `https://api.github.com/repos/${repository}`;
	async function api(path, { method = "GET", body, allowMissing = false } = {}) {
		const response = await fetchImpl(`${base}/${path}`, {
			method,
			headers: {
				accept: "application/vnd.github+json",
				"content-type": "application/json",
				authorization: `Bearer ${method === "GET" ? readToken : writeToken}`,
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		if (allowMissing && response.status === 404) return null;
		if (!response.ok) throw new Error(`release API ${method} ${path}: HTTP ${response.status}`);
		return response.json();
	}
	const main = await api("git/ref/heads/main");
	const sha = main.object?.sha;
	if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("main has no valid commit");
	const file = await api(`contents/package.json?ref=${sha}`);
	if (file.encoding !== "base64") throw new Error("the main manifest is not readable");
	const manifest = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
	if (manifest.name !== "pi-harness-runtime" || !/^1\.1\.\d+$/.test(manifest.version ?? "")) {
		throw new Error("main must carry a pi-harness-runtime 1.1.x release");
	}
	const tag = `v${manifest.version}`;
	const existing = await api(`git/ref/tags/${tag}`, { allowMissing: true });
	if (existing) {
		let object = existing.object;
		for (let depth = 0; object?.type === "tag" && depth < 5; depth++) {
			object = (await api(`git/tags/${object.sha}`)).object;
		}
		if (object?.type !== "commit" || object.sha !== sha) {
			throw new Error(`${tag} already names a different commit; it will not be moved`);
		}
		return { tag, sha, created: false };
	}
	const associated = await api(`commits/${sha}/pulls?per_page=100`);
	const release = associated.find((pr) =>
		pr.merged_at && pr.merge_commit_sha === sha && pr.base?.ref === "main" &&
		pr.head?.ref === "develop" && pr.head?.repo?.full_name === repository,
	);
	if (!release?.head?.sha) throw new Error("main is not the merge of a same-repository develop release PR");
	const checks = await fetchCheckRuns({ repo: repository, sha: release.head.sha, token: readToken, fetchImpl });
	if (!evaluateChecks(checks, [CI_CHECK, SENSITIVE_TERMS_CHECK]).passed) {
		throw new Error("the merged release head does not have passing Tests and No sensitive terms");
	}
	const current = await api("git/ref/heads/main");
	if (current.object?.sha !== sha) throw new Error("main moved during preparation; retry the tag workflow");
	await api("git/refs", { method: "POST", body: { ref: `refs/tags/${tag}`, sha } });
	return { tag, sha, created: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const result = await tagMainRelease({
			repository: process.env.GITHUB_REPOSITORY,
			readToken: process.env.GITHUB_TOKEN,
			writeToken: process.env.RELEASE_TAG_TOKEN,
		});
		console.log(`${result.tag} at ${result.sha}: ${result.created ? "created; publication triggered" : "already tagged"}`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
