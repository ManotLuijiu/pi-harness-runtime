/**
 * Milestone Manager - RFC-0075
 *
 * Track milestones and calculate status.
 */
import type { Milestone, MilestoneStatus, MilestoneManagerOptions } from './types.js';
/**
 * Calculate milestone status based on progress and time
 */
export declare function calculateMilestoneStatus(milestone: Milestone, options?: MilestoneManagerOptions): MilestoneStatus;
/**
 * Milestone Manager
 */
export declare class MilestoneManager {
    private milestones;
    private options;
    constructor(options?: MilestoneManagerOptions);
    addMilestone(milestone: Milestone): void;
    removeMilestone(id: string): void;
    getMilestone(id: string): Milestone | undefined;
    listMilestones(): Milestone[];
    updateMilestone(id: string, update: Partial<Milestone>): void;
    getStatus(id: string): MilestoneStatus | undefined;
    getAtRiskMilestones(): Milestone[];
    getMissedMilestones(): Milestone[];
}
//# sourceMappingURL=engine.d.ts.map