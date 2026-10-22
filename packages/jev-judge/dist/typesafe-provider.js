/**
 * TypeSafe Jev Provider - Direct API integration
 *
 * Uses TypeSafe's /v1/systemone endpoint directly.
 * This is the recommended provider for Jev decisions.
 *
 * API: POST https://api.typesafe.ai/v1/systemone
 * Auth: Bearer token (TYPESAFE_API_KEY)
 */
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
    config;
    constructor(config) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
        };
    }
    /**
     * Evaluate state against questions using TypeSafe API
     */
    async evaluate(state, questions) {
        const startTime = Date.now();
        // Convert state to string if object
        const stateStr = typeof state === "string" ? state : JSON.stringify(state);
        // Build TypeSafe question format as a map (not array)
        const questionsMap = {};
        for (const [id, q] of Object.entries(questions)) {
            const questionObj = q;
            questionsMap[id] = {
                type: questionObj.type,
                instructions: questionObj.instructions,
            };
            if (questionObj.type === "choice") {
                questionsMap[id].options = questionObj.options;
                // For choice questions, criteria defines ordered preference levels
                questionsMap[id].criteria = questionObj.options;
            }
            else if (questionObj.type === "score") {
                questionsMap[id].min = questionObj.min ?? 0;
                questionsMap[id].max = questionObj.max ?? 100;
            }
        }
        // Call TypeSafe API directly
        const response = await fetch(`${this.config.baseUrl}/v1/systemone`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
                model: this.config.model,
                questions: questionsMap,
                state: stateStr,
            }),
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        const latencyMs = Date.now() - startTime;
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`TypeSafe API error ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        // Build decisions map
        const decisions = {};
        for (const [questionId, question] of Object.entries(questions)) {
            const questionData = question;
            const answer = data.answers?.[questionId];
            // Reject missing required answers
            if (!answer) {
                throw new Error(`TypeSafe API: missing answer for required question "${questionId}"`);
            }
            const decision = this.buildDecision(questionId, questionData, answer);
            decisions[questionId] = decision;
        }
        return {
            decisions,
            state: stateStr,
            latencyMs,
            model: data.model ?? "typesafe/systemone",
        };
    }
    /**
     * Quick noul (yes/no) evaluation
     */
    async noul(state, question) {
        const result = await this.evaluate(state, {
            answer: { type: "noul", instructions: question },
        });
        const decision = result.decisions.answer;
        const noulResponse = decision.response;
        return {
            noul: noulResponse.noul,
            confidence: decision.confidence,
        };
    }
    /**
     * Quick choice evaluation
     */
    async choice(state, question, options) {
        const result = await this.evaluate(state, {
            answer: { type: "choice", instructions: question, options },
        });
        const decision = result.decisions.answer;
        const choiceResponse = decision.response;
        return {
            choice: choiceResponse.choice,
            confidence: choiceResponse.confidence,
        };
    }
    /**
     * Quick score evaluation
     */
    async score(state, question, min = 0, max = 100) {
        const result = await this.evaluate(state, {
            answer: { type: "score", instructions: question, min, max },
        });
        const decision = result.decisions.answer;
        const scoreResponse = decision.response;
        return {
            score: scoreResponse.score,
            confidence: scoreResponse.confidence,
        };
    }
    /**
     * Build JevDecision from TypeSafe answer
     */
    buildDecision(questionId, question, answer) {
        let response;
        let probability;
        switch (answer.type) {
            case "noul":
                // FIX: Validate noul value is present and in range [0, 1]
                if (answer.noul === undefined || answer.noul === null) {
                    throw new Error(`TypeSafe API: missing noul value for question "${questionId}"`);
                }
                if (typeof answer.noul !== "number" || isNaN(answer.noul)) {
                    throw new Error(`TypeSafe API: invalid noul value for question "${questionId}": ${JSON.stringify(answer.noul)}`);
                }
                if (answer.noul < 0 || answer.noul > 1) {
                    throw new Error(`TypeSafe API: noul value out of range [0,1] for question "${questionId}": ${answer.noul}`);
                }
                response = {
                    type: "noul",
                    noul: answer.noul,
                };
                probability = answer.noul;
                break;
            case "choice": {
                const options = question.type === "choice"
                    ? (question.options ?? [])
                    : [];
                // The model's choice MUST win. The previous expression
                // (`answer.choice ?? question.type === "choice" ? options[0] : ""`)
                // was parsed as `(answer.choice ?? (question.type === "choice")) ? options[0] : ""`,
                // so a non-empty returned choice was DISCARDED and the first option was
                // always selected.
                const returned = typeof answer.choice === "string" ? answer.choice.trim() : "";
                let selected;
                if (returned.length > 0) {
                    if (options.includes(returned)) {
                        selected = returned;
                    }
                    else {
                        // Case-insensitive match: keep the canonical option spelling.
                        const canonical = options.find((option) => option.toLowerCase() === returned.toLowerCase());
                        // No match: pass the model's value through unchanged instead of
                        // silently substituting a different option.
                        selected = canonical ?? returned;
                    }
                }
                else {
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
            case "score":
                const min = question.type === "score" ? question.min ?? 0 : 0;
                const max = question.type === "score" ? question.max ?? 100 : 100;
                response = {
                    type: "score",
                    score: answer.score ?? (min + max) / 2,
                    confidence: answer.confidence ?? 0.5,
                };
                // Normalize score to 0-1
                probability = ((answer.score ?? (min + max) / 2) - min) / (max - min);
                break;
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
    getConfidence(probability) {
        // Confidence is based on distance from 0.5 (uncertain)
        const distance = Math.abs(probability - 0.5);
        if (distance > 0.35)
            return "high";
        if (distance > 0.2)
            return "medium";
        return "low";
    }
}
/**
 * Detect which provider to use based on API key or config
 */
export function detectProvider(apiKey, baseUrl) {
    // If baseUrl is explicitly set to TypeSafe, use TypeSafe
    if (baseUrl?.includes("typesafe.ai")) {
        return "typesafe";
    }
    // If using OpenRouter URL, use OpenRouter
    if (baseUrl?.includes("openrouter")) {
        return "openrouter";
    }
    // If key looks like TypeSafe (no specific pattern known), prefer TypeSafe
    // TypeSafe keys are typically longer than OpenAI-compatible keys
    if (apiKey.length > 50) {
        return "typesafe";
    }
    // Default to OpenRouter for short keys (OpenAI-compatible)
    return "openrouter";
}
//# sourceMappingURL=typesafe-provider.js.map