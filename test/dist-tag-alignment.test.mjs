#!/usr/bin/env node
/**
 * The alignment of the npm channels with the release.
 *
 * The channels of a package are pointers, and a pointer is what a
 * consumer installs. A pointer that names an older version hands over a
 * build the repository has left behind, so the release removes every
 * pointer that is older than the version it published. npm and GitHub
 * then name the same version.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
	compareVersions,
	orphanedVersionTags,
	parseDistTagOutput,
	staleDistTags,
	versionLine,
} from "../scripts/align-dist-tags.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the channels of a package are read from the lines of the command", () => {
	// `npm dist-tag ls` prints "name: version" per line. The --json flag
	// is not honored by the command, so the lines are what is read.
	const output = "beta: 1.1.71-3\ndevelop: 0.10.42\nlatest: 1.1.455\n";
	assert.deepEqual(parseDistTagOutput(output), {
		beta: "1.1.71-3",
		develop: "0.10.42",
		latest: "1.1.455",
	});
});

test("an empty answer names no channel", () => {
	assert.deepEqual(parseDistTagOutput(""), {});
	assert.deepEqual(parseDistTagOutput("no channels\n"), {});
});

test("a version is compared by its numbers", () => {
	assert.equal(compareVersions("1.1.455", "1.1.455"), 0);
	assert.equal(compareVersions("1.1.454", "1.1.455"), -1);
	assert.equal(compareVersions("1.1.456", "1.1.455"), 1);
});

test("a pre-release suffix does not change the order of a line", () => {
	// 71 is older than 455, whatever the suffix says.
	assert.equal(compareVersions("1.1.71-3", "1.1.455"), -1);
	assert.equal(compareVersions("0.10.42", "1.1.455"), -1);
});

test("a channel of an older version is stale", () => {
	const channels = { latest: "1.1.455", develop: "0.10.42", beta: "1.1.71-3" };
	assert.deepEqual(staleDistTags(channels, "1.1.455"), ["beta", "develop"]);
});

test("the channel of the release is never stale", () => {
	const channels = { latest: "1.1.455" };
	assert.deepEqual(staleDistTags(channels, "1.1.455"), []);
});

test("a channel of the release itself is aligned and stays", () => {
	const channels = { develop: "1.1.455", latest: "1.1.455" };
	assert.deepEqual(staleDistTags(channels, "1.1.455"), []);
});

test("a channel of a newer version stays", () => {
	// A pre-release of the future is not stale.
	const channels = { next: "1.1.460", latest: "1.1.455" };
	assert.deepEqual(staleDistTags(channels, "1.1.455"), []);
});

test("a tag without a published version is reported", () => {
	const tags = ["v1.1.448", "v1.1.449", "v1.1.450"];
	const published = ["1.1.448", "1.1.450"];
	assert.deepEqual(orphanedVersionTags(tags, published), ["v1.1.449"]);
});

test("a tag that names no version is not a version", () => {
	const tags = ["waiting-for-user-buttons-20261010113913"];
	assert.deepEqual(orphanedVersionTags(tags, []), []);
});

test("only a residue above the newest published version is reported", () => {
	// The repository carries the tags of an era in which the releases
	// were not published to npm. Those tags are the history of that era,
	// not a mismatch of the current release.
	const tags = ["v0.10.42", "v1.1.449", "v1.1.455", "v1.1.456"];
	const published = ["1.1.455"];
	assert.deepEqual(orphanedVersionTags(tags, published), [
		"v0.10.42",
		"v1.1.449",
		"v1.1.456",
	]);
	assert.deepEqual(
		orphanedVersionTags(tags, published, { since: "1.1.455" }),
		["v1.1.456"],
	);
});

test("the line of a version is the numbers before the last one", () => {
	assert.equal(versionLine("1.1.455"), "1.1");
	assert.equal(versionLine("1.1.71-3"), "1.1");
	assert.equal(versionLine("0.10.42"), "0.10");
});

test("every published version tag is aligned", () => {
	const tags = ["v1.1.448", "v1.1.450", "v1.1.455"];
	const published = ["1.1.448", "1.1.450", "1.1.455"];
	assert.deepEqual(orphanedVersionTags(tags, published), []);
});

test("the release publishes through OIDC and carries no token", () => {
	const workflow = readFileSync(
		join(ROOT, ".github/workflows/release.yml"),
		"utf8",
	);
	const publish = workflow.indexOf("- name: Publish to npm\n");
	assert.ok(publish > 0, "the release publishes to npm");
	const block = workflow.slice(publish, publish + 600);
	assert.ok(
		block.includes("npm publish"),
		"the publish step publishes the package",
	);
	assert.ok(
		!block.includes("_authToken") && !block.includes("NODE_AUTH_TOKEN"),
		"the publish step carries no credential: npm does the OIDC exchange",
	);
});

test("the release does not touch the channels of the package", () => {
	// The release publishes a version and creates the GitHub release.
	// A channel is a pointer that a consumer installs, and changing one
	// is a write that the registry guards with a second factor. The
	// alignment is therefore the operator's tool, not a step of every
	// release.
	const workflow = readFileSync(
		join(ROOT, ".github/workflows/release.yml"),
		"utf8",
	);
	assert.ok(
		!workflow.includes("dist-tag"),
		"the release does not change a channel of the package",
	);
	assert.ok(
		!workflow.includes("align-dist-tags"),
		"the release does not run the alignment script",
	);
});

test("the alignment is a tool of the repository", () => {
	const script = readFileSync(
		join(ROOT, "scripts/align-dist-tags.mjs"),
		"utf8",
	);
	assert.ok(
		script.includes("--apply"),
		"the script can remove a channel when it is asked to",
	);
	assert.ok(
		script.includes("stale channels"),
		"the script names the channels that are stale",
	);
});
