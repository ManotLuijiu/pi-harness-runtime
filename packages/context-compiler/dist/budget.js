/**
 * Context Compiler - Token Budget Fitting
 *
 * Fits optional candidates into the available token budget.
 * Required candidates always fit first.
 * Uses the RFC-0041 character-based estimation (1 token ≈ 4 characters).
 */
/**
 * Estimate tokens from content using 4 chars/token approximation.
 */
export function estimateTokens(content) {
    if (!content || content.trim() === "")
        return 0;
    return Math.ceil(content.length / 4);
}
/**
 * Fit candidates into the token budget.
 *
 * Algorithm:
 * 1. Always include required candidates
 * 2. Sort optional by score (descending)
 * 3. Greedily add optional until budget exhausted
 * 4. Record all omitted with reason "budget"
 *
 * @param candidates - Ranked candidates (highest score first)
 * @param maximumTokens - Available budget
 * @returns Candidates to include and items to omit
 */
export function fitToBudget(candidates, maximumTokens) {
    const included = [];
    const omitted = [];
    let usedTokens = 0;
    for (const { candidate } of candidates) {
        const tokens = estimateTokens(candidate.content);
        // Optional items with no content are omitted (broken/unavailable)
        if (!candidate.required &&
            (!candidate.content || candidate.content.trim() === "")) {
            omitted.push({
                id: candidate.id,
                kind: candidate.kind,
                reason: "source_unavailable",
                reasonDetail: "no content",
                estimatedTokens: 0,
            });
            continue;
        }
        if (candidate.required) {
            // Required: always include
            included.push(candidate);
            usedTokens += tokens;
            continue;
        }
        // Optional: check budget
        if (usedTokens + tokens <= maximumTokens) {
            included.push(candidate);
            usedTokens += tokens;
        }
        else {
            omitted.push({
                id: candidate.id,
                kind: candidate.kind,
                reason: "budget",
                reasonDetail: `estimated ${tokens} tokens, only ${maximumTokens - usedTokens} remaining`,
                estimatedTokens: tokens,
            });
        }
    }
    return {
        included,
        omitted,
        estimatedTokens: usedTokens,
    };
}
/**
 * Convert included candidates to compiled items.
 */
export function toCompiledItems(candidates) {
    return candidates.map((c) => ({
        id: c.id,
        kind: c.kind,
        content: c.content,
        source: c.source,
        priority: c.priority,
        required: c.required,
        trust: c.trust,
        estimatedTokens: estimateTokens(c.content),
        contentHash: c.contentHash,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        symbols: c.symbols,
    }));
}
//# sourceMappingURL=budget.js.map