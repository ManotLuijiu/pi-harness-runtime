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
        // Build TypeSafe question format
        const questionsArray = Object.entries(questions).map(([id, q]) => {
            const questionObj = q;
            const question = {
                id,
                type: questionObj.type,
                instructions: questionObj.instructions,
            };
            if (questionObj.type === "choice") {
                question.options = questionObj.options;
                // For choice questions, criteria defines ordered preference levels
                question.criteria = questionObj.options;
            }
            else if (questionObj.type === "score") {
                question.min = questionObj.min ?? 0;
                question.max = questionObj.max ?? 100;
            }
            return question;
        });
        // Call TypeSafe API directly
        const response = await fetch(`${this.config.baseUrl}/v1/systemone`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
                questions: questionsArray,
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
            if (!answer) {
                // Skip missing answers
                continue;
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
                response = {
                    type: "noul",
                    noul: answer.probability ?? 0.5,
                };
                probability = answer.probability ?? 0.5;
                break;
            case "choice":
                response = {
                    type: "choice",
                    choice: answer.choice ?? question.type === "choice" ? question.options[0] : "",
                    confidence: answer.confidence ?? 0.5,
                };
                probability = answer.confidence ?? 0.5;
                break;
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