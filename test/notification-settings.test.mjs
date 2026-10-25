/**
 * Tests for the persisted notification-channel settings.
 *
 * The rules:
 * - a channel that was never mentioned is NOT disabled ("disabled" and
 *   "not configured" are different states),
 * - an explicit opt-out survives a restart,
 * - a broken file never stops the harness from starting.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	isChannelDisabled,
	loadNotificationSettings,
	notificationSettingsPath,
	saveNotificationSettings,
	setChannelDisabled,
} from "../harness/notification-settings.ts";

function withTempDir(run) {
	const dir = mkdtempSync(join(tmpdir(), "notification-settings-"));
	try {
		return run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("a channel that was never mentioned is not disabled", () => {
	withTempDir((dir) => {
		const path = join(dir, "notification-settings.json");
		assert.equal(isChannelDisabled("line", path), false);
	});
});

test("an explicit opt-out is remembered", () => {
	withTempDir((dir) => {
		const path = join(dir, "notification-settings.json");
		assert.equal(setChannelDisabled("line", true, path), true);
		assert.equal(isChannelDisabled("line", path), true);
		// Another channel is untouched.
		assert.equal(isChannelDisabled("telegram", path), false);
	});
});

test("the opt-out survives a reload", () => {
	withTempDir((dir) => {
		const path = join(dir, "notification-settings.json");
		setChannelDisabled("line", true, path);
		// A second read - as a restart does.
		const settings = loadNotificationSettings(path);
		assert.equal(settings.channels.line.enabled, false);
	});
});

test("turning the channel on again clears the opt-out", () => {
	withTempDir((dir) => {
		const path = join(dir, "notification-settings.json");
		setChannelDisabled("line", true, path);
		setChannelDisabled("line", false, path);
		assert.equal(isChannelDisabled("line", path), false);
	});
});

test("a broken settings file does not stop the harness", () => {
	withTempDir((dir) => {
		const path = join(dir, "notification-settings.json");
		writeFileSync(path, "{ this is not json", "utf8");
		const settings = loadNotificationSettings(path);
		assert.deepEqual(settings.channels, {});
		assert.equal(isChannelDisabled("line", path), false);
	});
});

test("an entry that does not decode is dropped, the others survive", () => {
	withTempDir((dir) => {
		const path = join(dir, "notification-settings.json");
		writeFileSync(
			path,
			JSON.stringify({ version: 1, channels: { line: { enabled: false }, broken: 42 } }),
			"utf8",
		);
		const settings = loadNotificationSettings(path);
		assert.equal(settings.channels.line.enabled, false);
		assert.equal(settings.channels.broken, undefined);
	});
});

test("the settings live next to the other harness state", () => {
	// The startup summary reads the file before any channel is started, so
	// the path must not depend on a runtime that may not be there.
	assert.match(notificationSettingsPath(), /\.pi-harness-runtime[/\\]notification-settings\.json$/);
});

test("the settings are saved as readable JSON", () => {
	withTempDir((dir) => {
		const path = join(dir, "notification-settings.json");
		saveNotificationSettings({ version: 1, channels: { line: { enabled: false } } }, path);
		assert.equal(isChannelDisabled("line", path), true);
	});
});
