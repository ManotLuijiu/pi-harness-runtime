/**
 * Tests for the agent-policy package
 */

import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PolicyLoader } from "../src/policy-loader.js";
import { PolicyStore, resetPolicyStore, getPolicyStore } from "../src/policy-store.js";
import { renderSystemContract, parseSections, createCleanEnvelope, createDegradedEnvelope } from "../src/policy-renderer.js";
import { classifyToolCall } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const TEST_DIR = "/tmp/agent-policy-test";

function setupTestDir() {
  rmSync(TEST_DIR, { force: true, recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "src"), { recursive: true });
  mkdirSync(join(TEST_DIR, "packages/test"), { recursive: true });
}

function teardownTestDir() {
  rmSync(TEST_DIR, { force: true, recursive: true });
}

function createTestFile(relativePath: string, content: string) {
  const fullPath = join(TEST_DIR, relativePath);
  writeFileSync(fullPath, content, "utf8");
  return fullPath;
}

// ---------------------------------------------------------------------------
// PolicyLoader Tests
// ---------------------------------------------------------------------------

describe("PolicyLoader", () => {
  let loader: PolicyLoader;
  let harnessPath: string;

  beforeEach(() => {
    setupTestDir();
    harnessPath = createTestFile("AGENTS.md", `# Test Harness Rules

## Mandatory Rules

- Follow these rules
- Always do X

## Advisory

- Consider doing Y
`);
    loader = new PolicyLoader({
      harnessRulesPath: new URL(`file://${harnessPath}`),
    });
  });

  afterEach(() => {
    teardownTestDir();
    loader = undefined as any;
  });

  it("should load harness rules", async () => {
    const manifest = await loader.load(TEST_DIR);
    
    expect(manifest.revision).toBeTruthy();
    expect(manifest.projectRoot).toBe(TEST_DIR);
    expect(manifest.sources.length).toBeGreaterThan(0);
    expect(manifest.coverage).toBe("complete");
    
    // Check mandatory sources
    const mandatory = manifest.sources.filter(s => s.priority === "mandatory");
    expect(mandatory.length).toBeGreaterThan(0);
  });

  it("should compute deterministic revision", async () => {
    const manifest1 = await loader.load(TEST_DIR);
    const manifest2 = await loader.load(TEST_DIR);
    
    expect(manifest1.revision).toBe(manifest2.revision);
  });

  it("should detect rule changes", async () => {
    const manifest1 = await loader.load(TEST_DIR);
    
    // Modify the harness rules
    createTestFile("AGENTS.md", `# Modified Rules

## Changed

- Different content
`);
    
    // Invalidate cache
    loader.invalidateCache(TEST_DIR);
    
    const manifest2 = await loader.load(TEST_DIR);
    
    expect(manifest1.revision).not.toBe(manifest2.revision);
  });

  it("should load project rules when present", async () => {
    createTestFile("RULES.md", `# Project Rules

This is a project rule file.
`);
    
    const manifest = await loader.load(TEST_DIR);
    
    expect(manifest.sources.length).toBeGreaterThanOrEqual(2);
    expect(manifest.trust).toBeTruthy();
  });

  it("should handle degraded coverage on missing files", async () => {
    const emptyLoader = new PolicyLoader({
      harnessRulesPath: new URL("file:///nonexistent/path/AGENTS.md"),
    });
    
    await expect(emptyLoader.load(TEST_DIR)).rejects.toThrow();
  });

  it("should infer scope from target path", async () => {
    const manifest = await loader.loadForTarget(TEST_DIR, join(TEST_DIR, "src/file.ts"));
    
    expect(manifest).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PolicyStore Tests
// ---------------------------------------------------------------------------

describe("PolicyStore", () => {
  let store: PolicyStore;

  beforeEach(() => {
    resetPolicyStore();
    store = getPolicyStore();
  });

  afterEach(() => {
    store.invalidateAll();
  });

  function createTestManifest(revision = "test-rev-1") {
    return {
      revision,
      projectRoot: TEST_DIR,
      trust: "trusted" as const,
      coverage: "complete" as const,
      sources: [{
        path: "/test/AGENTS.md",
        scope: "",
        priority: "mandatory" as const,
        sha256: "abc123",
        bytes: 100,
        harnessOwned: true,
      }],
      loadedAt: Date.now(),
    };
  }

  it("should record and retrieve receipt", () => {
    const manifest = createTestManifest();
    const sessionId = "test-session-1";
    
    const receipt = store.noteDelivered(sessionId, manifest, "system_prompt");
    
    expect(receipt.sessionId).toBe(sessionId);
    expect(receipt.revision).toBe(manifest.revision);
    expect(receipt.deliveryMethod).toBe("system_prompt");
    
    const retrieved = store.getReceipt(sessionId, TEST_DIR);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.revision).toBe(manifest.revision);
  });

  it("should validate receipt against manifest", () => {
    const manifest = createTestManifest();
    const sessionId = "test-session-2";
    
    store.noteDelivered(sessionId, manifest, "system_prompt");
    
    const valid = store.validateReceipt(sessionId, manifest);
    expect(valid.valid).toBe(true);
    
    const wrongManifest = createTestManifest("different-revision");
    const invalid = store.validateReceipt(sessionId, wrongManifest);
    expect(invalid.valid).toBe(false);
    expect(invalid.reason).toContain("does not match");
  });

  it("should check receipt validity", () => {
    const manifest = createTestManifest();
    const sessionId = "test-session-3";
    
    // No receipt yet
    expect(store.hasValidReceipt(sessionId, manifest)).toBe(false);
    
    // Add receipt
    store.noteDelivered(sessionId, manifest, "system_prompt");
    expect(store.hasValidReceipt(sessionId, manifest)).toBe(true);
    
    // Different revision
    const wrongManifest = createTestManifest("other-rev");
    expect(store.hasValidReceipt(sessionId, wrongManifest)).toBe(false);
  });

  it("should invalidate on revision change", () => {
    const manifest1 = createTestManifest("rev-1");
    const manifest2 = createTestManifest("rev-2");
    const sessionId = "test-session-4";
    
    store.noteDelivered(sessionId, manifest1, "system_prompt");
    expect(store.hasValidReceipt(sessionId, manifest1)).toBe(true);
    
    // New revision - old receipt should not cover it
    expect(store.hasValidReceipt(sessionId, manifest2)).toBe(false);
  });

  it("should clear session receipts", () => {
    const manifest = createTestManifest();
    const sessionId = "test-session-5";
    
    store.noteDelivered(sessionId, manifest, "system_prompt");
    expect(store.getReceipt(sessionId, TEST_DIR)).not.toBeNull();
    
    store.clearSession(sessionId);
    expect(store.getReceipt(sessionId, TEST_DIR)).toBeNull();
  });

  it("should track statistics", () => {
    const manifest = createTestManifest();
    
    store.noteDelivered("session-1", manifest, "system_prompt");
    store.noteDelivered("session-2", manifest, "tool");
    
    const stats = store.getStats();
    expect(stats.totalReceipts).toBe(2);
    expect(stats.sessionsTracked).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PolicyRenderer Tests
// ---------------------------------------------------------------------------

describe("PolicyRenderer", () => {
  function createTestManifest() {
    return {
      revision: "abc123",
      projectRoot: TEST_DIR,
      trust: "trusted" as const,
      coverage: "complete" as const,
      sources: [{
        path: "/test/AGENTS.md",
        scope: "",
        priority: "mandatory" as const,
        sha256: "abc123",
        bytes: 100,
        harnessOwned: true,
      }],
      loadedAt: Date.now(),
    };
  }

  it("should render system contract", () => {
    const manifest = createTestManifest();
    const contract = renderSystemContract(manifest);
    
    expect(contract).toContain("PI-HARNESS POLICY");
    expect(contract).toContain(manifest.revision);
    expect(contract).toContain("Mandatory:");
    expect(contract).toContain("harness_rules");
  });

  it("should include coverage in contract", () => {
    const manifest = {
      ...createTestManifest(),
      coverage: "partial" as const,
    };
    
    const contract = renderSystemContract(manifest);
    expect(contract).toContain("coverage=partial");
    expect(contract).toContain("WARNING");
  });

  it("should include trust warning for untrusted projects", () => {
    const manifest = {
      ...createTestManifest(),
      trust: "untrusted" as const,
    };
    
    const contract = renderSystemContract(manifest);
    expect(contract).toContain("not trusted");
  });

  it("should parse markdown sections", () => {
    const content = `# Header 1

Some content here.

## Header 2

More content.
`;
    
    const sections = parseSections(content, "/test/AGENTS.md", "", "mandatory");
    
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe("Header 1");
    expect(sections[0].content).toContain("Some content here");
    expect(sections[1].title).toBe("Header 2");
  });

  it("should create clean envelope", () => {
    const envelope = createCleanEnvelope();
    
    expect(envelope.verdict).toBe("clean");
    expect(envelope.findings).toHaveLength(0);
    expect(envelope.nextAction).toBe("continue");
  });

  it("should create degraded envelope", () => {
    const envelope = createDegradedEnvelope("LSP timeout");
    
    expect(envelope.verdict).toBe("degraded");
    expect(envelope.summary).toContain("LSP timeout");
    expect(envelope.nextAction).toBe("run_full");
  });
});

// ---------------------------------------------------------------------------
// Tool Classification Tests
// ---------------------------------------------------------------------------

describe("Tool Classifier", () => {
  it("should classify write as mutating", () => {
    const cap = classifyToolCall("write", { path: "/test/file.ts", content: "" });
    expect(cap.mutatesProject).toBe(true);
    expect(cap.releasesProject).toBe(false);
    expect(cap.confidence).toBe("high");
  });

  it("should classify edit as mutating", () => {
    const cap = classifyToolCall("edit", { path: "/test/file.ts" });
    expect(cap.mutatesProject).toBe(true);
  });

  it("should classify read as non-mutating", () => {
    const cap = classifyToolCall("read", { path: "/test/file.ts" });
    expect(cap.mutatesProject).toBe(false);
    expect(cap.releasesProject).toBe(false);
  });

  it("should classify bash git commands as releasing", () => {
    const cap = classifyToolCall("bash", { command: "git commit -m 'test'" });
    expect(cap.mutatesProject).toBe(true);
    expect(cap.releasesProject).toBe(true);
  });

  it("should classify subagent as child delegation", () => {
    const cap = classifyToolCall("subagent", { agent: "test", task: "do something" });
    expect(cap.isChildDelegation).toBe(true);
    expect(cap.mutatesProject).toBe(true);
  });

  it("should classify harness_rules as non-mutating", () => {
    const cap = classifyToolCall("harness_rules", { action: "manifest" });
    expect(cap.mutatesProject).toBe(false);
    expect(cap.releasesProject).toBe(false);
  });

  it("should conservatively classify unknown tools", () => {
    const cap = classifyToolCall("unknown_tool", {});
    expect(cap.mutatesProject).toBe(true); // Conservative
    expect(cap.confidence).toBe("low");
  });
});
