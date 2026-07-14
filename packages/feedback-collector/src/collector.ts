/**
 * Feedback Collector — Core (RFC-0021)
 */

import type {
	FeedbackBatch,
	FeedbackCollectionConfig,
	FeedbackFilter,
	FeedbackItem,
	FeedbackSentiment,
	FeedbackSource,
	FeedbackSummary,
} from "./types.js";

let _idCounter = 0;
function nextId(): string {
	return `fb-${Date.now()}-${++_idCounter}`;
}

function inferSentiment(message: string): FeedbackSentiment {
	const lower = message.toLowerCase();
	const positive = ["great", "excellent", "love", "perfect", "good", "helpful", "works", "amazing"];
	const negative = ["bad", "wrong", "hate", "broken", "fail", "slow", "terrible", "bug", "error"];
	if (positive.some((w) => lower.includes(w))) return "positive";
	if (negative.some((w) => lower.includes(w))) return "negative";
	return "neutral";
}

export class FeedbackCollector {
	private items: FeedbackItem[] = [];
	private batches: FeedbackBatch[] = [];
	private config: Required<FeedbackCollectionConfig>;

	constructor(config: FeedbackCollectionConfig = {}) {
		this.config = {
			retentionDays: config.retentionDays ?? 90,
			autoCloseThreshold: config.autoCloseThreshold ?? 10,
			anonymizeUserId: config.anonymizeUserId ?? false,
		};
	}

		collect(source: FeedbackSource, message: string, metadata?: Record<string, unknown>): FeedbackItem {
		const item: FeedbackItem = {
			id: nextId(),
			source,
			sentiment: inferSentiment(message),
			message,
			status: "pending",
			createdAt: new Date().toISOString(),
			tags: (metadata?.tags as string[] | undefined) ?? [],
			metadata,
		};
		this.items.push(item);
		return item;
	}

	collectBatch(batch: FeedbackBatch): void {
		for (const item of batch.items) {
			if (!item.id) item.id = nextId();
			if (!item.createdAt) item.createdAt = new Date().toISOString();
			if (!item.sentiment) item.sentiment = inferSentiment(item.message);
			if (!item.status) item.status = "pending";
			this.items.push(item);
		}
		this.batches.push(batch);
	}

	query(filter?: FeedbackFilter): FeedbackItem[] {
		let results = [...this.items];
		if (!filter) return results;

		if (filter.source) results = results.filter((i) => i.source === filter.source);
		if (filter.sentiment) results = results.filter((i) => i.sentiment === filter.sentiment);
		if (filter.status) results = results.filter((i) => i.status === filter.status);
		if (filter.tags?.length) {
			results = results.filter((i) => filter.tags!.some((t) => i.tags?.includes(t)));
		}
		if (filter.since) {
			results = results.filter((i) => (i.createdAt ?? "") >= filter.since!);
		}
		if (filter.until) {
			results = results.filter((i) => (i.createdAt ?? "") <= filter.until!);
		}

		return results;
	}

	summary(filter?: FeedbackFilter): FeedbackSummary {
		const items = this.query(filter);
		const total = items.length;
		const bySource: Record<FeedbackSource, number> = {
			human: 0,
			automated: 0,
			system: 0,
			user: 0,
		};
		const bySentiment: Record<FeedbackSentiment, number> = {
			positive: 0,
			neutral: 0,
			negative: 0,
		};
		let scoreSum = 0;
		let scoreCount = 0;

		for (const item of items) {
			bySource[item.source] = (bySource[item.source] ?? 0) + 1;
			if (item.sentiment) {
				bySentiment[item.sentiment] = (bySentiment[item.sentiment] ?? 0) + 1;
			}
			if (item.score !== undefined) {
				scoreSum += item.score;
				scoreCount++;
			}
		}

		return {
			total,
			bySource,
			bySentiment,
			avgScore: scoreCount > 0 ? scoreSum / scoreCount : 0,
			pending: items.filter((i) => i.status === "pending").length,
		};
	}

	updateStatus(id: string, status: FeedbackItem["status"]): boolean {
		const item = this.items.find((i) => i.id === id);
		if (!item) return false;
		item.status = status;
		if (status === "actioned" || status === "dismissed") {
			item.resolvedAt = new Date().toISOString();
		}
		return true;
	}

	resolve(id: string, status: "actioned" | "dismissed"): boolean {
		return this.updateStatus(id, status);
	}

	autoCloseOld(): number {
		const cutoff = Date.now() - this.config.retentionDays * 86_400_000;
		let count = 0;
		for (const item of this.items) {
			const created = new Date(item.createdAt ?? Date.now()).getTime();
			if (created < cutoff && item.status === "pending") {
				item.status = "dismissed";
				item.resolvedAt = new Date().toISOString();
				count++;
			}
		}
		return count;
	}

	count(): number {
		return this.items.length;
	}

	listBatches(): FeedbackBatch[] {
		return [...this.batches];
	}
}
