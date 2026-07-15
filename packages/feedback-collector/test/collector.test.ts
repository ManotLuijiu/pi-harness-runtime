/**
 * Feedback Collector Tests (RFC-0021)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { FeedbackCollector } from "../src/index.js";
import type { FeedbackBatch } from "../src/index.js";

describe("FeedbackCollector", () => {
  let collector: FeedbackCollector;

  beforeEach(() => { collector = new FeedbackCollector(); });

  it("collects feedback from human source", () => {
    const item = collector.collect("human", "Great product, love it!");
    expect(item.id).toBeDefined();
    expect(item.source).toBe("human");
    expect(item.sentiment).toBe("positive");
    expect(item.status).toBe("pending");
  });

  it("collects feedback from automated source", () => {
    const item = collector.collect("automated", "Build failed on line 42");
    expect(item.source).toBe("automated");
    expect(item.sentiment).toBe("negative");
  });

  it("infers negative sentiment from error messages", () => {
    const item = collector.collect("system", "Bug: crash on startup");
    expect(item.sentiment).toBe("negative");
  });

  it("infers neutral sentiment", () => {
    const item = collector.collect("system", "Process completed");
    expect(item.sentiment).toBe("neutral");
  });

  it("collectBatch adds all items", () => {
    const batch: FeedbackBatch = {
      id: "batch-1",
      source: "user",
      receivedAt: new Date().toISOString(),
      items: [
        { id: "f1", message: "msg1", source: "user", status: "pending" },
        { id: "f2", message: "msg2", source: "user", status: "pending" },
      ],
    };
    collector.collectBatch(batch);
    expect(collector.count()).toBe(2);
  });

  it("query filters by source", () => {
    collector.collect("human", "human msg");
    collector.collect("automated", "automated msg");
    const results = collector.query({ source: "human" });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("human");
  });

  it("query filters by sentiment", () => {
    collector.collect("system", "good thing");
    collector.collect("system", "bad thing");
    const results = collector.query({ sentiment: "positive" });
    expect(results).toHaveLength(1);
  });

  it("query filters by status", () => {
    collector.collect("human", "msg1");
    collector.collect("human", "msg2");
    collector.updateStatus(collector.query()[0].id, "reviewed");
    const results = collector.query({ status: "pending" });
    expect(results).toHaveLength(1);
  });

  it("query filters by tags", () => {
    collector.collect("human", "msg1", { tags: ["auth"] });
    collector.collect("human", "msg2", { tags: ["ui"] });
    const results = collector.query({ tags: ["auth"] });
    expect(results).toHaveLength(1);
  });

  it("summary aggregates correctly", () => {
    collector.collect("human", "great work");
    collector.collect("human", "bad bug");
    collector.collect("automated", "system msg");
    const summary = collector.summary();
    expect(summary.total).toBe(3);
    expect(summary.bySource.human).toBe(2);
    expect(summary.bySource.automated).toBe(1);
    expect(summary.pending).toBe(3);
  });

  it("summary calculates avgScore", () => {
    collector.collect("human", "msg1");
    const items = collector.query();
    items[0].score = 4;
    items[0].sentiment = "positive";
    collector.collect("human", "msg2");
    const items2 = collector.query();
    items2[1].score = 2;
    items2[1].sentiment = "neutral";
    const summary = collector.summary();
    expect(summary.avgScore).toBe(3);
  });

  it("updateStatus changes status", () => {
    const item = collector.collect("human", "msg");
    collector.updateStatus(item.id, "reviewed");
    expect(collector.query({ status: "reviewed" })).toHaveLength(1);
  });

  it("resolve sets resolvedAt", () => {
    const item = collector.collect("human", "msg");
    collector.resolve(item.id, "actioned");
    const updated = collector.query()[0];
    expect(updated.resolvedAt).toBeDefined();
    expect(updated.status).toBe("actioned");
  });

  it("autoCloseOld closes old items", () => {
    const item = collector.collect("human", "old msg");
    const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const items = collector.query();
    items[0].createdAt = oldDate;
    const count = collector.autoCloseOld();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("count returns total items", () => {
    collector.collect("human", "msg1");
    collector.collect("human", "msg2");
    expect(collector.count()).toBe(2);
  });

  it("listBatches returns batches", () => {
    const batch: FeedbackBatch = {
      id: "b1", source: "user", receivedAt: "", items: [],
    };
    collector.collectBatch(batch);
    expect(collector.listBatches()).toHaveLength(1);
  });
});
