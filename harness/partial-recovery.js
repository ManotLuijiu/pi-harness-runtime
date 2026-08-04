/**
 * Partial Response Recovery — RFC-0021
 *
 * Persist and recover incomplete agent outputs.
 * Never loses partial response text.
 *
 * Integration with CompactOrchestrator:
 * - Saves partial artifacts during compact
 * - Loads partial artifacts on retry
 * - Merges partials for context injection
 *
 * Artifact Layout:
 *   harness/partial/
 *     job_xxx/
 *       task_004/
 *         partial_001.md
 *         partial_002.md
 *         merged.md
 *         recovery_status.json
 *         files.json
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { continuePromptGenerator } from "./continue-prompt.js";
export class PartialRecovery {
    rootDir;
    taskId;
    partials = [];
    constructor(jobId, taskId, rootDir) {
        this.rootDir =
            rootDir ?? join(homedir(), ".pi", "harness", jobId, "partial", taskId);
        this.taskId = taskId;
        this.ensureDir();
        this.loadExistingPartials();
    }
    // --- Public API -----------------------------------------------------------
    /**
     * Save a partial response
     */
    savePartial(content, source = "output_limit", metadata) {
        const partial = {
            id: this.generateId(),
            timestamp: new Date().toISOString(),
            taskId: this.taskId,
            content,
            source,
            metadata,
        };
        this.partials.push(partial);
        // Save to disk
        const path = join(this.rootDir, `${partial.id}.md`);
        writeFileSync(path, content, "utf-8");
        // Update files manifest
        this.saveFilesManifest();
        // Update recovery status
        this.updateStatus("continuing");
        return partial;
    }
    /**
     * Save partial from compact result
     */
    saveFromCompact(summary, remainingWork) {
        const content = [
            "## Compaction Summary",
            summary,
            "",
            "## Remaining Work",
            ...remainingWork.map((w) => `- ${w}`),
        ].join("\n");
        this.savePartial(content, "compaction", { type: "compact_summary" });
    }
    /**
     * Get all partial responses
     */
    getPartials() {
        return [...this.partials];
    }
    /**
     * Get the count of partials
     */
    getCount() {
        return this.partials.length;
    }
    /**
     * Merge partials using the specified strategy
     */
    merge(options = { method: "markdown_sections" }) {
        if (this.partials.length === 0) {
            return "";
        }
        let merged;
        switch (options.method) {
            case "markdown_sections":
                merged = this.mergeAsMarkdownSections();
                break;
            case "code_blocks":
                merged = this.mergeCodeBlocks();
                break;
            case "json_concat":
                merged = this.mergeJson();
                break;
            case "patch_merge":
                merged = this.mergePatchBased();
                break;
            default:
                merged = this.mergeAsMarkdownSections();
        }
        // Remove duplicates if requested
        if (options.removeDuplicates) {
            merged = this.removeDuplicates(merged);
        }
        // Save merged output
        const mergedPath = join(this.rootDir, "merged.md");
        writeFileSync(mergedPath, merged, "utf-8");
        return merged;
    }
    /**
     * Generate continue prompt from partials
     */
    generateContinuePrompt() {
        if (this.partials.length === 0) {
            return "continue";
        }
        const merged = this.merge({ method: "markdown_sections" });
        const recentWork = this.extractRecentWork(merged);
        return continuePromptGenerator.generate({
            taskId: this.taskId,
            requirement: "Continue from partial work",
            whatWasCompleted: this.extractCompletedWork(merged),
            whatNeedsToBeDone: recentWork,
            partialFiles: this.extractFileReferences(merged),
            decisions: this.extractDecisions(merged),
        });
    }
    /**
     * Load partials from a continuation prompt
     */
    loadFromContinuationPrompt(prompt) {
        // Extract code blocks and content from continue_prompt.md
        const codeBlockMatch = prompt.match(/```[\s\S]*?```/g);
        if (codeBlockMatch) {
            const content = codeBlockMatch.join("\n\n");
            this.savePartial(content, "output_limit", { fromContinuation: true });
        }
    }
    /**
     * Check if recovery is needed
     */
    hasPartials() {
        return this.partials.length > 0;
    }
    /**
     * Check if we should escalate (too many partials)
     */
    shouldEscalate(maxPartials = 10) {
        return this.partials.length >= maxPartials;
    }
    /**
     * Mark recovery as completed
     */
    markCompleted() {
        this.updateStatus("completed");
    }
    /**
     * Mark recovery as failed
     */
    markFailed(error) {
        this.updateStatus("failed", error);
    }
    /**
     * Mark recovery as escalated
     */
    markEscalated() {
        this.updateStatus("escalated");
    }
    /**
     * Get recovery status
     */
    getStatus() {
        const statusPath = join(this.rootDir, "recovery_status.json");
        if (existsSync(statusPath)) {
            try {
                return JSON.parse(readFileSync(statusPath, "utf-8"));
            }
            catch {
                // Fall through to default
            }
        }
        return {
            taskId: this.taskId,
            status: "pending",
            partials: [],
            attempts: 0,
        };
    }
    /**
     * Clean up partials (after successful completion)
     */
    cleanup(keepMerged = true) {
        if (!existsSync(this.rootDir)) {
            return;
        }
        const files = readdirSync(this.rootDir);
        for (const file of files) {
            if (file === "merged.md" && keepMerged) {
                continue;
            }
            if (file === "recovery_status.json") {
                continue;
            }
            try {
                unlinkSync(join(this.rootDir, file));
            }
            catch {
                // Ignore errors
            }
        }
    }
    // --- Private Methods ------------------------------------------------
    ensureDir() {
        if (!existsSync(this.rootDir)) {
            mkdirSync(this.rootDir, { recursive: true });
        }
    }
    loadExistingPartials() {
        if (!existsSync(this.rootDir)) {
            return;
        }
        const files = readdirSync(this.rootDir);
        for (const file of files) {
            if (file.endsWith(".md") && file !== "merged.md") {
                const path = join(this.rootDir, file);
                const content = readFileSync(path, "utf-8");
                const id = file.replace(".md", "");
                this.partials.push({
                    id,
                    timestamp: new Date().toISOString(),
                    taskId: this.taskId,
                    content,
                    source: "output_limit",
                });
            }
        }
        // Sort by id
        this.partials.sort((a, b) => a.id.localeCompare(b.id));
    }
    generateId() {
        const count = this.partials.length + 1;
        return `partial_${String(count).padStart(3, "0")}`;
    }
    saveFilesManifest() {
        const manifestPath = join(this.rootDir, "files.json");
        const files = this.partials.map((p) => ({
            id: p.id,
            file: `${p.id}.md`,
            timestamp: p.timestamp,
            source: p.source,
        }));
        writeFileSync(manifestPath, JSON.stringify(files, null, 2), "utf-8");
    }
    updateStatus(status, error) {
        const statusPath = join(this.rootDir, "recovery_status.json");
        const current = this.getStatus();
        const updated = {
            taskId: this.taskId,
            status,
            partials: this.partials.map((p) => `${p.id}.md`),
            mergedOutput: existsSync(join(this.rootDir, "merged.md"))
                ? "merged.md"
                : undefined,
            attempts: current.attempts + 1,
            lastError: error ?? current.lastError,
            completedAt: status === "completed" ? new Date().toISOString() : undefined,
        };
        writeFileSync(statusPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
    }
    mergeAsMarkdownSections() {
        return this.partials
            .map((p, i) => `## Partial ${i + 1} (${p.source})\n\n${p.content}`)
            .join("\n\n---\n\n");
    }
    mergeCodeBlocks() {
        const codeBlocks = [];
        for (const partial of this.partials) {
            const matches = partial.content.match(/```[\s\S]*?```/g);
            if (matches) {
                codeBlocks.push(...matches);
            }
        }
        // Remove duplicates
        const seen = new Set();
        const unique = [];
        for (const block of codeBlocks) {
            if (!seen.has(block)) {
                seen.add(block);
                unique.push(block);
            }
        }
        return unique.join("\n\n");
    }
    mergeJson() {
        const results = [];
        for (const partial of this.partials) {
            try {
                const parsed = JSON.parse(partial.content);
                if (Array.isArray(parsed)) {
                    results.push(...parsed);
                }
                else {
                    results.push(parsed);
                }
            }
            catch {
                // Not JSON, include as-is
                results.push({ _raw: partial.content });
            }
        }
        return JSON.stringify(results, null, 2);
    }
    mergePatchBased() {
        // Simple approach: concatenate non-overlapping parts
        const parts = [];
        for (const partial of this.partials) {
            // Look for new content after last marker
            const lines = partial.content.split("\n");
            const newLines = [];
            for (const line of lines) {
                // Skip if it looks like a duplicate header
                if (!parts.some((p) => p.includes(line) ||
                    line.startsWith("#") ||
                    line.startsWith("---"))) {
                    newLines.push(line);
                }
            }
            if (newLines.length > 0) {
                parts.push(newLines.join("\n"));
            }
        }
        return parts.join("\n\n---\n\n");
    }
    removeDuplicates(text) {
        const lines = text.split("\n");
        const seen = new Set();
        const unique = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!seen.has(trimmed) && trimmed.length > 0) {
                seen.add(trimmed);
                unique.push(line);
            }
        }
        return unique.join("\n");
    }
    extractRecentWork(merged) {
        const work = [];
        // Look for bullet points and remaining work
        const lines = merged.split("\n");
        for (const line of lines) {
            if (line.match(/^[-*]\s/) && !line.includes("[completed]")) {
                work.push(line.replace(/^[-*]\s/, "").trim());
            }
        }
        return work.slice(0, 10);
    }
    extractCompletedWork(merged) {
        const completed = [];
        const lines = merged.split("\n");
        for (const line of lines) {
            if (line.match(/^[-*]\s/) && line.includes("[completed]")) {
                completed.push(line
                    .replace(/^[-*]\s/, "")
                    .replace("[completed]", "")
                    .trim());
            }
        }
        return completed.slice(0, 10);
    }
    extractFileReferences(merged) {
        const files = [];
        // Look for file paths
        const patterns = [
            /[A-Za-z]:\\[\w\\]+(?:\.\w+)?/g, // Windows
            /\/[\w./-]+(?:\.\w+)?/g, // Unix
        ];
        for (const pattern of patterns) {
            for (const match of merged.matchAll(pattern)) {
                if (match[0] && !files.includes(match[0])) {
                    files.push(match[0]);
                }
            }
        }
        return files.slice(0, 20);
    }
    extractDecisions(merged) {
        const decisions = [];
        // Look for decision markers
        const lines = merged.split("\n");
        for (const line of lines) {
            if (line.match(/(?:decision|decided|chose|using):/i)) {
                decisions.push(line.replace(/^[-*]\s*/, "").trim());
            }
        }
        return decisions.slice(0, 5);
    }
}
// --- Factory ----------------------------------------------------------------
/**
 * Create a PartialRecovery manager for a task
 */
export function createPartialRecovery(jobId, taskId, rootDir) {
    return new PartialRecovery(jobId, taskId, rootDir);
}
