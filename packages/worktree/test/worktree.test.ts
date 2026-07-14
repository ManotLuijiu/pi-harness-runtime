/**
 * Worktree Manager Tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { WorktreeManager } from "../src/worktree.js";

// Mock Node.js modules at module level
const mockExecSync = vi.fn().mockReturnValue("/mocked/path/worktrees/test-wt");
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn().mockReturnValue("[]");

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
}));

describe("WorktreeManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue("/mocked/path/worktrees/test-wt");
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("[]");
  });

  describe("constructor", () => {
    it("creates instance with rootDir", () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo", baseBranch: "main" });
      expect(manager).toBeDefined();
    });
  });

  describe("create", () => {
    it("creates a worktree with name", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo", baseBranch: "main" });
      const result = await manager.create({ name: "test-wt" });
      expect(result.name).toBe("test-wt");
      expect(result.branch).toBe("worktree/test-wt");
      expect(result.status).toBe("active");
    });

    it("sanitizes name", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      const result = await manager.create({ name: "my worktree!" });
      expect(result.name).toBe("my-worktree-");
    });

    it("uses custom branch if provided", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      const result = await manager.create({ name: "my-wt", branch: "feature/my-branch" });
      expect(result.branch).toBe("feature/my-branch");
    });

    it("stores jobId and taskId", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      const result = await manager.create({
        name: "job-wt",
        jobId: "job-123",
        taskId: "task-456",
      });
      expect(result.jobId).toBe("job-123");
      expect(result.taskId).toBe("task-456");
    });

    it("sets createdAt timestamp", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      const before = Date.now();
      const result = await manager.create({ name: "time-wt" });
      const after = Date.now();
      const created = Date.parse(result.createdAt);
      expect(created >= before && created <= after).toBe(true);
    });
  });

  describe("list", () => {
    it("returns empty array when no worktrees", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      const result = await manager.list();
      expect(result).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns null for unknown worktree", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      const result = await manager.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getByJob", () => {
    it("returns null when no worktree for job", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      const result = await manager.getByJob("unknown-job");
      expect(result).toBeNull();
    });
  });

  describe("remove", () => {
    it("throws for unknown worktree", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      await expect(manager.remove("nonexistent")).rejects.toThrow();
    });
  });

  describe("prune", () => {
    it("returns pruned worktrees", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      mockExecSync.mockReturnValue("worktree /mocked/path/worktrees/test-wt");
      const result = await manager.prune();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getUncommitted", () => {
    it("parses numstat output", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      mockExecSync.mockReturnValue("10\t5\tfile.ts\n20\t0\tnew.ts\n");

      const diffs = await manager.getUncommitted("/mocked/path/worktrees/test-wt");
      expect(diffs.length).toBe(2);
      expect(diffs[0].file).toBe("file.ts");
      expect(diffs[0].insertions).toBe(10);
      expect(diffs[0].deletions).toBe(5);
    });
  });

  describe("markMerged", () => {
    it("marks worktree as merged", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      await manager.create({ name: "merge-wt" });
      await manager.markMerged("merge-wt");
      // Should not throw
    });
  });

  describe("metadata persistence", () => {
    it("saves worktree to .worktrees.json", async () => {
      const manager = new WorktreeManager({ rootDir: "/tmp/test-repo" });
      await manager.create({ name: "persist-wt" });
      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });
});
