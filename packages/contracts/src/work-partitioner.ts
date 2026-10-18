/**
 * Work Partitioner
 * 
 * Partitions work into disjoint file ownership groups.
 */

import type { WorkGroup, ScopeFacts } from "./delegation.js";

/**
 * File dependency info
 */
export interface FileDependency {
  path: string;
  imports: string[];
  exports: string[];
}

/**
 * Partition configuration
 */
export interface PartitionConfig {
  /** Maximum files per group */
  maxFilesPerGroup: number;
  /** Whether to group by directory */
  groupByDirectory: boolean;
  /** Shared files that shouldn't be partitioned */
  sharedPaths: string[];
}

/**
 * Default partition config
 */
export const DEFAULT_PARTITION_CONFIG: PartitionConfig = {
  maxFilesPerGroup: 15,
  groupByDirectory: true,
  sharedPaths: [
    "index.ts",
    "index.js",
    "main.ts",
    "main.js",
    "package.json",
    "tsconfig.json",
  ],
};

/**
 * Partition files into ownership groups
 */
export function partitionWork(
  files: string[],
  facts: ScopeFacts,
  config: Partial<PartitionConfig> = {}
): WorkGroup[] {
  const cfg = { ...DEFAULT_PARTITION_CONFIG, ...config };

  // Filter out shared paths
  const ownedFiles = files.filter(
    (f) => !cfg.sharedPaths.some((s) => f.endsWith(s))
  );

  // Group files by directory
  const dirGroups = groupByDirectory(ownedFiles);

  // Further partition large groups
  const groups: WorkGroup[] = [];
  let groupId = 1;

  for (const [dir, dirFiles] of Object.entries(dirGroups)) {
    if (dirFiles.length <= cfg.maxFilesPerGroup) {
      groups.push(createGroup(groupId++, dir, dirFiles, facts.isMechanical));
    } else {
      // Split large directories
      const subGroups = splitGroup(dirFiles, cfg.maxFilesPerGroup);
      for (const subFiles of subGroups) {
        groups.push(createGroup(groupId++, dir, subFiles, facts.isMechanical));
      }
    }
  }

  return groups;
}

/**
 * Group files by directory
 */
function groupByDirectory(files: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const file of files) {
    // Get directory part of path
    const parts = file.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";

    if (!groups[dir]) {
      groups[dir] = [];
    }
    groups[dir].push(file);
  }

  return groups;
}

/**
 * Create a work group
 */
function createGroup(
  id: number,
  description: string,
  files: string[],
  isMechanical: boolean
): WorkGroup {
  return {
    groupId: `group-${id}`,
    description: `${description} (${files.length} files)`,
    ownedPaths: files,
    isMechanical,
    status: "pending",
  };
}

/**
 * Split a group into smaller subgroups
 */
function splitGroup(files: string[], maxSize: number): string[][] {
  const subgroups: string[][] = [];

  for (let i = 0; i < files.length; i += maxSize) {
    subgroups.push(files.slice(i, i + maxSize));
  }

  return subgroups;
}

/**
 * Detect ownership conflicts
 */
export function detectOwnershipConflicts(
  groups: WorkGroup[],
  newPaths: string[]
): string[] {
  const conflicts: string[] = [];

  for (const path of newPaths) {
    for (const group of groups) {
      if (
        group.status !== "cancelled" &&
        group.status !== "failed" &&
        group.ownedPaths.includes(path)
      ) {
        conflicts.push(`${path} already owned by ${group.groupId}`);
      }
    }
  }

  return conflicts;
}

/**
 * Assign work to group
 */
export function assignWorkToGroup(
  groups: WorkGroup[],
  groupId: string,
  paths: string[]
): WorkGroup | null {
  const group = groups.find((g) => g.groupId === groupId);

  if (!group) {
    return null;
  }

  // Check for conflicts
  const conflicts = detectOwnershipConflicts(
    groups.filter((g) => g.groupId !== groupId),
    paths
  );

  if (conflicts.length > 0) {
    // Return group with conflict info
    return {
      ...group,
      status: "failed",
    };
  }

  return {
    ...group,
    ownedPaths: [...new Set([...group.ownedPaths, ...paths])],
  };
}

/**
 * Get unowned files
 */
export function getUnownedFiles(
  allFiles: string[],
  groups: WorkGroup[]
): string[] {
  const ownedFiles = new Set<string>();

  for (const group of groups) {
    if (group.status !== "cancelled" && group.status !== "failed") {
      for (const path of group.ownedPaths) {
        ownedFiles.add(path);
      }
    }
  }

  return allFiles.filter((f) => !ownedFiles.has(f));
}

/**
 * Update group status
 */
export function updateGroupStatus(
  groups: WorkGroup[],
  groupId: string,
  status: WorkGroup["status"],
  childId?: string
): WorkGroup[] {
  return groups.map((g) => {
    if (g.groupId !== groupId) {
      return g;
    }

    return {
      ...g,
      status,
      childId: childId || g.childId,
    };
  });
}

/**
 * Check if all groups are complete
 */
export function areAllGroupsComplete(groups: WorkGroup[]): boolean {
  return groups.every(
    (g) =>
      g.status === "completed" ||
      g.status === "failed" ||
      g.status === "cancelled"
  );
}

/**
 * Get pending groups
 */
export function getPendingGroups(groups: WorkGroup[]): WorkGroup[] {
  return groups.filter((g) => g.status === "pending");
}
