/**
 * The visibility of the automatic retries of the core of Pi.
 *
 * The core declares `auto_retry_start` and `auto_retry_end` for its own
 * session and the interactive mode consumes them. The extension API does
 * not expose them, so the harness cannot observe the countdown of the
 * internal retry.
 *
 * The test is a guard, not a belief: when a newer core exposes the events
 * to extensions, the test fails and the harness wires the bridge instead
 * of documenting the gap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	CORE_RETRY_EVENTS,
	inspectRetryVisibility,
	installedRetryVisibility,
	resolveExtensionTypesPath,
} from "../harness/pi-retry-visibility.ts";

/** The declarations of the extension API of the core in this repository. */
function readRepositoryExtensionTypes() {
	const path = join(
		process.cwd(),
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"core",
		"extensions",
		"types.d.ts",
	);
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

test("the core declares the retry events for its own session", () => {
	const path = join(
		process.cwd(),
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"core",
		"agent-session.d.ts",
	);
	assert.ok(existsSync(path), "the declarations of the core are readable");
	const source = readFileSync(path, "utf8");
	for (const event of CORE_RETRY_EVENTS) {
		assert.ok(
			source.includes(`"${event}"`),
			`the core declares ${event}`,
		);
	}
});

test("the extension API of the core hides the retry events", () => {
	const source = readRepositoryExtensionTypes();
	assert.ok(
		source,
		"the declarations of the extension API are readable in the repository",
	);

	const visibility = inspectRetryVisibility(source);

	// When a newer core exposes the events to extensions, this assertion
	// fails on purpose: the harness then wires the bridge instead of
	// documenting a gap that no longer exists.
	assert.equal(
		visibility.verdict,
		"not-exposed",
		"the extension API of the core exposes the retry events now - wire the bridge to observe them",
	);
	assert.deepEqual(visibility.hidden, [...CORE_RETRY_EVENTS]);
	assert.match(visibility.reason, /not visible to an extension/);
});

test("the declarations that cannot be read are unknown, never exposed", () => {
	const visibility = inspectRetryVisibility(undefined);

	assert.equal(visibility.verdict, "unknown");
	assert.deepEqual(visibility.hidden, []);
	assert.match(visibility.reason, /could not be read/);
});

test("the declarations that expose the events are exposed", () => {
	const source = CORE_RETRY_EVENTS.map(
		(event) => `on(event: "${event}", handler: (event: unknown) => void): void;`,
	).join("\n");

	const visibility = inspectRetryVisibility(source);

	assert.equal(visibility.verdict, "exposed");
	assert.deepEqual(visibility.hidden, []);
});

test("the path of the declarations follows the entry point of the core", () => {
	const path = resolveExtensionTypesPath([
		"/usr/bin/node",
		"/home/user/.nvm/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
	]);

	assert.equal(
		path,
		"/home/user/.nvm/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts",
	);
});

test("a process without the core has no path", () => {
	assert.equal(resolveExtensionTypesPath(["/usr/bin/node", "/tmp/app.js"]), undefined);
});

test("the visibility of the installed core is a verdict, never a guess", () => {
	const visibility = installedRetryVisibility();

	assert.ok(
		["exposed", "not-exposed", "unknown"].includes(visibility.verdict),
		"the verdict is one of the three",
	);
	assert.equal(typeof visibility.reason, "string");
	assert.ok(visibility.reason.length > 0, "the verdict carries a reason");
});
