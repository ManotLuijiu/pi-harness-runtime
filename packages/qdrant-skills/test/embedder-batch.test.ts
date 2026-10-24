/**
 * The batch embeddings of the embedder.
 *
 * One request per text exhausts the sockets of the process when a registry
 * holds hundreds of skills. The endpoint of OpenAI accepts an array of
 * inputs, so a batch stays one request per chunk.
 *
 * The HTTP client is injected, so the test never replaces a global and never
 * reaches the network.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createEmbeddingsBatch } from "../src/embedder.js";

/** One recorded request. */
interface RecordedRequest {
	url: string;
	body: { model: string; input: string[] };
	authorization: string;
}

/** A client that answers with the given vectors. */
function fakeFetch(
	vectors: number[][],
	recorded: RecordedRequest[],
): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? "{}")) as {
			model: string;
			input: string[];
		};
		recorded.push({
			url: String(input),
			body,
			authorization: String(
				(init?.headers as Record<string, string>)?.Authorization ?? "",
			),
		});
		return {
			ok: true,
			json: async () => ({
				// The endpoint may answer out of order.
				data: body.input.map((_, index) => {
					const position = body.input.length - 1 - index;
					return { index: position, embedding: vectors[position] };
				}),
				usage: { total_tokens: body.input.length * 3 },
			}),
			text: async () => "",
		} as Response;
	}) as unknown as typeof fetch;
}

/** The environment variables the key lookup looks at. */
const ENV_KEYS = ["OPENAI_API_KEY", "HOME", "USERPROFILE"] as const;

let saved: Record<string, string | undefined> = {};
let tempHome: string;

beforeEach(() => {
	saved = {};
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	// A fresh home directory: the test never reads the key of the machine
	// it runs on.
	tempHome = mkdtempSync(join(homedir(), ".test-qdrant-batch-"));
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	rmSync(tempHome, { recursive: true, force: true });
});

describe("the batch embeddings of the embedder", () => {
	it("sends one request for many texts", async () => {
		const recorded: RecordedRequest[] = [];
		const texts = ["first", "second", "third"];

		const result = await createEmbeddingsBatch(
			texts,
			"sk-test-key",
			{ fetchImpl: fakeFetch([[1], [2], [3]], recorded) },
		);

		expect(recorded.length).toBe(1);
		expect(recorded[0].body.input).toEqual(texts);
		expect(result.embeddings).toEqual([[1], [2], [3]]);
		expect(result.tokens).toBe(9);
	});

	it("keeps the order of the texts even when the answer is out of order", async () => {
		const recorded: RecordedRequest[] = [];

		const result = await createEmbeddingsBatch(
			["a", "b", "c"],
			"sk-test-key",
			{ fetchImpl: fakeFetch([[10], [20], [30]], recorded) },
		);

		expect(result.embeddings).toEqual([[10], [20], [30]]);
	});

	it("splits a large input into chunks", async () => {
		const recorded: RecordedRequest[] = [];
		const texts = Array.from({ length: 150 }, (_, index) => `text-${index}`);

		const result = await createEmbeddingsBatch(
			texts,
			"sk-test-key",
			{ fetchImpl: fakeFetch(texts.map((_, index) => [index]), recorded) },
		);

		// The chunk size is 64, so 150 texts need three requests.
		expect(recorded.length).toBe(3);
		expect(recorded[0].body.input.length).toBe(64);
		expect(recorded[1].body.input.length).toBe(64);
		expect(recorded[2].body.input.length).toBe(22);
		expect(result.embeddings.length).toBe(150);
		expect(result.tokens).toBe(150 * 3);
	});

	it("sends no request for an empty input", async () => {
		const recorded: RecordedRequest[] = [];

		const result = await createEmbeddingsBatch([], "sk-test-key", {
			fetchImpl: fakeFetch([], recorded),
		});

		expect(recorded.length).toBe(0);
		expect(result.embeddings).toEqual([]);
		expect(result.tokens).toBe(0);
	});

	it("sends the OpenAI key of the caller", async () => {
		const recorded: RecordedRequest[] = [];

		await createEmbeddingsBatch(["text"], "sk-test-key", {
			fetchImpl: fakeFetch([[1]], recorded),
		});

		expect(recorded[0].authorization).toBe("Bearer sk-test-key");
		expect(recorded[0].url).toBe("https://api.openai.com/v1/embeddings");
	});

	it("trims a very long text", async () => {
		const recorded: RecordedRequest[] = [];

		await createEmbeddingsBatch(["x".repeat(9000)], "sk-test-key", {
			fetchImpl: fakeFetch([[1]], recorded),
		});

		expect(recorded[0].body.input[0].length).toBe(8000);
	});

	it("reports a failed request", async () => {
		const failing = (async () =>
			({
				ok: false,
				text: async () => "the endpoint refused the request",
			}) as Response) as unknown as typeof fetch;

		await expect(
			createEmbeddingsBatch(["text"], "sk-test-key", { fetchImpl: failing }),
		).rejects.toThrow(/OpenAI embedding failed/);
	});

	it("reports a missing key", async () => {
		// The home directory points at a fresh directory and the environment
		// carries no key, so the machine of the test cannot provide one.
		await expect(
			createEmbeddingsBatch(["text"], "", { fetchImpl: fakeFetch([[1]], []) }),
		).rejects.toThrow(/No OpenAI API key/);
	});
});
