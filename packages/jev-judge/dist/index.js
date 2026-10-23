/**
 * Jev Judge - Main API
 *
 * Structured decision model for agent routing, E2E testing, and automated decisions.
 * Uses TypeSafe Jev via:
 * - Primary: TypeSafe direct API (https://api.typesafe.ai/v1/systemone)
 * - Fallback: OpenRouter API (https://openrouter.ai/api/v1)
 *
 * Every credential is bound to its own provider: a TypeSafe key is only ever
 * sent to the TypeSafe API and an OpenRouter key only to OpenRouter. The
 * fallback is explicit - the next provider is only used when the previous one
 * failed with a retryable error.
 *
 * @example
 * ```typescript
 * import { JevJudge, resolveJevProviders } from "@pi-harness/jev-judge";
 *
 * // Provider chain built from the environment / key files
 * const judge = new JevJudge({ providers: resolveJevProviders() });
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
import { existsSync, readFileSync } from "node:fs";
// OpenAI SDK (OpenRouter is OpenAI-compatible)
// @ts-ignore - openai is installed at workspace root
import OpenAI from "openai";
import { TypeSafeJudge, providerForBaseUrl } from "./typesafe-provider.js";
import { toProviderError, JevProviderError } from "./provider-error.js";
import { logError } from "./file-logger.js";
/**
 * Environment variable keys for API keys
 */
export const ENV_KEYS = {
    TYPESAFE_API_KEY: "TYPESAFE_API_KEY",
    OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
};
/** Default TypeSafe endpoint. */
export const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
/** Default TypeSafe model (an alias served by the System One models). */
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";
/** Default OpenRouter endpoint. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/**
 * Default OpenRouter model.
 *
 * `typesafe/jev-router` is the only TypeSafe model published on OpenRouter;
 * the previous default ("typesafe/systemone") is not in the catalog.
 */
export const OPENROUTER_DEFAULT_MODEL = "typesafe/jev-router";
/**
 * The prefix of an OpenRouter key.
 *
 * Used to bind the LEGACY key file (jev-api-key.txt) to the right provider:
 * that file has historically held both kinds of key, and binding it blindly
 * to TypeSafe would send an OpenRouter key to the TypeSafe API.
 */
const OPENROUTER_KEY_PREFIX = "sk-or-";
/**
 * True when the key looks like an OpenRouter key.
 */
export function looksLikeOpenRouterKey(apiKey) {
    return apiKey.trim().startsWith(OPENROUTER_KEY_PREFIX);
}
/**
 * Get the API key of the FIRST configured provider.
 *
 * The order is TypeSafe first, then OpenRouter. The returned key is NOT
 * bound to a provider by this function - use `resolveJevProviders()` to get
 * a provider chain where every credential belongs to its own endpoint.
 *
 * @deprecated Prefer `resolveJevProviders()`.
 */
export function getApiKeyFromEnv() {
    const providers = resolveJevProviders();
    return providers[0]?.apiKey;
}
/**
 * Resolve the provider chain from the environment and the key files.
 *
 * A provider is only included when its OWN credential is available:
 * - TypeSafe: TYPESAFE_API_KEY, or the key file typesafe-api-key.txt
 * - OpenRouter: OPENROUTER_API_KEY, or the key file openrouter-api-key.txt
 *
 * The legacy key file jev-api-key.txt is bound by the shape of the key it
 * holds: an "sk-or-" key is an OpenRouter key, everything else is treated as
 * a TypeSafe key. It is never sent to the wrong endpoint.
 *
 * The credentials are never crossed: the TypeSafe key is never sent to
 * OpenRouter and the OpenRouter key is never sent to TypeSafe.
 */
export function resolveJevProviders(options) {
    const env = options?.env ?? process.env;
    const keysDir = options?.keysDir ?? defaultKeysDir();
    const providers = [];
    // The legacy key file holds whichever key the user put there. It is bound
    // by the SHAPE of the key (an "sk-or-" key is an OpenRouter key) and it is
    // only used for a provider that has no credential of its own yet.
    const legacyKey = readKeyFile(keysDir, "jev-api-key.txt");
    const legacyIsOpenRouter = legacyKey ? looksLikeOpenRouterKey(legacyKey) : false;
    const legacyKeyFor = (provider) => {
        if (!legacyKey)
            return undefined;
        const isOpenRouter = provider === "openrouter";
        return legacyIsOpenRouter === isOpenRouter ? legacyKey : undefined;
    };
    const typesafeKey = firstNonEmpty(env[ENV_KEYS.TYPESAFE_API_KEY], readKeyFile(keysDir, "typesafe-api-key.txt"), legacyKeyFor("typesafe"));
    if (typesafeKey) {
        providers.push({
            provider: "typesafe",
            apiKey: typesafeKey,
            baseUrl: env["TYPESAFE_BASE_URL"]?.trim() || TYPESAFE_BASE_URL,
            model: env["TYPESAFE_MODEL"]?.trim() || TYPESAFE_DEFAULT_MODEL,
        });
    }
    const openrouterKey = firstNonEmpty(env[ENV_KEYS.OPENROUTER_API_KEY], readKeyFile(keysDir, "openrouter-api-key.txt"), legacyKeyFor("openrouter"));
    if (openrouterKey) {
        providers.push({
            provider: "openrouter",
            apiKey: openrouterKey,
            baseUrl: env["OPENROUTER_BASE_URL"]?.trim() || OPENROUTER_BASE_URL,
            model: env["OPENROUTER_MODEL"]?.trim() || OPENROUTER_DEFAULT_MODEL,
        });
    }
    return providers;
}
function firstNonEmpty(...values) {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed)
            return trimmed;
    }
    return undefined;
}
function defaultKeysDir() {
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/user";
    return `${homedir}/.pi-harness-runtime/keys`;
}
function readKeyFile(keysDir, name) {
    try {
        const path = `${keysDir}/${name}`;
        if (!existsSync(path))
            return undefined;
        const key = readFileSync(path, "utf8").trim();
        return key.length > 10 ? key : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Check if a Jev API key is available
 */
export function hasJevApiKey() {
    return resolveJevProviders().length > 0;
}
/**
 * Create JevJudge with the provider chain resolved from the environment
 */
export function createJevJudge(config) {
    const providers = resolveJevProviders();
    if (providers.length === 0) {
        throw new Error(`Jev API key not found. Set TYPESAFE_API_KEY (or OPENROUTER_API_KEY), or write the key to ~/.pi-harness-runtime/keys/typesafe-api-key.txt (or openrouter-api-key.txt)`);
    }
    return new JevJudge({ ...config, providers: config?.providers ?? providers });
}
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    defaultThreshold: 0.7,
    timeoutMs: 30000,
};
/**
 * The identity of a provider entry.
 *
 * The clients are cached per provider IDENTITY, not per base URL: two
 * entries may share an endpoint but use different credentials, and reusing
 * the first client would send its key to the second entry.
 */
function providerCacheKey(provider) {
    return [
        provider.provider,
        provider.baseUrl,
        provider.model,
        provider.apiKey,
    ].join("|");
}
/**
 * JevJudge - Main class for making structured decisions with Jev
 *
 * Supports two providers:
 * - TypeSafe direct API (primary, recommended)
 * - OpenRouter API (fallback for backwards compatibility)
 */
export class JevJudge {
    config;
    providers;
    typesafeJudges = new Map();
    openrouterClients = new Map();
    constructor(config) {
        this.config = {
            defaultThreshold: config.defaultThreshold ?? DEFAULT_CONFIG.defaultThreshold,
            timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
            baseUrl: config.baseUrl,
            model: config.model,
            apiKey: config.apiKey,
        };
        this.providers = this.resolveProviders(config);
        if (this.providers.length === 0) {
            throw new Error("Jev: no usable provider configured. Every provider needs a non-empty apiKey.");
        }
    }
    /**
     * Build the provider chain.
     *
     * An explicit chain is used as-is. Otherwise the legacy single provider
     * configuration is turned into a one element chain; the credential then
     * belongs to the caller, who has to pass the matching baseUrl.
     */
    resolveProviders(config) {
        if (config.providers && config.providers.length > 0) {
            const usable = config.providers.filter((provider) => Boolean(provider.apiKey?.trim()));
            for (const dropped of config.providers) {
                if (!dropped.apiKey?.trim()) {
                    logError("[JevJudge]", `Provider ${dropped.provider} has an empty apiKey and was dropped from the chain`);
                }
            }
            return usable;
        }
        if (!config.apiKey) {
            throw new Error("Jev: no provider configured. Pass `providers` (see resolveJevProviders) or a legacy `apiKey`.");
        }
        // The legacy path cannot ask which endpoint the key belongs to, so an
        // OpenRouter key without an explicit baseUrl is refused instead of
        // being sent to the TypeSafe API.
        if (!config.baseUrl && looksLikeOpenRouterKey(config.apiKey)) {
            throw new Error("Jev: the key looks like an OpenRouter key. Pass `baseUrl: \"https://openrouter.ai/api/v1\"` or a provider chain (resolveJevProviders()) so the credential is not sent to the wrong endpoint.");
        }
        const baseUrl = config.baseUrl ?? TYPESAFE_BASE_URL;
        const provider = providerForBaseUrl(baseUrl);
        return [
            {
                provider,
                apiKey: config.apiKey,
                baseUrl,
                model: config.model ??
                    (provider === "typesafe" ? TYPESAFE_DEFAULT_MODEL : OPENROUTER_DEFAULT_MODEL),
            },
        ];
    }
    /**
     * Evaluate state against questions
     *
     * The provider chain is tried in order. The next provider is only used
     * when the previous one failed with a retryable error (network, timeout,
     * rate limit, auth, 5xx). A request contract error is never retried on
     * another provider: it is a bug that has to stay visible.
     *
     * @param state - The context/situation to evaluate (text or structured)
     * @param questions - Map of question_id -> question definition
     * @returns Evaluation result with decisions
     */
    async evaluate(state, questions) {
        if (this.providers.length === 0) {
            throw new Error("No Jev provider configured");
        }
        let lastError;
        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i];
            try {
                const result = provider.provider === "typesafe"
                    ? await this.evaluateWithTypeSafe(provider, state, questions)
                    : await this.evaluateWithOpenRouter(provider, state, questions);
                return { ...result, provider: provider.provider };
            }
            catch (error) {
                const providerError = toProviderError(error, provider.provider);
                lastError = providerError;
                const isLast = i === this.providers.length - 1;
                if (!providerError.retryable || isLast) {
                    throw providerError;
                }
                logError("[JevJudge]", `Provider ${provider.provider} failed (${providerError.message}); trying the next provider`);
            }
        }
        throw lastError ?? new Error("No Jev provider configured");
    }
    evaluateWithTypeSafe(provider, state, questions) {
        const cacheKey = providerCacheKey(provider);
        let judge = this.typesafeJudges.get(cacheKey);
        if (!judge) {
            judge = new TypeSafeJudge({
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
                model: provider.model,
                timeoutMs: this.config.timeoutMs,
            });
            this.typesafeJudges.set(cacheKey, judge);
        }
        return judge.evaluate(state, questions);
    }
    /**
     * Evaluate through OpenRouter.
     *
     * OpenRouter is an OpenAI compatible endpoint, so the questions are
     * asked as a prompt and the answer is parsed as JSON. This path has its
     * own contract and does not use the TypeSafe request format.
     */
    async evaluateWithOpenRouter(provider, state, questions) {
        const cacheKey = providerCacheKey(provider);
        let client = this.openrouterClients.get(cacheKey);
        if (!client) {
            client = new OpenAI({
                apiKey: provider.apiKey,
                baseURL: provider.baseUrl,
                timeout: this.config.timeoutMs,
            });
            this.openrouterClients.set(cacheKey, client);
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
                entry.options = choiceNames(questionObj);
                const descriptions = choiceDescriptions(questionObj);
                if (descriptions)
                    entry.descriptions = descriptions;
            }
            else if (questionObj.type === "score") {
                entry.type = "score";
                entry.instructions = questionObj.instructions;
                if (questionObj.min !== undefined)
                    entry.min = questionObj.min;
                if (questionObj.max !== undefined)
                    entry.max = questionObj.max;
                if (questionObj.criteria)
                    entry.criteria = questionObj.criteria;
            }
            return entry;
        });
        // Call Jev via OpenRouter
        const response = await client.chat.completions.create({
            model: provider.model,
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
                // The same policy as the TypeSafe path: a partial answer would
                // silently produce a decision from a subset of the questions.
                throw new JevProviderError(`OpenRouter: missing answer for required question "${questionId}"`, { provider: "openrouter", retryable: false });
            }
            const decision = this.buildDecision(questionId, questionData, responseData);
            decisions[questionId] = decision;
        }
        return {
            decisions,
            state: stateStr,
            latencyMs,
            model: provider.model,
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
    /**
     * The provider chain in use.
     */
    getProviders() {
        return [...this.providers];
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
/**
 * The candidate names of a choice question.
 */
function choiceNames(question) {
    const criteria = question.criteria;
    if (Array.isArray(criteria))
        return [...criteria];
    if (criteria)
        return Object.keys(criteria);
    return [...(question.options ?? [])];
}
/**
 * The per option descriptions of a choice question, when there are any.
 */
function choiceDescriptions(question) {
    const criteria = question.criteria;
    if (criteria && !Array.isArray(criteria)) {
        const entries = Object.entries(criteria);
        if (entries.length === 0)
            return undefined;
        return Object.fromEntries(entries);
    }
    if (question.optionDescriptions)
        return question.optionDescriptions;
    return undefined;
}
// Export types
export * from "./types.js";
// Export provider errors
export { JevProviderError, isRetryableStatus, toProviderError } from "./provider-error.js";
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
export { TypeSafeJudge, detectProvider, providerForBaseUrl } from "./typesafe-provider.js";
// Export the TypeSafe request contract helpers
export { buildChoiceCriteria, buildScoreScale, scorePositionToProbability, scorePositionToValue, validateQuestion, MAX_SCORE_LEVELS, } from "./typesafe-request.js";
// Export TodoContinuation
export { TodoContinuationController, createTodoContinuation } from "./continuation-controller.js";
// Export TodoProvider
export { createTodoProvider } from "./todo-provider.js";
// Export staged validation plans
export { parseValidationPlan, formatValidationContext, buildValidationSteerSuffix, describeTier, parseTier, parseDurationMs, formatDuration, summarizeValidationState, validationBudgetStatus, } from "./validation-plan.js";
// Export the validation ledger (durable record of the tiers that ran)
export { ValidationLedger, defaultLedgerPath, parseRunRecord, parseLedgerContent, } from "./validation-ledger.js";
// Export the validation tie-breaker (typed verdict about one item)
export { tieBreakValidation, formatTieBreaker, } from "./validation-tie-breaker.js";
// Export Task Intake
export { TaskIntakeController, createTaskIntake } from "./task-intake.js";
//# sourceMappingURL=index.js.map