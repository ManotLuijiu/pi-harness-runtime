/**
 * Jev Judge - Main API
 *
 * Structured decision model for agent routing, E2E testing, and automated decisions.
 * Uses TypeSafe Jev via:
 * - Primary: TypeSafe direct API (https://api.typesafe.ai/v1/systemone)
 * - Fallback: OpenRouter API (https://openrouter.ai/api/v1)
 *
 * @example
 * ```typescript
 * import { JevJudge } from "@pi-harness/jev-judge";
 *
 * // Auto-detects TypeSafe vs OpenRouter based on API key and baseUrl
 * const judge = new JevJudge({ apiKey: process.env.TYPESAFE_API_KEY! });
 *
 * // Ask multiple questions at once
 * const result = await judge.evaluate(
 *   "The deploy failed with exit code 1",
 *   {
 *     isUrgent: { type: "noul", instructions: "Does this require immediate attention?" },
 *     severity: {
 *       type: "choice",
 *       instructions: "What is the severity level?",
 *       options: ["critical", "high", "medium", "low"]
 *     }
 *   }
 * );
 *
 * console.log(result.decisions.isUrgent.noul); // 0.92
 * ```
 */
// OpenAI SDK (OpenRouter is OpenAI-compatible)
// @ts-ignore - openai is installed at workspace root
import OpenAI from "openai";
import { TypeSafeJudge } from "./typesafe-provider.js";
/**
 * Environment variable keys for API keys
 */
export const ENV_KEYS = {
    TYPESAFE_API_KEY: "TYPESAFE_API_KEY",
    OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
};
/**
 * Get API key from environment or keys file
 * Priority: TYPESAFE_API_KEY env > OPENROUTER_API_KEY env > keys file
 */
export function getApiKeyFromEnv() {
    // First check environment variables
    const envKey = process.env[ENV_KEYS.TYPESAFE_API_KEY] ||
        process.env[ENV_KEYS.OPENROUTER_API_KEY];
    if (envKey)
        return envKey;
    // Fall back to keys file (e.g., ~/.pi-harness-runtime/keys/jev-api-key.txt)
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
    const keysDir = `${homedir}/.pi-harness-runtime/keys`;
    const keyFile = `${keysDir}/jev-api-key.txt`;
    try {
        const { readFileSync, existsSync, mkdirSync } = require("fs");
        // Auto-create directory if doesn't exist
        if (!existsSync(keysDir)) {
            mkdirSync(keysDir, { recursive: true });
        }
        if (existsSync(keyFile)) {
            const key = readFileSync(keyFile, "utf8").trim();
            if (key && key.length > 10) {
                return key;
            }
        }
    }
    catch {
        // Ignore file/directory errors
    }
    return undefined;
}
/**
 * Check if Jev API key is available
 */
export function hasJevApiKey() {
    return !!getApiKeyFromEnv();
}
/**
 * Create JevJudge with auto-detected API key from environment
 */
export function createJevJudge(config) {
    const apiKey = getApiKeyFromEnv();
    if (!apiKey) {
        throw new Error(`Jev API key not found. Set TYPESAFE_API_KEY run: echo "{api_key}" > ~/.pi-harness-runtime/keys/jev-api-key.txt`);
    }
    return new JevJudge({ apiKey, ...config });
}
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    baseUrl: "https://api.typesafe.ai", // TypeSafe direct API as default
    model: "typesafe/systemone",
    defaultThreshold: 0.7,
    timeoutMs: 30000,
};
/**
 * Detect provider from baseUrl
 */
function detectProvider(baseUrl) {
    if (baseUrl.includes("typesafe.ai"))
        return "typesafe";
    if (baseUrl.includes("openrouter"))
        return "openrouter";
    return "openrouter"; // Default to OpenRouter for backwards compatibility
}
/**
 * JevJudge - Main class for making structured decisions with Jev
 *
 * Supports two providers:
 * - TypeSafe direct API (primary, recommended)
 * - OpenRouter API (fallback for backwards compatibility)
 */
export class JevJudge {
    typesafeJudge;
    openrouterClient;
    config;
    provider;
    constructor(config) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
        };
        this.provider = detectProvider(this.config.baseUrl);
        if (this.provider === "typesafe") {
            // Use TypeSafe direct API
            this.typesafeJudge = new TypeSafeJudge({
                apiKey: this.config.apiKey,
                baseUrl: this.config.baseUrl,
                timeoutMs: this.config.timeoutMs,
            });
        }
        else {
            // Use OpenRouter
            this.openrouterClient = new OpenAI({
                apiKey: this.config.apiKey,
                baseURL: this.config.baseUrl,
                timeout: this.config.timeoutMs,
            });
        }
    }
    /**
     * Evaluate state against questions
     *
     * @param state - The context/situation to evaluate (text or structured)
     * @param questions - Map of question_id -> question definition
     * @returns Evaluation result with decisions
     */
    async evaluate(state, questions) {
        // Use TypeSafe provider if configured
        if (this.provider === "typesafe" && this.typesafeJudge) {
            return this.typesafeJudge.evaluate(state, questions);
        }
        // Fall back to OpenRouter
        if (!this.openrouterClient) {
            throw new Error("No Jev provider configured");
        }
        const startTime = Date.now();
        // Convert state to string if object
        const stateStr = typeof state === "string" ? state : JSON.stringify(state);
        // Build questions array for OpenRouter API
        const questionsArray = Object.entries(questions).map(([id, q]) => {
            const questionObj = q;
            const entry = { id };
            if (questionObj.type === "noul") {
                entry.type = "noul";
                entry.instructions = questionObj.instructions;
            }
            else if (questionObj.type === "choice") {
                entry.type = "choice";
                entry.instructions = questionObj.instructions;
                entry.options = questionObj.options;
            }
            else if (questionObj.type === "score") {
                entry.type = "score";
                entry.instructions = questionObj.instructions;
                if (questionObj.min !== undefined)
                    entry.min = questionObj.min;
                if (questionObj.max !== undefined)
                    entry.max = questionObj.max;
            }
            return entry;
        });
        // Call Jev via OpenRouter
        const response = await this.openrouterClient.chat.completions.create({
            model: this.config.model,
            messages: [
                {
                    role: "system",
                    content: `You are a decision engine. Evaluate the following state and answer the questions.
Return your answers in the exact JSON format specified.`,
                },
                {
                    role: "user",
                    content: `State: ${stateStr}

Questions:
${JSON.stringify(questionsArray, null, 2)}

Respond with a JSON object mapping each question ID to its answer.`,
                },
            ],
            response_format: {
                type: "json_object",
            },
            temperature: 0.1, // Low temperature for consistent decisions
        });
        const latencyMs = Date.now() - startTime;
        // Parse response
        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("No response from Jev");
        }
        let parsed;
        try {
            parsed = JSON.parse(content);
        }
        catch {
            throw new Error("Invalid JSON response from Jev");
        }
        // Build decisions map
        const decisions = {};
        for (const [questionId, question] of Object.entries(questions)) {
            const questionData = question;
            const responseData = parsed[questionId];
            if (!responseData) {
                continue;
            }
            const decision = this.buildDecision(questionId, questionData, responseData);
            decisions[questionId] = decision;
        }
        return {
            decisions,
            state: stateStr,
            latencyMs,
            model: this.config.model,
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
        return {
            noul: decision.response.noul,
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
        return {
            choice: decision.response.choice,
            confidence: decision.response.confidence,
        };
    }
    /**
     * Make threshold-based decision
     */
    thresholdDecision(probability, threshold = this.config.defaultThreshold) {
        const confidence = this.getConfidence(probability, threshold);
        return {
            shouldAct: probability >= threshold,
            probability,
            confidence,
            action: probability >= 0.9 ? "proceed" : probability >= 0.5 ? "review" : "block",
        };
    }
    /**
     * Batch evaluate multiple states
     */
    async batchEvaluate(states, questions, options = {}) {
        const { concurrency = 3 } = options;
        const results = [];
        const batches = [];
        // Split into batches
        for (let i = 0; i < states.length; i += concurrency) {
            batches.push(...states.slice(i, i + concurrency));
        }
        // Process batches
        for (const batch of batches) {
            const result = await this.evaluate(batch, questions);
            results.push(result);
        }
        return results;
    }
    // Private helpers
    // Note: Response schema removed - using json_object mode without strict schema
    // This allows Jev to return flexible responses
    buildDecision(questionId, question, response) {
        let probability;
        let confidence;
        switch (response.type) {
            case "noul":
                probability = response.noul;
                break;
            case "choice":
                probability = response.confidence;
                break;
            case "score":
                // Normalize score to 0-1
                const max = question.type === "score" ? (question.max ?? 100) : 100;
                const min = question.type === "score" ? (question.min ?? 0) : 0;
                probability = (response.score - min) / (max - min);
                break;
        }
        confidence = this.getConfidence(probability, this.config.defaultThreshold);
        return {
            questionId,
            question,
            response,
            probability,
            confidence,
        };
    }
    getConfidence(probability, threshold) {
        const distance = Math.abs(probability - threshold);
        if (distance > 0.3)
            return "high";
        if (distance > 0.15)
            return "medium";
        return "low";
    }
}
// Export types
export * from "./types.js";
// Export submodules
export { E2EJudge } from "./e2e-judge.js";
export { FlakyDetector } from "./flaky-detector.js";
export { DecisionEngine } from "./decision-engine.js";
export { AutoContinueJudge, createTaskState } from "./auto-continue.js";
// Export WrapUpJudge
export { checkWrapUp, getTodoSummary } from "./wrap-up-judge.js";
// Export EnvironmentJudge
export { EnvironmentJudge } from "./environment-judge.js";
// Export TypeSafeJudge
export { TypeSafeJudge, detectProvider } from "./typesafe-provider.js";
// Export TodoContinuation
export { TodoContinuationController, createTodoContinuation } from "./continuation-controller.js";
// Export TodoProvider
export { createTodoProvider, PiUnavailableTodoProvider } from "./todo-provider.js";
//# sourceMappingURL=index.js.map