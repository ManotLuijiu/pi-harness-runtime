/**
 * PolicyRenderer - Renders compact system contract for agent injection.
 *
 * Responsibilities:
 * - Render a compact, deterministic contract for before_agent_start injection
 * - Render full rule text for the harness_rules tool
 * - Render policy status for display
 */
import { readFileSync, existsSync } from "node:fs";
// ---------------------------------------------------------------------------
// System Contract Rendering
// ---------------------------------------------------------------------------
/**
 * Render the compact mandatory contract for system prompt injection.
 */
export function renderSystemContract(manifest) {
    const lines = [];
    // Header
    lines.push(`PI-HARNESS POLICY revision=${manifest.revision} coverage=${manifest.coverage}`);
    lines.push("");
    // Mandatory rules
    lines.push("Mandatory:");
    lines.push("- Read and follow the active harness and scoped project rules.");
    lines.push("- Before mutation, call harness_rules when the current revision is not loaded.");
    lines.push("- Treat [BLOCKING] code findings as completion gates.");
    lines.push("- Treat [DEGRADED] as incomplete evidence, never as clean.");
    lines.push("- Re-read a file after the harness reports an automatic mutation.");
    lines.push("");
    // Tool reference
    lines.push("Use harness_rules for full text and source attribution.");
    lines.push("");
    // Trust indicator
    if (manifest.trust === "untrusted") {
        lines.push("WARNING: Project is not trusted. Project rules are advisory only.");
        lines.push("");
    }
    // Coverage warning
    if (manifest.coverage !== "complete") {
        lines.push(`WARNING: Policy coverage is ${manifest.coverage}. Some rules may be missing.`);
        lines.push("");
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Rule Section Parsing
// ---------------------------------------------------------------------------
/**
 * Parse markdown content into sections.
 */
export function parseSections(content, source, scope, priority) {
    const sections = [];
    const lines = content.split("\n");
    let currentSection = null;
    let sectionIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineOffset = content.split("\n").slice(0, i).join("\n").length;
        // Check for markdown heading
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            // Save previous section
            if (currentSection) {
                sections.push({
                    id: currentSection.id,
                    title: currentSection.title,
                    content: currentSection.content.join("\n").trim(),
                    source,
                    scope,
                    priority,
                    offset: currentSection.offset,
                    truncated: false,
                });
            }
            // Start new section
            const level = headingMatch[1].length;
            const title = headingMatch[2].trim();
            currentSection = {
                id: `section-${sectionIndex++}`,
                title,
                content: [],
                offset: lineOffset,
            };
        }
        else if (currentSection) {
            currentSection.content.push(line);
        }
    }
    // Save last section
    if (currentSection) {
        sections.push({
            id: currentSection.id,
            title: currentSection.title,
            content: currentSection.content.join("\n").trim(),
            source,
            scope,
            priority,
            offset: currentSection.offset,
            truncated: false,
        });
    }
    // If no sections found, create a single section with the whole content
    if (sections.length === 0) {
        sections.push({
            id: "section-0",
            title: "Full Content",
            content: content.trim(),
            source,
            scope,
            priority,
            offset: 0,
            truncated: false,
        });
    }
    return sections;
}
// ---------------------------------------------------------------------------
// Full Rules Rendering
// ---------------------------------------------------------------------------
/**
 * Render full rules for the harness_rules tool.
 */
export function renderFullRules(manifest, options = {}) {
    const sections = [];
    const maxBytes = options.maxBytes ?? 50 * 1024; // Default 50KB cap
    // Filter sources
    let sources = manifest.sources;
    if (options.source) {
        sources = sources.filter(s => s.path.includes(options.source));
    }
    // Parse sections from each source
    for (const source of sources) {
        const content = readSourceContent(source.path);
        if (!content)
            continue;
        const sourceSections = parseSections(content, source.path, source.scope, source.priority);
        // Filter by section if requested
        const filteredSections = options.section
            ? sourceSections.filter(s => s.title.toLowerCase().includes(options.section.toLowerCase()) ||
                s.id === options.section)
            : sourceSections;
        sections.push(...filteredSections);
    }
    // Truncate if needed
    let totalBytes = 0;
    let truncated = false;
    const truncatedSections = [];
    for (const section of sections) {
        const sectionBytes = Buffer.byteLength(section.content, "utf8");
        if (totalBytes + sectionBytes > maxBytes) {
            // Check if we can fit a partial section
            const remainingBytes = maxBytes - totalBytes;
            if (remainingBytes > 100) {
                // Fit as much as possible
                truncatedSections.push({
                    ...section,
                    content: section.content.slice(0, remainingBytes),
                    truncated: true,
                });
            }
            truncated = true;
            break;
        }
        truncatedSections.push(section);
        totalBytes += sectionBytes;
    }
    return {
        sections: truncatedSections,
    };
}
/**
 * Render a manifest summary.
 */
export function renderManifestSummary(manifest) {
    const lines = [];
    lines.push(`Policy Manifest`);
    lines.push(`================`);
    lines.push(`Revision: ${manifest.revision}`);
    lines.push(`Project: ${manifest.projectRoot}`);
    lines.push(`Trust: ${manifest.trust}`);
    lines.push(`Coverage: ${manifest.coverage}`);
    lines.push(`Loaded: ${new Date(manifest.loadedAt).toISOString()}`);
    lines.push("");
    lines.push("Sources:");
    for (const source of manifest.sources) {
        const scope = source.scope || "(root)";
        const priority = source.priority;
        const owner = source.harnessOwned ? "[harness]" : "[project]";
        lines.push(`  ${owner} ${scope} ${priority} ${source.path}`);
    }
    if (manifest.loadError) {
        lines.push("");
        lines.push(`ERROR: ${manifest.loadError}`);
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Finding Envelope Rendering
// ---------------------------------------------------------------------------
/**
 * Render a finding envelope for display.
 */
export function renderFindingEnvelope(envelope) {
    const lines = [];
    // Header with verdict
    const verdictPrefix = {
        blocking: "[BLOCKING]",
        advisory: "[ADVISORY]",
        clean: "[CLEAN]",
        degraded: "[DEGRADED]",
    }[envelope.verdict];
    lines.push(`${verdictPrefix} Code Analysis (${envelope.coverage} coverage, ${envelope.freshness})`);
    lines.push("");
    // Summary
    if (envelope.summary) {
        lines.push(envelope.summary);
        lines.push("");
    }
    // Individual findings
    if (envelope.findings.length > 0) {
        for (const finding of envelope.findings) {
            const severity = {
                error: "ERROR",
                warning: "WARN",
                information: "INFO",
                hint: "HINT",
            }[finding.severity];
            const location = finding.line ? `${finding.path}:${finding.line}` : finding.path;
            const blocking = finding.blocking ? " [BLOCKING]" : "";
            lines.push(`${severity} ${location}: ${finding.message}${blocking}`);
            if (finding.fix) {
                lines.push(`  Fix: ${finding.fix}`);
            }
        }
        lines.push("");
    }
    // Next action
    if (envelope.nextAction) {
        const actionText = {
            fix: "Required: fix these issues before reporting completion.",
            reread: "Required: re-read affected files to get updated analysis.",
            run_full: "Required: do not report the project clean; run a full analysis.",
            continue: "No blocking issues found.",
        }[envelope.nextAction];
        lines.push(actionText);
    }
    return lines.join("\n");
}
/**
 * Create a clean finding envelope.
 */
export function createCleanEnvelope(coverage = "full") {
    return {
        verdict: "clean",
        coverage,
        freshness: "fresh",
        findings: [],
        nextAction: "continue",
        summary: "No blocking issues found in code analysis.",
    };
}
/**
 * Create a degraded finding envelope.
 */
export function createDegradedEnvelope(reason, coverage = "delta") {
    return {
        verdict: "degraded",
        coverage,
        freshness: "indeterminate",
        findings: [],
        nextAction: "run_full",
        summary: `Analysis degraded: ${reason}. Do not claim the project is clean.`,
    };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Read source content from a path.
 */
function readSourceContent(path) {
    // Handle file:// URLs
    const normalizedPath = path.startsWith("file://")
        ? path.slice(7)
        : path;
    if (existsSync(normalizedPath)) {
        try {
            return readFileSync(normalizedPath, "utf8");
        }
        catch {
            return null;
        }
    }
    return null;
}
//# sourceMappingURL=policy-renderer.js.map