/**
 * E2E Test Suite: Honcho CLI
 * 
 * Tests the honcho CLI commands used by pi-harness-runtime.
 * 
 * Usage:
 *   PI_HARNESS_E2E=1 bun test e2e/honcho/cli.test.ts
 *
 * These tests talk to the real Honcho CLI, so they are opt-in.
 */

import { describe, it, beforeAll, afterAll, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// Real Honcho CLI calls: opt-in via PI_HARNESS_E2E=1.
const describeE2E = process.env.PI_HARNESS_E2E === "1" ? describe : describe.skip;

// Test configuration
const TEST_WORKSPACE_PREFIX = "pi-harness-test";
const API_KEY_FILE = join(homedir(), ".pi-harness-runtime", "keys", "honcho-api-key.txt");

interface TestContext {
  apiKey: string;
  testWorkspaces: string[];
}

function getApiKey(): string {
  const envKey = process.env.HONCHO_API_KEY;
  if (envKey) return envKey;
  
  if (existsSync(API_KEY_FILE)) {
    return readFileSync(API_KEY_FILE, "utf-8").trim();
  }
  
  throw new Error("No Honcho API key found. Set HONCHO_API_KEY env var or create " + API_KEY_FILE);
}

function execHoncho(args: string[]): string {
  const fullEnv = {
    ...process.env,
    HONCHO_API_KEY: getApiKey(),
  };
  return execSync(`honcho ${args.join(" ")}`, { 
    env: fullEnv as NodeJS.ProcessEnv,
    encoding: "utf-8",
  });
}

describeE2E("Honcho CLI E2E Tests", () => {
  let ctx: TestContext;
  
  beforeAll(() => {
    ctx = {
      apiKey: getApiKey(),
      testWorkspaces: [],
    };
    console.log("\n[Test Setup] API key loaded");
  });
  
  afterAll(() => {
    console.log("\n[Cleanup] Test workspaces created:", ctx.testWorkspaces.length);
    console.log("  (Manual cleanup needed: honcho workspace delete <name>)");
  });
  
  describe("workspace management", () => {
    it("should list existing workspaces", () => {
      const output = execHoncho(["workspace", "list", "--json"]);
      const workspaces = JSON.parse(output);
      
      expect(Array.isArray(workspaces)).toBe(true);
      
      const workspaceIds = workspaces.map((w: { id: string }) => w.id);
      console.log("  Existing workspaces:", workspaceIds);
      expect(workspaceIds).toContain("pi-harness");
    });
    
    it("should create a new workspace with metadata", () => {
      const testWorkspace = `${TEST_WORKSPACE_PREFIX}-${Date.now()}`;
      ctx.testWorkspaces.push(testWorkspace);
      
      // Create with metadata
      const metadata = JSON.stringify({ purpose: "pi-harness E2E test", version: "1.0.0" });
      const output = execHoncho(["workspace", "create", testWorkspace, "--json", "--metadata", metadata]);
      const result = JSON.parse(output);
      
      expect(result).toHaveProperty("workspace_id");
      expect(result.workspace_id).toBe(testWorkspace);
      console.log(`  Created: ${result.workspace_id}`);
    });
    
    it("should create workspace idempotently", () => {
      const testWorkspace = `${TEST_WORKSPACE_PREFIX}-idem-${Date.now()}`;
      ctx.testWorkspaces.push(testWorkspace);
      
      const result1 = JSON.parse(execHoncho(["workspace", "create", testWorkspace, "--json"]));
      const result2 = JSON.parse(execHoncho(["workspace", "create", testWorkspace, "--json"]));
      
      expect(result1.workspace_id).toBe(result2.workspace_id);
      expect(result1.workspace_id).toBe(testWorkspace);
    });
  });
  
  describe("error handling", () => {
    it("should fail without API key", () => {
      expect(() => {
        execSync("HONCHO_API_KEY= honcho workspace list", { 
          env: { ...process.env, HONCHO_API_KEY: "" } as NodeJS.ProcessEnv,
          encoding: "utf-8",
        });
      }).toThrow();
    });
  });
});
