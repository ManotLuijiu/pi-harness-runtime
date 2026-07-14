/**
 * Sprint Planner — Types (RFC-0074)
 */
export type StoryPoint = 1 | 2 | 3 | 5 | 8 | 13 | 21;
export type Priority = "critical" | "high" | "medium" | "low";
export type Status = "todo" | "in-progress" | "done" | "blocked";
export interface Requirement {
    id: string;
    title: string;
    description: string;
    priority: Priority;
    estimate?: StoryPoint;
    acceptanceCriteria: string[];
    labels: string[];
    parentId?: string;
    dependencies: string[];
}
export interface Task {
    id: string;
    requirementId: string;
    title: string;
    description: string;
    status: Status;
    assignee?: string;
    estimate?: StoryPoint;
    labels: string[];
}
export interface Sprint {
    id: string;
    number: number;
    name: string;
    startDate: string;
    endDate: string;
    capacity: number;
    tasks: Task[];
    velocity?: number;
    goal?: string;
}
export interface SprintConfig {
    sprintDurationDays: number;
    capacityPerDay: number;
    defaultEstimate: StoryPoint;
    prioritizationStrategy: "priority-then-dependencies" | "moSCoW" | "value-density";
}
export interface PlanningResult {
    sprints: Sprint[];
    unassigned: Requirement[];
    totalPoints: number;
    capacityUtilization: number;
}
//# sourceMappingURL=types.d.ts.map