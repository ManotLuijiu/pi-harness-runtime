/**
 * Tests for the startup summary order.
 *
 * The rule: two rows that belong together stay together. The notification
 * channels (Telegram and LINE) must not be separated by a row that another
 * feature added in between.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { HarnessStartupStatus, harnessStatusMarker } from "../harness-startup-status.ts";

test("a row is placed directly after its anchor", () => {
	const status = new HarnessStartupStatus();
	status.update("Telegram", "configured and enabled", "ok");
	status.update("Jev", "configured", "ok");
	status.update("LINE", "credentials missing", "warn");

	status.updateAfter("Telegram", "LINE", "credentials missing", "warn");

	const labels = status.messages.map((message) => message.label);
	assert.deepEqual(labels, ["Telegram", "LINE", "Jev"]);
});

test("an existing row is moved to the anchor", () => {
	const status = new HarnessStartupStatus();
	status.update("Telegram", "configured", "ok");
	status.update("LINE", "old text", "warn");
	status.update("Jev", "configured", "ok");

	status.updateAfter("Telegram", "LINE", "new text", "info");

	const labels = status.messages.map((message) => message.label);
	assert.deepEqual(labels, ["Telegram", "LINE", "Jev"]);
	const line = status.messages.find((message) => message.label === "LINE");
	assert.equal(line.text, "new text");
	assert.equal(line.status, "info");
	// The row is not duplicated.
	assert.equal(status.messages.filter((message) => message.label === "LINE").length, 1);
});

test("a row without an anchor goes to the end", () => {
	const status = new HarnessStartupStatus();
	status.update("Jev", "configured", "ok");

	status.updateAfter("Telegram", "LINE", "credentials missing", "warn");

	const labels = status.messages.map((message) => message.label);
	assert.deepEqual(labels, ["Jev", "LINE"]);
});

test("the anchor keeps its place when it is updated", () => {
	const status = new HarnessStartupStatus();
	status.update("Telegram", "initializing", "wait");
	status.updateAfter("Telegram", "LINE", "credentials missing", "warn");
	// The Telegram row changes its text when the channel is checked.
	status.update("Telegram", "configured and enabled", "ok");

	const labels = status.messages.map((message) => message.label);
	assert.deepEqual(labels, ["Telegram", "LINE"]);
	assert.equal(status.messages[0].text, "configured and enabled");
});

test("the informational status has its own marker", () => {
	assert.equal(harnessStatusMarker("info"), "[INFO]");
	// The other markers keep their meaning.
	assert.equal(harnessStatusMarker("ok"), "[OK]");
	assert.equal(harnessStatusMarker("warn"), "[WARN]");
	assert.equal(harnessStatusMarker("err"), "[ERR]");
	assert.equal(harnessStatusMarker("wait"), "[WAIT]");
});
