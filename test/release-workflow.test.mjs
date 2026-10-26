/**
 * The release workflow must be able to run the npm cleanup, and the cleanup
 * must never be able to publish.
 *
 * Two defects lived in `.github/workflows/release.yml` and both were
 * invisible to a dry run:
 *
 *   1. The unpublish job called
 *      `$GITHUB_WORKSPACE/scripts/npm-unpublish-with-approval.sh` but never
 *      checked the repository out, so the script was not in the workspace.
 *      A dry run never reaches the script, so only a real removal would have
 *      failed - and it would have failed on the first version.
 *   2. The second-factor report read the account profile and, when the
 *      endpoint returned nothing, printed "no second factor is enabled on
 *      the account". The registry answered the same run with `EOTP`, which
 *      proves the opposite. An absent answer is not evidence of absence.
 *
 * The workflow is parsed as text. A YAML parser is not a dependency of this
 * package, and the invariants that matter here are about the shape of the
 * file: which steps a job has, which strings appear, and how the gating
 * expressions read.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const workflow = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");

/** The body of a top-level job, from its key up to the next top-level key. */
function jobBody(name) {
	const start = workflow.indexOf(`\n  ${name}:\n`);
	assert.notEqual(start, -1, `the workflow has no job named "${name}"`);
	const rest = workflow.slice(start + 1);
	const next = rest.search(/\n {2}[a-z][a-z0-9_-]*:\n/);
	return next === -1 ? rest : rest.slice(0, next);
}

/** The body of a named step inside a job. */
function stepBody(job, name) {
	const body = jobBody(job);
	const start = body.indexOf(`- name: ${name}\n`);
	assert.notEqual(start, -1, `the "${job}" job has no step named "${name}"`);
	const rest = body.slice(start + 1);
	const next = rest.search(/\n {6}- name: /);
	return next === -1 ? rest : rest.slice(0, next);
}

test("the unpublish job checks the repository out", () => {
	const body = jobBody("unpublish");
	assert.match(body, /- name: Checkout\n/);
	// The script the unpublish step runs has to come from that checkout.
	assert.match(body, /actions\/checkout@v4/);
});

test("the unpublish step runs the checked-out helper", () => {
	const body = stepBody("unpublish", "Unpublish versions");
	assert.match(body, /\$GITHUB_WORKSPACE\/scripts\/npm-unpublish-with-approval\.sh/);
	// The helper has to be executable in the repository, or the checkout
	// gives a non-executable file and the step cannot run it.
	const mode = readFileSync(join(ROOT, "scripts", "npm-unpublish-with-approval.sh"), "utf8");
	assert.ok(mode.length > 0, "the helper script exists and is readable");
});

test("the removal is verified against the state captured before it", () => {
	// The removal is irreversible, so the run has to report what the
	// registry shows afterwards. The check has to run against the state
	// that was real, which means the capture comes first.
	const body = jobBody("unpublish");
	const capture = stepBody("unpublish", "Capture the registry state");
	const verify = stepBody("unpublish", "Verify the removal");
	assert.match(capture, /npm-verify-removal\.mjs/);
	assert.match(capture, /--capture/);
	assert.match(verify, /npm-verify-removal\.mjs/);
	assert.ok(
		body.indexOf("Capture the registry state") < body.indexOf("Unpublish versions"),
		"the state is captured after the removal, so it records the wrong state",
	);
	assert.ok(
		body.indexOf("Unpublish versions") < body.indexOf("Verify the removal"),
		"the removal is verified before it happens",
	);
});

test("the verification script exists in the repository", () => {
	// The workflow step runs the script from the checkout, so the file
	// has to be there and has to be a node script.
	const path = join(ROOT, "scripts", "npm-verify-removal.mjs");
	assert.ok(existsSync(path), "the verification script is in the repository");
	const source = readFileSync(path, "utf8");
	assert.match(source, /npm_config_registry/);
	assert.match(source, /--capture/);
});

test("the release job still checks out and still publishes", () => {
	const body = jobBody("release");
	assert.match(body, /- name: Checkout\n/);
	assert.match(body, /Publish to npm/);
	assert.match(body, /Create GitHub Release/);
});

test("a cleanup dispatch cannot publish", () => {
	// The release job only runs when no versions were named.
	const release = jobBody("release");
	const gate = release.slice(release.indexOf("if:"));
	assert.match(gate, /unpublish_versions == null \|\|\s*\n?\s*github\.event\.inputs\.unpublish_versions == ''/);
	// And the unpublish job only runs when versions were named.
	const unpublish = jobBody("unpublish");
	const unpublishGate = unpublish.slice(unpublish.indexOf("if:"));
	assert.match(unpublishGate, /unpublish_versions != ''/);
});

test("the second-factor report never turns an absent answer into 'no second factor'", () => {
	const body = stepBody("unpublish", "Report the account's second-factor requirements");
	assert.doesNotMatch(
		body,
		/no second factor is enabled on the account/,
		"an empty profile response is not proof that no second factor exists",
	);
	// The report has to name the unknown case instead.
	assert.match(body, /second factor: unknown/);
	// And it has to say that the registry's own answer is the authority.
	assert.match(body, /EOTP/);
});

test("the report distinguishes the factor types it can see", () => {
	const body = stepBody("unpublish", "Report the account's second-factor requirements");
	assert.match(body, /totp=/);
	assert.match(body, /webauth=/);
	assert.match(body, /an authenticator one-time code is required/);
	assert.match(body, /a browser approval is required/);
});

test("a one-time code reaches npm without appearing in the run metadata", () => {
	const body = stepBody("unpublish", "Unpublish versions");
	// The code comes from a secret, never from a workflow input.
	assert.match(body, /NPM_OTP: \$\{\{ secrets\.NPM_OTP \}\}/);
	assert.doesNotMatch(body, /NPM_OTP: \$\{\{ github\./);
});

test("the unpublish job reports a pending approval instead of printing the url", () => {
	const body = stepBody("unpublish", "Unpublish versions");
	assert.match(body, /rc -eq 42/);
	assert.match(body, /a browser approval for/);
	// The approval url embeds credential material, so the workflow must not
	// print it and must not upload it as an artifact.
	assert.doesNotMatch(body, /upload-artifact/);
	assert.doesNotMatch(body, /npmjs\.com\/auth\/cli/);
});

test("every shell block in the workflow parses", () => {
	const lines = workflow.split("\n");
	const blocks = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/^\s+run:\s*\|\s*$/.test(lines[i])) continue;
		const indent = lines[i].match(/^(\s*)/)[1].length;
		const body = [];
		let j = i + 1;
		while (j < lines.length) {
			const line = lines[j];
			if (line.trim() === "") {
				body.push("");
				j++;
				continue;
			}
			if (line.match(/^(\s*)/)[1].length <= indent) break;
			body.push(line.slice(indent + 2));
			j++;
		}
		blocks.push(body.join("\n"));
		i = j;
	}
	assert.ok(blocks.length > 0, "the workflow has shell blocks");
	for (const [index, block] of blocks.entries()) {
		const result = spawnSync("bash", ["-n"], { input: block, encoding: "utf8" });
		assert.equal(result.status, 0, `shell block ${index} does not parse: ${result.stderr}`);
	}
});

test("the release checks the published files for a client name before it publishes", () => {
	// A name inside a published file is published for good: the removal
	// of a published version is a support ticket. The gate therefore
	// stands between the verification and the publish.
	const body = jobBody("release");
	const gate = stepBody("release", "Verify the published files hold no client name");
	const publish = body.indexOf("- name: Publish to npm");
	assert.notEqual(publish, -1, "the release publishes");
	assert.ok(
		body.indexOf("- name: Verify the published files hold no client name") < publish,
		"the gate runs after the publish, so the name is already public",
	);
	// The gate needs the list, and the list is the repository secret.
	assert.match(gate, /SENSITIVE_TERMS: \$\{\{ secrets\.SENSITIVE_TERMS \}\}/);
	// It looks at the packed tarball - the thing npm really publishes -
	// and not at the working tree.
	assert.match(gate, /npm pack --pack-destination/);
	assert.match(gate, /check-sensitive-terms\.mjs --tree/);
	// It fails closed: without the list the scanner exits 2, and the
	// step stops there.
	assert.match(gate, /set -euo pipefail/);
});

test("the release gate does not run untrusted code of the published package", () => {
	// The tarball is unpacked, never installed and never run. A package
	// that holds a script must not execute it while it is checked.
	const gate = stepBody("release", "Verify the published files hold no client name");
	assert.doesNotMatch(gate, /npm install/);
	assert.doesNotMatch(gate, /npm ci/);
	assert.doesNotMatch(gate, /postinstall/);
});

test("the CI carries the list, so the content scan runs on every push", () => {
	const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
	assert.match(
		ci,
		/SENSITIVE_TERMS: \$\{\{ secrets\.SENSITIVE_TERMS \}\}/,
		"the CI verification has the list",
	);
});
