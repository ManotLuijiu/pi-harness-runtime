/**
 * Default Capability Profiles (RFC-0051)
 */

import type { CapabilityProfile } from "./types.js";

export const DEFAULT_CAPABILITIES: Record<
	string,
	Record<string, CapabilityProfile[]>
> = {
	openai: {
		"gpt-4o": [
			{
				capability: "code_generation",
				score: 95,
				latency: "medium",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
			{
				capability: "code_review",
				score: 90,
				latency: "medium",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
			{
				capability: "vision",
				score: 95,
				latency: "medium",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
			{
				capability: "function_calling",
				score: 95,
				latency: "medium",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
			{
				capability: "json_mode",
				score: 90,
				latency: "medium",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
		],
		"gpt-4o-mini": [
			{
				capability: "code_generation",
				score: 85,
				latency: "fast",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
			{
				capability: "code_review",
				score: 80,
				latency: "fast",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
			{
				capability: "function_calling",
				score: 85,
				latency: "fast",
				contextWindow: 128000,
				maxOutputTokens: 16384,
			},
		],
	},
	anthropic: {
		"claude-sonnet-4": [
			{
				capability: "code_generation",
				score: 95,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "code_review",
				score: 95,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "planning",
				score: 90,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "vision",
				score: 90,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
		],
		"claude-opus-4": [
			{
				capability: "code_generation",
				score: 98,
				latency: "slow",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "planning",
				score: 95,
				latency: "slow",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "analysis",
				score: 95,
				latency: "slow",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "code_review",
				score: 98,
				latency: "slow",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
		],
		"claude-3-5-sonnet-latest": [
			{
				capability: "code_generation",
				score: 96,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "code_review",
				score: 95,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "planning",
				score: 92,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
			{
				capability: "analysis",
				score: 93,
				latency: "fast",
				contextWindow: 200000,
				maxOutputTokens: 8192,
			},
		],
	},
	minimax: {
		"MiniMax-Text-01": [
			{
				capability: "code_generation",
				score: 85,
				latency: "fast",
				contextWindow: 1000000,
				maxOutputTokens: 8192,
			},
			{
				capability: "function_calling",
				score: 80,
				latency: "fast",
				contextWindow: 1000000,
				maxOutputTokens: 8192,
			},
			{
				capability: "json_mode",
				score: 85,
				latency: "fast",
				contextWindow: 1000000,
				maxOutputTokens: 8192,
			},
		],
		"abab6.5s-chat": [
			{
				capability: "code_generation",
				score: 75,
				latency: "fast",
				contextWindow: 245760,
				maxOutputTokens: 4096,
			},
			{
				capability: "function_calling",
				score: 70,
				latency: "fast",
				contextWindow: 245760,
				maxOutputTokens: 4096,
			},
		],
	},
	google: {
		"gemini-1.5-pro": [
			{
				capability: "code_generation",
				score: 90,
				latency: "medium",
				contextWindow: 2000000,
				maxOutputTokens: 8192,
			},
			{
				capability: "vision",
				score: 95,
				latency: "medium",
				contextWindow: 2000000,
				maxOutputTokens: 8192,
			},
			{
				capability: "analysis",
				score: 92,
				latency: "medium",
				contextWindow: 2000000,
				maxOutputTokens: 8192,
			},
		],
		"gemini-1.5-flash": [
			{
				capability: "code_generation",
				score: 82,
				latency: "fast",
				contextWindow: 1000000,
				maxOutputTokens: 8192,
			},
			{
				capability: "vision",
				score: 88,
				latency: "fast",
				contextWindow: 1000000,
				maxOutputTokens: 8192,
			},
		],
	},
};
