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

import type {
	ProviderConfig,
	ProviderCapability,
	ProviderRequest,
	ProviderResponse,
} from "../../packages/types/src/runtime-types.ts";

export interface AdapterConfig {
	provider: ProviderConfig;
	quotaSignalExtractor?: (error: unknown) => QuotaSignal | null;
}

export interface QuotaSignal {
	exhausted: boolean;
	resetsAt?: string;
	retryAfterMs?: number;
}

export interface AdapterResult {
	response: ProviderResponse;
	quotaSignal?: QuotaSignal;
	retryable: boolean;
}

export interface ProviderAdapter {
	readonly id: string;
	readonly name: string;

	invoke(request: ProviderRequest): Promise<AdapterResult>;

	parseError(error: unknown): {
		quotaExceeded: boolean;
		rateLimited: boolean;
		timeout: boolean;
		serverError: boolean;
		clientError: boolean;
		quotaSignal?: QuotaSignal;
	};

	getCapabilities(): ProviderCapability[];

	supportsModel(model: string): boolean;

	getDefaultModel(): string;

	getMaxTokens(model?: string): number;
}

/**
 * Base adapter with common functionality
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
	abstract readonly id: string;
	abstract readonly name: string;

	constructor(protected config: ProviderConfig) {}

	abstract invoke(request: ProviderRequest): Promise<AdapterResult>;

	abstract parseError(error: unknown): {
		quotaExceeded: boolean;
		rateLimited: boolean;
		timeout: boolean;
		serverError: boolean;
		clientError: boolean;
		quotaSignal?: QuotaSignal;
	};

	getCapabilities(): ProviderCapability[] {
		return this.config.capabilities;
	}

	supportsModel(model: string): boolean {
		return this.config.models.includes(model);
	}

	getDefaultModel(): string {
		return this.config.models[0] ?? "default";
	}

	getMaxTokens(model?: string): number {
		// Default token limits per model family
		const limits: Record<string, number> = {
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
	protected parseUsage(response: unknown): ProviderResponse["usage"] {
		const r = response as Record<string, unknown>;
		return {
			input: (r.input_tokens as number) ?? (r.prompt_tokens as number) ?? 0,
			output:
				(r.output_tokens as number) ?? (r.completion_tokens as number) ?? 0,
			cacheRead: (r.cache_read_tokens as number) ?? 0,
			cacheWrite: (r.cache_write_tokens as number) ?? 0,
			cost: (r.cost as number) ?? 0,
		};
	}
}

/**
 * MiniMax adapter
 */
export class MiniMaxAdapter extends BaseProviderAdapter {
	readonly id = "minimax";
	readonly name = "MiniMax";

	async invoke(request: ProviderRequest): Promise<AdapterResult> {
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

	parseError(error: unknown): {
		quotaExceeded: boolean;
		rateLimited: boolean;
		timeout: boolean;
		serverError: boolean;
		clientError: boolean;
		quotaSignal?: QuotaSignal;
	} {
		const e = error as Record<string, unknown>;
		const msg = String(e.message ?? e.error ?? "").toLowerCase();

		return {
			quotaExceeded: msg.includes("2056") || msg.includes("quota"),
			rateLimited: msg.includes("rate limit") || msg.includes("429"),
			timeout: msg.includes("timeout") || msg.includes("timed out"),
			serverError:
				msg.includes("500") || msg.includes("502") || msg.includes("503"),
			clientError:
				msg.includes("400") || msg.includes("401") || msg.includes("403"),
			quotaSignal:
				msg.includes("quota") || msg.includes("2056")
					? { exhausted: true, resetsAt: undefined }
					: undefined,
		};
	}
}

/**
 * OpenAI adapter
 */
export class OpenAIAdapter extends BaseProviderAdapter {
	readonly id = "openai";
	readonly name = "OpenAI";

	async invoke(request: ProviderRequest): Promise<AdapterResult> {
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

	parseError(error: unknown): {
		quotaExceeded: boolean;
		rateLimited: boolean;
		timeout: boolean;
		serverError: boolean;
		clientError: boolean;
		quotaSignal?: QuotaSignal;
	} {
		const e = error as Record<string, unknown>;
		const msg = String(e.message ?? e.error ?? "").toLowerCase();
		const code = String(e.code ?? "");

		return {
			quotaExceeded:
				code === "insufficient_quota" || code === "context_length_exceeded",
			rateLimited: code === "rate_limit_exceeded" || msg.includes("429"),
			timeout: msg.includes("timeout"),
			serverError: code.startsWith("5"),
			clientError: code.startsWith("4"),
			quotaSignal:
				code === "insufficient_quota"
					? { exhausted: true, resetsAt: undefined }
					: undefined,
		};
	}
}

/**
 * Adapter registry
 */
export class AdapterRegistry {
	private adapters: Map<string, ProviderAdapter> = new Map();

	register(adapter: ProviderAdapter): void {
		this.adapters.set(adapter.id, adapter);
	}

	get(id: string): ProviderAdapter | undefined {
		return this.adapters.get(id);
	}

	list(): ProviderAdapter[] {
		return Array.from(this.adapters.values());
	}

	/**
	 * Create default registry with standard adapters
	 */
	static createDefault(): AdapterRegistry {
		const registry = new AdapterRegistry();

		registry.register(
			new MiniMaxAdapter({
				id: "minimax",
				name: "MiniMax",
				models: ["minimax/MiniMax-M3", "minimax/MiniMax-Text-01"],
				capabilities: ["code", "review", "plan", "test"],
				rateLimits: {},
			}),
		);

		registry.register(
			new OpenAIAdapter({
				id: "openai",
				name: "OpenAI",
				models: ["openai/gpt-4o", "openai/gpt-4-turbo"],
				capabilities: ["code", "review", "plan", "test", "refactor"],
				rateLimits: {},
			}),
		);

		return registry;
	}
}
