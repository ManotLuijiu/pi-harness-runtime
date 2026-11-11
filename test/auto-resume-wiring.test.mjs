/**
 * The wiring of the automatic resume.
 *
 * The resume is a message of the harness, and it carries a marker. The
 * marker is what the guard of a late resume recognizes, so the resume that
 * is queued and the guard that consumes it have to agree on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(needle, before = 0, after = 1200) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

test("the resume is queued as a marked message of the harness", () => {
	const region = around("async function queueAutoResume(", 0, 2200);
	assert.ok(region, "the executor of the resume is registered");
	assert.match(
		region,
		/pi\.sendMessage\(\s*buildAutoResumeMessage\(\{/,
		"the resume carries the marker",
	);
	assert.match(
		region,
		/scope: options\.scope \?\? "request",/,
		"the resume names what it continues",
	);
	assert.match(
		region,
		/reason,\s*scope: options\.scope \?\? "request",\s*nonce: nextResumeNonce\(\),/,
		"the resume names why it was queued and what it continues",
	);
});

test("the guard of a late resume is a public boundary of Pi", () => {
	assert.match(
		indexSource,
		/pi\.on\("context", async \(event\) => \{/,
		"the guard runs before the provider is called",
	);
	const region = around('pi.on("context", async (event) => {');
	assert.match(
		region,
		/findAutoResumeIndex\(event\.messages\)/,
		"the guard looks for the marker",
	);
	assert.match(
		region,
		/decideResumeScope\(\{/,
		"the guard asks whether the request still has work",
	);
	assert.match(
		region,
		/return \{\s*messages: neutralizeAutoResume\(event\.messages, index\)/,
		"the guard replaces the resume",
	);
});

test("the guard does not abort the run", () => {
	const region = around('pi.on("context", async (event) => {');
	assert.equal(
		region.includes("abort("),
		false,
		"the run of the session goes on",
	);
});

test("a resume of a cut turn is not guarded", () => {
	const region = around('pi.on("context", async (event) => {');
	assert.match(
		region,
		/details\?\.scope === "turn"/,
		"a turn that was cut off is unfinished by definition",
	);
});

test("the resumes of the output limit keep the scope of the turn", () => {
	for (const needle of [
		'queueAutoResume("output-limit", OUTPUT_LIMIT_RESUME_PROMPT, "steer", {',
		'"post-compact-output-limit",',
	]) {
		const region = around(needle, 0, 400);
		assert.ok(region, `the resume is registered: ${needle}`);
		assert.match(
			region,
			/scope: "turn"/,
			`the resume of a cut turn is not guarded: ${needle}`,
		);
	}
});

test("the resume of the request keeps the scope of the request", () => {
	const region = around('queueAutoResume("post-compact", "resume", "followUp")', 0, 200);
	assert.ok(region, "the resume after a compaction is registered");
	assert.equal(
		region.includes('scope: "turn"'),
		false,
		"the resume after a compaction continues the request",
	);
});
