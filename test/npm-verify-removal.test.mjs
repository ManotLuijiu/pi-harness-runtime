/**
 * The verification that follows an npm removal has to be trustworthy.
 *
 * The removal is irreversible, so the operator relies on the check that
 * comes after it. The obvious check - ask the registry for one version at
 * a time and treat a non-zero exit as "the version is gone" - cannot tell
 * a removed version from a registry that did not answer. A network hiccup
 * during the check therefore reads as a successful removal.
 *
 * `scripts/npm-verify-removal.mjs` separates the two, and this file proves
 * that it does. The registry is a local server, so the test never touches
 * the network and can make the registry behave badly on purpose.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const script = join(repo, "scripts", "npm-verify-removal.mjs");

/**
 * A registry that answers with whatever the test tells it to.
 *
 * The state describes which versions are published, which tarballs are
 * still downloadable, and what the dist-tags say. The server answers
 * from that state, so a test can describe a removal that did not happen,
 * a removal that did, and a registry that is simply not answering.
 */
async function startRegistry(state) {
	const server = createServer((request, response) => {
		const url = new URL(request.url, "http://localhost");
		const path = decodeURIComponent(url.pathname);

		if (state.unreachable) {
			request.socket.destroy();
			return;
		}

		// The packument.
		if (path === "/pi-harness-runtime") {
			if (state.packumentStatus && state.packumentStatus !== 200) {
				response.writeHead(state.packumentStatus, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "registry says no" }));
				return;
			}
			const versions = {};
			for (const version of state.published) {
				versions[version] = { name: "pi-harness-runtime", version };
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ versions, "dist-tags": state.tags ?? {} }));
			return;
		}

		// A tarball.
		const tarball = /^\/pi-harness-runtime\/-\/pi-harness-runtime-(.+)\.tgz$/.exec(path);
		if (tarball) {
			const version = tarball[1];
			if (state.tarballsUnknown?.includes(version)) {
				// An answer that is neither "there" nor "not there".
				response.writeHead(500);
				response.end();
				return;
			}
			const alive = state.tarballsAlive?.includes(version) ?? state.published.includes(version);
			response.writeHead(alive ? 200 : 404, { "content-type": "application/octet-stream" });
			response.end(alive ? "tarball" : "not found");
			return;
		}

		response.writeHead(404);
		response.end();
	});

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise((done) => server.close(done)),
	};
}

function writeSpec(spec) {
	const dir = mkdtempSync(join(tmpdir(), "npm-verify-test-"));
	const path = join(dir, "spec.json");
	writeFileSync(path, JSON.stringify(spec));
	return path;
}

/**
 * Capture the registry state into a spec.
 *
 * The child is started asynchronously, for the same reason as the verify
 * call: a synchronous call would block the event loop that the local
 * registry runs in.
 */
function capture(registryUrl, packageName, gone) {
	const path = join(mkdtempSync(join(tmpdir(), "npm-verify-test-")), "spec.json");
	return new Promise((resolve) => {
		const child = execFile(
			"node",
			[script, packageName, "--capture", path, ...gone],
			{ env: { ...process.env, npm_config_registry: registryUrl }, encoding: "utf8" },
			(error, stdout, stderr) => {
				resolve({
					code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
					stdout: `${stdout ?? ""}${stderr ?? ""}`,
					spec: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null,
				});
			},
		);
		child.on("error", () => {});
	});
}

/**
 * Run the verifier against a registry.
 *
 * The registry is named through npm_config_registry, which is what the
 * script reads, so the check runs against the local server and never
 * against npm.
 */
function verify(registryUrl, packageName, spec) {
	const path = writeSpec(spec);
	// The child is started asynchronously on purpose. A synchronous call
	// would block this process's event loop, and the registry is a server
	// in this very process - it would never answer the child that is
	// waiting for it, so the check would time out instead of running.
	return new Promise((resolve) => {
		const child = execFile(
			"node",
			[script, packageName, path],
			{ env: { ...process.env, npm_config_registry: registryUrl }, encoding: "utf8" },
			(error, stdout, stderr) => {
				resolve({
					code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
					stdout: `${stdout ?? ""}${stderr ?? ""}`,
				});
			},
		);
		child.on("error", () => {});
	});
}

/**
 * The test starts a server and a node process. The runner's default
 * per-test timeout is five seconds, which is enough on a fast machine and
 * not enough on a slow one, so every test states a timeout of its own.
 */
const TEST_TIMEOUT_MS = 60_000;

test("a version that is still published is reported as not verified", { timeout: TEST_TIMEOUT_MS }, async () => {
	const registry = await startRegistry({
		published: ["1.1.390", "1.1.433"],
		tags: { latest: "1.1.433" },
	});
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			gone: ["1.1.390"],
			keep: ["1.1.433"],
			tags: { latest: "1.1.433" },
		});
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stdout, /not verified/);
		assert.match(result.stdout, /still published: 1\.1\.390/);
	} finally {
		await registry.close();
	}
});

test("a completed removal is proven", { timeout: TEST_TIMEOUT_MS }, async () => {
	const registry = await startRegistry({
		published: ["1.1.433"],
		tags: { latest: "1.1.433" },
	});
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			gone: ["1.1.390", "1.1.391"],
			keep: ["1.1.433"],
			tags: { latest: "1.1.433" },
		});
		assert.equal(result.code, 0, result.stdout);
		assert.match(result.stdout, /verified/);
		assert.match(result.stdout, /tarball answers 404/);
	} finally {
		await registry.close();
	}
});

test("a version that is gone from the packument but still downloadable is not verified", { timeout: TEST_TIMEOUT_MS }, async () => {
	// This is the case the packument alone cannot catch: the listing is
	// gone, so the version looks removed, but the tarball still serves
	// the content that carries the private data.
	const registry = await startRegistry({
		published: ["1.1.433"],
		tarballsAlive: ["1.1.390"],
		tags: { latest: "1.1.433" },
	});
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			gone: ["1.1.390"],
			keep: ["1.1.433"],
		});
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stdout, /the tarball is still downloadable: 1\.1\.390/);
	} finally {
		await registry.close();
	}
});

test("a registry that cannot be reached is not a pass", { timeout: TEST_TIMEOUT_MS }, async () => {
	// The defect this guards: an unreachable registry and a removed
	// version both look like a non-zero exit to the naive check. The
	// verifier must say it could not verify, and must not use the exit
	// code that means "verified" or the one that means "failed".
	//
	// The spec names no removed version on purpose. With one, the
	// tarball probe would also fail, and the run would end up reporting
	// "could not verify" for a second, unrelated reason - which would
	// let a broken packument read pass unnoticed. The packument fetch
	// is therefore the only thing that can produce this outcome.
	const registry = await startRegistry({ published: [], unreachable: true });
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			keep: ["1.1.433"],
		});
		assert.equal(result.code, 2, result.stdout);
		assert.match(result.stdout, /could not verify/);
	} finally {
		await registry.close();
	}
});

test("a registry that answers with an error is not a pass", { timeout: TEST_TIMEOUT_MS }, async () => {
	const registry = await startRegistry({ published: [], packumentStatus: 503 });
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			gone: ["1.1.390"],
			keep: ["1.1.433"],
		});
		assert.equal(result.code, 2, result.stdout);
		assert.match(result.stdout, /could not verify/);
		assert.match(result.stdout, /503/);
	} finally {
		await registry.close();
	}
});

test("a tarball that does not answer is not a pass", { timeout: TEST_TIMEOUT_MS }, async () => {
	// The registry answered the packument, so the version looks removed.
	// The tarball then answered something that proves nothing. The
	// verifier must not report that as a removal.
	const registry = await startRegistry({
		published: ["1.1.433"],
		tarballsUnknown: ["1.1.390"],
		tags: { latest: "1.1.433" },
	});
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			gone: ["1.1.390"],
			keep: ["1.1.433"],
		});
		assert.equal(result.code, 2, result.stdout);
		assert.match(result.stdout, /could not verify/);
	} finally {
		await registry.close();
	}
});

test("a version that should remain but is gone is not verified", { timeout: TEST_TIMEOUT_MS }, async () => {
	const registry = await startRegistry({
		published: ["1.1.433"],
		tags: { latest: "1.1.433" },
	});
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			gone: ["1.1.390"],
			keep: ["1.1.425"],
		});
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stdout, /missing: 1\.1\.425/);
	} finally {
		await registry.close();
	}
});

test("the capture records the state the check will prove", { timeout: TEST_TIMEOUT_MS }, async () => {
	// A spec written by hand can describe a state that was never the
	// real one. The captured one cannot: it names every published
	// version that is not on the removal list, and the dist-tags as they
	// are at that moment.
	const registry = await startRegistry({
		published: ["1.1.390", "1.1.425", "1.1.433"],
		tags: { latest: "1.1.433", develop: "0.10.42" },
	});
	try {
		const result = await capture(registry.url, "pi-harness-runtime", ["1.1.390"]);
		assert.equal(result.code, 0, result.stdout);
		assert.deepEqual(result.spec.gone, ["1.1.390"]);
		assert.deepEqual([...result.spec.keep].sort(), ["1.1.425", "1.1.433"]);
		assert.deepEqual(result.spec.tags, { latest: "1.1.433", develop: "0.10.42" });
	} finally {
		await registry.close();
	}
});

test("a captured spec fails when the removal has not happened", { timeout: TEST_TIMEOUT_MS }, async () => {
	// The captured spec is the honest description of the state before
	// the removal, so checking against it must fail while the versions
	// are still there.
	const registry = await startRegistry({
		published: ["1.1.390", "1.1.433"],
		tags: { latest: "1.1.433" },
	});
	try {
		const captured = await capture(registry.url, "pi-harness-runtime", ["1.1.390"]);
		assert.equal(captured.code, 0, captured.stdout);
		const result = await verify(registry.url, "pi-harness-runtime", captured.spec);
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stdout, /still published: 1\.1\.390/);
	} finally {
		await registry.close();
	}
});

test("a captured spec passes once the removal happened", { timeout: TEST_TIMEOUT_MS }, async () => {
	const before = await startRegistry({
		published: ["1.1.390", "1.1.433"],
		tags: { latest: "1.1.433" },
	});
	let captured;
	try {
		captured = await capture(before.url, "pi-harness-runtime", ["1.1.390"]);
	} finally {
		await before.close();
	}

	// The same registry, after the removal.
	const after = await startRegistry({
		published: ["1.1.433"],
		tags: { latest: "1.1.433" },
	});
	try {
		const result = await verify(after.url, "pi-harness-runtime", captured.spec);
		assert.equal(result.code, 0, result.stdout);
		assert.match(result.stdout, /verified/);
	} finally {
		await after.close();
	}
});

test("a dist-tag that moved is not verified", { timeout: TEST_TIMEOUT_MS }, async () => {
	const registry = await startRegistry({
		published: ["1.1.433"],
		tags: { latest: "1.1.420" },
	});
	try {
		const result = await verify(registry.url, "pi-harness-runtime", {
			gone: ["1.1.390"],
			keep: ["1.1.433"],
			tags: { latest: "1.1.433" },
		});
		assert.equal(result.code, 1, result.stdout);
		assert.match(result.stdout, /dist-tag latest points at 1\.1\.420, expected 1\.1\.433/);
	} finally {
		await registry.close();
	}
});
