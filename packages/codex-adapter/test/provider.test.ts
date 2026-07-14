/**
 * Codex Adapter Tests (RFC-0070)
 */

import { describe, it, expect } from "bun:test";
import { CodexProvider } from "../src/provider.js";
import { ExecutionSandbox } from "../src/executor.js";
import { DEFAULT_TOOLS } from "../src/types.js";

describe("CodexProvider", () => {
  it("creates provider with API key", () => {
    const provider = new CodexProvider({ apiKey: "sk-test-key" });
    expect(provider.id).toBe("codex");
    expect(provider.name).toBe("OpenAI Codex");
    expect(provider.provider).toBeDefined();
  });

  it("creates provider with custom config", () => {
    const provider = new CodexProvider({
      apiKey: "sk-test",
      model: "o3",
      maxTokens: 4096,
      temperature: 0.5,
    });
    expect(provider).toBeDefined();
  });

  it("throws without API key", () => {
    expect(() => new CodexProvider({ apiKey: "" })).toThrow();
    expect(() => new CodexProvider({ apiKey: "   " })).toThrow();
  });

  it("healthCheck returns false for invalid key", async () => {
    const provider = new CodexProvider({
      apiKey: "sk-invalid-key-for-health-check-test",
      timeout: 5000,
    });
    const healthy = await provider.healthCheck();
    expect(healthy).toBe(false);
  });

  it("estimateCost calculates correctly for gpt-4o", () => {
    const provider = new CodexProvider({ apiKey: "sk-test" });
    const cost = provider.estimateCost(1000, 500);
    // gpt-4o: 1000/1M * $2.5 + 500/1M * $10 = $0.0025 + $0.005 = $0.0075
    expect(cost).toBeCloseTo(0.0075, 4);
  });

  it("estimateCost calculates correctly for o4-mini", () => {
    const provider = new CodexProvider({ apiKey: "sk-test", model: "o4-mini" });
    const cost = provider.estimateCost(1000, 500);
    // o4-mini: 1000/1M * $1 + 500/1M * $4 = $0.001 + $0.002 = $0.003
    expect(cost).toBeCloseTo(0.003, 4);
  });
});

describe("DEFAULT_TOOLS", () => {
  it("has 4 default tools", () => {
    expect(DEFAULT_TOOLS).toHaveLength(4);
    const names = DEFAULT_TOOLS.map((t) => t.name);
    expect(names).toContain("Read");
    expect(names).toContain("Write");
    expect(names).toContain("Bash");
    expect(names).toContain("WebSearch");
  });

  it("all tools have required fields", () => {
    for (const tool of DEFAULT_TOOLS) {
      expect(tool.type).toBe("function");
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
    }
  });
});

describe("ExecutionSandbox", () => {
  it("creates sandbox with defaults", () => {
    const sandbox = new ExecutionSandbox();
    expect(sandbox).toBeDefined();
  });

  it("creates sandbox with custom config", () => {
    const sandbox = new ExecutionSandbox({
      timeout: 10000,
      memoryLimitMB: 256,
      cwd: "/tmp",
      env: { TEST: "1" },
    });
    expect(sandbox).toBeDefined();
  });

  it("executes echo command", async () => {
    const sandbox = new ExecutionSandbox({ timeout: 5000 });
    const result = await sandbox.execute("echo 'hello world'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it("captures stderr", async () => {
    const sandbox = new ExecutionSandbox({ timeout: 5000 });
    const result = await sandbox.execute("echo 'error' >&2");
    expect(result.stderr.trim()).toBe("error");
  });

  it("handles non-zero exit code", async () => {
    const sandbox = new ExecutionSandbox({ timeout: 5000 });
    const result = await sandbox.execute("exit 42");
    expect(result.exitCode).toBe(42);
  });

  it("executeCode runs python", async () => {
    const sandbox = new ExecutionSandbox({ timeout: 5000 });
    const result = await sandbox.executeCode("print(2 + 2)", "python");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("4");
  });

  it("executeCode runs javascript", async () => {
    const sandbox = new ExecutionSandbox({ timeout: 5000 });
    const result = await sandbox.executeCode("console.log(2 + 2)", "javascript");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("4");
  });

  it("respects timeout", async () => {
    const sandbox = new ExecutionSandbox({ timeout: 500 });
    const result = await sandbox.execute("sleep 5");
    expect(result.exitCode).toBe(-1);
    expect(result.durationMs).toBeGreaterThan(400);
  }, { timeout: 10000 });
});
