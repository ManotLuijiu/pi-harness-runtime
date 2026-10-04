/**
 * Milestone Manager - RFC-0075
 *
 * Track milestones and calculate status.
 */
const DEFAULT_OPTIONS = {
    atRiskThreshold: 80,
    missedThreshold: 0,
};
/**
 * Calculate milestone status based on progress and time
 */
export function calculateMilestoneStatus(milestone, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const totalItems = milestone.items.length;
    const completedItems = milestone.completedItems;
    if (completedItems >= totalItems) {
        return 'completed';
    }
    // Check if past target date
    const targetDate = new Date(milestone.targetDate);
    const today = new Date();
    const daysPast = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    if (opts.missedThreshold && daysPast > opts.missedThreshold) {
        return 'missed';
    }
    // Check progress percentage
    const progressPct = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
    // Calculate expected progress based on time
    const startDate = new Date(milestone.targetDate);
    startDate.setDate(startDate.getDate() - 14); // Assume 2-week sprints
    const totalDays = 14;
    const daysElapsed = Math.max(0, Math.min(totalDays, totalDays - daysPast));
    const expectedPct = (daysElapsed / totalDays) * 100;
    if (progressPct < expectedPct * (1 - opts.atRiskThreshold / 100)) {
        return 'at-risk';
    }
    return 'on-track';
}
/**
 * Milestone Manager
 */
export class MilestoneManager {
    milestones = new Map();
    options;
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    addMilestone(milestone) {
        this.milestones.set(milestone.id, milestone);
    }
    removeMilestone(id) {
        this.milestones.delete(id);
    }
    getMilestone(id) {
        return this.milestones.get(id);
    }
    listMilestones() {
        return [...this.milestones.values()];
    }
    updateMilestone(id, update) {
        const milestone = this.milestones.get(id);
        if (milestone) {
            this.milestones.set(id, { ...milestone, ...update });
        }
    }
    getStatus(id) {
        const milestone = this.milestones.get(id);
        return milestone ? calculateMilestoneStatus(milestone, this.options) : undefined;
    }
    getAtRiskMilestones() {
        return this.listMilestones().filter(m => calculateMilestoneStatus(m, this.options) === 'at-risk');
    }
    getMissedMilestones() {
        return this.listMilestones().filter(m => calculateMilestoneStatus(m, this.options) === 'missed');
    }
}
//# sourceMappingURL=engine.js.map