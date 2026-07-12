/**
 * Task Compiler - Requirement Decomposition
 *
 * Breaks a compiled requirement into candidate tasks following
 * the standard engineering flow and decomposition policy.
 */
/**
 * Decompose a compiled requirement into task candidates.
 *
 * Policy: split when different capabilities needed, unrelated modules,
 * incoherent test set, destructive+edit mix, >maxComplexity, or
 * independently-proceeding outputs. Do NOT split to inflate count.
 */
export function decomposeRequirement(input) {
    const { requirement, project, maxComplexity = 5 } = input;
    const candidates = [];
    let priority = 1;
    // ─── Stage detection ────────────────────────────────────────────────
    const needsAnalysis = requirement.problemStatement.length > 200 || requirement.goals.length > 3;
    const needsDesign = requirement.problemStatement.length > 100;
    const hasTests = requirement.acceptanceCriteria.length > 0;
    const hasBrowserWorkflow = detectBrowserWorkflow(project);
    const needsRepair = requirement.riskTags.some((r) => r.risk === "destructive_operation");
    // ─── Analysis ──────────────────────────────────────────────────────
    if (needsAnalysis) {
        candidates.push({
            id: "analysis-0",
            title: `Analyze: ${truncate(requirement.title, 40)}`,
            objective: `Analyze the requirement "${requirement.title}": ${requirement.problemStatement}. Identify affected modules, detect dependencies, and outline implementation approach.`,
            type: "analysis",
            roughDependencies: [],
            criteria: [],
            estimatedComplexity: estimateComplexity(requirement.problemStatement),
            priority: priority++,
        });
    }
    // ─── Design ────────────────────────────────────────────────────────
    if (needsDesign) {
        candidates.push({
            id: "design-0",
            title: `Design: ${truncate(requirement.title, 40)}`,
            objective: `Design the architecture for: ${requirement.problemStatement}. Produce a schema or design document capturing the component model, API contracts, and data flow.`,
            type: "design",
            roughDependencies: needsAnalysis ? ["analysis-0"] : [],
            criteria: [],
            estimatedComplexity: 3,
            priority: priority++,
        });
    }
    // ─── Implementation ────────────────────────────────────────────────
    for (let i = 0; i < requirement.goals.length; i++) {
        const goal = requirement.goals[i];
        const implDeps = [];
        if (needsDesign)
            implDeps.push("design-0");
        else if (needsAnalysis)
            implDeps.push("analysis-0");
        candidates.push({
            id: `impl-${i}`,
            title: `Implement: ${truncate(goal.description, 45)}`,
            objective: goal.description,
            type: "implementation",
            roughDependencies: implDeps,
            criteria: mapGoalToCriteria(goal.id, requirement),
            estimatedComplexity: estimateComplexity(goal.description),
            priority: priority++,
        });
    }
    // Blocking constraints as an implementation concern
    const blockingConstraints = requirement.constraints.filter((c) => c.blocking);
    if (blockingConstraints.length > 0) {
        const firstImplId = requirement.goals.length > 0 ? "impl-0" : undefined;
        candidates.push({
            id: "impl-constraints",
            title: `Implement constraints: ${truncate(blockingConstraints[0].description, 40)}`,
            objective: blockingConstraints.map((c) => c.description).join("; "),
            type: "implementation",
            roughDependencies: firstImplId ? [firstImplId] : [],
            criteria: [],
            estimatedComplexity: 3,
            priority: priority++,
        });
    }
    // ─── Unit tests ───────────────────────────────────────────────────
    if (hasTests) {
        candidates.push({
            id: "test-0",
            title: `Write unit tests for: ${truncate(requirement.title, 35)}`,
            objective: `Write unit tests that verify the acceptance criteria for: ${requirement.problemStatement}. Each test must map to at least one acceptance criterion.`,
            type: "test",
            roughDependencies: requirement.goals.length > 0 ? ["impl-0"] : [],
            criteria: requirement.acceptanceCriteria.map((c) => c.id),
            estimatedComplexity: 3,
            priority: priority++,
        });
    }
    // ─── E2E tests ───────────────────────────────────────────────────
    if (hasBrowserWorkflow && input.insertE2E !== false) {
        candidates.push({
            id: "e2e-0",
            title: `Write E2E tests for: ${truncate(requirement.title, 35)}`,
            objective: `Write end-to-end browser tests for: ${requirement.problemStatement}. Cover the critical user flows identified in the requirements.`,
            type: "e2e_test",
            roughDependencies: hasTests
                ? ["test-0"]
                : requirement.goals.length > 0
                    ? ["impl-0"]
                    : [],
            criteria: [],
            estimatedComplexity: 5,
            priority: priority++,
        });
    }
    // ─── Review ────────────────────────────────────────────────────────
    const reviewDeps = [];
    if (hasTests)
        reviewDeps.push("test-0");
    if (hasBrowserWorkflow && input.insertE2E !== false)
        reviewDeps.push("e2e-0");
    if (reviewDeps.length === 0 && requirement.goals.length > 0)
        reviewDeps.push("impl-0");
    candidates.push({
        id: "review-0",
        title: `Review changes for: ${truncate(requirement.title, 35)}`,
        objective: `Review all code changes for: ${requirement.problemStatement}. Verify code quality, test coverage, and alignment with acceptance criteria.`,
        type: "review",
        roughDependencies: reviewDeps,
        criteria: requirement.acceptanceCriteria.map((c) => c.id),
        estimatedComplexity: 2,
        priority: priority++,
    });
    // ─── Repair ────────────────────────────────────────────────────────
    if (needsRepair) {
        candidates.push({
            id: "repair-0",
            title: `Repair / verify: ${truncate(requirement.title, 35)}`,
            objective: `Address review findings and verify that destructive operations in: ${requirement.problemStatement} have proper approval and rollback plans.`,
            type: "repair",
            roughDependencies: ["review-0"],
            criteria: [],
            estimatedComplexity: 3,
            priority: priority++,
        });
    }
    // ─── Documentation ────────────────────────────────────────────────
    candidates.push({
        id: "docs-0",
        title: `Document: ${truncate(requirement.title, 40)}`,
        objective: `Document the implementation of: ${requirement.title}. ${requirement.problemStatement}. Include usage examples, API documentation, and any relevant diagrams.`,
        type: "documentation",
        roughDependencies: needsRepair ? ["repair-0"] : ["review-0"],
        criteria: [],
        estimatedComplexity: 2,
        priority: priority++,
    });
    // ─── Enforce complexity threshold ─────────────────────────────────
    const result = [];
    for (const c of candidates) {
        if (c.estimatedComplexity > maxComplexity) {
            result.push(...splitByComplexity(c, maxComplexity));
        }
        else {
            result.push(c);
        }
    }
    return result;
}
// ─── Helpers ────────────────────────────────────────────────────────────
function estimateComplexity(text) {
    const words = text.split(/\s+/).length;
    if (words < 20)
        return 1;
    if (words < 50)
        return 2;
    if (words < 100)
        return 3;
    if (words < 200)
        return 5;
    return 8;
}
function splitByComplexity(task, _maxComplexity) {
    const half = Math.ceil(task.estimatedComplexity / 2);
    return [
        {
            ...task,
            id: `${task.id}-a`,
            estimatedComplexity: half,
            title: `${task.title} [Part 1]`,
            objective: `${task.objective} (Part 1)`,
        },
        {
            ...task,
            id: `${task.id}-b`,
            estimatedComplexity: half,
            title: `${task.title} [Part 2]`,
            objective: `${task.objective} (Part 2)`,
            roughDependencies: [...task.roughDependencies, `${task.id}-a`],
        },
    ];
}
function mapGoalToCriteria(goalId, requirement) {
    const acs = requirement.acceptanceCriteria;
    const goalIndex = requirement.goals.findIndex((g) => g.id === goalId);
    if (goalIndex < 0)
        return acs.map((c) => c.id);
    // Distribute criteria round-robin across goals
    return acs
        .filter((_, i) => i % requirement.goals.length === goalIndex)
        .map((c) => c.id);
}
function detectBrowserWorkflow(project) {
    const frameworks = project.frameworks ?? [];
    const testCapabilities = project.testCapabilities ?? [];
    return (frameworks.some((f) => /playwright|cypress|selenium|nightwatch/i.test(f.name)) ||
        testCapabilities.some((t) => /playwright|cypress|selenium|e2e|browser/i.test(t.runner)));
}
function truncate(text, maxLen) {
    if (text.length <= maxLen)
        return text;
    return `${text.slice(0, maxLen - 1)}…`;
}
//# sourceMappingURL=decompose.js.map