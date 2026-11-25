import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { tagMainRelease } from "../scripts/tag-main-release.mjs";

const repository = "fixture/runtime";
const sha = "a".repeat(40);
const head = "b".repeat(40);
const check = (name) => ({ name, status: "completed", conclusion: "success" });

function fixture(overrides = {}) {
	const state = {
		manifest: { name: "pi-harness-runtime", version: "1.1.529" },
		existing: null,
		checks: [check("Tests"), check("No sensitive terms")],
		pr: { merged_at: "2026-01-01", merge_commit_sha: sha, base: { ref: "main" },
			head: { ref: "develop", sha: head, repo: { full_name: repository } } },
		...overrides,
	};
	const calls = [];
	let mainReads = 0;
	const fetchImpl = async (url, options) => {
		const path = url.replace(`https://api.github.com/repos/${repository}/`, "");
		calls.push({ path, ...options });
		let body;
		let status = 200;
		if (path === "git/ref/heads/main") {
			mainReads++;
			body = { object: { sha: state.moved && mainReads > 1 ? head : sha } };
		} else if (path === `contents/package.json?ref=${sha}`) {
			body = { encoding: "base64", content: Buffer.from(JSON.stringify(state.manifest)).toString("base64") };
		} else if (path.startsWith("git/ref/tags/")) {
			body = state.existing;
			if (!body) status = state.tagStatus ?? 404;
		} else if (path.startsWith("git/tags/")) {
			body = { object: { type: "commit", sha } };
		} else if (path === `commits/${sha}/pulls?per_page=100`) {
			body = state.pr ? [state.pr] : [];
		} else if (path === `commits/${head}/check-runs?per_page=100`) {
			body = { check_runs: state.checks };
		} else if (path === "git/refs" && options.method === "POST") {
			body = JSON.parse(options.body);
			status = state.writeStatus ?? 201;
		} else throw new Error(`unexpected API path: ${path}`);
		return new Response(JSON.stringify(body), { status });
	};
	return { calls, run: () => tagMainRelease({ repository, readToken: "reader", writeToken: "writer", fetchImpl }) };
}

test("a verified merged main release gets an App-authenticated version tag", async () => {
	const f = fixture();
	assert.deepEqual(await f.run(), { tag: "v1.1.529", sha, created: true });
	const writes = f.calls.filter((call) => call.method === "POST");
	assert.equal(writes.length, 1);
	assert.deepEqual(JSON.parse(writes[0].body), { ref: "refs/tags/v1.1.529", sha });
	assert.equal(writes[0].headers.authorization, "Bearer writer");
	assert.ok(f.calls.filter((call) => call.method === "GET").every((call) => call.headers.authorization === "Bearer reader"));
});

for (const type of ["commit", "tag"]) {
	test(`an existing ${type} tag on this commit is idempotent`, async () => {
		const f = fixture({ existing: { object: { type, sha } } });
		assert.equal((await f.run()).created, false);
		assert.ok(f.calls.every((call) => call.method !== "POST"));
	});
}

for (const [title, overrides, reason] of [
	["a tag on another commit", { existing: { object: { type: "commit", sha: head } } }, /will not be moved/],
	["a major/minor version", { manifest: { name: "pi-harness-runtime", version: "1.2.0" } }, /1\.1\.x/],
	["a foreign package", { manifest: { name: "another-package", version: "1.1.529" } }, /1\.1\.x/],
	["a direct main push", { pr: null }, /same-repository/],
	["missing checks", { checks: [] }, /passing Tests/],
	["a failed check", { checks: [check("No sensitive terms"), { ...check("Tests"), conclusion: "failure" }] }, /passing Tests/],
	["a pending check", { checks: [check("No sensitive terms"), { ...check("Tests"), status: "in_progress", conclusion: null }] }, /passing Tests/],
	["main moving during the read", { moved: true }, /main moved/],
	["an unreadable tag ref", { tagStatus: 403 }, /HTTP 403/],
]) {
	test(`no release tag is written for ${title}`, async () => {
		const f = fixture(overrides);
		await assert.rejects(f.run(), reason);
		assert.ok(f.calls.every((call) => call.method !== "POST"));
	});
}

test("a fork PR cannot become a release", async () => {
	const f = fixture({ pr: { merged_at: "2026-01-01", merge_commit_sha: sha, base: { ref: "main" },
		head: { ref: "develop", sha: head, repo: { full_name: "foreign/runtime" } } } });
	await assert.rejects(f.run(), /same-repository/);
	assert.ok(f.calls.every((call) => call.method !== "POST"));
});

test("a refused tag write is a failure, not a reported release", async () => {
	await assert.rejects(fixture({ writeStatus: 403 }).run(), /HTTP 403/);
});

test("tagging runs trusted main after Auto merge and uses the App token", () => {
	const workflow = parse(readFileSync(new URL("../.github/workflows/tag-release.yml", import.meta.url), "utf8"));
	assert.deepEqual(workflow.on.workflow_run, { workflows: ["Auto merge"], types: ["completed"] });
	assert.equal(workflow.concurrency["cancel-in-progress"], false);
	assert.match(workflow.jobs.tag.if, /conclusion == 'success'/);
	assert.match(workflow.jobs.tag.if, /head_repository.full_name == github.repository/);
	const steps = workflow.jobs.tag.steps;
	assert.equal(steps.find((step) => step.uses === "actions/checkout@v4").with.ref, "main");
	assert.equal(steps.find((step) => step.id === "tag-app").with["permission-contents"], "write");
	assert.equal(steps.at(-1).env.RELEASE_TAG_TOKEN, "${{ steps.tag-app.outputs.token }}");
});

test("the release script dispatches GitHub rather than opening a PR with local credentials", () => {
	const script = readFileSync(new URL("../scripts/release-all.ts", import.meta.url), "utf8");
	assert.match(script, /gh workflow run auto-merge.yml --ref develop -f open_release_pr=true/);
	assert.doesNotMatch(script, /gh pr create/);
	assert.doesNotMatch(script, /After the merge: bun scripts\/release-all.ts --tag/);
});

test("Dependabot groups compatible updates and defers the tracked major migrations", () => {
	const config = parse(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));
	const update = config.updates[0];
	assert.equal(update["target-branch"], "develop");
	assert.equal(update.automerge, undefined);
	assert.equal(update["open-pull-request-strategy"], undefined);
	assert.deepEqual(update.groups["compatible-updates"]["update-types"], ["minor", "patch"]);
	assert.deepEqual(update.ignore.map((item) => item["dependency-name"]), ["openai", "@types/node", "@commitlint/cli"]);
});
