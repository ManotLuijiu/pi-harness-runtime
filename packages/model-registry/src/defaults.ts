/**
 * Default Model Definitions (RFC-0053)
 */

import type { ModelInfo } from "./types.js";

export const DEFAULT_MODELS: ModelInfo[] = [
	// OpenAI Models
	{
		id: "gpt-4o",
		providerId: "openai",
		name: "GPT-4o",
		contextWindow: 128000,
		maxOutputTokens: 16384,
		pricing: {
			currency: "USD",
			inputPer1M: 5,
			outputPer1M: 15,
		},
		capabilities: [
			"code_generation",
			"code_review",
			"vision",
			"function_calling",
			"json_mode",
		],
		aliases: ["gpt4o", "gpt-4o", "openai-gpt-4o"],
		status: "active",
	},
	{
		id: "gpt-4o-mini",
		providerId: "openai",
		name: "GPT-4o Mini",
		contextWindow: 128000,
		maxOutputTokens: 16384,
		pricing: {
			currency: "USD",
			inputPer1M: 0.15,
			outputPer1M: 0.6,
		},
		capabilities: [
			"code_generation",
			"code_review",
			"function_calling",
			"json_mode",
		],
		aliases: ["gpt4o-mini", "gpt-4o-mini", "openai-gpt-4o-mini"],
		status: "active",
	},
	{
		id: "gpt-4-turbo",
		providerId: "openai",
		name: "GPT-4 Turbo",
		contextWindow: 128000,
		maxOutputTokens: 4096,
		pricing: {
			currency: "USD",
			inputPer1M: 10,
			outputPer1M: 30,
		},
		capabilities: [
			"code_generation",
			"code_review",
			"vision",
			"function_calling",
		],
		aliases: ["gpt4-turbo", "gpt-4-turbo"],
		status: "deprecated",
	},

	// Anthropic Models
	{
		id: "claude-sonnet-4",
		providerId: "anthropic",
		name: "Claude Sonnet 4",
		contextWindow: 200000,
		maxOutputTokens: 8192,
		pricing: {
			currency: "USD",
			inputPer1M: 3,
			outputPer1M: 15,
		},
		capabilities: [
			"code_generation",
			"code_review",
			"planning",
			"vision",
			"analysis",
		],
		aliases: [
			"sonnet",
			"claude-sonnet",
			"anthropic-sonnet",
			"claude-3-5-sonnet",
		],
		status: "active",
	},
	{
		id: "claude-opus-4",
		providerId: "anthropic",
		name: "Claude Opus 4",
		contextWindow: 200000,
		maxOutputTokens: 8192,
		pricing: {
			currency: "USD",
			inputPer1M: 15,
			outputPer1M: 75,
		},
		capabilities: ["code_generation", "planning", "analysis", "code_review"],
		aliases: ["opus", "claude-opus", "anthropic-opus", "claude-3-opus"],
		status: "active",
	},

	// MiniMax Models
	{
		id: "MiniMax-Text-01",
		providerId: "minimax",
		name: "MiniMax Text 01",
		contextWindow: 1000000,
		maxOutputTokens: 8192,
		pricing: {
			currency: "USD",
			inputPer1M: 0.1,
			outputPer1M: 0.5,
			batchInputPer1M: 0.01,
		},
		capabilities: ["code_generation", "function_calling", "json_mode"],
		aliases: ["minimax", "minimax-text", "minimax-text-01"],
		status: "active",
	},
	{
		id: "abab6.5s-chat",
		providerId: "minimax",
		name: "ABAB 6.5S Chat",
		contextWindow: 245760,
		maxOutputTokens: 4096,
		pricing: {
			currency: "USD",
			inputPer1M: 0.05,
			outputPer1M: 0.2,
		},
		capabilities: ["code_generation", "function_calling"],
		aliases: ["abab", "abab6.5s"],
		status: "active",
	},

	// Google Models
	{
		id: "gemini-1.5-pro",
		providerId: "google",
		name: "Gemini 1.5 Pro",
		contextWindow: 2000000,
		maxOutputTokens: 8192,
		pricing: {
			currency: "USD",
			inputPer1M: 1.25,
			outputPer1M: 5,
		},
		capabilities: ["code_generation", "vision", "analysis"],
		aliases: ["gemini-pro", "gemini-1.5-pro-latest"],
		status: "active",
	},
	{
		id: "gemini-1.5-flash",
		providerId: "google",
		name: "Gemini 1.5 Flash",
		contextWindow: 1000000,
		maxOutputTokens: 8192,
		pricing: {
			currency: "USD",
			inputPer1M: 0.035,
			outputPer1M: 0.14,
		},
		capabilities: ["code_generation", "vision"],
		aliases: ["gemini-flash", "gemini-1.5-flash-latest"],
		status: "active",
	},
];
