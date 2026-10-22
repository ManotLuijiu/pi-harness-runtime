/**
 * Unit tests for the Jev provider chain.
 *
 * The TypeSafe provider is stubbed at the `fetch` boundary and the OpenRouter
 * provider runs against a local HTTP server, so no network calls to the real
 * services and no credentials are involved.
 *
 * The behaviour under test:
 *
 * 1. A credential belongs to ONE provider. A TypeSafe key is never sent to
 *    OpenRouter and an OpenRouter key is never sent to the TypeSafe API.
 * 2. The next provider is only used when the previous one failed with a
 *    retryable error. A request contract error (422) is never papered over
 *    with a fallback provider, because it is a bug in the request we build.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
	JevJudge,
	resolveJevProviders,
	OPENROUTER_DEFAULT_MODEL,
	TYPESAFE_DEFAULT_MODEL,
} from "../src/index.js";
import { JevProviderError } from "../src/provider-error.js";
import type { JevProviderConfig } from "../src/types.js";

const originalFetch = globalThis.fetch;

interface Call {
	url: string;
	authorization: string;
}

let calls: Call[] = [];
let tempDirs: string[] = [];

/**
 * A temporary key directory with the given key files.
 */
function makeKeysDir(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "jev-keys-"));
	tempDirs.push(dir);
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content, "utf8");
	}
	return dir;
}

/**
 * Stub the TypeSafe endpoint (the provider under test uses global fetch).
 */
function stubTypeSafeFetch(status: number, body: unknown): void {
	globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
		calls.push({
			url,
			authorization: init?.headers?.["Authorization"] ?? "",
		});
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
			text: async () => JSON.stringify(body),
		};
	}) as unknown as typeof fetch;
}

/**
 * A local OpenRouter compatible endpoint (the OpenAI SDK does its own
 * networking, so the provider cannot be stubbed at the fetch boundary).
 */
async function startOpenRouterServer(options: {
	status?: number;
	content?: string;
}): Promise<{ baseUrl: string; server: Server; close: () => Promise<void> }> {
	const status = options.status ?? 200;
	const content = options.content ?? JSON.stringify({ answer: { type: "noul", noul: 0.5 } });

	const server = createServer((req, res) => {
		calls.push({
			url: req.url ?? "",
			authorization: req.headers["authorization"] ?? "",
		});
		const payload = {
			id: "chatcmpl-test",
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: "test-model",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		};
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(payload));
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;

	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		server,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}

function typesafeProvider(overrides: Partial<JevProviderConfig> = {}): JevProviderConfig {
	return {
		provider: "typesafe",
		apiKey: "typesafe-secret",
		baseUrl: "https://typesafe.invalid",
		model: "test-model",
		...overrides,
	};
}

function openrouterProvider(
	baseUrl: string,
	overrides: Partial<JevProviderConfig> = {}
): JevProviderConfig {
	return {
		provider: "openrouter",
		apiKey: "openrouter-secret",
		baseUrl,
		model: "test-model",
		...overrides,
	};
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	calls = [];
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
});

describe("resolveJevProviders", () => {
	it("binds each environment credential to its own provider", () => {
		const providers = resolveJevProviders({
			env: { TYPESAFE_API_KEY: "typesafe-secret", OPENROUTER_API_KEY: "openrouter-secret" },
			keysDir: "/nonexistent-keys-dir",
		});

		expect(providers.length).toBe(2);
		expect(providers[0].provider).toBe("typesafe");
		expect(providers[0].apiKey).toBe("typesafe-secret");
		expect(providers[0].baseUrl).toContain("typesafe.ai");
		expect(providers[0].model).toBe(TYPESAFE_DEFAULT_MODEL);
		expect(providers[1].provider).toBe("openrouter");
		expect(providers[1].apiKey).toBe("openrouter-secret");
		expect(providers[1].baseUrl).toContain("openrouter");
		expect(providers[1].model).toBe(OPENROUTER_DEFAULT_MODEL);
	});

	it("never puts the TypeSafe key on the OpenRouter provider", () => {
		const providers = resolveJevProviders({
			env: { TYPESAFE_API_KEY: "typesafe-secret" },
			keysDir: "/nonexistent-keys-dir",
		});

		expect(providers.length).toBe(1);
		expect(providers[0].provider).toBe("typesafe");
		expect(providers.some((p) => p.provider === "openrouter")).toBe(false);
	});

	it("never puts the OpenRouter key on the TypeSafe provider", () => {
		const providers = resolveJevProviders({
			env: { OPENROUTER_API_KEY: "openrouter-secret" },
			keysDir: "/nonexistent-keys-dir",
		});

		expect(providers.length).toBe(1);
		expect(providers[0].provider).toBe("openrouter");
		expect(providers[0].apiKey).toBe("openrouter-secret");
	});

	it("returns no provider when no credential is available", () => {
		const providers = resolveJevProviders({
			env: {},
			keysDir: "/nonexistent-keys-dir",
		});

		expect(providers.length).toBe(0);
	});

	it("reads the key files and binds each key to its own provider", () => {
		const keysDir = makeKeysDir({
			"typesafe-api-key.txt": "typesafe-file-secret",
			"openrouter-api-key.txt": "openrouter-file-secret",
		});

		const providers = resolveJevProviders({ env: {}, keysDir });

		expect(providers.length).toBe(2);
		expect(providers[0].provider).toBe("typesafe");
		expect(providers[0].apiKey).toBe("typesafe-file-secret");
		expect(providers[0].baseUrl).toContain("typesafe.ai");
		expect(providers[1].provider).toBe("openrouter");
		expect(providers[1].apiKey).toBe("openrouter-file-secret");
		expect(providers[1].baseUrl).toContain("openrouter");
	});

	it("binds the legacy key file by the shape of the key it holds", () => {
		const keysDir = makeKeysDir({
			"jev-api-key.txt": "sk-or-v1-legacy-openrouter-secret",
		});

		const providers = resolveJevProviders({ env: {}, keysDir });

		expect(providers.length).toBe(1);
		// An OpenRouter key must never be sent to the TypeSafe API.
		expect(providers[0].provider).toBe("openrouter");
		expect(providers[0].apiKey).toBe("sk-or-v1-legacy-openrouter-secret");
		expect(providers[0].baseUrl).toContain("openrouter");
	});

	it("binds a legacy key file that is not an OpenRouter key to TypeSafe", () => {
		const keysDir = makeKeysDir({
			"jev-api-key.txt": "legacy-typesafe-secret",
		});

		const providers = resolveJevProviders({ env: {}, keysDir });

		expect(providers.length).toBe(1);
		expect(providers[0].provider).toBe("typesafe");
		expect(providers[0].apiKey).toBe("legacy-typesafe-secret");
	});

	it("prefers the dedicated key file over the legacy one", () => {
		const keysDir = makeKeysDir({
			"typesafe-api-key.txt": "typesafe-file-secret",
			"jev-api-key.txt": "legacy-typesafe-secret",
		});

		const providers = resolveJevProviders({ env: {}, keysDir });

		expect(providers.length).toBe(1);
		expect(providers[0].apiKey).toBe("typesafe-file-secret");
	});

	it("keeps TypeSafe first when the legacy key is the TypeSafe one", () => {
		const keysDir = makeKeysDir({
			"jev-api-key.txt": "legacy-typesafe-secret",
			"openrouter-api-key.txt": "openrouter-file-secret",
		});

		const providers = resolveJevProviders({ env: {}, keysDir });

		// TypeSafe is the primary provider, OpenRouter the fallback.
		expect(providers.length).toBe(2);
		expect(providers[0].provider).toBe("typesafe");
		expect(providers[0].apiKey).toBe("legacy-typesafe-secret");
		expect(providers[1].provider).toBe("openrouter");
		expect(providers[1].apiKey).toBe("openrouter-file-secret");
	});
});

describe("JevJudge - provider chain", () => {
	it("uses the first provider when it succeeds", async () => {
		stubTypeSafeFetch(200, {
			answers: { answer: { type: "noul", noul: 0.9 } },
			model: "test-model",
		});

		const judge = new JevJudge({
			providers: [typesafeProvider(), openrouterProvider("http://127.0.0.1:1/v1")],
		});

		const result = await judge.evaluate("state", {
			answer: { type: "noul", instructions: "Is it true?" },
		});

		expect(result.provider).toBe("typesafe");
		expect(result.decisions.answer.probability).toBe(0.9);
		expect(calls.length).toBe(1);
		expect(calls[0].url).toContain("typesafe.invalid");
	});

	it("falls back to the next provider on a server error", async () => {
		stubTypeSafeFetch(500, { detail: "server error" });
		const openrouter = await startOpenRouterServer({});

		try {
			const judge = new JevJudge({
				providers: [typesafeProvider(), openrouterProvider(openrouter.baseUrl)],
			});

			const result = await judge.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			});

			expect(result.provider).toBe("openrouter");
			expect(calls.length).toBe(2);
			expect(calls[0].url).toContain("typesafe.invalid");
			expect(calls[1].url).toContain("/chat/completions");
		} finally {
			await openrouter.close();
		}
	});

	it("falls back on an auth error", async () => {
		stubTypeSafeFetch(401, { detail: "invalid token" });
		const openrouter = await startOpenRouterServer({});

		try {
			const judge = new JevJudge({
				providers: [typesafeProvider(), openrouterProvider(openrouter.baseUrl)],
			});

			const result = await judge.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			});

			expect(result.provider).toBe("openrouter");
			expect(calls.length).toBe(2);
		} finally {
			await openrouter.close();
		}
	});

	it("does NOT fall back on a contract error", async () => {
		stubTypeSafeFetch(422, { detail: "Input should be a valid dictionary" });

		const judge = new JevJudge({
			providers: [typesafeProvider(), openrouterProvider("http://127.0.0.1:1/v1")],
		});

		const error = (await judge
			.evaluate("state", { answer: { type: "noul", instructions: "Is it true?" } })
			.catch((e: unknown) => e)) as JevProviderError;

		expect(error).toBeInstanceOf(JevProviderError);
		expect((error as JevProviderError).status).toBe(422);
		expect((error as JevProviderError).retryable).toBe(false);
		// The second provider was never asked: a contract error is a bug, not
		// a provider outage.
		expect(calls.length).toBe(1);
		expect(calls[0].url).toContain("typesafe.invalid");
	});

	it("sends the credential of the provider it belongs to", async () => {
		stubTypeSafeFetch(500, { detail: "server error" });
		const openrouter = await startOpenRouterServer({});

		try {
			const judge = new JevJudge({
				providers: [
					typesafeProvider({ apiKey: "typesafe-secret" }),
					openrouterProvider(openrouter.baseUrl, { apiKey: "openrouter-secret" }),
				],
			});

			await judge.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			});

			expect(calls[0].authorization).toBe("Bearer typesafe-secret");
			expect(calls[1].authorization).toBe("Bearer openrouter-secret");
		} finally {
			await openrouter.close();
		}
	});

	it("reports the last error when every provider fails", async () => {
		stubTypeSafeFetch(503, { detail: "service unavailable" });
		const openrouter = await startOpenRouterServer({ status: 500 });

		try {
			const judge = new JevJudge({
				providers: [typesafeProvider(), openrouterProvider(openrouter.baseUrl)],
			});

			const error = (await judge
				.evaluate("state", { answer: { type: "noul", instructions: "Is it true?" } })
				.catch((e: unknown) => e)) as JevProviderError;

			expect(error).toBeInstanceOf(JevProviderError);
			// The status of the LAST provider (500), not of the first one (503).
			expect((error as JevProviderError).status).toBe(500);
			expect((error as JevProviderError).provider).toBe("openrouter");
			// Both providers were contacted (the OpenRouter SDK retries a 5xx
			// on its own, so the exact number of calls is not fixed).
			expect(calls.length).toBeGreaterThanOrEqual(2);
			expect(calls.some((call) => call.url.includes("/chat/completions"))).toBe(true);
		} finally {
			await openrouter.close();
		}
	});

	it("does NOT fall back on a bad request (400)", async () => {
		stubTypeSafeFetch(400, { detail: "Invalid request." });

		const judge = new JevJudge({
			providers: [typesafeProvider(), openrouterProvider("http://127.0.0.1:1/v1")],
		});

		const error = (await judge
			.evaluate("state", { answer: { type: "noul", instructions: "Is it true?" } })
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).status).toBe(400);
		expect((error as JevProviderError).retryable).toBe(false);
		expect(calls.length).toBe(1);
	});

	it("falls back on a rate limit (429)", async () => {
		stubTypeSafeFetch(429, { detail: "slow down" });
		const openrouter = await startOpenRouterServer({});

		try {
			const judge = new JevJudge({
				providers: [typesafeProvider(), openrouterProvider(openrouter.baseUrl)],
			});

			const result = await judge.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			});

			expect(result.provider).toBe("openrouter");
			expect(calls.length).toBe(2);
		} finally {
			await openrouter.close();
		}
	});

	it("falls back on a network failure", async () => {
		globalThis.fetch = (async () => {
			throw Object.assign(new Error("fetch failed"), { name: "APIConnectionError" });
		}) as unknown as typeof fetch;
		const openrouter = await startOpenRouterServer({});

		try {
			const judge = new JevJudge({
				providers: [typesafeProvider(), openrouterProvider(openrouter.baseUrl)],
			});

			const result = await judge.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			});

			expect(result.provider).toBe("openrouter");
		} finally {
			await openrouter.close();
		}
	});

	it("gives every provider entry its own credential when the base URL is shared", async () => {
		// The first entry fails with a retryable error, so the second entry is
		// used. The clients are cached per provider identity: the second entry
		// must NOT reuse the client (and the credential) of the first one.
		let call = 0;
		globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
			call += 1;
			calls.push({
				url,
				authorization: init?.headers?.["Authorization"] ?? "",
			});
			const ok = call > 1;
			return {
				ok,
				status: ok ? 200 : 503,
				json: async () => ({ answers: { answer: { type: "noul", noul: 0.9 } } }),
				text: async () => "{}",
			};
		}) as unknown as typeof fetch;

		const judge = new JevJudge({
			providers: [
				typesafeProvider({ apiKey: "first-secret" }),
				typesafeProvider({ apiKey: "second-secret" }),
			],
		});

		const result = await judge.evaluate("state", {
			answer: { type: "noul", instructions: "Is it true?" },
		});

		expect(result.provider).toBe("typesafe");
		expect(calls.length).toBe(2);
		expect(calls[0].authorization).toBe("Bearer first-secret");
		expect(calls[1].authorization).toBe("Bearer second-secret");
	});

	it("keeps the legacy single provider configuration working", async () => {
		stubTypeSafeFetch(200, {
			answers: { answer: { type: "noul", noul: 0.7 } },
			model: "test-model",
		});

		const judge = new JevJudge({
			apiKey: "legacy-key",
			baseUrl: "https://api.typesafe.ai",
		});

		const result = await judge.evaluate("state", {
			answer: { type: "noul", instructions: "Is it true?" },
		});

		expect(result.provider).toBe("typesafe");
		expect(calls.length).toBe(1);
		expect(calls[0].authorization).toBe("Bearer legacy-key");
	});

	it("refuses to run without a provider", () => {
		expect(() => new JevJudge({})).toThrow(/no provider configured/i);
	});

	it("refuses a legacy OpenRouter key without an explicit base URL", () => {
		expect(
			() => new JevJudge({ apiKey: "sk-or-v1-legacy-openrouter-secret" })
		).toThrow(/openrouter/i);
	});

	it("drops a provider with an empty api key", () => {
		expect(
			() =>
				new JevJudge({
					providers: [typesafeProvider({ apiKey: "" })],
				})
		).toThrow(/no usable provider/i);
	});
});
