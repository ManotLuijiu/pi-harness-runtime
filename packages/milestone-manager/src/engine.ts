/**
 * Milestone Manager - RFC-0075
 *
 * Track milestones and calculate status.
 */

import type { Milestone, MilestoneStatus, MilestoneManagerOptions } from './types.js';

const DEFAULT_OPTIONS: MilestoneManagerOptions = {
  atRiskThreshold: 80,
  missedThreshold: 0,
};

/**
 * Calculate milestone status based on progress and time
 */
export function calculateMilestoneStatus(
  milestone: Milestone,
  options: MilestoneManagerOptions = {}
): MilestoneStatus {
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

  if (progressPct < expectedPct * (1 - opts.atRiskThreshold! / 100)) {
    return 'at-risk';
  }

  return 'on-track';
}

/**
 * Milestone Manager
 */
export class MilestoneManager {
  private milestones: Map<string, Milestone> = new Map();
  private options: MilestoneManagerOptions;

  constructor(options: MilestoneManagerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  addMilestone(milestone: Milestone): void {
    this.milestones.set(milestone.id, milestone);
  }

  removeMilestone(id: string): void {
    this.milestones.delete(id);
  }

  getMilestone(id: string): Milestone | undefined {
    return this.milestones.get(id);
  }

  listMilestones(): Milestone[] {
    return [...this.milestones.values()];
  }

  updateMilestone(id: string, update: Partial<Milestone>): void {
    const milestone = this.milestones.get(id);
    if (milestone) {
      this.milestones.set(id, { ...milestone, ...update });
    }
  }

  getStatus(id: string): MilestoneStatus | undefined {
    const milestone = this.milestones.get(id);
    return milestone ? calculateMilestoneStatus(milestone, this.options) : undefined;
  }

  getAtRiskMilestones(): Milestone[] {
    return this.listMilestones().filter(
      m => calculateMilestoneStatus(m, this.options) === 'at-risk'
    );
  }

  getMissedMilestones(): Milestone[] {
    return this.listMilestones().filter(
      m => calculateMilestoneStatus(m, this.options) === 'missed'
    );
  }
}
