/**
 * Task Compiler - File Scope Assignment
 *
 * Assigns filesInScope and FileOwnership to each compiled task
 * based on the project structure and task type.
 */
/**
 * Assign file scope and ownership to each task candidate.
 *
 * File scope is determined by:
 * - Task type (implementation → source files, test → test files)
 * - Project structure (detected by Project Analyzer)
 * - Requirement goals and constraints
 */
export function assignFileScope(candidates, project) {
    const __projectPath = project.projectPath;
    const sourceExts = detectSourceExtensions(project);
    const testExts = detectTestExtensions(project);
    return candidates.map((candidate) => {
        const filesInScope = inferFiles(candidate, project, sourceExts, testExts);
        const mode = getOwnershipMode(candidate.type);
        const ownership = {
            taskId: candidate.id,
            include: filesInScope,
            exclude: getExclusions(candidate.type, project),
            mode,
        };
        return {
            id: candidate.id,
            jobId: "", // Set by compiler
            title: candidate.title,
            objective: candidate.objective,
            type: candidate.type,
            dependencies: candidate.roughDependencies,
            filesInScope,
            filesExclude: ownership.exclude,
            expectedOutputs: [], // Set by verification.ts
            acceptanceCriteria: candidate.criteria,
            requiredCapabilities: inferCapabilities(candidate.type),
            permittedCommands: [], // Set by command-policy.ts
            prohibitedCommands: [], // Set by command-policy.ts
            preferredProvider: undefined, // Set by compiler.ts
            estimatedComplexity: candidate.estimatedComplexity,
            fileOwnership: ownership,
            priority: candidate.priority,
        };
    });
}
// ─── File inference by task type ───────────────────────────────────────
function inferFiles(candidate, project, _sourceExts, testExts) {
    const { type, objective } = candidate;
    const base = project.projectPath;
    switch (type) {
        case "analysis": {
            return [`${base}/src/**`];
        }
        case "design": {
            return [`${base}/src/**/*.ts`, `${base}/docs/**`];
        }
        case "implementation": {
            // Default to all source files; narrow by extracting file mentions from objective
            const mentions = extractFileMentions(objective);
            if (mentions.length > 0)
                return mentions;
            return [`${base}/src/**`];
        }
        case "test": {
            if (testExts.length > 0)
                return [`${base}/test/**`, `${base}/**/*.test.*`];
            return [`${base}/**/*.test.*`, `${base}/**/*.spec.*`];
        }
        case "e2e_test": {
            return [`${base}/**/*.e2e.*`, `${base}/e2e/**`];
        }
        case "review": {
            // Review reads everything that's been modified
            return [`${base}/src/**`];
        }
        case "repair": {
            // Repair targets whatever the review flagged
            const mentions = extractFileMentions(objective);
            return mentions.length > 0 ? mentions : [`${base}/src/**`];
        }
        case "documentation": {
            return [`${base}/README.md`, `${base}/docs/**`, `${base}/src/**/*.md`];
        }
        default: {
            return [`${base}/src/**`];
        }
    }
}
// ─── Extract file mentions from objective text ──────────────────────────
function extractFileMentions(text) {
    // Match common file/directory patterns in natural language:
    // - "src/components/Button.tsx"
    // - "packages/foo/src/"
    // - "test/user.test.ts"
    const pattern = /(?:src|test|packages?|apps?|lib|components?|hooks?|utils|docs?)[/\\][^\s"']+/gi;
    const matches = text.match(pattern);
    if (!matches)
        return [];
    // Deduplicate and return
    return [...new Set(matches)];
}
// ─── Ownership mode ────────────────────────────────────────────────────
function getOwnershipMode(type) {
    // Parallel tasks with "exclusive" mode cannot modify the same files
    switch (type) {
        case "implementation":
        case "test":
        case "e2e_test":
        case "repair":
            return "exclusive";
        case "analysis":
        case "design":
        case "review":
        case "documentation":
            return "shared_read";
        default:
            return "shared_read";
    }
}
// ─── Exclusions ────────────────────────────────────────────────────────
function getExclusions(_type, project) {
    const exclusions = [
        // Never touch these regardless of task type
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/coverage/**",
        "**/build/**",
    ];
    // Add project-specific exclusions from rules
    if (project.rules) {
        for (const rule of project.rules) {
            if (rule.section === "scope" || rule.section === "files") {
                // Rules may specify excluded patterns
            }
        }
    }
    return exclusions;
}
// ─── Capability inference ───────────────────────────────────────────────
function inferCapabilities(type) {
    const caps = {
        analysis: ["plan", "analysis"],
        design: ["plan", "analysis"],
        implementation: ["code"],
        test: ["code", "test"],
        e2e_test: ["code", "e2e"],
        review: ["review"],
        repair: ["code", "debug"],
        documentation: ["code"],
    };
    return caps[type] ?? ["code"];
}
// ─── Extension detection ─────────────────────────────────────────────────
function detectSourceExtensions(project) {
    const frameworks = project.frameworks ?? [];
    const exts = new Set(["ts", "tsx", "js", "jsx"]);
    if (frameworks.some((f) => /typescript|ts|tsx/i.test(f.name))) {
        exts.add("ts");
        exts.add("tsx");
    }
    if (frameworks.some((f) => /react|next\.?js|vue|svelte/i.test(f.name))) {
        exts.add("jsx");
        exts.add("tsx");
    }
    if (frameworks.some((f) => /python|flask|django|fastapi/i.test(f.name))) {
        exts.add("py");
    }
    if (frameworks.some((f) => /frappe|erpnext/i.test(f.name))) {
        exts.add("py");
        exts.add("js");
    }
    return [...exts];
}
function detectTestExtensions(project) {
    const frameworks = project.frameworks ?? [];
    const testCaps = project.testCapabilities ?? [];
    const exts = new Set();
    if (frameworks.some((f) => /playwright|cypress|selenium|nightwatch/i.test(f.name)) ||
        testCaps.some((t) => /playwright|cypress|selenium|nightwatch/i.test(t.runner))) {
        exts.add("e2e.ts");
    }
    return [...exts];
}
//# sourceMappingURL=file-scope.js.map