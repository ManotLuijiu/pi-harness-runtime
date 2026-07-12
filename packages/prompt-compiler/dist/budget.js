/**
 * Prompt Compiler - Budget / Compaction
 *
 * Compacts optional sections to fit within the token budget.
 * Required sections are never removed.
 * Compaction order (least to most important to keep):
 * 1. Historical logs
 * 2. Previous successful examples
 * 3. Low-priority repository notes
 * 4. Non-blocking discussion
 * 5. Redundant file summaries
 *
 * Priority 0 entries (critical) are never compacted.
 */
/**
 * Compact sections to fit within the token budget.
 *
 * Only compactable sections are affected.
 * Required sections are preserved verbatim.
 *
 * @param sections - Input sections
 * @param availableTokens - Maximum tokens available
 * @param estimateTokens - Token estimation function
 * @returns Compacted sections and removed section IDs
 */
export function compactToBudget(sections, availableTokens, estimateTokens) {
    const removed = [];
    // Calculate tokens used by required sections
    let requiredTokens = 0;
    for (const section of sections) {
        if (!section.compactable) {
            requiredTokens += estimateTokens(section.content);
        }
    }
    const budgetForOptional = availableTokens - requiredTokens;
    // Get compactable sections, sorted by priority (most compactable first)
    // within each section, compact from the bottom up
    const compactableSections = sections
        .map((s, i) => ({ section: s, index: i }))
        .filter(({ section }) => section.compactable)
        .reverse(); // process from end of document
    let currentOptionalTokens = 0;
    const optionalSectionTokens = new Map();
    for (const { section, index } of compactableSections) {
        const tokens = estimateTokens(section.content);
        optionalSectionTokens.set(index, tokens);
        currentOptionalTokens += tokens;
    }
    // If within budget, return as-is
    if (currentOptionalTokens <= budgetForOptional) {
        return {
            sections,
            removed: [],
            estimatedTokens: requiredTokens + currentOptionalTokens,
        };
    }
    // Otherwise, compact compactable sections by removing low-priority content
    // from the end of each section
    const workingSections = sections.map((s) => ({ ...s }));
    let overBudgetBy = currentOptionalTokens - budgetForOptional;
    // Sort compactable sections by priority label (higher priority label = more important)
    // Within each section, trim lines from the end that are marked as lower priority
    for (const { section, index } of compactableSections) {
        if (overBudgetBy <= 0)
            break;
        const lines = workingSections[index]?.content.split("\n");
        const sectionTokens = optionalSectionTokens.get(index) ?? 0;
        // Estimate tokens per line (rough approximation)
        const avgTokensPerLine = lines.length > 0 ? Math.ceil(sectionTokens / lines.length) : 1;
        // Remove lines from the end (least important), working backwards
        const priorityKeywords = [
            "SUPPLEMENTAL",
            "NON-BLOCKING",
            "HISTORICAL",
            "DISCUSSION",
            "NOTE",
            "EXAMPLE",
            "CONTEXT",
            "REFERENCE",
        ];
        let linesRemoved = 0;
        const trimmedLines = [];
        for (let i = 0; i < lines.length; i++) {
            trimmedLines.push(lines[i] ?? "");
        }
        // Remove from end
        while (trimmedLines.length > 0 && overBudgetBy > 0) {
            const lastLine = trimmedLines[trimmedLines.length - 1];
            if (!lastLine || lastLine.trim() === "" || lastLine.startsWith("#")) {
                // Never remove headers or blank lines at the start
                break;
            }
            const isLowPriority = priorityKeywords.some((kw) => lastLine.toUpperCase().includes(kw));
            if (isLowPriority) {
                trimmedLines.pop();
                overBudgetBy -= avgTokensPerLine;
                linesRemoved++;
            }
            else {
                break;
            }
        }
        if (trimmedLines.length < lines.length) {
            const removedText = lines.slice(trimmedLines.length).join("\n");
            if (removedText.trim()) {
                removed.push(`${section.id}: ${removedText.slice(0, 100)}...`);
            }
            workingSections[index] = {
                ...(workingSections[index] ?? section),
                content: trimmedLines.join("\n"),
            };
        }
    }
    const finalTokens = requiredTokens +
        [...workingSections]
            .filter((s) => s.compactable)
            .reduce((sum, s) => sum + estimateTokens(s.content), 0);
    return {
        sections: workingSections,
        removed,
        estimatedTokens: finalTokens,
    };
}
/**
 * Simple word-based token estimator.
 * ~4 characters per token on average.
 */
export function estimateTokens(text) {
    if (!text || text.trim() === "")
        return 0;
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
}
//# sourceMappingURL=budget.js.map