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
export declare const DEFAULT_PARTITION_CONFIG: PartitionConfig;
/**
 * Partition files into ownership groups
 */
export declare function partitionWork(files: string[], facts: ScopeFacts, config?: Partial<PartitionConfig>): WorkGroup[];
/**
 * Detect ownership conflicts
 */
export declare function detectOwnershipConflicts(groups: WorkGroup[], newPaths: string[]): string[];
/**
 * Assign work to group
 */
export declare function assignWorkToGroup(groups: WorkGroup[], groupId: string, paths: string[]): WorkGroup | null;
/**
 * Get unowned files
 */
export declare function getUnownedFiles(allFiles: string[], groups: WorkGroup[]): string[];
/**
 * Update group status
 */
export declare function updateGroupStatus(groups: WorkGroup[], groupId: string, status: WorkGroup["status"], childId?: string): WorkGroup[];
/**
 * Check if all groups are complete
 */
export declare function areAllGroupsComplete(groups: WorkGroup[]): boolean;
/**
 * Get pending groups
 */
export declare function getPendingGroups(groups: WorkGroup[]): WorkGroup[];
