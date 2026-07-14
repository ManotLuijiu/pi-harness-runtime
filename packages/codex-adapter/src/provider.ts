/**
 * Codex Adapter — Provider (RFC-0070)
 */

import type { CodexConfig, CodexOptions, CodexResponse } from "./types.js";
import { DEFAULT_TOOLS } from "./types.js";

export { DEFAULT_TOOLS };

/**
 * OpenAI Codex Provider for pi-harness
 */
export class CodexProvider {
	readonly id = "codex";
	readonly name = "OpenAI Codex";

	readonly provider = {
		complete: (prompt: string, options?: unknown) =>
			this.complete(prompt, options as CodexOptions),
		stream: undefined,
		embed: undefined,
	};

	private apiKey: string;
	private cfg: Required<Omit<CodexConfig, "apiKey">>;

	constructor(config: CodexConfig) {
		if (!config.apiKey?.trim()) {
			throw new Error("CodexProvider requires an API key");
		}
		this.apiKey = config.apiKey;
		this.cfg = {
			model: config.model ?? "gpt-4o",
			baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
			maxTokens: config.maxTokens ?? 8192,
			temperature: config.temperature ?? 0.7,
			timeout: config.timeout ?? 60000,
		};
	}

	async complete(
		prompt: string,
		options?: CodexOptions,
	): Promise<CodexResponse> {
		const model = options?.model ?? this.cfg.model;
		const maxTokens = options?.maxTokens ?? this.cfg.maxTokens;
		const temperature = options?.temperature ?? this.cfg.temperature;
		const tools = options?.tools ?? DEFAULT_TOOLS;

		const body: Record<string, unknown> = {
			model,
			messages: [{ role: "user", content: prompt }],
			max_tokens: maxTokens,
			temperature,
		};

		if (tools.length > 0) {
			body.tools = tools;
			body.tool_choice = options?.toolChoice ?? "auto";
		}

		const response = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.cfg.timeout),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${text}`);
		}

		const data = (await response.json()) as {
			choices: Array<{
				message: {
					content: string | null;
					tool_calls?: Array<{ function: { name: string; arguments: string } }>;
				};
				finish_reason: string;
			}>;
			usage?: {
				prompt_tokens: number;
				completion_tokens: number;
				total_tokens: number;
			};
		};

		const choice = data.choices[0];
		let content = choice.message.content ?? "";

		if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
			content +=
				"\n\n[Tool calls: " +
				choice.message.tool_calls
					.map((tc) => `${tc.function.name}(${tc.function.arguments})`)
					.join(", ") +
				"]";
		}

		return {
			content,
			finishReason: choice.finish_reason,
			usage: data.usage
				? {
						inputTokens: data.usage.prompt_tokens,
						outputTokens: data.usage.completion_tokens,
						totalTokens: data.usage.total_tokens,
					}
				: undefined,
		};
	}

	async *stream(
		prompt: string,
		options?: CodexOptions,
	): AsyncGenerator<string> {
		const model = options?.model ?? this.cfg.model;
		const maxTokens = options?.maxTokens ?? this.cfg.maxTokens;
		const temperature = options?.temperature ?? this.cfg.temperature;
		const tools = options?.tools ?? DEFAULT_TOOLS;

		const body: Record<string, unknown> = {
			model,
			messages: [{ role: "user", content: prompt }],
			max_tokens: maxTokens,
			temperature,
			stream: true,
		};

		if (tools.length > 0) {
			body.tools = tools;
			body.tool_choice = options?.toolChoice ?? "auto";
		}

		const response = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.cfg.timeout),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${text}`);
		}

		if (!response.body) throw new Error("No response body");

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const raw = line.slice(6);
						if (raw === "[DONE]") continue;
						try {
							const chunk = JSON.parse(raw) as {
								choices: Array<{ delta: { content?: string } }>;
							};
							if (chunk.choices[0]?.delta?.content) {
								yield chunk.choices[0].delta.content;
							}
						} catch {
							// ignore parse errors
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			const response = await fetch(`${this.cfg.baseUrl}/models`, {
				headers: { Authorization: `Bearer ${this.apiKey}` },
				signal: AbortSignal.timeout(10000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	estimateCost(inputTokens: number, outputTokens: number): number {
		const pricing: Record<string, { input: number; output: number }> = {
			"gpt-4o": { input: 2.5, output: 10.0 },
			o3: { input: 10.0, output: 40.0 },
			"o4-mini": { input: 1.0, output: 4.0 },
		};
		const p = pricing[this.cfg.model] ?? pricing["gpt-4o"];
		return (
			(inputTokens / 1_000_000) * p.input +
			(outputTokens / 1_000_000) * p.output
		);
	}
}
