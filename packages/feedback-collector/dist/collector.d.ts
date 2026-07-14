/**
 * Feedback Collector — Core (RFC-0021)
 */
import type { FeedbackBatch, FeedbackCollectionConfig, FeedbackFilter, FeedbackItem, FeedbackSource, FeedbackSummary } from "./types.js";
export declare class FeedbackCollector {
    private items;
    private batches;
    private config;
    constructor(config?: FeedbackCollectionConfig);
    collect(source: FeedbackSource, message: string, metadata?: Record<string, unknown>): FeedbackItem;
    collectBatch(batch: FeedbackBatch): void;
    query(filter?: FeedbackFilter): FeedbackItem[];
    summary(filter?: FeedbackFilter): FeedbackSummary;
    updateStatus(id: string, status: FeedbackItem["status"]): boolean;
    resolve(id: string, status: "actioned" | "dismissed"): boolean;
    autoCloseOld(): number;
    count(): number;
    listBatches(): FeedbackBatch[];
}
//# sourceMappingURL=collector.d.ts.map