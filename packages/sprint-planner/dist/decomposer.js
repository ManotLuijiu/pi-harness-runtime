/**
 * Sprint Planner — Requirement Decomposer (RFC-0074)
 */
let taskCounter = 0;
/**
 * Decompose a requirement into tasks
 */
export function decomposeRequirement(req, options) {
    const tasks = [];
    const estimate = req.estimate ?? options?.defaultEstimate ?? 3;
    tasks.push(createTask(req, "Implementation", "todo", estimate));
    tasks.push(createTask(req, "Tests", "todo", Math.min(estimate, 5)));
    tasks.push(createTask(req, "Documentation", "todo", 1));
    for (const ac of req.acceptanceCriteria) {
        tasks.push(createTask(req, `AC: ${ac}`, "todo", 2));
    }
    return tasks;
}
function createTask(req, title, status, estimate) {
    return {
        id: `task-${++taskCounter}-${Date.now()}`,
        requirementId: req.id,
        title: `${req.title} — ${title}`,
        description: req.description,
        status,
        estimate,
        labels: req.labels,
    };
}
export function assignEstimate(complexity) {
    const points = [1, 2, 3, 5, 8, 13, 21];
    const idx = Math.min(Math.floor(complexity / 2), points.length - 1);
    return points[idx];
}
export function sumPoints(tasks) {
    return tasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0);
}
//# sourceMappingURL=decomposer.js.map