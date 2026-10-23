/**
 * Every warning and error line of the startup summary must tell the user
 * what to do next.
 *
 * The startup summary is the only place where a user learns that a
 * credential is missing. A line that says "credentials missing" without a
 * command leaves the user guessing - this test scans the extension source
 * and fails when a warn/err line carries no actionable instruction.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The details array of every addHarnessMessage() call with a warn/err status. */
function warningDetails(source) {
	const results = [];
	// The text may contain an escaped quote - the pattern has to survive it,
	// otherwise a line with a quote in its text is silently skipped.
	const pattern =
		/addHarnessMessage\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"(warn|err)"\s*,\s*\[/g;
	let match;
	while ((match = pattern.exec(source)) !== null) {
		// Take the array literal up to its closing bracket.
		let depth = 1;
		let index = pattern.lastIndex;
		while (index < source.length && depth > 0) {
			const char = source[index];
			if (char === "[") depth += 1;
			else if (char === "]") depth -= 1;
			index += 1;
		}
		results.push({
			label: match[1],
			text: match[2],
			status: match[3],
			details: source.slice(pattern.lastIndex, index - 1),
			line: source.slice(0, match.index).split("\n").length,
		});
	}
	return results;
}

test("the startup summary has warning and error lines to check", () => {
	// A guard against a scan that silently matches nothing.
	const warnings = warningDetails(indexSource);
	assert.ok(warnings.length >= 8, `found ${warnings.length} warning/error lines`);
});

/**
 * A line that spreads the fix commands of a feature gets them at runtime -
 * the source only names the feature. Those lines are checked by the audit
 * and report tests, not by the source scan.
 */
function spreadsFixHelper(details) {
	// Only the known fix helpers (camelCase names) - the English word
	// "fixes" in a sentence must not disable the check for that line.
	return /keyFileFixes|\b[A-Za-z]+Fixes\b/.test(details);
}

test("every warning and error line carries an actionable instruction", () => {
	const actionable = ["echo ", "How to fix", "Check ", "reload Pi", "Unset ", "The file exists"];
	for (const warning of warningDetails(indexSource)) {
		if (spreadsFixHelper(warning.details)) continue;
		const haystack = `${warning.text} ${warning.details}`;
		assert.ok(
			actionable.some((needle) => haystack.includes(needle)),
			`the "${warning.label}: ${warning.text}" line (index.ts:${warning.line}) tells the user what to do`,
		);
	}
});

test("a warning line never leaves the user without a file or a command", () => {
	// A line that only says "something is wrong" is not enough: it must
	// either name the file to look at, offer the command that fixes it, or
	// spread the fix commands of the feature (keyFileFixes...).
	for (const warning of warningDetails(indexSource)) {
		// A line that spreads the fix commands of a feature is verified by
		// the audit test - the source does not contain the commands.
		if (spreadsFixHelper(warning.details)) continue;
		const haystack = `${warning.text} ${warning.details}`;
		const namesSomething =
			haystack.includes("~") ||
			haystack.includes("echo ") ||
			haystack.includes("Fix:") ||
			haystack.includes(".txt") ||
			haystack.includes("keys/") ||
			haystack.includes("How to fix") ||
			haystack.includes("Check ");
		assert.ok(
			namesSomething,
			`the "${warning.label}: ${warning.text}" line (index.ts:${warning.line}) names a file or a command`,
		);
	}
});

test("every fix-helper spread names a known feature", () => {
	// A line that spreads the fix commands of a feature is verified by the
	// audit test (the helper always produces an `echo` command) - but only
	// when the feature is one the audit knows.
	const known = new Set(["Telegram", "Relay", "LINE", "Jev", "Qdrant", "Honcho"]);
	const spreads = indexSource.match(/keyFileFixes(?:OrFallback)?\(\s*"([^"]+)"/g) ?? [];
	assert.ok(spreads.length >= 5, `found ${spreads.length} fix-helper spreads`);
	for (const spread of spreads) {
		const feature = /"([^"]+)"/.exec(spread)?.[1];
		assert.ok(
			feature && known.has(feature),
			`the fix helper is called with a known feature: ${spread}`,
		);
	}
});

test("the channel health is asked per channel, not for the whole centre", () => {
	// `hasHealthyChannels()` is green as soon as ONE channel works - a
	// broken Telegram channel would hide behind a working LINE channel and
	// the startup summary would not mention it.
	assert.match(
		indexSource,
		/isChannelHealthy\("telegram"\)/,
		"the Telegram state comes from the Telegram channel itself",
	);
	assert.doesNotMatch(
		indexSource,
		/!center\.hasHealthyChannels\(\)/,
		"the Telegram health is not taken from the whole notification centre",
	);
});

test("the relay line is only reported for a user who wants the relay", () => {
	// The relay is an optional feature: a permanent warning with fix
	// commands for every user would be noise.
	assert.match(
		indexSource,
		/relayShouldBeReported\(\{/,
		"the relay report is gated",
	);
});

test("a failed Telegram init is remembered as a failure", () => {
	// The LINE line blames Telegram when Telegram is not configured. When
	// the Telegram init threw, Telegram *was* configured - it failed.
	assert.match(
		indexSource,
		/telegramChannelState = "failed"/,
		"the Telegram state is set to failed when the init throws",
	);
});
