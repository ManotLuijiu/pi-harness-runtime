/**
 * Feedback Collector — Types (RFC-0021)
 */

export type FeedbackSource = "human" | "automated" | "system" | "user";
export type FeedbackSentiment = "positive" | "neutral" | "negative";
export type FeedbackStatus = "pending" | "reviewed" | "actioned" | "dismissed";

export interface FeedbackItem {
	id: string;
	source: FeedbackSource;
	sentiment?: FeedbackSentiment;
	score?: number;
	message: string;
	targetId?: string;
	tags?: string[];
	status: FeedbackStatus;
	createdAt?: string;
	resolvedAt?: string;
	metadata?: Record<string, unknown>;
}

export interface FeedbackBatch {
	id: string;
	items: FeedbackItem[];
	source: FeedbackSource;
	receivedAt: string;
}

export interface FeedbackSummary {
	total: number;
	bySource: Record<FeedbackSource, number>;
	bySentiment: Record<FeedbackSentiment, number>;
	avgScore: number;
	pending: number;
}

export interface FeedbackFilter {
	source?: FeedbackSource;
	sentiment?: FeedbackSentiment;
	status?: FeedbackStatus;
	tags?: string[];
	since?: string;
	until?: string;
}

export interface FeedbackCollectionConfig {
	retentionDays?: number;
	autoCloseThreshold?: number;
	anonymizeUserId?: boolean;
}
