/**
 * Evaluation Runner Tests (RFC-0020)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  EvaluationRunner,
  exactMatchEvaluator,
  substringMatchEvaluator,
  lengthEvaluator,
} from "../src/index.js";
import type { EvaluationSuite } from "../src/index.js";

describe("EvaluationRunner", () => {
  let runner: EvaluationRunner;

  beforeEach(() => { runner = new EvaluationRunner(); });

  it("registers and lists evaluators", () => {
    runner.registerEvaluator("custom", async () => ({ runId: "r1", metric: "custom", score: 0.5, passed: true }));
    expect(runner.listEvaluators()).toContain("custom");
  });

  it("runs suite and returns report", async () => {
    runner.registerEvaluator("exact", exactMatchEvaluator);
    const suite: EvaluationSuite = {
      id: "s1",
      name: "Basic",
      cases: [{
        id: "c1",
        name: "exact match",
        input: { prompt: "hello", expectedOutput: "world" },
        evaluators: ["exact"],
      }],
      thresholds: { "exact-match": 1 },
    };
    const report = await runner.runSuite(suite, async () => "world");
    expect(report.total).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.results[0].score).toBe(1);
  });

  it("marks failed when output differs", async () => {
    runner.registerEvaluator("exact", exactMatchEvaluator);
    const suite: EvaluationSuite = {
      id: "s2",
      name: "Fail",
      cases: [{
        id: "c1",
        name: "differs",
        input: { prompt: "hello", expectedOutput: "world" },
        evaluators: ["exact"],
      }],
      thresholds: {},
    };
    const report = await runner.runSuite(suite, async () => "other");
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(0);
  });

  it("handles timeout", async () => {
    runner = new EvaluationRunner({ timeoutMs: 10 });
    runner.registerEvaluator("exact", exactMatchEvaluator);
    const suite: EvaluationSuite = {
      id: "s3",
      name: "Timeout",
      cases: [{
        id: "c1",
        name: "slow",
        input: { prompt: "hello", expectedOutput: "world" },
        evaluators: ["exact"],
      }],
      thresholds: {},
    };
    const report = await runner.runSuite(suite, async () => new Promise((r) => setTimeout(() => r("world"), 200)));
    expect(report.failed).toBe(1);
    expect(report.results[0].details).toContain("timeout");
  });

  it("registers unknown evaluator gracefully", async () => {
    const suite: EvaluationSuite = {
      id: "s4",
      name: "Unknown",
      cases: [{
        id: "c1",
        name: "unknown",
        input: { prompt: "hello" },
        evaluators: ["not-registered"],
      }],
      thresholds: {},
    };
    const report = await runner.runSuite(suite, async () => "output");
    expect(report.total).toBe(1);
    expect(report.results[0].details).toContain("not registered");
  });

  it("calculates summary averages", async () => {
    runner.registerEvaluator("exact", exactMatchEvaluator);
    const suite: EvaluationSuite = {
      id: "s5",
      name: "Multi",
      cases: [
        { id: "c1", name: "a", input: { prompt: "a", expectedOutput: "x" }, evaluators: ["exact"] },
        { id: "c2", name: "b", input: { prompt: "b", expectedOutput: "y" }, evaluators: ["exact"] },
      ],
      thresholds: {},
    };
    const report = await runner.runSuite(suite, async () => "x");
    expect(report.summary["exact-match"]?.count).toBe(2);
  });
});

describe("exactMatchEvaluator", () => {
  it("scores 1 for exact match", async () => {
    const result = await exactMatchEvaluator(
      { prompt: "hello", expectedOutput: "world" },
      "world",
    );
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("scores 0 for mismatch", async () => {
    const result = await exactMatchEvaluator(
      { prompt: "hello", expectedOutput: "world" },
      "other",
    );
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });
});

describe("substringMatchEvaluator", () => {
  it("passes when expected is substring", async () => {
    const result = await substringMatchEvaluator(
      { prompt: "hello", expectedOutput: "world peace" },
      "hello world peace today",
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when expected not found", async () => {
    const result = await substringMatchEvaluator(
      { prompt: "hello", expectedOutput: "xyz" },
      "abc def",
    );
    expect(result.passed).toBe(false);
  });
});

describe("lengthEvaluator", () => {
  it("passes when within range", async () => {
    const result = await lengthEvaluator(
      { prompt: "hello", metadata: { minLength: 5, maxLength: 20 } },
      "hello world",
    );
    expect(result.passed).toBe(true);
  });

  it("fails when too long", async () => {
    const result = await lengthEvaluator(
      { prompt: "hello", metadata: { minLength: 5, maxLength: 10 } },
      "this is a very long response",
    );
    expect(result.passed).toBe(false);
  });
});
