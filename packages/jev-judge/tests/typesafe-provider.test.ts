/**
 * Unit tests for the TypeSafe Jev provider.
 *
 * The TypeSafe API is stubbed at the `fetch` boundary, so no network calls and
 * no credentials are involved.
 *
 * Regression coverage:
 *
 * 1. `buildDecision()` used to evaluate the choice answer as
 *
 *      answer.choice ?? question.type === "choice" ? options[0] : ""
 *
 *    which JS parses as `(answer.choice ?? (question.type === "choice")) …`
 *    - so the model's choice was DISCARDED and the first option always won.
 *
 * 2. The request contract: the TypeSafe API rejects a choice question whose
 *    `criteria` is an ARRAY ("Input should be a valid dictionary") and a
 *    score question without `criteria` ("Field required"). Both used to be
 *    sent that way, so every real auto-continue request failed with 422 and
 *    the judge silently fell back to its "wait" default.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { TypeSafeJudge } from "../src/typesafe-provider.js";
import { JevProviderError } from "../src/provider-error.js";
import type { JevChoiceResponse, JevNoulResponse, JevScoreResponse } from "../src/types.js";

const originalFetch = globalThis.fetch;

interface StubAnswer {
	type: "noul" | "choice" | "score";
	noul?: number;
	choice?: string;
	score?: number;
	confidence?: number;
}

interface CapturedRequest {
	url: string;
	body: Record<string, unknown>;
}

let lastRequest: CapturedRequest | null = null;

function stubTypeSafe(answers: Record<string, StubAnswer>): void {
	lastRequest = null;
	globalThis.fetch = (async (url: string, init?: { body?: string }) => {
		lastRequest = {
			url,
			body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
		};
		return {
			ok: true,
			status: 200,
			json: async () => ({ answers, model: "test-model", latency_ms: 1 }),
			text: async () => JSON.stringify({ answers }),
		};
	}) as unknown as typeof fetch;
}

function stubFailure(status: number, body = "boom"): void {
	lastRequest = null;
	globalThis.fetch = (async (url: string, init?: { body?: string }) => {
		lastRequest = {
			url,
			body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
		};
		return {
			ok: false,
			status,
			json: async () => ({ detail: body }),
			text: async () => body,
		};
	}) as unknown as typeof fetch;
}

function stubNetworkError(error?: unknown): void {
	globalThis.fetch = (async () => {
		throw error ?? new Error("fetch failed");
	}) as unknown as typeof fetch;
}

/**
 * The error shape undici produces for a connection failure: a TypeError whose
 * cause carries the system error code.
 */
function undiciConnectionError(): Error {
	return Object.assign(new TypeError("fetch failed"), {
		cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
			code: "ECONNREFUSED",
		}),
	});
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
	lastRequest = null;
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
		expect(result.decisions.answer.probability).toBe(0.8);
	});

	it("sends the choice criteria as a dictionary", async () => {
		stubTypeSafe({
			answer: { type: "choice", choice: "high", confidence: 0.6 },
		});

		await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["critical", "high"],
				optionDescriptions: {
					critical: "it is critical",
					high: "it is high",
				},
			},
		});

		const questions = lastRequest?.body.questions as Record<
			string,
			{ type: string; criteria: unknown }
		>;
		expect(questions.answer.type).toBe("choice");
		expect(questions.answer.criteria).toEqual({
			critical: "it is critical",
			high: "it is high",
		});
	});

	it("accepts a criteria dictionary directly", async () => {
		stubTypeSafe({
			answer: { type: "choice", choice: "high", confidence: 0.6 },
		});

		await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				criteria: { critical: "it is critical", high: "it is high" },
			},
		});

		const questions = lastRequest?.body.questions as Record<
			string,
			{ criteria: unknown }
		>;
		expect(questions.answer.criteria).toEqual({
			critical: "it is critical",
			high: "it is high",
		});
	});

	it("matches the option spelling case insensitively", async () => {
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

	it("passes an unknown choice through instead of substituting an option", async () => {
		stubTypeSafe({
			answer: { type: "choice", choice: "delta", confidence: 0.7 },
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

	it("sends a score question with a rubric", async () => {
		stubTypeSafe({ answer: { type: "score", score: 3, confidence: 0.6 } });

		await makeJudge().evaluate("state", {
			answer: {
				type: "score",
				instructions: "How bad?",
				min: 1,
				max: 5,
				criteria: ["1 - none", "2 - low", "3 - medium", "4 - high", "5 - severe"],
			},
		});

		const questions = lastRequest?.body.questions as Record<
			string,
			{ type: string; criteria: unknown }
		>;
		expect(questions.answer.type).toBe("score");
		expect(questions.answer.criteria).toEqual([
			"1 - none",
			"2 - low",
			"3 - medium",
			"4 - high",
			"5 - severe",
		]);
	});

	it("derives a rubric from min and max when none is given", async () => {
		stubTypeSafe({ answer: { type: "score", score: 3.37, confidence: 0.6 } });

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "score",
				instructions: "How bad?",
				min: 1,
				max: 5,
			},
		});

		const questions = lastRequest?.body.questions as Record<
			string,
			{ criteria: string[] }
		>;
		expect(Array.isArray(questions.answer.criteria)).toBe(true);
		expect(questions.answer.criteria.length).toBe(5);

		// The API answers with the position in the rubric, the reported value
		// is mapped back onto the min/max scale.
		const response = result.decisions.answer.response as JevScoreResponse;
		expect(response.score).toBeCloseTo(4.37, 5);
		expect(result.decisions.answer.probability).toBeCloseTo(0.8425, 5);
	});

	it("maps the rubric position onto the min/max scale", async () => {
		stubTypeSafe({ answer: { type: "score", score: 4.5, confidence: 0.6 } });

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "score",
				instructions: "How good?",
				min: 0,
				max: 100,
			},
		});

		const response = result.decisions.answer.response as JevScoreResponse;
		// 10 levels were derived (0..100), 4.5 of 9 steps => 50
		expect(response.score).toBeCloseTo(50, 5);
		expect(result.decisions.answer.probability).toBeCloseTo(0.5, 5);
	});

	it("clamps a rubric position outside the rubric", async () => {
		stubTypeSafe({ answer: { type: "score", score: 99, confidence: 0.6 } });

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "score",
				instructions: "How good?",
				min: 1,
				max: 5,
			},
		});

		const response = result.decisions.answer.response as JevScoreResponse;
		expect(response.score).toBe(5);
		expect(result.decisions.answer.probability).toBe(1);
	});
});

describe("TypeSafeJudge - request validation", () => {
	it("rejects a choice question without options before sending anything", async () => {
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
		}) as unknown as typeof fetch;

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "choice", instructions: "Pick one" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect(error).toBeInstanceOf(JevProviderError);
		expect((error as JevProviderError).retryable).toBe(false);
		expect((error as JevProviderError).message).toContain("options");
		expect(called).toBe(false);
	});

	it("rejects a score question with too many rubric levels", async () => {
		const error = (await makeJudge()
			.evaluate("state", {
				answer: {
					type: "score",
					instructions: "How good?",
					criteria: Array.from({ length: 12 }, (_, i) => `level ${i}`),
				},
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect(error).toBeInstanceOf(JevProviderError);
		expect((error as JevProviderError).retryable).toBe(false);
	});
});

describe("TypeSafeJudge - wire format", () => {
	it("sends only the fields the API accepts", async () => {
		stubTypeSafe({ answer: { type: "noul", noul: 0.5 } });

		await makeJudge().evaluate("state", {
			answer: { type: "noul", instructions: "Is it true?" },
		});

		// The API rejects unknown fields with 400 "Invalid request" - a local
		// bookkeeping field that leaks into the body breaks every request.
		expect(Object.keys(lastRequest?.body ?? {}).sort()).toEqual([
			"model",
			"questions",
			"state",
		]);
	});

	it("sends only the fields the API accepts for a question", async () => {
		stubTypeSafe({ answer: { type: "score", score: 2, confidence: 0.5 } });

		await makeJudge().evaluate("state", {
			answer: {
				type: "score",
				instructions: "How bad?",
				min: 1,
				max: 5,
				criteria: ["1 - none", "2 - low", "3 - medium", "4 - high", "5 - severe"],
			},
		});

		const questions = lastRequest?.body.questions as Record<string, Record<string, unknown>>;
		expect(Object.keys(questions.answer).sort()).toEqual([
			"criteria",
			"instructions",
			"type",
		]);
		// The local scale bookkeeping must not reach the wire.
		expect(questions.answer.min).toBeUndefined();
		expect(questions.answer.max).toBeUndefined();
		expect(questions.answer.scoreScales).toBeUndefined();
	});

	it("sends only the fields the API accepts for a choice question", async () => {
		stubTypeSafe({ answer: { type: "choice", choice: "yes", confidence: 0.5 } });

		await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["yes", "no"],
			},
		});

		const questions = lastRequest?.body.questions as Record<string, Record<string, unknown>>;
		expect(Object.keys(questions.answer).sort()).toEqual([
			"criteria",
			"instructions",
			"type",
		]);
		expect(questions.answer.options).toBeUndefined();
	});

	it("describes a named candidate by its name when no description is given", async () => {
		stubTypeSafe({ answer: { type: "choice", choice: "yes", confidence: 0.5 } });

		await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				options: ["yes", "no"],
			},
		});

		const questions = lastRequest?.body.questions as Record<string, { criteria: unknown }>;
		expect(questions.answer.criteria).toEqual({ yes: "yes", no: "no" });
	});

	it("resolves the candidates of a criteria only question", async () => {
		stubTypeSafe({ answer: { type: "choice", choice: "high", confidence: 0.5 } });

		const result = await makeJudge().evaluate("state", {
			answer: {
				type: "choice",
				instructions: "Pick one",
				criteria: { critical: "it is critical", high: "it is high" },
			},
		});

		const response = result.decisions.answer.response as JevChoiceResponse;
		expect(response.choice).toBe("high");
	});
});

describe("TypeSafeJudge - error classification", () => {
	it("marks a contract error (422) as not retryable", async () => {
		stubFailure(422, "Input should be a valid dictionary");

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect(error).toBeInstanceOf(JevProviderError);
		expect((error as JevProviderError).status).toBe(422);
		expect((error as JevProviderError).retryable).toBe(false);
	});

	it("marks a bad request (400) as not retryable", async () => {
		stubFailure(400, "Invalid request.");

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).status).toBe(400);
		expect((error as JevProviderError).retryable).toBe(false);
	});

	it("marks a rate limit (429) as retryable", async () => {
		stubFailure(429, "slow down");

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).status).toBe(429);
		expect((error as JevProviderError).retryable).toBe(true);
	});

	it("marks a server error (500) as retryable", async () => {
		stubFailure(500);

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).status).toBe(500);
		expect((error as JevProviderError).retryable).toBe(true);
	});

	it("marks an auth error (401) as retryable", async () => {
		stubFailure(401);

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).status).toBe(401);
		expect((error as JevProviderError).retryable).toBe(true);
	});

	it("marks a network failure as retryable", async () => {
		stubNetworkError(undiciConnectionError());

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect(error).toBeInstanceOf(JevProviderError);
		expect((error as JevProviderError).retryable).toBe(true);
	});

	it("marks a timeout as retryable", async () => {
		stubNetworkError(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }));

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).retryable).toBe(true);
	});

	it("does NOT mark a bug of our own as retryable", async () => {
		// A malformed URL is not a provider outage: falling back to another
		// provider would only hide the bug.
		stubNetworkError(new TypeError("Failed to parse URL"));

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect(error).toBeInstanceOf(JevProviderError);
		expect((error as JevProviderError).retryable).toBe(false);
	});

	it("marks the failure of several addresses as retryable", async () => {
		// undici tries the addresses of a host one after the other and reports
		// the failures as an AggregateError. The cause here is NOT a transport
		// failure: the addresses are what makes the attempt a transport
		// failure.
		const aggregate = new AggregateError(
			[
				Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }),
				Object.assign(new Error("connect EHOSTUNREACH 10.0.0.1:443"), {
					code: "EHOSTUNREACH",
				}),
			],
			"all failed"
		);
		Object.assign(aggregate, { cause: new TypeError("Failed to parse URL") });
		stubNetworkError(aggregate);

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).retryable).toBe(true);
	});

	it("marks an expired provider certificate as retryable", async () => {
		for (const code of [
			"CERT_HAS_EXPIRED",
			"SELF_SIGNED_CERT_IN_CHAIN",
			"DEPTH_ZERO_SELF_SIGNED_CERT",
			"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
		]) {
			stubNetworkError(Object.assign(new Error(`certificate error ${code}`), { code }));

			const error = (await makeJudge()
				.evaluate("state", {
					answer: { type: "noul", instructions: "Is it true?" },
				})
				.catch((e: unknown) => e)) as JevProviderError;

			expect(`${code}: ${(error as JevProviderError).retryable}`).toBe(`${code}: true`);
		}
	});

	it("does NOT mark a stream bug of our own as retryable", async () => {
		// Writing to a finished stream is our bug, not a provider outage.
		stubNetworkError(
			Object.assign(new Error("write after end"), { code: "ERR_STREAM_WRITE_AFTER_END" })
		);

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).retryable).toBe(false);
	});

	it("marks an unreachable network as retryable", async () => {
		stubNetworkError(
			Object.assign(new Error("connect ENETUNREACH 10.0.0.1:443"), { code: "ENETUNREACH" })
		);

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).retryable).toBe(true);
	});

	it("marks a TLS failure as retryable", async () => {
		stubNetworkError(
			Object.assign(new Error("certificate altname mismatch"), {
				code: "ERR_TLS_CERT_ALTNAME_INVALID",
			})
		);

		const error = (await makeJudge()
			.evaluate("state", {
				answer: { type: "noul", instructions: "Is it true?" },
			})
			.catch((e: unknown) => e)) as JevProviderError;

		expect((error as JevProviderError).retryable).toBe(true);
	});
});
