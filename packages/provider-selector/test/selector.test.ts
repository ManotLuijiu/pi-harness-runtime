/**
 * Provider Selector Tests (RFC-0012)
 */

import { describe, it, expect } from "bun:test";
import {
  selectProvider,
  rank,
  compareCost,
  compareLatency,
  filterByCapability,
  filterByRegion,
} from "../src/index.js";
import type { Provider } from "../src/index.js";

const makeProvider = (overrides?: Partial<Provider>): Provider => ({
  id: "p1",
  name: "Provider 1",
  baseURL: "https://api.example.com",
  capabilities: ["text"],
  region: "us",
  inputCostPer1M: 1.0,
  outputCostPer1M: 3.0,
  latencyMs: 500,
  qualityScore: 80,
  maxContextTokens: 128000,
  available: true,
  ...overrides,
});

const PROVIDERS: Provider[] = [
  makeProvider({ id: "cheap", name: "Cheap", inputCostPer1M: 0.1, latencyMs: 200, qualityScore: 60 }),
  makeProvider({ id: "fast", name: "Fast", inputCostPer1M: 2.0, latencyMs: 50, qualityScore: 90 }),
  makeProvider({ id: "quality", name: "Quality", inputCostPer1M: 5.0, latencyMs: 800, qualityScore: 98 }),
];

describe("selectProvider", () => {
  it("selects a provider", () => {
    const result = selectProvider(PROVIDERS);
    expect(result).not.toBeNull();
    expect(result!.provider.available).toBe(true);
  });

  it("returns null for empty list", () => {
    expect(selectProvider([])).toBeNull();
  });

  it("returns null when none available", () => {
    const unavailable = PROVIDERS.map((p) => ({ ...p, available: false }));
    expect(selectProvider(unavailable)).toBeNull();
  });

  it("prefers cheapest for cost criteria", () => {
    const result = selectProvider(PROVIDERS, "cost");
    expect(result!.provider.id).toBe("cheap");
  });

  it("prefers fastest for latency criteria", () => {
    const result = selectProvider(PROVIDERS, "latency");
    expect(result!.provider.id).toBe("fast");
  });

  it("prefers high quality for quality criteria", () => {
    const result = selectProvider(PROVIDERS, "quality");
    expect(result!.score).toBeGreaterThan(0.8);
  });

  it("includes alternatives", () => {
    const result = selectProvider(PROVIDERS);
    expect(result!.alternatives.length).toBeGreaterThan(0);
  });

  it("includes reason", () => {
    const result = selectProvider(PROVIDERS);
    expect(result!.reason).toContain("score:");
  });
});

describe("rank", () => {
  it("returns sorted providers", () => {
    const ranked = rank(PROVIDERS);
    expect(ranked.length).toBe(3);
    expect(ranked[0].available).toBe(true);
  });

  it("uses criteria for ranking", () => {
    const byCost = rank(PROVIDERS, "cost");
    const byLatency = rank(PROVIDERS, "latency");
    expect(byCost[0].id).not.toBe(byLatency[0].id);
  });

  it("filters unavailable", () => {
    const mixed = [...PROVIDERS, { ...PROVIDERS[0], id: "down", available: false }];
    expect(rank(mixed).length).toBe(3);
  });
});

describe("compareCost", () => {
  it("negative when a is cheaper", () => {
    const cheap = makeProvider({ id: "c", inputCostPer1M: 0.5, outputCostPer1M: 1.0 });
    const expensive = makeProvider({ id: "e", inputCostPer1M: 5.0, outputCostPer1M: 10.0 });
    expect(compareCost(cheap, expensive)).toBeLessThan(0);
  });

  it("positive when a is more expensive", () => {
    const cheap = makeProvider({ id: "c", inputCostPer1M: 0.5, outputCostPer1M: 1.0 });
    const expensive = makeProvider({ id: "e", inputCostPer1M: 5.0, outputCostPer1M: 10.0 });
    expect(compareCost(expensive, cheap)).toBeGreaterThan(0);
  });
});

describe("compareLatency", () => {
  it("negative when a is faster", () => {
    const fast = makeProvider({ id: "f", latencyMs: 50 });
    const slow = makeProvider({ id: "s", latencyMs: 500 });
    expect(compareLatency(fast, slow)).toBeLessThan(0);
  });
});

describe("filterByCapability", () => {
  it("filters to matching capability", () => {
    const mixed = [
      makeProvider({ id: "t", capabilities: ["text"] }),
      makeProvider({ id: "tv", capabilities: ["text", "vision"] }),
    ];
    expect(filterByCapability(mixed, "vision")).toHaveLength(1);
    expect(filterByCapability(mixed, "vision")[0].id).toBe("tv");
  });
});

describe("filterByRegion", () => {
  it("filters by region", () => {
    const mixed = [
      makeProvider({ id: "us1", region: "us" }),
      makeProvider({ id: "eu1", region: "eu" }),
    ];
    expect(filterByRegion(mixed, "us")).toHaveLength(1);
  });

  it("global returns all", () => {
    const mixed = [makeProvider({ region: "us" }), makeProvider({ region: "eu" })];
    expect(filterByRegion(mixed, "global")).toHaveLength(2);
  });

  it("global regions always match", () => {
    const mixed = [
      makeProvider({ id: "g", region: "global" }),
      makeProvider({ id: "us", region: "us" }),
    ];
    expect(filterByRegion(mixed, "eu")).toHaveLength(1);
  });
});
