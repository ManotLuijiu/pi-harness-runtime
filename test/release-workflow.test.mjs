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

test("the release verification of the package carries the list too", () => {
	// The verification of the package skips the content scan when it
	// has no list. The release has the list, so the scan runs there as
	// well - and the public log of a release does not say that a scan
	// was skipped.
	const step = stepBody("release", "Verify package contents");
	assert.match(
		step,
		/SENSITIVE_TERMS: \$\{\{ secrets\.SENSITIVE_TERMS \}\}/,
		"the release verification of the package has the list",
	);
});

test("the release checks the commit messages before it publishes", () => {
	// GitHub builds the release notes from the commit messages of the
	// release, so a name in a message would be published in the release
	// body and in the notes of every later release.
	const body = jobBody("release");
	const gate = stepBody("release", "Verify the commit messages hold no client name");
	assert.match(gate, /SENSITIVE_TERMS: \$\{\{ secrets\.SENSITIVE_TERMS \}\}/);
	assert.match(gate, /check-sensitive-terms\.mjs --commits/);
	assert.match(gate, /set -euo pipefail/);
	const publish = body.indexOf("- name: Publish to npm");
	assert.notEqual(publish, -1, "the release publishes");
	assert.ok(
		body.indexOf("- name: Verify the commit messages hold no client name") < publish,
		"the gate runs after the publish",
	);
});

test("the CI stops when the list is missing on a push", () => {
	// A push to a branch of this repository gets the secret. If the
	// secret is empty there, the scan of the published files silently
	// turns itself off - and a check that turned itself off is worse
	// than a check that never existed, because it looks like a pass.
	const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
	assert.match(
		ci,
		/SAME_REPOSITORY: \$\{\{ github\.event_name == 'push' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository \}\}/,
		"the CI knows when the secret is expected",
	);
	assert.match(ci, /if \[ -z "\$\{SENSITIVE_TERMS:-\}" \] && \[ "\$SAME_REPOSITORY" = "true" \]/);
	assert.match(ci, /exit 1/, "the CI stops instead of skipping the scan");
});

test("the pull request check and the release check both carry the list", () => {
	const pr = readFileSync(
		join(ROOT, ".github", "workflows", "sensitive-terms.yml"),
		"utf8",
	);
	assert.match(
		pr,
		/SENSITIVE_TERMS: \$\{\{ secrets\.SENSITIVE_TERMS \}\}/,
		"the pull request check has the list",
	);
	assert.match(pr, /pull_request_target/, "the check runs in the context of the base branch");
	assert.match(pr, /permissions:\n\s+contents: read/, "the check only reads");
	assert.match(pr, /persist-credentials: false/, "the checkout keeps no credential");

	for (const step of [
		"Verify the published files hold no client name",
		"Verify the commit messages hold no client name",
	]) {
		const gate = stepBody("release", step);
		assert.match(
			gate,
			/SENSITIVE_TERMS: \$\{\{ secrets\.SENSITIVE_TERMS \}\}/,
			`the gate "${step}" has the list`,
		);
	}
});

/**
 * The release comes from `main`, and only from `main`.
 *
 * `develop` is the branch the work is done on and `main` is the branch
 * npm publishes. A tag that does not sit on `main` names a version that
 * no gate ever saw, so the workflow refuses it. The tests below are
 * about that boundary and about the order of the gates: a gate that
 * runs after the publish is no gate at all.
 */

test("the release is triggered by a tag", () => {
	// Without a tag there is no publish, and a tag names one version.
	assert.match(workflow, /push:\n\s+tags:\n\s+- "v\*"/);
});

test("the release job runs for a tag and for a manual dispatch", () => {
	const body = jobBody("release");
	const gate = body.slice(body.indexOf("if:"));
	assert.match(gate, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
	assert.match(gate, /github\.event_name == 'workflow_dispatch'/);
});

test("the release refuses a tag that is not on main", () => {
	const step = stepBody("release", "Verify the release comes from main");
	// The commit of the tag is compared with the release branch.
	assert.match(step, /git merge-base --is-ancestor "\$COMMIT_SHA" "origin\/main"/);
	// And a manual release has to run on the release branch too.
	assert.match(step, /refs\/heads\/main/);
});

test("the released commit is the commit of the tag", () => {
	const step = stepBody("release", "Resolve the released commit");
	// A tag can be annotated, and then the object it points at is the
	// tag itself. The release is about the commit.
	assert.match(step, /git rev-parse "\$\{GITHUB_REF\}\^\{commit\}"/);
});

test("the version gate and the sensitive check stand before the publish", () => {
	const body = jobBody("release");
	const publish = body.indexOf("- name: Publish to npm");
	assert.notEqual(publish, -1, "the release publishes");
	for (const gate of [
		"- name: Verify the version",
		"- name: Verify the sensitive terms check passed for this commit",
		"- name: Verify the published files hold no client name",
		"- name: Verify the commit messages hold no client name",
	]) {
		const at = body.indexOf(gate);
		assert.notEqual(at, -1, `the release has no step "${gate}"`);
		assert.ok(at < publish, `the step "${gate}" runs after the publish`);
	}
});

test("the publish needs a version that can be published", () => {
	const body = jobBody("release");
	const publish = body.slice(body.indexOf("- name: Publish to npm"));
	// A version that is already on the registry, or one that is older
	// than the newest published one, publishes nothing.
	assert.match(publish, /steps\.version\.outputs\.publishable == 'true'/);
});

test("the sensitive check is verified for the commit that is published", () => {
	const step = stepBody("release", "Verify the sensitive terms check passed for this commit");
	assert.match(step, /COMMIT_SHA: \$\{\{ steps\.commit\.outputs\.sha \}\}/);
	assert.match(step, /verify-sensitive-check\.mjs/);
});

test("the version gate and the check of the commit are in the repository", () => {
	for (const script of [
		"verify-release-version.mjs",
		"verify-sensitive-check.mjs",
	]) {
		assert.ok(
			existsSync(join(ROOT, "scripts", script)),
			`the repository has no scripts/${script}`,
		);
	}
});

test("the published manifest does not carry the hooks of the repository", () => {
	const step = stepBody("release", "Set the version of the release");
	// The `prepare` script installs the git hooks. It is repository
	// tooling, and the published manifest is the consumer facing
	// surface.
	assert.match(step, /delete pkg\.scripts\.prepare/);
});

test("a manual release keeps the version of the manifest", () => {
	// A manual release has no tag. The name of a branch is not a
	// version, and a manifest that carries "refs/heads/main" as its
	// version is refused by the version gate - so the manual release
	// would never publish anything.
	const step = stepBody("release", "Set the version of the release");
	// The version comes from the tag, and only for a tag push.
	assert.match(step, /REF_NAME#refs\/tags\/v/);
	assert.match(step, /EVENT_NAME" = "push"/);
	// And the version of the manifest is only written when there is one.
	assert.match(step, /if \(process\.env\.TAG_VERSION\)/);
	// The workspace packages follow the version of the tag.
	assert.match(step, /pkg\.version = process\.env\.TAG_VERSION/);
});

test("a dry run of a removal does not check a removal that never happened", () => {
	// The check proves that a version is gone. A dry run removes
	// nothing, so the versions are still there and the check would
	// report the removal as failed.
	const step = stepBody("unpublish", "Verify the removal");
	assert.match(step, /if: github\.event\.inputs\.dry_run != 'true'/);
});

test("a dry run of a publish only runs for a version that can be published", () => {
	// npm refuses a publish of a version that is already on the
	// registry, and a dry run of such a version would fail for a
	// reason that has nothing to do with the release.
	const body = jobBody("release");
	const dry = body.slice(body.indexOf("- name: Publish to npm (dry-run)"));
	assert.match(dry, /steps\.version\.outputs\.publishable == 'true'/);
});

test("two releases do not publish at the same time", () => {
	// A tag push and a manual dispatch can name the same version, and
	// the second publish of a version is refused by the registry.
	const body = jobBody("release");
	assert.match(body, /concurrency:\n\s+group: release-\$\{\{ github\.repository \}\}/);
	// A running release is never cancelled.
	assert.match(body, /cancel-in-progress: false/);
});

test("the GitHub release points at the published commit", () => {
	const body = jobBody("release");
	const release = body.slice(body.indexOf("- name: Create GitHub Release"));
	assert.match(release, /target_commitish: \$\{\{ steps\.commit\.outputs\.sha \}\}/);
	assert.match(release, /tag_name: \$\{\{ steps\.meta\.outputs\.release_tag \}\}/);
});
