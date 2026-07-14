/**
 * Context Manager Types (RFC-0010)
 */

export type PressureLevel = "normal" | "warning" | "compact" | "hard_stop";

export interface TriggerPolicy {
	warningThreshold: number;
	compactThreshold: number;
	hardStopThreshold: number;
}

export interface ContextItem {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	tokens: number;
	priority: number;
	timestamp: number;
	expiresAt?: number;
}

export interface CompactionResult {
	decisions: string[];
	openQuestions: string[];
	taskProgress: Record<string, string>;
	remainingTokens: number;
	compactedContent: string;
}

export interface SessionScope {
	id: string;
	items: ContextItem[];
	ttlMs: number;
	createdAt: number;
}

export interface ResumePrompt {
	summary: string;
	decisions: string[];
	openQuestions: string[];
	taskProgress: Record<string, string>;
	nextAction: string;
}
