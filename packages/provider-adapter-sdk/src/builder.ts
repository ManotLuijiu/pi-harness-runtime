/**
 * Provider Adapter SDK - Builder
 *
 * Fluent API for creating provider adapters.
 */

import type {
	AdapterResult,
	AdapterBuilderConfig,
	ErrorAnalysis,
	HealthCheckResult,
	InvokeFunction,
	ErrorParserFunction,
	HealthCheckFunction,
	RateLimitConfig,
	ProviderCapability,
	ProviderRequest,
	ProviderResponse,
} from "./types.js";
import { BuilderValidationError } from "./errors.js";

/**
 * Token limits for common model families
 */
const DEFAULT_TOKEN_LIMITS: Record<string, number> = {
	// MiniMax
	"minimax/MiniMax-M3": 32768,
	"minimax/MiniMax-Text-01": 1000000,
	// Anthropic
	"anthropic/claude-3-5-sonnet": 200000,
	"anthropic/claude-3-5-haiku": 200000,
	"anthropic/claude-3-opus": 200000,
	"anthropic/claude-3-sonnet": 200000,
	"anthropic/claude-3-haiku": 200000,
	"anthropic/claude-2.1": 200000,
	"anthropic/claude-2": 100000,
	"anthropic/claude-instant": 100000,
	// OpenAI
	"openai/gpt-4o": 128000,
	"openai/gpt-4-turbo": 128000,
	"openai/gpt-4": 128000,
	"openai/gpt-3.5-turbo": 16385,
	// Google
	"google/gemini-1.5-pro": 128000,
	"google/gemini-1.5-flash": 128000,
	// Default
	default: 4096,
};

/**
 * Default error parser for unknown providers
 */
const defaultErrorParser: ErrorParserFunction = (error: unknown) => {
	const e = error as Record<string, unknown>;
	const msg = String(e.message ?? e.error ?? "").toLowerCase();
	const code = String(e.code ?? "");

	return {
		quotaExceeded:
			code === "insufficient_quota" ||
			code === "context_length_exceeded" ||
			msg.includes("quota"),
		rateLimited:
			code === "rate_limit_exceeded" ||
			msg.includes("429") ||
			msg.includes("rate limit"),
		timeout: msg.includes("timeout") || msg.includes("timed out"),
		serverError: code.startsWith("5") || msg.includes("500"),
		clientError: code.startsWith("4") && !code.startsWith("429"),
		message: String(e.message ?? e.error ?? "Unknown error"),
		code,
	};
};

/**
 * Builder class for creating provider adapters
 */
export class AdapterBuilder {
	private _id: string | undefined;
	private _name: string | undefined;
	private _models: string[] = [];
	private _capabilities: ProviderCapability[] = [];
	private _rateLimits: RateLimitConfig = {};
	private _defaultModel: string | undefined;
	private _maxTokens: Record<string, number> = {};
	private _invokeFn: InvokeFunction | undefined;
	private _errorParserFn: ErrorParserFunction = defaultErrorParser;
	private _healthCheckFn: HealthCheckFunction | undefined;

	constructor(name?: string) {
		if (name) {
			this._name = name;
		}
	}

	/**
	 * Set the adapter ID
	 */
	id(id: string): AdapterBuilder {
		if (!id || id.trim() === "") {
			throw new BuilderValidationError("Adapter ID cannot be empty", "id");
		}
		this._id = id.toLowerCase();
		return this;
	}

	/**
	 * Set the adapter name
	 */
	name(name: string): AdapterBuilder {
		if (!name || name.trim() === "") {
			throw new BuilderValidationError("Adapter name cannot be empty", "name");
		}
		this._name = name;
		return this;
	}

	/**
	 * Set supported models
	 */
	models(...models: string[]): AdapterBuilder {
		if (models.length === 0) {
			throw new BuilderValidationError(
				"At least one model must be specified",
				"models",
			);
		}
		this._models = models;
		if (!this._defaultModel) {
			this._defaultModel = models[0];
		}
		return this;
	}

	/**
	 * Set default model (if different from first model)
	 */
	defaultModel(model: string): AdapterBuilder {
		if (!this._models.includes(model)) {
			throw new BuilderValidationError(
				`Default model '${model}' must be in the models list`,
				"defaultModel",
			);
		}
		this._defaultModel = model;
		return this;
	}

	/**
	 * Set capabilities
	 */
	capabilities(...capabilities: ProviderCapability[]): AdapterBuilder {
		this._capabilities = capabilities;
		return this;
	}

	/**
	 * Set rate limits
	 */
	rateLimits(limits: RateLimitConfig): AdapterBuilder {
		this._rateLimits = limits;
		return this;
	}

	/**
	 * Set token limits per model
	 */
	maxTokens(model: string, tokens: number): AdapterBuilder {
		this._maxTokens[model] = tokens;
		return this;
	}

	/**
	 * Set the invoke function (required)
	 */
	invoke(fn: InvokeFunction): AdapterBuilder {
		if (typeof fn !== "function") {
			throw new BuilderValidationError("Invoke must be a function", "invoke");
		}
		this._invokeFn = fn;
		return this;
	}

	/**
	 * Set the complete function (alias for invoke)
	 */
	complete(
		fn: (
			prompt: string,
			options?: Record<string, unknown>,
		) => Promise<ProviderResponse>,
	): AdapterBuilder {
		if (typeof fn !== "function") {
			throw new BuilderValidationError(
				"Complete must be a function",
				"complete",
			);
		}
		// Convert the prompt-based function to ProviderRequest-based invoke
		this._invokeFn = async (request: ProviderRequest) => {
			const prompt = request.messages
				.filter((m) => m.role === "user")
				.map((m) => m.content)
				.join("\n");
			return fn(prompt, { model: request.model });
		};
		return this;
	}

	/**
	 * Set custom error parser
	 */
	parseError(fn: ErrorParserFunction): AdapterBuilder {
		if (typeof fn !== "function") {
			throw new BuilderValidationError(
				"parseError must be a function",
				"parseError",
			);
		}
		this._errorParserFn = fn;
		return this;
	}

	/**
	 * Set health check function
	 */
	healthCheck(fn: HealthCheckFunction): AdapterBuilder {
		if (typeof fn !== "function") {
			throw new BuilderValidationError(
				"healthCheck must be a function",
				"healthCheck",
			);
		}
		this._healthCheckFn = fn;
		return this;
	}

	/**
	 * Validate and build the adapter
	 */
	build(): BuiltAdapter {
		// Validate required fields
		if (!this._id) {
			throw new BuilderValidationError("Adapter ID is required", "id");
		}
		if (!this._name) {
			throw new BuilderValidationError("Adapter name is required", "name");
		}
		if (!this._invokeFn) {
			throw new BuilderValidationError("Invoke function is required", "invoke");
		}

		return new BuiltAdapter({
			id: this._id,
			name: this._name,
			models: this._models,
			capabilities: this._capabilities,
			rateLimits: this._rateLimits,
			defaultModel: this._defaultModel ?? this._models[0],
			maxTokens: { ...DEFAULT_TOKEN_LIMITS, ...this._maxTokens },
			invokeFn: this._invokeFn,
			errorParserFn: this._errorParserFn,
			healthCheckFn: this._healthCheckFn,
		});
	}
}

/**
 * Configuration for BuiltAdapter
 */
interface BuiltAdapterConfig {
	id: string;
	name: string;
	models: string[];
	capabilities: ProviderCapability[];
	rateLimits: RateLimitConfig;
	defaultModel: string;
	maxTokens: Record<string, number>;
	invokeFn: InvokeFunction;
	errorParserFn: ErrorParserFunction;
	healthCheckFn?: HealthCheckFunction;
}

/**
 * Built adapter instance
 */
export class BuiltAdapter {
	readonly id: string;
	readonly name: string;
	private readonly _models: string[];
	private readonly _capabilities: ProviderCapability[];
	private readonly _rateLimits: RateLimitConfig;
	private readonly _defaultModel: string;
	private readonly _maxTokens: Record<string, number>;
	private readonly _invokeFn: InvokeFunction;
	private readonly _errorParserFn: ErrorParserFunction;
	private readonly _healthCheckFn?: HealthCheckFunction;

	constructor(config: BuiltAdapterConfig) {
		this.id = config.id;
		this.name = config.name;
		this._models = config.models;
		this._capabilities = config.capabilities;
		this._rateLimits = config.rateLimits;
		this._defaultModel = config.defaultModel;
		this._maxTokens = config.maxTokens;
		this._invokeFn = config.invokeFn;
		this._errorParserFn = config.errorParserFn;
		this._healthCheckFn = config.healthCheckFn;
	}

	/**
	 * Get supported models
	 */
	getModels(): string[] {
		return [...this._models];
	}

	/**
	 * Get capabilities
	 */
	getCapabilities(): ProviderCapability[] {
		return [...this._capabilities];
	}

	/**
	 * Get rate limits
	 */
	getRateLimits(): RateLimitConfig {
		return { ...this._rateLimits };
	}

	/**
	 * Check if model is supported
	 */
	supportsModel(model: string): boolean {
		return this._models.some((m) => m.toLowerCase() === model.toLowerCase());
	}

	/**
	 * Get default model
	 */
	getDefaultModel(): string {
		return this._defaultModel;
	}

	/**
	 * Get max tokens for a model
	 */
	getMaxTokens(model?: string): number {
		const modelToCheck = model ?? this._defaultModel;
		// Try exact match first
		if (this._maxTokens[modelToCheck]) {
			return this._maxTokens[modelToCheck];
		}
		// Try to find a prefix match
		for (const [key, value] of Object.entries(this._maxTokens)) {
			if (modelToCheck?.toLowerCase().startsWith(key.toLowerCase())) {
				return value;
			}
		}
		return this._maxTokens.default ?? 4096;
	}

	/**
	 * Invoke the adapter
	 */
	async invoke(request: ProviderRequest): Promise<AdapterResult> {
		const start = Date.now();

		try {
			const response = await this._invokeFn(request);
			return {
				response,
				retryable: false,
				latencyMs: Date.now() - start,
			};
		} catch (error) {
			const errorAnalysis = this._errorParserFn(error);
			const latencyMs = Date.now() - start;

			return {
				response: {
					content: "",
					error: errorAnalysis.message,
				},
				quotaSignal: errorAnalysis.quotaSignal,
				retryable:
					errorAnalysis.rateLimited ||
					errorAnalysis.serverError ||
					errorAnalysis.timeout,
				latencyMs,
			};
		}
	}

	/**
	 * Parse an error
	 */
	parseError(error: unknown): ErrorAnalysis {
		return this._errorParserFn(error);
	}

	/**
	 * Health check
	 */
	async healthCheck(): Promise<HealthCheckResult> {
		if (this._healthCheckFn) {
			return this._healthCheckFn();
		}

		// Default health check - just return healthy
		return {
			healthy: true,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Convert to adapter info for registry
	 */
	toConfig(): AdapterBuilderConfig {
		return {
			id: this.id,
			name: this.name,
			models: this._models,
			capabilities: this._capabilities,
			rateLimits: this._rateLimits,
			defaultModel: this._defaultModel,
			maxTokens: this._maxTokens,
		};
	}
}

// ─── Factory Function ──────────────────────────────────────────────────────

/**
 * Create a new provider builder
 */
export function createProviderBuilder(name: string): AdapterBuilder {
	return new AdapterBuilder(name);
}
