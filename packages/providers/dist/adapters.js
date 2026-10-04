/**
 * Provider Adapter — RFC-0002
 *
 * Normalizes provider-specific behavior for:
 * - model invocation
 * - error detection
 * - quota detection
 * - reset time discovery
 * - retry policy
 * - model capability metadata
 */
/**
 * Base adapter with common functionality
 */
export class BaseProviderAdapter {
    config;
    constructor(config) {
        this.config = config;
    }
    getCapabilities() {
        return this.config.capabilities;
    }
    supportsModel(model) {
        return this.config.models.includes(model);
    }
    getDefaultModel() {
        return this.config.models[0] ?? "default";
    }
    getMaxTokens(model) {
        // Default token limits per model family
        const limits = {
            "minimax/MiniMax-M3": 32768,
            "minimax/MiniMax-Text-01": 1000000,
            "anthropic/claude-3-5-sonnet": 200000,
            "openai/gpt-4o": 128000,
            "openai/gpt-4-turbo": 128000,
        };
        return limits[model ?? this.getDefaultModel()] ?? 4096;
    }
    /**
     * Parse usage from response
     */
    parseUsage(response) {
        const r = response;
        return {
            input: r.input_tokens ?? r.prompt_tokens ?? 0,
            output: r.output_tokens ?? r.completion_tokens ?? 0,
            cacheRead: r.cache_read_tokens ?? 0,
            cacheWrite: r.cache_write_tokens ?? 0,
            cost: r.cost ?? 0,
        };
    }
}
/**
 * MiniMax adapter
 */
export class MiniMaxAdapter extends BaseProviderAdapter {
    id = "minimax";
    name = "MiniMax";
    async invoke(request) {
        // In practice, this would call the MiniMax API
        // For now, return a mock response
        return {
            response: {
                content: "Mock response",
                usage: { input: 100, output: 200, cost: 0.001 },
                model: request.model,
                finishReason: "stop",
            },
            retryable: false,
        };
    }
    parseError(error) {
        const e = error;
        const msg = String(e.message ?? e.error ?? "").toLowerCase();
        return {
            quotaExceeded: msg.includes("2056") || msg.includes("quota"),
            rateLimited: msg.includes("rate limit") || msg.includes("429"),
            timeout: msg.includes("timeout") || msg.includes("timed out"),
            serverError: msg.includes("500") || msg.includes("502") || msg.includes("503"),
            clientError: msg.includes("400") || msg.includes("401") || msg.includes("403"),
            quotaSignal: msg.includes("quota") || msg.includes("2056")
                ? { exhausted: true, resetsAt: undefined }
                : undefined,
        };
    }
}
/**
 * OpenAI adapter
 */
export class OpenAIAdapter extends BaseProviderAdapter {
    id = "openai";
    name = "OpenAI";
    async invoke(request) {
        return {
            response: {
                content: "Mock response",
                usage: { input: 100, output: 200, cost: 0.002 },
                model: request.model,
                finishReason: "stop",
            },
            retryable: false,
        };
    }
    parseError(error) {
        const e = error;
        const msg = String(e.message ?? e.error ?? "").toLowerCase();
        const code = String(e.code ?? "");
        return {
            quotaExceeded: code === "insufficient_quota" || code === "context_length_exceeded",
            rateLimited: code === "rate_limit_exceeded" || msg.includes("429"),
            timeout: msg.includes("timeout"),
            serverError: code.startsWith("5"),
            clientError: code.startsWith("4"),
            quotaSignal: code === "insufficient_quota"
                ? { exhausted: true, resetsAt: undefined }
                : undefined,
        };
    }
}
/**
 * Claude adapter — Anthropic's Claude models
 */
export class ClaudeAdapter extends BaseProviderAdapter {
    id = "anthropic";
    name = "Anthropic Claude";
    async invoke(request) {
        // In practice, this would call the Claude API via Anthropic SDK
        // For now, return a mock response
        return {
            response: {
                content: "Mock response",
                usage: { input: 100, output: 200, cost: 0.003 },
                model: request.model,
                finishReason: "stop",
            },
            retryable: false,
        };
    }
    parseError(error) {
        const e = error;
        const msg = String(e.message ?? e.error ?? "").toLowerCase();
        const type = String(e.type ?? "");
        const errorCode = String(e.code ?? "");
        // Anthropic-specific error handling
        const isRateLimited = type.includes("rate_limit_error") ||
            msg.includes("rate limit") ||
            errorCode.includes("429");
        const isOverloaded = type.includes("overloaded_error") || msg.includes("overloaded");
        return {
            quotaExceeded: type.includes("quota_error") ||
                type.includes("insufficient_quota") ||
                msg.includes("quota exceeded"),
            rateLimited: isRateLimited || isOverloaded,
            timeout: type.includes("timeout") || msg.includes("timeout"),
            serverError: type.includes("api_error") || isOverloaded,
            clientError: type.includes("invalid_request_error") ||
                type.includes("authentication_error") ||
                type.includes("permission_error"),
            quotaSignal: type.includes("quota_error")
                ? { exhausted: true, resetsAt: undefined }
                : undefined,
        };
    }
    getDefaultModel() {
        return "anthropic/claude-3-5-sonnet-20240620";
    }
    getMaxTokens(model) {
        const limits = {
            "anthropic/claude-3-5-sonnet-20240620": 200000,
            "anthropic/claude-3-5-haiku-20240620": 200000,
            "anthropic/claude-3-opus-20240229": 200000,
            "anthropic/claude-3-sonnet-20240229": 200000,
            "anthropic/claude-3-haiku-20240307": 200000,
            "anthropic/claude-2.1": 200000,
            "anthropic/claude-2": 100000,
            "anthropic/claude-instant": 100000,
        };
        return limits[model ?? this.getDefaultModel()] ?? 200000;
    }
}
/**
 * Adapter registry
 */
export class AdapterRegistry {
    adapters = new Map();
    register(adapter) {
        this.adapters.set(adapter.id, adapter);
    }
    get(id) {
        return this.adapters.get(id);
    }
    list() {
        return Array.from(this.adapters.values());
    }
    /**
     * Create default registry with standard adapters
     */
    static createDefault() {
        const registry = new AdapterRegistry();
        registry.register(new MiniMaxAdapter({
            id: "minimax",
            name: "MiniMax",
            models: ["minimax/MiniMax-M3", "minimax/MiniMax-Text-01"],
            capabilities: ["code", "review", "plan", "test"],
            rateLimits: {},
        }));
        registry.register(new OpenAIAdapter({
            id: "openai",
            name: "OpenAI",
            models: ["openai/gpt-4o", "openai/gpt-4-turbo"],
            capabilities: ["code", "review", "plan", "test", "refactor"],
            rateLimits: {},
        }));
        registry.register(new ClaudeAdapter({
            id: "anthropic",
            name: "Anthropic Claude",
            models: [
                "anthropic/claude-3-5-sonnet-20240620",
                "anthropic/claude-3-5-haiku-20240620",
                "anthropic/claude-3-opus-20240229",
            ],
            capabilities: [
                "code",
                "review",
                "plan",
                "test",
                "refactor",
                "analysis",
            ],
            rateLimits: {},
        }));
        return registry;
    }
}
//# sourceMappingURL=adapters.js.map