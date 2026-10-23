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
		// The adapter takes the inner config (the notification center passes
		// channel.config to it).
		const adapter = new LineAdapter({
			channelAccessToken: "test-token",
			userId: "test-user",
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
			channelAccessToken: "bad-token",
			userId: "test-user",
		});
		assert.equal(await adapter.initialize(), false);
		assert.equal(adapter.isHealthy(), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the diagnostic names the reason and never the token", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({
		ok: false,
		status: 401,
		text: async () => '{"message":"invalid token bad-token"}',
	});
	try {
		const adapter = new LineAdapter({
			channelAccessToken: "bad-token",
			userId: "test-user",
		});
		assert.equal(await adapter.initialize(), false);
		const diagnostic = adapter.getDiagnostic();
		assert.match(diagnostic, /401/);
		// The reason: the token is invalid, expired or revoked.
		assert.match(diagnostic, /invalid, expired or revoked/);
		// A credential must never reach the startup summary.
		assert.equal(diagnostic.includes("bad-token"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("a LINE server failure is not reported as a credential problem", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
	try {
		const adapter = new LineAdapter({
			channelAccessToken: "some-token",
			userId: "test-user",
		});
		assert.equal(await adapter.initialize(), false);
		const diagnostic = adapter.getDiagnostic();
		assert.match(diagnostic, /the LINE API failed/);
		assert.equal(diagnostic.includes("invalid, expired or revoked"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the credential is checked against the bot info endpoint", async () => {
	const originalFetch = globalThis.fetch;
	let requested = "";
	let authHeader = "";
	globalThis.fetch = async (url, options) => {
		requested = String(url);
		authHeader = String(options?.headers?.["Authorization"] ?? "");
		return { ok: true, status: 200, text: async () => "" };
	};
	try {
		const adapter = new LineAdapter({
			channelAccessToken: "some-token",
			userId: "test-user",
		});
		assert.equal(await adapter.initialize(), true);
		// The user profile endpoint needs a user id in the path, so it can
		// never validate a credential.
		assert.match(requested, /\/v2\/bot\/info$/);
		// The token is really sent - a check without the credential would
		// pass for every token.
		assert.equal(authHeader, "Bearer some-token");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("a missing token is a missing credential, not a failed request", async () => {
	const originalFetch = globalThis.fetch;
	let called = false;
	globalThis.fetch = async () => {
		called = true;
		return { ok: true, status: 200, text: async () => "" };
	};
	try {
		const adapter = new LineAdapter({ channelAccessToken: "", userId: "test-user" });
		assert.equal(await adapter.initialize(), false);
		assert.equal(called, false, "no request is made without a token");
		assert.match(adapter.getDiagnostic(), /no LINE channel access token configured/);
		assert.equal(adapter.isHealthy(), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the credential check is bounded by a timeout", async () => {
	const originalFetch = globalThis.fetch;
	let signal = null;
	globalThis.fetch = async (_url, options) => {
		signal = options?.signal ?? null;
		return { ok: true, status: 200, text: async () => "" };
	};
	try {
		const adapter = new LineAdapter({
			channelAccessToken: "some-token",
			userId: "test-user",
		});
		assert.equal(await adapter.initialize(), true);
		assert.ok(signal, "the request carries an abort signal");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("a network failure is reported without throwing", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("ECONNREFUSED 127.0.0.1:443");
	};
	try {
		const adapter = new LineAdapter({
			channelAccessToken: "some-token",
			userId: "test-user",
		});
		assert.equal(await adapter.initialize(), false);
		const diagnostic = adapter.getDiagnostic();
		assert.match(diagnostic, /LINE network error/);
		assert.equal(diagnostic.includes("some-token"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("a bot token in an error body is redacted", async () => {
	const { sanitizeLineText } = await import(
		join(packageRoot, "dist", "adapters", "line-adapter.js")
	);
	const sanitized = sanitizeLineText(
		"failed for https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getMe",
	);

	assert.equal(sanitized.includes("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"), false);
	assert.match(sanitized, /<redacted>/);
	// The machine readable output stays ASCII.
	assert.equal(/[^\x20-\x7e]/.test(sanitized), false);
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
