/**
 * Delegation Assessment Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  shouldTriggerAssessment,
  DEFAULT_DELEGATION_TRIGGERS,
  type ScopeFacts,
  type DelegationTriggerConfig,
  type DelegationStrategy,
  type WorkGroup,
} from "../src/delegation.js";
import {
  partitionWork,
  detectOwnershipConflicts,
  getUnownedFiles,
  updateGroupStatus,
  areAllGroupsComplete,
  DEFAULT_PARTITION_CONFIG,
} from "../src/work-partitioner.js";

describe("Delegation Triggers", () => {
  it("should trigger on 10+ files", () => {
    const facts: ScopeFacts = {
      estimatedFiles: 15,
      observedFiles: 15,
      estimatedCallSites: 20,
      observedCallSites: 20,
      independentComponents: 1,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: {},
      fingerprint: "",
    };

    expect(shouldTriggerAssessment(facts)).toBe(true);
  });

  it("should trigger on 50+ call sites", () => {
    const facts: ScopeFacts = {
      estimatedFiles: 5,
      observedFiles: 5,
      estimatedCallSites: 60,
      observedCallSites: 60,
      independentComponents: 1,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: {},
      fingerprint: "",
    };

    expect(shouldTriggerAssessment(facts)).toBe(true);
  });

  it("should trigger on 2+ independent components", () => {
    const facts: ScopeFacts = {
      estimatedFiles: 5,
      observedFiles: 5,
      estimatedCallSites: 10,
      observedCallSites: 10,
      independentComponents: 3,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: {},
      fingerprint: "",
    };

    expect(shouldTriggerAssessment(facts)).toBe(true);
  });

  it("should not trigger on small scope", () => {
    const facts: ScopeFacts = {
      estimatedFiles: 3,
      observedFiles: 3,
      estimatedCallSites: 5,
      observedCallSites: 5,
      independentComponents: 1,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: {},
      fingerprint: "",
    };

    expect(shouldTriggerAssessment(facts)).toBe(false);
  });

  it("should respect custom config", () => {
    const facts: ScopeFacts = {
      estimatedFiles: 5,
      observedFiles: 5,
      estimatedCallSites: 10,
      observedCallSites: 10,
      independentComponents: 1,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: {},
      fingerprint: "",
    };

    const customConfig: DelegationTriggerConfig = {
      minFiles: 5,
      minCallSites: 10,
      minIndependentComponents: 1,
      assessOnDiscovery: true,
    };

    expect(shouldTriggerAssessment(facts, customConfig)).toBe(true);
  });
});

describe("Work Partitioning", () => {
  it("should partition files by directory", () => {
    const files = [
      "src/components/Button.ts",
      "src/components/Modal.ts",
      "src/utils/helper.ts",
      "src/utils/format.ts",
    ];

    const facts: ScopeFacts = {
      estimatedFiles: 4,
      observedFiles: 4,
      estimatedCallSites: 10,
      observedCallSites: 10,
      independentComponents: 2,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: { ".ts": 4 },
      fingerprint: "",
    };

    const groups = partitionWork(files, facts);

    expect(groups.length).toBe(2);
    expect(groups.some((g) => g.description.includes("components"))).toBe(true);
    expect(groups.some((g) => g.description.includes("utils"))).toBe(true);
  });

  it("should limit files per group", () => {
    const files = Array.from({ length: 40 }, (_, i) => `src/dir${i % 3}/file${i}.ts`);

    const facts: ScopeFacts = {
      estimatedFiles: 40,
      observedFiles: 40,
      estimatedCallSites: 100,
      observedCallSites: 100,
      independentComponents: 3,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: { ".ts": 40 },
      fingerprint: "",
    };

    const groups = partitionWork(files, facts);

    // Should have multiple groups (max 15 files per group for 40 files = 3 groups)
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const group of groups) {
      expect(group.ownedPaths.length).toBeLessThanOrEqual(
        DEFAULT_PARTITION_CONFIG.maxFilesPerGroup + 5 // Allow small overflow
      );
    }
  });

  it("should exclude shared paths", () => {
    const files = [
      "index.ts",
      "src/main.ts",
      "src/index.ts",
      "src/components/Button.ts",
    ];

    const facts: ScopeFacts = {
      estimatedFiles: 4,
      observedFiles: 4,
      estimatedCallSites: 10,
      observedCallSites: 10,
      independentComponents: 1,
      tightlyCoupled: false,
      isMechanical: false,
      isComplex: false,
      fileTypes: { ".ts": 4 },
      fingerprint: "",
    };

    const groups = partitionWork(files, facts);

    // All groups combined should not include shared paths
    const allOwned = groups.flatMap((g) => g.ownedPaths);
    expect(allOwned).not.toContain("index.ts");
    expect(allOwned).not.toContain("main.ts");
  });
});

describe("Ownership Conflicts", () => {
  it("should detect conflicts", () => {
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "components",
        ownedPaths: ["src/components/Button.ts"],
        isMechanical: false,
        status: "pending",
      },
    ];

    const conflicts = detectOwnershipConflicts(groups, ["src/components/Button.ts"]);

    expect(conflicts.length).toBe(1);
    expect(conflicts[0]).toContain("already owned");
  });

  it("should detect conflict with completed groups (already owned)", () => {
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "components",
        ownedPaths: ["src/components/Button.ts"],
        isMechanical: false,
        status: "completed",
      },
    ];

    // Completed groups still own files - conflict should be detected
    const conflicts = detectOwnershipConflicts(groups, ["src/components/Button.ts"]);

    expect(conflicts.length).toBe(1);
  });

  it("should not conflict with cancelled groups", () => {
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "components",
        ownedPaths: ["src/components/Button.ts"],
        isMechanical: false,
        status: "cancelled",
      },
    ];

    const conflicts = detectOwnershipConflicts(groups, ["src/components/Button.ts"]);

    expect(conflicts.length).toBe(0);
  });
});

describe("Group Status Updates", () => {
  it("should update group status", () => {
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "test",
        ownedPaths: ["file.ts"],
        isMechanical: false,
        status: "pending",
      },
    ];

    const updated = updateGroupStatus(groups, "group-1", "dispatched", "child-123");

    expect(updated[0].status).toBe("dispatched");
    expect(updated[0].childId).toBe("child-123");
  });

  it("should check completion", () => {
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "test1",
        ownedPaths: ["file1.ts"],
        isMechanical: false,
        status: "completed",
      },
      {
        groupId: "group-2",
        description: "test2",
        ownedPaths: ["file2.ts"],
        isMechanical: false,
        status: "completed",
      },
    ];

    expect(areAllGroupsComplete(groups)).toBe(true);
  });

  it("should not report complete with pending", () => {
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "test1",
        ownedPaths: ["file1.ts"],
        isMechanical: false,
        status: "completed",
      },
      {
        groupId: "group-2",
        description: "test2",
        ownedPaths: ["file2.ts"],
        isMechanical: false,
        status: "pending",
      },
    ];

    expect(areAllGroupsComplete(groups)).toBe(false);
  });
});

describe("Unowned Files", () => {
  it("should identify unowned files", () => {
    const allFiles = ["file1.ts", "file2.ts", "file3.ts"];
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "test",
        ownedPaths: ["file1.ts", "file2.ts"],
        isMechanical: false,
        status: "pending",
      },
    ];

    const unowned = getUnownedFiles(allFiles, groups);

    expect(unowned).toEqual(["file3.ts"]);
  });

  it("should consider completed groups as owned", () => {
    const allFiles = ["file1.ts", "file2.ts"];
    const groups: WorkGroup[] = [
      {
        groupId: "group-1",
        description: "test",
        ownedPaths: ["file1.ts"],
        isMechanical: false,
        status: "completed",
      },
    ];

    const unowned = getUnownedFiles(allFiles, groups);

    expect(unowned).toEqual(["file2.ts"]);
  });
});
