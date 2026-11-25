import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { dependencyEligibility, manifestSafety, mergeDependencyPr } from "../scripts/merge-dependency-pr.mjs";

const repository = "fixture/runtime";
const head = "a".repeat(40);
const metadata = { ecosystem: "bun", targetBranch: "develop", updateType: "version-update:semver-minor", dependencyNames: "ws,yaml", maintainerChanges: "false" };
const files = [{ filename: "package.json", status: "modified" }, { filename: "bun.lock", status: "modified" }];
const pullRequest = { node_id: "PR_fixture", state: "open", draft: false, merged: false, changed_files: 2,
	user: { login: "dependabot[bot]", type: "Bot" }, base: { ref: "develop", sha: "c".repeat(40) },
	head: { ref: "dependabot/bun/develop/compatible-updates", sha: head, repo: { full_name: repository } } };
const classify = (overrides = {}) => dependencyEligibility({ repository, metadata, files, pullRequest, ...overrides });

test("only verified compatible dependency changes into develop are eligible", () => {
	assert.equal(classify(), null);
	assert.equal(classify({ metadata: { ...metadata, updateType: "version-update:semver-patch" } }), null);
});

for (const [name, overrides] of [
	["major updates", { metadata: { ...metadata, updateType: "version-update:semver-major" } }],
	["unknown update classifications", { metadata: { ...metadata, updateType: "" } }],
	["Pi migrations", { metadata: { ...metadata, dependencyNames: "yaml,@earendil-works/pi-durable" } }],
	["maintainer changes", { metadata: { ...metadata, maintainerChanges: "true" } }],
	["missing verified names", { metadata: { ...metadata, dependencyNames: "" } }],
	["human authors", { pullRequest: { ...pullRequest, user: { login: "maintainer", type: "User" } } }],
	["forks", { pullRequest: { ...pullRequest, head: { ...pullRequest.head, repo: { full_name: "foreign/runtime" } } } }],
	["other targets", { pullRequest: { ...pullRequest, base: { ref: "main" } } }],
	["drafts", { pullRequest: { ...pullRequest, draft: true } }],
	["closed PRs", { pullRequest: { ...pullRequest, state: "closed" } }],
	["source-code edits", { files: [files[0], { filename: "index.ts", status: "modified" }] }],
	["workflow edits", { files: [files[0], { filename: ".github/workflows/ci.yml", status: "modified" }] }],
	["renamed files", { files: [files[0], { filename: "bun.lock", status: "renamed" }] }],
	["a truncated diff", { pullRequest: { ...pullRequest, changed_files: 3 } }],
]) {
	test(`manual review is retained for ${name}`, () => assert.ok(classify(overrides)));
}

function fixture({ changedHead = false, initialHead = head, passed = true, mergeAccepted = true, updateType = metadata.updateType } = {}) {
	const merges = [];
	let reads = 0;
	let waited = false;
	const options = {
		repository, number: 7, token: "synthetic", expectedHead: head,
		metadata: { ...metadata, updateType },
		fetchImpl: async (url) => {
			if (url.includes("/files?")) return new Response(JSON.stringify(files));
			if (url.includes("/contents/")) return new Response(JSON.stringify({ encoding: "base64", content: Buffer.from(JSON.stringify({ dependencies: { yaml: url.endsWith(head) ? "^2.9.1" : "^2.9.0" } })).toString("base64") }));
			reads++;
			return new Response(JSON.stringify({ ...pullRequest, head: { ...pullRequest.head,
				sha: changedHead && reads > 1 ? "b".repeat(40) : initialHead } }));
		},
		waitImpl: async (input) => {
			waited = true;
			assert.equal(input.sha, head);
			assert.deepEqual(input.names, ["Tests", "No sensitive terms"]);
			return { passed };
		},
		mergeImpl: async (input) => { merges.push(input); return { merged: mergeAccepted }; },
	};
	return { merges, waited: () => waited, run: () => mergeDependencyPr(options) };
}

test("both gates must pass before an expected-head merge is submitted", async () => {
	const f = fixture();
	assert.equal((await f.run()).action, "merge");
	assert.equal(f.merges.length, 1);
	assert.equal(f.merges[0].headSha, head);
	assert.equal(f.merges[0].nodeId, pullRequest.node_id);
});

test("failed, pending or missing gates never merge", async () => {
	const f = fixture({ passed: false });
	assert.equal((await f.run()).action, "hold");
	assert.equal(f.merges.length, 0);
});

test("a head change during checks invalidates the metadata and merge", async () => {
	const f = fixture({ changedHead: true });
	await assert.rejects(f.run(), /head changed/);
	assert.equal(f.merges.length, 0);
});

test("a head change before metadata use stops before waiting", async () => {
	const f = fixture({ initialHead: "b".repeat(40) });
	await assert.rejects(f.run(), /head changed/);
	assert.equal(f.waited(), false);
	assert.equal(f.merges.length, 0);
});

test("major updates never wait for or submit an automatic merge", async () => {
	const f = fixture({ updateType: "version-update:semver-major" });
	assert.equal((await f.run()).action, "skip");
	assert.equal(f.waited(), false);
	assert.equal(f.merges.length, 0);
});

test("a refused merge is not reported as successful", async () => {
	await assert.rejects(fixture({ mergeAccepted: false }).run(), /refused/);
});

test("manifest contents independently reject a major update mislabeled as minor", () => {
	assert.ok(manifestSafety({ dependencies: { sdk: "^1.2.3" } }, { dependencies: { sdk: "^2.0.0" } }));
	assert.equal(manifestSafety({ dependencies: { sdk: "^1.2.3" } }, { dependencies: { sdk: "^1.3.0" } }), null);
});

test("dependency automation cannot alter scripts, add dependencies or downgrade", () => {
	assert.ok(manifestSafety({ scripts: { test: "safe" } }, { scripts: { test: "changed" } }));
	assert.ok(manifestSafety({}, { dependencies: { sdk: "1.0.0" } }));
	assert.ok(manifestSafety({ dependencies: { sdk: "^1.2.3" } }, { dependencies: { sdk: "^1.2.2" } }));
});

test("the privileged workflow reads trusted develop and verifies metadata before merging", () => {
	const workflow = parse(readFileSync(new URL("../.github/workflows/dependency-merge.yml", import.meta.url), "utf8"));
	assert.deepEqual(workflow.on.pull_request_target.branches, ["develop"]);
	assert.match(workflow.jobs.merge.if, /pull_request.user.login == 'dependabot\[bot\]'/);
	const steps = workflow.jobs.merge.steps;
	assert.deepEqual(steps.find((step) => step.uses === "actions/checkout@v4").with, { ref: "develop", "persist-credentials": false });
	const verify = steps.find((step) => step.id === "metadata");
	assert.equal(verify.uses, "dependabot/fetch-metadata@v3");
	assert.equal(verify.with["skip-verification"], undefined);
	assert.equal(verify.with["skip-commit-verification"], undefined);
	assert.ok(steps.findIndex((step) => step.id === "head") < steps.indexOf(verify));
	assert.equal(steps.at(-1).env.EXPECTED_HEAD, "${{ steps.head.outputs.sha }}");
	assert.ok(steps.every((step) => !/bun install|npm install/.test(step.run ?? "")));
});

test("Pi updates remain a separate manually reviewed Dependabot group", () => {
	const config = parse(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));
	assert.deepEqual(config.updates[0].groups["compatible-updates"]["exclude-patterns"], ["@earendil-works/*"]);
	assert.deepEqual(config.updates[0].groups["pi-runtime"].patterns, ["@earendil-works/*"]);
});
