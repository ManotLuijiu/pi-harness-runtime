/**
 * Tests for the startup line of the skill system.
 *
 * The line carries two counts: the skills on this machine and the skills in
 * the vector store. A single "N discovered" would hide the difference
 * between "no local skills" and "no shared skills".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { localSkillsReport, skillsReport } from "../harness/skills-startup.ts";

test("the line shows the local count while the vector store is unknown", () => {
	const report = localSkillsReport(12);
	assert.match(report.text, /Local Skills 12/);
	assert.equal(report.status, "wait");
});

test("the line shows both counts", () => {
	const report = skillsReport(12, { state: "populated", count: 79 });
	assert.equal(report.text, "Local Skills 12 | Qdrant Skills 79");
	assert.equal(report.status, "ok");
});

test("the vector store without credentials is named", () => {
	const report = skillsReport(12, { state: "not-configured", count: 0 });
	assert.equal(report.text, "Local Skills 12 | Qdrant Skills not configured");
	// A machine without a vector store is not broken - it is an
	// information, not a warning.
	assert.equal(report.status, "info");
});

test("an unreachable vector store is a warning", () => {
	const report = skillsReport(12, {
		state: "unavailable",
		count: 0,
		error: "the cluster refused the connection",
	});
	assert.equal(report.text, "Local Skills 12 | Qdrant Skills unavailable");
	assert.equal(report.status, "warn");
	assert.ok(report.details.some((detail) => /refused the connection/.test(detail)));
});

test("an empty vector store shows zero", () => {
	const empty = skillsReport(12, { state: "empty", count: 0 });
	assert.equal(empty.text, "Local Skills 12 | Qdrant Skills 0");
	// A collection that does not exist yet is empty as well.
	const missing = skillsReport(12, { state: "missing", count: 0 });
	assert.equal(missing.text, "Local Skills 12 | Qdrant Skills 0");
});

test("a schema mismatch is reported with its cause", () => {
	const report = skillsReport(12, {
		state: "populated",
		count: 79,
		collection: "pi-harness-skills",
		schemaMismatch: "the collection holds 384-dimensional vectors, the runtime embeds with 1536",
	});
	assert.equal(report.status, "warn");
	assert.ok(
		report.details.some((detail) => /384-dimensional vectors/.test(detail)),
		"the mismatch must name the numbers",
	);
	assert.ok(
		report.details.some((detail) => /pi-harness-skills/.test(detail)),
		"the mismatch must name the collection",
	);
});

test("a machine without local skills still shows the remote count", () => {
	const report = skillsReport(0, { state: "populated", count: 79 });
	assert.equal(report.text, "Local Skills 0 | Qdrant Skills 79");
});
