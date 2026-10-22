/**
 * Unit tests for the TypeSafe Jev provider.
 *
 * The TypeSafe API is stubbed at the `fetch` boundary, so no network calls and
 * no credentials are involved.
 *
 * Regression coverage: `buildDecision()` used to evaluate the choice answer as
 *
 *   answer.choice ?? question.type === "choice" ? options[0] : ""
 *
 * which JS parses as `(answer.choice ?? (question.type === "choice")) ? options[0] : ""`.
 * A non-empty choice returned by the model was therefore discarded and the
 * FIRST option was always selected.
 *
 * Run with: bun test packages/jev-judge/tests/typesafe-provider.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import { TypeSafeJudge } from "../src/typesafe-provider.js";
import type { JevChoiceResponse, JevNoulResponse, JevScoreResponse } from "../src/types.js";

const originalFetch = globalThis.fetch;

interface StubAnswer {
	type: "noul" | "choice" | "score";
	noul?: number;
	choice?: string;
	score?: number;
	confidence?: number;
}

function stubTypeSafe(answers: Record<string, StubAnswer>): void {
	globalThis.fetch = (async () => ({
		ok: true,
		status: 200,
		json: async () => ({ answers, model: "test-model", latency_ms: 1 }),
		text: async () => JSON.stringify({ answers }),
	})) as unknown as typeof fetch;
}

function makeJudge(): TypeSafeJudge {
	return new TypeSafeJudge({
		apiKey: "test-key",
		baseUrl: "https://typesafe.invalid",
		model: "test-model",
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("TypeSafeJudge - choice answers", () => {
	it("uses the choice returned by the model", async () => {
		stubTypeSafe({
			answer: { type: "choice", choice: "gamma", confidence: 0.8 },
		});

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["alpha", "beta", "gamma"],
			},
		});

		const response = result.decisions.answer.response as JevChoiceResponse;
		expect(response.choice).toBe("gamma");
		expect(response.confidence).toBe(0.8);
	});

	it("uses the choice returned by the model through the choice() helper", async () => {
		stubTypeSafe({
			answer: { type: "choice", choice: "beta", confidence: 0.6 },
		});

		const result = await makeJudge().choice("state", "Pick one", [
			"alpha",
			"beta",
		]);

		expect(result.choice).toBe("beta");
		expect(result.confidence).toBe(0.6);
	});

	it("falls back to the first option when the model returns no choice", async () => {
		stubTypeSafe({ answer: { type: "choice", confidence: 0.5 } });

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["alpha", "beta"],
			},
		});

		const response = result.decisions.answer.response as JevChoiceResponse;
		expect(response.choice).toBe("alpha");
	});

	it("treats an empty choice as no choice", async () => {
		stubTypeSafe({ answer: { type: "choice", choice: "   ", confidence: 0.5 } });

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["alpha", "beta"],
			},
		});

		const response = result.decisions.answer.response as JevChoiceResponse;
		expect(response.choice).toBe("alpha");
	});

	it("normalizes a case-insensitive match to the canonical option", async () => {
		stubTypeSafe({
			answer: { type: "choice", choice: "GAMMA", confidence: 0.7 },
		});

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["alpha", "beta", "gamma"],
			},
		});

		const response = result.decisions.answer.response as JevChoiceResponse;
		expect(response.choice).toBe("gamma");
	});

	it("passes a choice that is not in the options through unchanged", async () => {
		stubTypeSafe({
			answer: { type: "choice", choice: "delta", confidence: 0.4 },
		});

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["alpha", "beta"],
			},
		});

		const response = result.decisions.answer.response as JevChoiceResponse;
		expect(response.choice).toBe("delta");
	});
});

describe("TypeSafeJudge - noul and score answers", () => {
	it("keeps noul answers intact", async () => {
		stubTypeSafe({ answer: { type: "noul", noul: 0.75 } });

		const result = await makeJudge().evaluate("state", {
			answer: { type: "noul", instructions: "Is it true?" },
		});

		const response = result.decisions.answer.response as JevNoulResponse;
		expect(response.noul).toBe(0.75);
		expect(result.decisions.answer.probability).toBe(0.75);
	});

	it("normalizes score answers to a probability", async () => {
		stubTypeSafe({ answer: { type: "score", score: 75, confidence: 0.75 } });

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "score",
				instructions: "How good?",
				min: 0,
				max: 100,
			},
		});

		const response = result.decisions.answer.response as JevScoreResponse;
		expect(response.score).toBe(75);
		expect(result.decisions.answer.probability).toBe(0.75);
	});
});
