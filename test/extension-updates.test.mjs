/**
 * The release notes of the runtime, in the shape the native host reads them.
 *
 * The host of Pi shows the notes of an installed package under its native
 * Extension Updates section. It reads the changelog of the package itself, so
 * the runtime only has to write a changelog the host can read - and to keep no
 * second version store and no second notification of its own.
 *
 * The tests are behavioural: they feed the module the changelogs the release
 * generation produces and count the notes the host would show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
	NATIVE_ENTRY_HEADING,
	newerReleaseNotes,
	normalizeReleaseNoteHeadings,
	parseReleaseNotes,
	renderReleaseNotes,
} from "../harness/release-notes.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = join(repoRoot, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf-8");

const PATCH_HEADING =
	"### [1.1.532](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v1.1.531...v1.1.532) (2026-11-27)";
const MINOR_HEADING =
	"## [0.10.0](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.24...v0.10.0) (2026-07-30)";

test("the heading of a patch release gets the level the host reads", () => {
	const { markdown, changed } = normalizeReleaseNoteHeadings(
		`# Changelog\n\n${PATCH_HEADING}\n\n### Features\n\n* a fix ([abc123](https://github.com/ManotLuijiu/pi-harness-runtime/commit/abc123))\n`,
	);
	assert.equal(changed, 1);
	assert.ok(
		markdown.includes(
			"## [1.1.532](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v1.1.531...v1.1.532) (2026-11-27)",
		),
		"the link and the date of the release have to survive",
	);
	assert.ok(markdown.includes("### Features"), "the sections keep their level");
});

test("the heading of a minor release stays as it is", () => {
	const { markdown, changed } = normalizeReleaseNoteHeadings(
		`# Changelog\n\n${MINOR_HEADING}\n`,
	);
	assert.equal(changed, 0);
	assert.ok(markdown.includes(MINOR_HEADING));
});

test("the content and the links of the history are preserved", () => {
	const before = [
		"# Changelog",
		"",
		PATCH_HEADING,
		"",
		"### Features",
		"",
		"* a fix ([abc123](https://github.com/ManotLuijiu/pi-harness-runtime/commit/abc123))",
		"",
		MINOR_HEADING,
		"",
		"### Bug Fixes",
		"",
		"* an old fix",
		"",
	].join("\n");
	const { markdown } = normalizeReleaseNoteHeadings(before);
	const withoutHeadings = (text) =>
		text
			.split("\n")
			.filter((line) => !/^#{2,6}\s*\[?v?\d+\.\d+\.\d+/.test(line))
			.join("\n");
	assert.equal(withoutHeadings(markdown), withoutHeadings(before));
	assert.ok(markdown.includes("compare/v1.1.531...v1.1.532"));
	assert.ok(markdown.includes("compare/v0.9.24...v0.10.0"));
});

test("the normalizer is idempotent", () => {
	const once = normalizeReleaseNoteHeadings(changelog).markdown;
	const twice = normalizeReleaseNoteHeadings(once);
	assert.equal(twice.changed, 0);
	assert.equal(twice.markdown, once);
});

test("the parser reads the version of a release", () => {
	const { markdown } = normalizeReleaseNoteHeadings(
		`# Changelog\n\n${PATCH_HEADING}\n\n### Features\n\n* a fix\n\n${MINOR_HEADING}\n\n### Features\n\n* an old fix\n`,
	);
	const entries = parseReleaseNotes(markdown);
	assert.deepEqual(
		entries.map((entry) => entry.version),
		["1.1.532", "0.10.0"],
	);
});

test("the changelog of the repository is written the way the host reads it", () => {
	const entries = parseReleaseNotes(changelog);
	assert.ok(entries.length > 100, "every release of the repository is an entry");
	for (const entry of entries) {
		assert.ok(
			entry.heading.startsWith(NATIVE_ENTRY_HEADING),
			`the heading of ${entry.version} has to start with "${NATIVE_ENTRY_HEADING}"`,
		);
	}
});

test("the native parser of the host reads the changelog of the repository", async (t) => {
	const hostChangelog =
		"/home/frappe/.pi/agent/install/releases/1.6.1/node_modules/@earendil-works/pi-coding-agent/dist/utils/changelog.js";
	if (!existsSync(hostChangelog)) {
		t.skip("the host of Pi is not installed on this machine");
		return;
	}
	const host = await import(hostChangelog);
	const entries = host.parseChangelog(changelogPath);
	const ours = parseReleaseNotes(changelog);
	assert.deepEqual(
		entries.map((entry) => `${entry.major}.${entry.minor}.${entry.patch}`),
		ours.map((entry) => entry.version),
		"the host has to read the same releases as the runtime",
	);
});

test("a first install shows no notes", () => {
	assert.deepEqual(newerReleaseNotes(changelog, undefined), []);
	assert.deepEqual(newerReleaseNotes(changelog, ""), []);
});

test("one upgrade shows the notes of the new version", () => {
	const notes = newerReleaseNotes(changelog, "1.1.530");
	assert.deepEqual(
		notes.map((entry) => entry.version),
		["1.1.531"],
	);
});

test("the versions that were skipped are shown", () => {
	const notes = newerReleaseNotes(changelog, "1.1.528");
	assert.deepEqual(
		notes.map((entry) => entry.version),
		["1.1.531", "1.1.530", "1.1.529"],
	);
});

test("the same version shows nothing", () => {
	assert.deepEqual(newerReleaseNotes(changelog, "1.1.531"), []);
});

test("a downgrade shows nothing", () => {
	assert.deepEqual(newerReleaseNotes(changelog, "1.1.532"), []);
	assert.deepEqual(newerReleaseNotes(changelog, "9.0.0"), []);
});

test("a version that cannot be read shows nothing", () => {
	assert.deepEqual(newerReleaseNotes(changelog, "not-a-version"), []);
});

test("a missing changelog shows nothing", () => {
	assert.deepEqual(parseReleaseNotes(""), []);
	assert.deepEqual(newerReleaseNotes("", "1.1.530"), []);
});

test("the notes carry the name of the runtime", () => {
	const rendered = renderReleaseNotes(changelog, "pi-harness-runtime", "1.1.530");
	assert.ok(rendered.startsWith("## pi-harness-runtime [1.1.531]"));
	assert.ok(!rendered.includes("pi-harness-runtime pi-harness-runtime"));
});

test("the runtime keeps no second version store and no second notice", () => {
	const sources = [
		join(repoRoot, "index.ts"),
		join(repoRoot, "harness", "release-notes.ts"),
	];
	for (const source of sources) {
		const text = readFileSync(source, "utf-8");
		assert.ok(
			!/last-seen-version|lastSeenVersion|extensionChangelogVersion/i.test(text),
			`${source} must not keep a version store of its own`,
		);
	}
});

test("the release generation writes a changelog the host reads", () => {
	const release = readFileSync(join(repoRoot, "scripts", "release-all.ts"), "utf-8");
	assert.ok(
		release.includes("normalizeChangelogHeadings()"),
		"the release has to normalize the headings of the changelog",
	);
	assert.ok(release.includes("normalizeReleaseNoteHeadings"));
});

test("the published package carries the changelog", () => {
	const manifest = JSON.parse(
		readFileSync(join(repoRoot, "package.json"), "utf-8"),
	);
	assert.ok(
		manifest.files.includes("/CHANGELOG.md"),
		"the changelog has to be part of the published files",
	);
	assert.ok(existsSync(changelogPath));
});
