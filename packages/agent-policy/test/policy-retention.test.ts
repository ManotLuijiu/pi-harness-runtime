/**
 * Policy Retention Tests
 *
 * Tests for lifecycle retention after compaction, reset, resume.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PolicyManifest } from "../dist/types.js";
import { PolicyLoader } from "../dist/policy-loader.js";
import { getPolicyStore, resetPolicyStore } from "../dist/policy-store.js";

// Test workspace
const TEST_DIR = "/tmp/policy-retention-test-" + Date.now();
const AGENTS_MD = join(TEST_DIR, "AGENTS.md");
const RULES_MD = join(TEST_DIR, "RULES.md");

describe("Policy Retention Tests", () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    resetPolicyStore();
  });

  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    resetPolicyStore();
  });

  // --- Session Epoch Tests ---
  describe("Session epochs", () => {
    it("should track session epochs separately", async () => {
      const store = getPolicyStore();
      const session1 = "session-1-" + randomUUID().slice(0, 8);
      const session2 = "session-2-" + randomUUID().slice(0, 8);

      // Create a manifest
      const manifest: PolicyManifest = {
        revision: "abc123",
        projectRoot: TEST_DIR,
        trust: "unknown",
        coverage: "complete",
        sources: [],
        loadedAt: Date.now(),
      };

      // Note delivery for session 1
      const receipt1 = store.noteDelivered(session1, manifest, "system_prompt");
      assert.strictEqual(receipt1.sessionId, session1);

      // Session 2 should NOT have a receipt
      const receipt2 = store.getReceipt(session2, TEST_DIR);
      assert.strictEqual(receipt2, null);
    });

    it("should not leak receipts between sessions after reset", async () => {
      const store = getPolicyStore();
      const sessionId = "session-reset-" + randomUUID().slice(0, 8);

      const manifest: PolicyManifest = {
        revision: "abc123",
        projectRoot: TEST_DIR,
        trust: "unknown",
        coverage: "complete",
        sources: [],
        loadedAt: Date.now(),
      };

      // Deliver to session
      store.noteDelivered(sessionId, manifest, "system_prompt");

      // Clear session
      store.clearSession(sessionId);

      // Receipt should be gone
      const receipt = store.getReceipt(sessionId, TEST_DIR);
      assert.strictEqual(receipt, null);
    });
  });

  // --- Source Change Tests ---
  describe("Source changes", () => {
    it("should invalidate receipts when AGENTS.md changes", async () => {
      const store = getPolicyStore();
      const sessionId = "session-change-" + randomUUID().slice(0, 8);

      // Write initial content
      writeFileSync(AGENTS_MD, "# Original Agents\n\nFollow the rules.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      // Load and deliver
      const manifest1 = await loader.load(TEST_DIR);
      store.noteDelivered(sessionId, manifest1, "system_prompt");

      // Modify file
      writeFileSync(AGENTS_MD, "# Updated Agents\n\nDifferent rules.", "utf8");

      // Invalidate cache
      loader.invalidateCache(TEST_DIR);

      // Load new manifest
      const manifest2 = await loader.load(TEST_DIR);

      // Revision should be different
      assert.notStrictEqual(manifest1.revision, manifest2.revision);

      // Old receipt should NOT cover new manifest
      const hasCoverage = store.hasValidReceipt(sessionId, manifest2);
      assert.strictEqual(hasCoverage, false);
    });

    it("should include RULES.md in sources", async () => {
      // Write RULES.md
      writeFileSync(RULES_MD, "# Rules\n\nThese are rules.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);

      // RULES.md should be included as advisory at minimum
      const rulesSource = manifest.sources.find(s => s.path.includes("RULES.md"));
      assert.ok(rulesSource, "RULES.md should be included in sources");

      // Clean up
      unlinkSync(RULES_MD);
    });
  });

  // --- Bounded Delivery Tests ---
  describe("Bounded delivery", () => {
    it("should track exact revision and source coverage", async () => {
      const store = getPolicyStore();
      const sessionId = "session-exact-" + randomUUID().slice(0, 8);

      writeFileSync(AGENTS_MD, "# Agents\n\nContent.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);

      // Note delivery with specific sections
      const receipt = store.noteDelivered(sessionId, manifest, "tool", ["section-1"]);

      assert.strictEqual(receipt.revision, manifest.revision);
      assert.deepStrictEqual(receipt.sectionsDelivered, ["section-1"]);
    });

    it("should reject acknowledgement of wrong revision", async () => {
      const store = getPolicyStore();
      const sessionId = "session-wrong-rev-" + randomUUID().slice(0, 8);

      writeFileSync(AGENTS_MD, "# Agents v1\n\nContent.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest1 = await loader.load(TEST_DIR);
      store.noteDelivered(sessionId, manifest1, "system_prompt");

      // Update content
      writeFileSync(AGENTS_MD, "# Agents v2\n\nDifferent content.", "utf8");
      loader.invalidateCache(TEST_DIR);
      const manifest2 = await loader.load(TEST_DIR);

      // Old receipt should NOT cover new manifest
      const hasCoverage = store.hasValidReceipt(sessionId, manifest2);
      assert.strictEqual(hasCoverage, false);
    });
  });

  // --- Trust Evaluation Tests ---
  describe("Trust evaluation", () => {
    it("should evaluate trust appropriately", async () => {
      // Create a .git directory (indicates repository)
      mkdirSync(join(TEST_DIR, ".git"), { recursive: true });

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);

      // Trust should be evaluated
      assert.ok(["trusted", "untrusted", "unknown"].includes(manifest.trust));

      // Clean up
      rmSync(join(TEST_DIR, ".git"), { recursive: true, force: true });
    });
  });

  // --- Compaction Recovery Tests ---
  describe("Compaction recovery", () => {
    it("should invalidate receipts on session_compact event", async () => {
      const store = getPolicyStore();
      const sessionId = "session-compact-" + randomUUID().slice(0, 8);

      writeFileSync(AGENTS_MD, "# Agents\n\nContent.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);
      store.noteDelivered(sessionId, manifest, "system_prompt");

      // Simulate compaction: invalidate all
      store.invalidateAll();

      // Receipt should be gone
      const receipt = store.getReceipt(sessionId, TEST_DIR);
      assert.strictEqual(receipt, null);
    });
  });

  // --- Nested Scope Tests ---
  describe("Nested scope resolution", () => {
    it("should load scoped rules for subdirectories", async () => {
      // Create nested structure
      mkdirSync(join(TEST_DIR, "packages", "my-pkg"), { recursive: true });
      writeFileSync(AGENTS_MD, "# Root Agents\n\nRoot rules.", "utf8");
      writeFileSync(join(TEST_DIR, "packages", "AGENTS.md"), "# Package Agents\n\nPackage rules.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);

      // Should have both root and package rules
      assert.ok(manifest.sources.length >= 2, "Should include both root and package rules");

      // Clean up nested structure
      rmSync(join(TEST_DIR, "packages"), { recursive: true, force: true });
    });
  });

  // --- Delivery Deduplication Tests ---
  describe("Delivery deduplication", () => {
    it("should not create duplicate receipts in same session", async () => {
      const store = getPolicyStore();
      const sessionId = "session-dedup-" + randomUUID().slice(0, 8);

      writeFileSync(AGENTS_MD, "# Agents\n\nContent.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);

      // First delivery
      const receipt1 = store.noteDelivered(sessionId, manifest, "system_prompt");

      // Second delivery should update, not create duplicate
      const receipt2 = store.noteDelivered(sessionId, manifest, "system_prompt");

      // Should be same session
      assert.strictEqual(receipt1.sessionId, receipt2.sessionId);

      // Should have same revision
      assert.strictEqual(receipt1.revision, receipt2.revision);
    });
  });

  // --- Partial Read Tracking Tests ---
  describe("Partial read tracking", () => {
    it("should track which sections were actually delivered", async () => {
      const store = getPolicyStore();
      const sessionId = "session-partial-" + randomUUID().slice(0, 8);

      writeFileSync(AGENTS_MD, "# Agents\n\n## Section 1\n\nContent 1.\n\n## Section 2\n\nContent 2.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);

      // Note partial delivery (only section 1)
      const receipt = store.noteDelivered(sessionId, manifest, "tool", ["section-1"]);
      assert.deepStrictEqual(receipt.sectionsDelivered, ["section-1"]);
    });
  });

  // --- Full Policy Text Delivery Tests ---
  describe("Full policy text delivery", () => {
    it("should compute full policy text after revision change", async () => {
      writeFileSync(AGENTS_MD, "# Full Agents\n\n## Rule 1\n\nContent 1.\n\n## Rule 2\n\nContent 2.", "utf8");

      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);

      // Full text should include actual content, not just contract pointers
      const { renderFullPolicyText } = await import("../dist/index.js");
      const fullText = renderFullPolicyText(manifest);

      assert.ok(fullText.includes("Full Agents"), "Should include source title");
      assert.ok(fullText.includes("Rule 1"), "Should include section heading");
      assert.ok(fullText.includes("Content 1"), "Should include actual content");
      assert.ok(fullText.includes("revision="), "Should include revision info");
    });

    it("should detect when full policy exceeds size limit", async () => {
      const loader = new PolicyLoader({
        harnessRulesPath: new URL(`file://${AGENTS_MD}`),
      });

      const manifest = await loader.load(TEST_DIR);
      const { checkPolicyTextSize } = await import("../dist/index.js");

      // With normal-sized content, should fit in 100KB limit
      const result = checkPolicyTextSize(manifest, 100 * 1024);
      assert.strictEqual(result.fits, true, "Normal policy should fit in 100KB");

      // With very small limit, should report overflow
      const smallResult = checkPolicyTextSize(manifest, 10);
      assert.strictEqual(smallResult.fits, false, "Should report when limit is too small");
      assert.ok(smallResult.reason?.includes("exceeds limit"), "Should explain overflow");
    });
  });
});
