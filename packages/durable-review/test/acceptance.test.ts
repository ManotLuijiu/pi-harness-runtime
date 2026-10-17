/**
 * Durable Review Acceptance Tests
 *
 * Tests per wiki/pi-durable-reviewer-minimax-plan.md acceptance criteria.
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, rmdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateAndHashRequest, hashWorkspaceKey, getWorkspaceDir } from "../dist/service.js";
import { validateReviewRequest } from "../dist/types.js";
import {
  tryAcquireOwnership,
  releaseOwnership,
  startWorker,
  stopWorker,
  checkWorkerReady,
} from "../dist/worker.js";
import { handleReviewRequest, cancelJob, getJobStatus } from "../dist/worker.js";

// Test workspace path
const TEST_WORKSPACE = "/tmp/durable-review-test-" + Date.now();
const TEST_DB_DIR = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "durable");

describe("Acceptance Tests", () => {
  // Setup
  before(() => {
    mkdirSync(TEST_WORKSPACE, { recursive: true });
  });

  after(() => {
    // Cleanup test workspace
    try {
      const workspaceKey = hashWorkspaceKey(TEST_WORKSPACE);
      const testDir = getWorkspaceDir(workspaceKey);
      const lockPath = join(testDir, ".worker.lock");
      if (existsSync(lockPath)) unlinkSync(lockPath);
    } catch {
      // ignore cleanup errors
    }
  });

  // --- Feature Disabled ---
  describe("Feature disabled", () => {
    it("validateReviewRequest works without HARNESS_DURABLE_REVIEW flag", () => {
      const request = {
        requestId: "test-1",
        input: { workspacePath: TEST_WORKSPACE },
      };
      const validation = validateReviewRequest(request);
      assert.strictEqual(validation.valid, true);
    });
  });

  // --- Duplicate Admission ---
  describe("Duplicate admission", () => {
    it("same request returns same input hash", () => {
      const request1 = {
        requestId: "test-dup",
        input: { workspacePath: TEST_WORKSPACE, diff: "test diff" },
      };
      const request2 = {
        requestId: "test-dup",
        input: { workspacePath: TEST_WORKSPACE, diff: "test diff" },
      };

      const val1 = validateAndHashRequest(request1);
      const val2 = validateAndHashRequest(request2);

      assert.strictEqual(val1.valid, true);
      assert.strictEqual(val2.valid, true);
      assert.strictEqual(val1.inputHash, val2.inputHash);
    });

    it("different input returns different hash", () => {
      const request1 = {
        requestId: "test-1",
        input: { workspacePath: TEST_WORKSPACE, diff: "diff 1" },
      };
      const request2 = {
        requestId: "test-2",
        input: { workspacePath: TEST_WORKSPACE, diff: "diff 2" },
      };

      const val1 = validateAndHashRequest(request1);
      const val2 = validateAndHashRequest(request2);

      assert.strictEqual(val1.valid, true);
      assert.strictEqual(val2.valid, true);
      assert.notStrictEqual(val1.inputHash, val2.inputHash);
    });
  });

  // --- Ownership ---
  describe("Ownership race", () => {
    it("first worker acquires ownership", async () => {
      const workspaceKey = hashWorkspaceKey(TEST_WORKSPACE);
      const workerId1 = "worker-1-" + randomUUID().slice(0, 8);

      const result = await tryAcquireOwnership(workspaceKey, workerId1);
      assert.strictEqual(result.acquired, true);

      // Cleanup
      await releaseOwnership(workspaceKey, workerId1);
    });

    it("second worker cannot acquire if first holds lock", async () => {
      const workspaceKey = hashWorkspaceKey(TEST_WORKSPACE);
      const workerId1 = "worker-1-" + randomUUID().slice(0, 8);
      const workerId2 = "worker-2-" + randomUUID().slice(0, 8);

      // First acquires
      const result1 = await tryAcquireOwnership(workspaceKey, workerId1);
      assert.strictEqual(result1.acquired, true);

      // Second should fail
      const result2 = await tryAcquireOwnership(workspaceKey, workerId2);
      assert.strictEqual(result2.acquired, false);
      assert.ok(result2.existingOwner);

      // Cleanup
      await releaseOwnership(workspaceKey, workerId1);
    });

    it("stale owner is recoverable", async () => {
      const workspaceKey = hashWorkspaceKey(TEST_WORKSPACE);
      const workerId1 = "stale-worker-" + randomUUID().slice(0, 8);
      const workerId2 = "new-worker-" + randomUUID().slice(0, 8);

      // First acquires
      const result1 = await tryAcquireOwnership(workspaceKey, workerId1);
      assert.strictEqual(result1.acquired, true);

      // Simulate stale lock by directly writing old timestamp
      const lockPath = join(getWorkspaceDir(workspaceKey), ".worker.lock");
      const staleLock = {
        workerId: workerId1,
        pid: 99999,
        startedAt: Date.now() - 120_000, // 2 minutes ago
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      // New worker should be able to acquire
      const result2 = await tryAcquireOwnership(workspaceKey, workerId2);
      assert.strictEqual(result2.acquired, true);

      // Cleanup
      await releaseOwnership(workspaceKey, workerId2);
    });
  });

  // --- Worker Lifecycle ---
  describe("Worker lifecycle", () => {
    it("startWorker succeeds", async () => {
      const result = await startWorker(TEST_WORKSPACE);
      assert.strictEqual(result.success, true);
      assert.ok(result.workerId);
      assert.ok(result.workspaceKey);
    });

    it("checkWorkerReady returns ready", async () => {
      const ready = await checkWorkerReady();
      assert.strictEqual(ready.ready, true);
      assert.ok(ready.workerId);
    });

    it("stopWorker succeeds", async () => {
      await stopWorker();
      const ready = await checkWorkerReady();
      assert.strictEqual(ready.ready, false);
    });
  });

  // --- Request Handling ---
  describe("Request handling", () => {
    before(async () => {
      await startWorker(TEST_WORKSPACE);
    });

    after(async () => {
      await stopWorker();
    });

    it("handleReviewRequest creates job", async () => {
      const request = {
        requestId: "test-review-" + randomUUID().slice(0, 8),
        input: { workspacePath: TEST_WORKSPACE },
      };

      const result = await handleReviewRequest(request);
      assert.ok(result.jobId);
      assert.strictEqual(result.status.status, "queued");
    });

    it("handleReviewRequest rejects invalid request", async () => {
      const invalidRequest = {
        requestId: "",
        input: { workspacePath: TEST_WORKSPACE },
      };

      await assert.rejects(
        async () => handleReviewRequest(invalidRequest as any),
        /requestId is required/
      );
    });

    it("getJobStatus returns null for unknown job", async () => {
      const status = await getJobStatus("unknown-job-id");
      assert.strictEqual(status, null);
    });

    it("cancelJob returns false for unknown job", async () => {
      const cancelled = await cancelJob("unknown-job-id");
      assert.strictEqual(cancelled, false);
    });
  });

  // --- Input Stability ---
  describe("Input stability", () => {
    it("validateAndHashRequest produces stable hash", () => {
      const request = {
        requestId: "test-hash",
        input: { workspacePath: TEST_WORKSPACE, diff: "stable diff content" },
      };

      const result1 = validateAndHashRequest(request);
      const result2 = validateAndHashRequest(request);

      assert.strictEqual(result1.inputHash, result2.inputHash);
    });

    it("different content produces different hash", () => {
      const request1 = {
        requestId: "test",
        input: { workspacePath: TEST_WORKSPACE, diff: "content A" },
      };
      const request2 = {
        requestId: "test",
        input: { workspacePath: TEST_WORKSPACE, diff: "content B" },
      };

      const result1 = validateAndHashRequest(request1);
      const result2 = validateAndHashRequest(request2);

      assert.notStrictEqual(result1.inputHash, result2.inputHash);
    });
  });

  // --- Workspace Path ---
  describe("Workspace path handling", () => {
    it("hashWorkspaceKey produces consistent hash", () => {
      const hash1 = hashWorkspaceKey("/some/path");
      const hash2 = hashWorkspaceKey("/some/path");
      assert.strictEqual(hash1, hash2);
    });

    it("different paths produce different hashes", () => {
      const hash1 = hashWorkspaceKey("/path/a");
      const hash2 = hashWorkspaceKey("/path/b");
      assert.notStrictEqual(hash1, hash2);
    });

    it("getWorkspaceDir creates directory", () => {
      const workspaceKey = hashWorkspaceKey(TEST_WORKSPACE);
      const dir = getWorkspaceDir(workspaceKey);
      assert.ok(existsSync(dir));
    });
  });

  // --- Validation ---
  describe("Request validation", () => {
    it("rejects missing requestId", () => {
      const result = validateReviewRequest({
        requestId: "",
        input: { workspacePath: TEST_WORKSPACE },
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes("requestId"));
    });

    it("rejects missing workspacePath", () => {
      const result = validateReviewRequest({
        requestId: "test",
        input: { workspacePath: "" },
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes("workspacePath"));
    });

    it("accepts valid request", () => {
      const result = validateReviewRequest({
        requestId: "test",
        input: { workspacePath: TEST_WORKSPACE },
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.request);
    });

    it("applies default maxPasses and maxToolCalls", () => {
      const result = validateReviewRequest({
        requestId: "test",
        input: { workspacePath: TEST_WORKSPACE },
      });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.request?.maxPasses, 5);
      assert.strictEqual(result.request?.maxToolCalls, 100);
    });

    it("respects provided maxPasses and maxToolCalls", () => {
      const result = validateReviewRequest({
        requestId: "test",
        input: { workspacePath: TEST_WORKSPACE },
        maxPasses: 10,
        maxToolCalls: 200,
      });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.request?.maxPasses, 10);
      assert.strictEqual(result.request?.maxToolCalls, 200);
    });
  });

  // --- Storage Failure ---
  describe("Storage failure handling", () => {
    it("validateAndHashRequest handles missing workspace path gracefully", () => {
      const result = validateAndHashRequest({
        requestId: "test",
        input: { workspacePath: "/nonexistent/path/that/cannot/exist" },
      });
      assert.strictEqual(result.valid, true); // Validation passes, hash is computed
      assert.ok(result.workspaceKey);
    });
  });
});
