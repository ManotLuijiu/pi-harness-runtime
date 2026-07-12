/**
 * Context Compiler - Deduplication
 *
 * Removes duplicate candidates and merges overlapping source file slices.
 * Uses content normalization for deduplication (same as RFC-0041).
 */
/**
 * Deduplicate candidates by normalized content.
 * Required candidates are never deduplicated (preserved).
 *
 * For source files with overlapping ranges, merge into a single slice.
 *
 * @returns [uniqueCandidates, duplicateIds]
 */
export function deduplicateCandidates(candidates) {
    const seen = new Map();
    const duplicates = [];
    for (const candidate of candidates) {
        // Required items are never deduplicated
        if (candidate.required) {
            seen.set(candidate.id, candidate);
            continue;
        }
        const normalized = normalizeContent(candidate.content);
        if (seen.has(normalized)) {
            duplicates.push(candidate.id);
        }
        else {
            seen.set(normalized, candidate);
        }
    }
    return {
        unique: [...seen.values()],
        duplicates,
    };
}
/**
 * Merge overlapping file slices from the same file.
 * Merges adjacent/overlapping line ranges and deduplicates symbols.
 */
export function mergeFileSlices(candidates) {
    // Group by file path
    const byFile = new Map();
    for (const c of candidates) {
        if (c.kind === "source_file" && c.filePath) {
            const existing = byFile.get(c.filePath);
            if (existing) {
                existing.push(c);
            }
            else {
                byFile.set(c.filePath, [c]);
            }
        }
        else {
            // Non-source-file candidates pass through
        }
    }
    const result = [];
    for (const candidate of candidates) {
        if (candidate.kind === "source_file" && candidate.filePath) {
            // Only process once (first candidate for each file)
            const slices = byFile.get(candidate.filePath) ?? [];
            if (slices[0] !== candidate)
                continue;
            if (slices.length === 1) {
                result.push(candidate);
            }
            else {
                // Merge multiple slices
                result.push(mergeSlicesForFile(candidate.filePath, slices));
            }
        }
        else {
            result.push(candidate);
        }
    }
    return result;
}
/**
 * Merge multiple slices from the same file.
 */
function mergeSlicesForFile(filePath, slices) {
    // Sort by startLine
    const sorted = [...slices].sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
    const first = sorted[0] ?? {
        id: "",
        kind: "source_file",
        content: "",
        source: "",
        priority: 0,
        required: false,
        trust: "unverified",
    };
    let endLine = first.endLine ?? 0;
    const allSymbols = new Set();
    const allSources = new Set();
    for (const slice of sorted) {
        if (slice.endLine && slice.endLine > endLine) {
            endLine = slice.endLine;
        }
        for (const sym of slice.symbols ?? []) {
            allSymbols.add(sym);
        }
        allSources.add(slice.source);
    }
    // Combine content from all slices
    const combinedContent = sorted.map((s) => s.content).join("\n...\n");
    return {
        id: first.id,
        kind: "source_file",
        content: combinedContent,
        source: [...allSources].join("; "),
        priority: Math.max(...sorted.map((s) => s.priority)),
        required: sorted.some((s) => s.required),
        trust: sorted.find((s) => s.trust === "authoritative")
            ? "authoritative"
            : sorted.find((s) => s.trust === "generated")
                ? "generated"
                : "unverified",
        filePath,
        startLine: first.startLine,
        endLine,
        symbols: [...allSymbols],
        contentHash: sorted[0]?.contentHash,
    };
}
/**
 * Normalize content for deduplication comparison.
 * Matches the RFC-0041 deduplication formula.
 */
function normalizeContent(text) {
    return collapseWhitespace(stripMarkdownDecoration(text.toLowerCase()));
}
function collapseWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
}
function stripMarkdownDecoration(text) {
    return text
        .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1")
        .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1")
        .replace(/[#*_`~>[\]]/g, "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
}
//# sourceMappingURL=deduplicate.js.map