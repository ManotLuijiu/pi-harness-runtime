/**
 * Milestone Manager - RFC-0075
 *
 * Track milestones against progress and alert when items are at risk.
 */
export type MilestoneStatus = 'on-track' | 'at-risk' | 'missed' | 'completed';
export interface Milestone {
    id: string;
    title: string;
    targetDate: string;
    description?: string;
    items: string[];
    status: MilestoneStatus;
    completedItems: number;
}
export interface MilestoneManagerOptions {
    atRiskThreshold?: number;
    missedThreshold?: number;
}
export interface MilestoneUpdate {
    itemId: string;
    status: 'added' | 'completed' | 'removed';
    milestoneId: string;
}
//# sourceMappingURL=types.d.ts.map