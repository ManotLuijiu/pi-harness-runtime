/**
 * The LINE adapter of the shipped notification package must mark itself
 * healthy when its credentials work.
 *
 * The startup summary reports "LINE: configured and enabled" only when the
 * channel is healthy. The notification package ships its compiled output
 * (`dist/`), so a source fix without a rebuilt dist would leave the startup
 * summary claiming that the LINE channel never starts. This test exercises
 * the **dist** (the artifact that actually runs) and asserts that it is in
 * sync with the source.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "packages", "notification");

const { LineAdapter } = await import(
	join(packageRoot, "dist", "adapters", "line-adapter.js")
);

test("the compiled LINE adapter marks itself healthy when the token works", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "" });
	try {
		const adapter = new LineAdapter({
			id: "line",
			type: "line",
			enabled: true,
			config: { channelAccessToken: "test-token", userId: "test-user" },
		});
		assert.equal(await adapter.initialize(), true);
		// The startup summary gates the green LINE line on this flag.
		assert.equal(
			adapter.isHealthy(),
			true,
			"the compiled adapter reports itself healthy after a successful initialize()",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("a failing LINE profile request does not mark the adapter healthy", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => "nope" });
	try {
		const adapter = new LineAdapter({
			id: "line",
			type: "line",
			enabled: true,
			config: { channelAccessToken: "bad-token", userId: "test-user" },
		});
		assert.equal(await adapter.initialize(), false);
		assert.equal(adapter.isHealthy(), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the compiled adapter is in sync with its source", () => {
	const source = readFileSync(join(packageRoot, "src", "adapters", "line-adapter.ts"), "utf8");
	const dist = readFileSync(join(packageRoot, "dist", "adapters", "line-adapter.js"), "utf8");
	assert.match(source, /this\.markHealthy\(\)/);
	assert.match(
		dist,
		/this\.markHealthy\(\)/,
		"the compiled adapter marks itself healthy - rebuild packages/notification",
	);
});
