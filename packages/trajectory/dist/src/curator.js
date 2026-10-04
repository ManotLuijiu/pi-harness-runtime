/**
 * Curator - Consolidation and Quality Enforcement
 *
 * Periodic pass that:
 * - Merges fragmented memory into skills
 * - Extracts common patterns into skills
 * - Prunes outdated items
 * - Enforces quality standards
 *
 * Based on Hermes Agent's curator system.
 */
/**
 * Default curator configuration
 */
export const DEFAULT_CURATOR_CONFIG = {
    enabled: true,
    consolidationIntervalDays: 7,
    memoryThreshold: 50,
    similarityThreshold: 3,
    archiveAgeDays: 90,
};
/**
 * Curator class
 */
export class Curator {
    config;
    handlers = new Set();
    lastConsolidation = Date.now();
    constructor(config) {
        this.config = { ...DEFAULT_CURATOR_CONFIG, ...config };
    }
    /**
     * Register event handler
     */
    on(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
    /**
     * Emit event
     */
    emit(event) {
        for (const handler of this.handlers) {
            try {
                handler(event);
            }
            catch (err) {
                console.error("[Curator] Handler error:", err);
            }
        }
    }
    /**
     * Check if consolidation should run
     */
    shouldConsolidate() {
        if (!this.config.enabled)
            return false;
        const daysSinceConsolidation = (Date.now() - this.lastConsolidation) / (1000 * 60 * 60 * 24);
        return daysSinceConsolidation >= this.config.consolidationIntervalDays;
    }
    /**
     * Run consolidation pass
     */
    async consolidate(memory, skills, trajectories) {
        this.emit({ type: "curator.started" });
        const actions = [];
        try {
            // 1. Find similar memory entries
            const similarGroups = this.findSimilarMemory(memory);
            for (const group of similarGroups) {
                if (group.entries.length >= this.config.similarityThreshold) {
                    const action = this.suggestMerge(group);
                    if (action) {
                        actions.push(action);
                        this.emit({ type: "curator.action", action });
                    }
                }
            }
            // 2. Extract patterns from trajectories
            const patterns = this.extractPatterns(trajectories);
            for (const pattern of patterns) {
                const action = this.suggestSkillExtraction(pattern);
                if (action) {
                    actions.push(action);
                    this.emit({ type: "curator.action", action });
                }
            }
            // 3. Check for outdated items
            const outdated = this.findOutdatedItems(memory, skills);
            for (const item of outdated) {
                const action = this.suggestArchive(item);
                if (action) {
                    actions.push(action);
                    this.emit({ type: "curator.action", action });
                }
            }
            // 4. Lint skills for quality
            for (const skill of skills) {
                const results = []; // Linting would require skills package
                const errors = results.filter((r) => r.severity === "error");
                if (errors.length > 0) {
                    // Suggest patch to fix errors
                    const action = this.suggestSkillPatch(skill, errors);
                    if (action) {
                        actions.push(action);
                        this.emit({ type: "curator.action", action });
                    }
                }
            }
            // Update last consolidation time
            this.lastConsolidation = Date.now();
            this.emit({ type: "curator.completed", actions });
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.emit({ type: "curator.error", error: errorMsg });
        }
        return actions;
    }
    /**
     * Find similar memory entries
     */
    findSimilarMemory(memory) {
        const groups = new Map();
        for (const entry of memory) {
            // Extract key terms from content
            const terms = this.extractTerms(entry.content);
            for (const term of terms) {
                const key = term.toLowerCase();
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key).push(entry);
            }
        }
        // Filter to groups with multiple entries
        const results = [];
        for (const [theme, entries] of groups) {
            // Deduplicate entries
            const unique = Array.from(new Set(entries.map((e) => e.id)))
                .map((id) => entries.find((e) => e.id === id));
            if (unique.length >= 2) {
                results.push({
                    entries: unique,
                    similarity: Math.min(1, unique.length / 10),
                    commonTheme: theme,
                });
            }
        }
        // Sort by similarity descending
        results.sort((a, b) => b.similarity - a.similarity);
        return results;
    }
    /**
     * Extract key terms from content
     */
    extractTerms(content) {
        // Simple term extraction
        const words = content
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 4);
        // Get most common words
        const freq = {};
        for (const word of words) {
            freq[word] = (freq[word] || 0) + 1;
        }
        // Return top terms
        return Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word]) => word);
    }
    /**
     * Suggest memory merge
     */
    suggestMerge(group) {
        // Find the most recent/relevant entry to keep
        const keeper = group.entries.reduce((a, b) => a.updated_at > b.updated_at ? a : b);
        return {
            type: "merge_memory",
            entries: group.entries.filter((e) => e.id !== keeper.id),
            into: keeper.id,
        };
    }
    /**
     * Extract patterns from trajectories
     */
    extractPatterns(trajectories) {
        const patterns = [];
        // Group by verdict
        const byVerdict = {};
        for (const t of trajectories) {
            if (!byVerdict[t.verdict]) {
                byVerdict[t.verdict] = [];
            }
            byVerdict[t.verdict].push(t);
        }
        // Find converged patterns (approved with low iterations)
        const fastConverged = trajectories.filter((t) => t.verdict === "approved" && t.iterations <= 2);
        for (const t of fastConverged) {
            const taskType = this.categorizeTask(t.taskRequest);
            patterns.push(`fast-${taskType}`);
        }
        // Find stuck patterns (high iterations)
        const stuck = trajectories.filter((t) => t.iterations >= 5 && t.verdict !== "approved");
        for (const t of stuck) {
            const taskType = this.categorizeTask(t.taskRequest);
            patterns.push(`stuck-${taskType}`);
        }
        return [...new Set(patterns)];
    }
    /**
     * Categorize task from request
     */
    categorizeTask(request) {
        const lower = request.toLowerCase();
        if (lower.includes("test"))
            return "testing";
        if (lower.includes("fix") || lower.includes("bug"))
            return "bugfix";
        if (lower.includes("refactor"))
            return "refactor";
        if (lower.includes("api"))
            return "api";
        if (lower.includes("config") || lower.includes("setup"))
            return "config";
        return "general";
    }
    /**
     * Suggest skill extraction
     */
    suggestSkillExtraction(pattern) {
        return {
            type: "extract_skill",
            pattern,
            from: [], // Would be populated from trajectories
        };
    }
    /**
     * Find outdated items
     */
    findOutdatedItems(memory, skills) {
        const outdated = [];
        const now = Date.now();
        for (const entry of memory) {
            const ageMs = now - new Date(entry.created_at).getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays > this.config.archiveAgeDays) {
                outdated.push({ id: entry.id, type: "memory", ageDays });
            }
        }
        for (const skill of skills) {
            const created = skill.hermes?.created_at
                ? new Date(skill.hermes.created_at).getTime()
                : now;
            const ageMs = now - created;
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            // Only archive agent-created skills, not user skills
            if (ageDays > this.config.archiveAgeDays && skill.hermes?.author === "agent") {
                const usageCount = skill.hermes?.usage_count ?? 0;
                if (usageCount === 0) {
                    outdated.push({ id: skill.id, type: "skill", ageDays });
                }
            }
        }
        return outdated;
    }
    /**
     * Suggest archive action
     */
    suggestArchive(item) {
        return {
            type: item.type === "memory" ? "archive_memory" : "archive_skill",
            id: item.id,
        };
    }
    /**
     * Suggest skill patch
     */
    suggestSkillPatch(skill, errors) {
        // Generate patch suggestion based on errors
        const patches = {};
        for (const error of errors) {
            switch (error.rule) {
                case "missing-description":
                    // Would need to generate a description
                    break;
                case "oversized-body":
                    // Would need to suggest splitting
                    break;
                case "incident-log-shape":
                    // Would need to clean up content
                    break;
            }
        }
        return {
            type: "patch_skill",
            id: skill.id,
            patch: patches,
        };
    }
    /**
     * Get quality summary
     */
    getQualitySummary(skills) {
        // Note: Full linting requires skills package - returning placeholder
        return {
            total: skills.length,
            errors: 0,
            warnings: 0,
            byRule: {},
        };
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Get configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
// Global instance
let globalCurator = null;
export function getGlobalCurator() {
    if (!globalCurator) {
        globalCurator = new Curator();
    }
    return globalCurator;
}
export function createCurator(config) {
    return new Curator(config);
}
//# sourceMappingURL=curator.js.map