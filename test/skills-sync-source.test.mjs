/**
 * The skill sync: where the skills come from, and which script performs it.
 *
 * The source of the skills is installation data: the operator names it. The
 * package must not carry a path of one operator's machine, and it must not
 * print one either. The script belongs to the package, so it is found
 * relative to the module - and an installation without it is a real state
 * that the caller has to be able to report.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import {
	SKILLS_SOURCE_ENV,
	expandHome,
	getSkillsSource,
	getSkillsSourceFromArgs,
	syncSkillsScriptPath,
} from "../packages/skills/src/sync-source.ts";

/** Run a function with the skill source set to a value. */
function withSource(value, run) {
	const before = process.env[SKILLS_SOURCE_ENV];
	if (value === undefined) delete process.env[SKILLS_SOURCE_ENV];
	else process.env[SKILLS_SOURCE_ENV] = value;
	try {
		return run();
	} finally {
		if (before === undefined) delete process.env[SKILLS_SOURCE_ENV];
		else process.env[SKILLS_SOURCE_ENV] = before;
	}
}

test("the skill source is named by an environment variable", () => {
	assert.equal(SKILLS_SOURCE_ENV, "PI_HARNESS_SKILLS_SOURCE");
});

test("expandHome expands a leading tilde", () => {
	assert.equal(expandHome("~"), homedir());
	assert.equal(expandHome("~/skills"), join(homedir(), "skills"));
	assert.equal(expandHome("/absolute/skills"), "/absolute/skills");
	assert.equal(expandHome("relative/skills"), "relative/skills");
});

test("without a configured source there is no source", () => {
	withSource(undefined, () => {
		assert.equal(getSkillsSource(), undefined);
	});
});

test("the configured source is expanded", () => {
	withSource("~/skills", () => {
		assert.equal(getSkillsSource(), join(homedir(), "skills"));
	});
});

test("an empty configured source is no source", () => {
	withSource("   ", () => {
		assert.equal(getSkillsSource(), undefined);
	});
});

test("the command line wins over the environment", () => {
	withSource("/from/env", () => {
		assert.equal(getSkillsSourceFromArgs(["--from", "/from/args"]), "/from/args");
		assert.equal(getSkillsSourceFromArgs(["--from=/from/args"]), "/from/args");
		assert.equal(getSkillsSourceFromArgs(["-f", "/from/args"]), "/from/args");
	});
});

test("the environment is used when the command line says nothing", () => {
	withSource("/from/env", () => {
		assert.equal(getSkillsSourceFromArgs([]), "/from/env");
		assert.equal(getSkillsSourceFromArgs(["--check-only"]), "/from/env");
	});
});

test("the sync script is found relative to the package", () => {
	const script = syncSkillsScriptPath();
	assert.ok(script, "the sync script must be found in this installation");
	assert.ok(script.endsWith(join("scripts", "sync-skills.ts")), script);
	assert.ok(existsSync(script), `${script} must exist`);
});

test("an installation without the sync script reports it", () => {
	assert.equal(
		syncSkillsScriptPath("file:///nowhere/at/all/module.js"),
		undefined,
		"a missing script must be reported, not guessed",
	);
});

test("the command reports a missing script instead of spawning one", () => {
	// The command cannot be loaded by node (it reaches the registry and the
	// scanner), so the message is checked in the source.
	const source = readFileSync(
		new URL("../packages/skills/src/skill-commands.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /The sync script is missing from this installation\./);
});
