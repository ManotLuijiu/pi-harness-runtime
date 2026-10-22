/**
 * TypeSafe Jev Provider - Direct API integration
 *
 * Uses TypeSafe's /v1/systemone endpoint directly.
 * This is the recommended provider for Jev decisions.
 *
 * API: POST https://api.typesafe.ai/v1/systemone
 * Auth: Bearer token (TYPESAFE_API_KEY)
 *
 * The request contract (choice criteria as a dictionary, score questions with
 * a mandatory rubric) is implemented in ./typesafe-request.ts; the mapping was
 * verified against the live endpoint.
 */

import type {
	JevQuestion,
	JevQuestions,
	JevResponse,
	JevDecision,
	JevEvaluationResult,
	JevNoulResponse,
	JevChoiceResponse,
	JevScoreResponse,
} from "./types.js";
import {
	buildChoiceCriteria,
	buildScoreScale,
	scorePositionToProbability,
	scorePositionToValue,
	validateQuestion,
	type ScoreScale,
} from "./typesafe-request.js";
import { JevProviderError, isRetryableStatus, isTransportError } from "./provider-error.js";

/**
 * TypeSafe API request format
 */
interface TypeSafeRequest {
	/** The model that handles the request. Required. */
	model: string;
	/** The content to evaluate. */
	state: string | object | unknown[];
	/** A map of typed questions. Keys are question IDs. */
	questions: Record<string, TypeSafeQuestion>;
}

/**
 * TypeSafe question format (per API spec, id not needed in question object - it's the map key)
 */
interface TypeSafeQuestion {
	type: "noul" | "choice" | "score";
	instructions: string;
	/**
	 * Choice questions: a dictionary of `name -> description`.
	 * Score questions: an ordered list of level descriptions.
	 */
	criteria?: Record<string, string> | string[];
}

/**
 * TypeSafe API response format
 */
interface TypeSafeResponse {
	answers: Record<string, TypeSafeAnswer>;
	model?: string;
	latency_ms?: number;
}

/**
 * TypeSafe answer format
 */
interface TypeSafeAnswer {
	type: "noul" | "choice" | "score";
	/** For noul type: probability of yes (0-1). */
	noul?: number;
	/** For choice type: the selected option. */
	choice?: string;
	/** For score type: the probability-weighted position in the rubric. */
	score?: number;
	/** For choice/score: confidence 0-1. */
	confidence?: number;
	/** For choice type: the probability of every choice. */
	probabilities?: Record<string, number>;
	/** For score type: the rubric levels mapped to their level index. */
	legend?: Record<string, string>;
}

/**
 * TypeSafe provider configuration
 */
export interface TypeSafeConfig {
	apiKey: string;
	model?: string;              // Defaults to jev-latest
	baseUrl?: string;            // Defaults to https://api.typesafe.ai
	timeoutMs?: number;          // Defaults to 30000
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
	model: "jev-latest",
	baseUrl: "https://api.typesafe.ai",
	timeoutMs: 30000,
};

/**
 * TypeSafe Jev Judge - Direct TypeSafe API integration
 *
 * Uses TypeSafe's systemone API for structured decisions.
 * More reliable than OpenRouter proxy and supports full feature set.
 */
export class TypeSafeJudge {
	private config: Required<TypeSafeConfig>;

	constructor(config: TypeSafeConfig) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
		} as Required<TypeSafeConfig>;
	}

	/**
	 * Evaluate state against questions using TypeSafe API
	 */
	async evaluate<T extends string>(
		state: string | object,
		questions: JevQuestions<T>
	): Promise<JevEvaluationResult<T>> {
		const startTime = Date.now();

		// Convert state to string if object
		const stateStr = typeof state === "string" ? state : JSON.stringify(state);

		// Build and validate the request. One invalid question fails the whole
		// request on the API side, so contract problems are caught locally.
		const { request, scoreScales } = this.buildRequest(stateStr, questions);

		// Call TypeSafe API directly
		let response: Response;
		try {
			response = await fetch(`${this.config.baseUrl}/v1/systemone`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				// Only the wire format is sent: the API rejects unknown fields.
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(this.config.timeoutMs),
			});
		} catch (error) {
			// A network failure, a timeout or an abort never reached a server
			// that rejected the request: another provider can still serve it.
			// Anything else (a malformed URL, a bug in our own code) is NOT
			// retryable - it must not disappear behind a fallback.
			throw new JevProviderError(
				`TypeSafe request failed: ${error instanceof Error ? error.message : String(error)}`,
				{ provider: "typesafe", retryable: isTransportError(error), cause: error }
			);
		}

		const latencyMs = Date.now() - startTime;

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			throw new JevProviderError(
				`TypeSafe API error ${response.status}: ${errorText}`,
				{
					provider: "typesafe",
					status: response.status,
					retryable: isRetryableStatus(response.status),
				}
			);
		}

		const data = await response.json() as TypeSafeResponse;

		// Build decisions map
		const decisions = {} as Record<T, JevDecision<T>>;

		for (const [questionId, question] of Object.entries(questions)) {
			const questionData = question as JevQuestion;
			const answer = data.answers?.[questionId] as TypeSafeAnswer | undefined;

			// Reject missing required answers
			if (!answer) {
				throw new JevProviderError(
					`TypeSafe API: missing answer for required question "${questionId}"`,
					{ provider: "typesafe", retryable: false }
				);
			}

			const decision = this.buildDecision(
				questionId,
				questionData,
				answer,
				scoreScales[questionId]
			);
			(decisions as Record<string, JevDecision>)[questionId] = decision;
		}

		return {
			decisions,
			state: stateStr,
			latencyMs,
			model: data.model ?? this.config.model,
		};
	}

	/**
	 * Build the API request and validate it against the API contract.
	 *
	 * The returned `request` is the wire format; `scoreScales` is local
	 * bookkeeping and is never sent to the API (it rejects unknown fields).
	 */
	private buildRequest<T extends string>(
		stateStr: string,
		questions: JevQuestions<T>
	): { request: TypeSafeRequest; scoreScales: Record<string, ScoreScale> } {
		const questionsMap: Record<string, TypeSafeQuestion> = {};
		const scoreScales: Record<string, ScoreScale> = {};

		for (const [id, raw] of Object.entries(questions)) {
			const questionObj = raw as JevQuestion;
			const scoreScale = validateQuestion(id, questionObj);

			if (questionObj.type === "choice") {
				questionsMap[id] = {
					type: "choice",
					instructions: questionObj.instructions,
					criteria: buildChoiceCriteria(id, questionObj),
				};
			} else if (questionObj.type === "score") {
				const { criteria } = buildScoreScale(id, questionObj);
				questionsMap[id] = {
					type: "score",
					instructions: questionObj.instructions,
					criteria,
				};
				if (scoreScale) scoreScales[id] = scoreScale;
			} else {
				questionsMap[id] = {
					type: "noul",
					instructions: questionObj.instructions,
				};
			}
		}

		if (Object.keys(questionsMap).length === 0) {
			throw new JevProviderError("TypeSafe request invalid: no questions to ask", {
				provider: "typesafe",
				retryable: false,
			});
		}

		return {
			request: {
				model: this.config.model,
				state: stateStr,
				questions: questionsMap,
			},
			scoreScales,
		};
	}

	/**
	 * Quick noul (yes/no) evaluation
	 */
	async noul(
		state: string | object,
		question: string
	): Promise<{ noul: number; confidence: "high" | "medium" | "low" }> {
		const result = await this.evaluate(state, {
			answer: { type: "noul", instructions: question },
		});

		const decision = result.decisions.answer as JevDecision<"answer">;
		const noulResponse = decision.response as JevNoulResponse;
		return {
			noul: noulResponse.noul,
			confidence: decision.confidence,
		};
	}

	/**
	 * Quick choice evaluation
	 */
	async choice<T extends string>(
		state: string | object,
		question: string,
		options: T[]
	): Promise<{ choice: T; confidence: number }> {
		const result = await this.evaluate(state, {
			answer: { type: "choice", instructions: question, options },
		});

		const decision = result.decisions.answer as JevDecision<"answer">;
		const choiceResponse = decision.response as JevChoiceResponse<T>;
		return {
			choice: choiceResponse.choice,
			confidence: choiceResponse.confidence,
		};
	}

	/**
	 * Quick score evaluation
	 */
	async score(
		state: string | object,
		question: string,
		min = 0,
		max = 100
	): Promise<{ score: number; confidence: number }> {
		const result = await this.evaluate(state, {
			answer: { type: "score", instructions: question, min, max },
		});

		const decision = result.decisions.answer as JevDecision<"answer">;
		const scoreResponse = decision.response as JevScoreResponse;
		return {
			score: scoreResponse.score,
			confidence: scoreResponse.confidence,
		};
	}

	/**
	 * Build JevDecision from TypeSafe answer
	 */
	private buildDecision<T extends string>(
		questionId: T,
		question: JevQuestion,
		answer: TypeSafeAnswer,
		scoreScale?: ScoreScale
	): JevDecision<T> {
		let response: JevResponse;
		let probability: number;

		switch (answer.type) {
			case "noul":
				// FIX: Validate noul value is present and in range [0, 1]
				if (answer.noul === undefined || answer.noul === null) {
					throw new JevProviderError(
						`TypeSafe API: missing noul value for question "${questionId}"`,
						{ provider: "typesafe", retryable: false }
					);
				}
				if (typeof answer.noul !== "number" || isNaN(answer.noul)) {
					throw new JevProviderError(
						`TypeSafe API: invalid noul value for question "${questionId}": ${JSON.stringify(answer.noul)}`,
						{ provider: "typesafe", retryable: false }
					);
				}
				if (answer.noul < 0 || answer.noul > 1) {
					throw new JevProviderError(
						`TypeSafe API: noul value out of range [0,1] for question "${questionId}": ${answer.noul}`,
						{ provider: "typesafe", retryable: false }
					);
				}
				response = {
					type: "noul",
					noul: answer.noul,
				};
				probability = answer.noul;
				break;

			case "choice": {
				const options = choiceCandidates(question);
				// The model's choice MUST win. The previous expression
				// (`answer.choice ?? question.type === "choice" ? options[0] : ""`)
				// was parsed as `(answer.choice ?? (question.type === "choice")) ? options[0] : ""`,
				// so a non-empty returned choice was DISCARDED and the first option was
				// always selected.
				const returned =
					typeof answer.choice === "string" ? answer.choice.trim() : "";
				let selected: string;
				if (returned.length > 0) {
					if (options.includes(returned)) {
						selected = returned;
					} else {
						// Case-insensitive match: keep the canonical option spelling.
						const canonical = options.find(
							(option) => option.toLowerCase() === returned.toLowerCase(),
						);
						// No match: pass the model's value through unchanged instead of
						// silently substituting a different option.
						selected = canonical ?? returned;
					}
				} else {
					// The model returned no usable choice: fall back to the first option.
					selected = options[0] ?? "";
				}
				response = {
					type: "choice",
					choice: selected,
					confidence: answer.confidence ?? 0.5,
				};
				probability = answer.confidence ?? 0.5;
				break;
			}

			case "score": {
				if (answer.score === undefined || answer.score === null) {
					throw new JevProviderError(
						`TypeSafe API: missing score value for question "${questionId}"`,
						{ provider: "typesafe", retryable: false }
					);
				}
				if (typeof answer.score !== "number" || isNaN(answer.score)) {
					throw new JevProviderError(
						`TypeSafe API: invalid score value for question "${questionId}": ${JSON.stringify(answer.score)}`,
						{ provider: "typesafe", retryable: false }
					);
				}
				// The API answers with the probability-weighted POSITION in the
				// rubric (0 .. levels-1), not with a value on the min/max scale.
				const scale: ScoreScale = scoreScale ?? {
					levels: 2,
					min: question.type === "score" ? question.min ?? 0 : 0,
					max: question.type === "score" ? question.max ?? 100 : 100,
				};
				const value = scorePositionToValue(answer.score, scale);
				response = {
					type: "score",
					score: value,
					confidence: answer.confidence ?? 0.5,
				};
				probability = scorePositionToProbability(answer.score, scale);
				break;
			}

			default:
				// Fallback for unknown types
				response = {
					type: "noul",
					noul: 0.5,
				};
				probability = 0.5;
		}

		const confidence = this.getConfidence(answer.confidence ?? probability);

		return {
			questionId,
			question,
			response,
			probability,
			confidence,
		};
	}

	/**
	 * Determine confidence level from probability
	 */
	private getConfidence(probability: number): "high" | "medium" | "low" {
		// Confidence is based on distance from 0.5 (uncertain)
		const distance = Math.abs(probability - 0.5);
		if (distance > 0.35) return "high";
		if (distance > 0.2) return "medium";
		return "low";
	}
}

/**
 * The candidate names of a choice question.
 *
 * `options` is the ergonomic way to name the candidates; a question that only
 * carries `criteria` is read from the criteria itself.
 */
function choiceCandidates(
	question: JevQuestion
): string[] {
	if (question.type !== "choice") return [];
	const options = question.options;
	if (options && options.length > 0) return [...options];
	const criteria = question.criteria;
	if (Array.isArray(criteria)) return [...criteria];
	if (criteria) return Object.keys(criteria);
	return [];
}

/**
 * Determine the provider that owns a base URL.
 *
 * The provider is derived from the ENDPOINT, never from the shape of a key:
 * guessing from a key is how an OpenRouter key ended up being sent to the
 * TypeSafe API.
 */
export function providerForBaseUrl(baseUrl: string): "typesafe" | "openrouter" {
	if (baseUrl.includes("typesafe.ai")) return "typesafe";
	if (baseUrl.includes("openrouter")) return "openrouter";
	throw new Error(
		`Jev: unknown provider base URL "${baseUrl}". Use resolveJevProviders() or pass an explicit provider chain.`
	);
}

/**
 * Detect which provider to use based on API key or config
 *
 * @deprecated The provider cannot be derived from a key - a bare key says
 * nothing about the endpoint it belongs to, and guessing from its length is
 * how an OpenRouter key ended up being sent to the TypeSafe API. Pass the
 * `baseUrl` of the provider, or use `resolveJevProviders()` (see ./index.ts),
 * which binds every credential to its own provider.
 */
export function detectProvider(
	_apiKey: string,
	baseUrl?: string
): "typesafe" | "openrouter" {
	if (!baseUrl) {
		throw new Error(
			"Jev: detectProvider() cannot guess the provider from the key. Pass the baseUrl of the provider or use resolveJevProviders()."
		);
	}
	return providerForBaseUrl(baseUrl);
}
