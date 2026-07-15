/**
 * Sprint Planner — Sprint Planner (RFC-0074)
 */
import { decomposeRequirement, sumPoints } from "./decomposer.js";
let sprintCounter = 0;
export function createSprintConfig(overrides) {
    return {
        sprintDurationDays: 14,
        capacityPerDay: 5,
        defaultEstimate: 3,
        prioritizationStrategy: "priority-then-dependencies",
        ...overrides,
    };
}
export function sortRequirements(reqs, strategy) {
    const priorityOrder = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
    };
    const sorted = [...reqs].sort((a, b) => {
        const aP = priorityOrder[a.priority];
        const bP = priorityOrder[b.priority];
        if (aP !== bP)
            return aP - bP;
        return a.dependencies.length - b.dependencies.length;
    });
    return topologicalSort(sorted);
}
function topologicalSort(reqs) {
    const result = [];
    const remaining = new Set(reqs.map((r) => r.id));
    const byId = new Map(reqs.map((r) => [r.id, r]));
    while (remaining.size > 0) {
        let added = false;
        for (const id of remaining) {
            const req = byId.get(id);
            const depsSatisfied = req.dependencies.every((d) => !remaining.has(d));
            if (depsSatisfied) {
                result.push(req);
                remaining.delete(id);
                added = true;
            }
        }
        if (!added) {
            for (const id of remaining)
                result.push(byId.get(id));
            break;
        }
    }
    return result;
}
export function planSprints(requirements, config) {
    const cfg = createSprintConfig(config);
    const allTasks = requirements.flatMap((req) => decomposeRequirement(req, { defaultEstimate: cfg.defaultEstimate }));
    const sorted = sortRequirements(requirements, cfg.prioritizationStrategy);
    const sprints = [];
    const unassigned = [];
    const sprintCapacity = cfg.sprintDurationDays * cfg.capacityPerDay;
    let sprintTasks = [];
    let sprintPoints = 0;
    for (const req of sorted) {
        const reqTasks = decomposeRequirement(req, {
            defaultEstimate: cfg.defaultEstimate,
        });
        const reqPoints = sumPoints(reqTasks);
        if (sprintPoints + reqPoints <= sprintCapacity) {
            sprintTasks.push(...reqTasks);
            sprintPoints += reqPoints;
        }
        else {
            if (sprintTasks.length > 0) {
                sprints.push(makeSprint(sprints.length + 1, sprintTasks));
            }
            sprintTasks = reqTasks;
            sprintPoints = reqPoints;
        }
    }
    if (sprintTasks.length > 0) {
        sprints.push(makeSprint(sprints.length + 1, sprintTasks));
    }
    return {
        sprints,
        unassigned,
        totalPoints: sumPoints(allTasks),
        capacityUtilization: sprints.length > 0
            ? (sumPoints(allTasks) / (sprints.length * sprintCapacity)) * 100
            : 0,
    };
}
function makeSprint(number, tasks) {
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);
    end.setDate(end.getDate() + 14 * number);
    return {
        id: `sprint-${++sprintCounter}-${Date.now()}`,
        number,
        name: `Sprint ${number}`,
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
        capacity: sumPoints(tasks),
        tasks,
    };
}
export function calculateVelocity(sprints) {
    const completed = sprints.filter((s) => s.tasks.every((t) => t.status === "done"));
    if (completed.length === 0)
        return 0;
    return (completed.reduce((s, sp) => s + (sp.velocity ?? sumPoints(sp.tasks)), 0) /
        completed.length);
}
//# sourceMappingURL=planner.js.map