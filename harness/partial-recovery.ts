/**
 * Partial Response Recovery — RFC-0021
 *
 * Persist and recover incomplete agent outputs.
 * Never loses partial response text.
 *
 * Artifact Layout:
 *   harness/partial/
 *     task_004/
 *       partial_001.md
 *       partial_002.md
 *       merged.md
 *       recovery_status.json
 *       files.json
 */

import {
	existsSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface PartialResponse {
	id: string;
	timestamp: string;
	taskId: string;
	content: string;
	source: "output_limit" | "compaction" | "interrupt" | "error";
	metadata?: Record<string, unknown>;
}

export interface RecoveryStatus {
	taskId: string;
	status: "pending" | "continuing" | "completed" | "escalated" | "failed";
	partials: string[];
	mergedOutput?: string;
	attempts: number;
	lastError?: string;
	completedAt?: string;
}

export interface MergeOptions {
	method: "markdown_sections" | "code_blocks" | "json_concat" | "patch_merge";
	removeDuplicates?: boolean;
	preserveOrder?: boolean;
}

export class PartialRecovery {
	private readonly rootDir: string;
	private readonly taskId: string;
	private partials: PartialResponse[] = [];

	constructor(jobId: string, taskId: string, rootDir?: string) {
		this.rootDir =
			rootDir ?? join(homedir(), ".pi", "harness", jobId, "partial", taskId);
		this.taskId = taskId;
		this.ensureDir();
		this.loadExistingPartials();
	}

	/**
	 * Save a partial response
	 */
	savePartial(
		content: string,
		source: PartialResponse["source"] = "output_limit",
		metadata?: Record<string, unknown>,
	): PartialResponse {
		const partial: PartialResponse = {
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
	 * Get all partial responses
	 */
	getPartials(): PartialResponse[] {
		return [...this.partials];
	}

	/**
	 * Get the count of partials
	 */
	getCount(): number {
		return this.partials.length;
	}

	/**
	 * Merge partials using the specified strategy
	 */
	merge(options: MergeOptions = { method: "markdown_sections" }): string {
		if (this.partials.length === 0) {
			return "";
		}

		let merged: string;

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
	 * Load partials from a continuation prompt
	 */
	loadFromContinuationPrompt(prompt: string): void {
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
	hasPartials(): boolean {
		return this.partials.length > 0;
	}

	/**
	 * Check if we should escalate (too many partials)
	 */
	shouldEscalate(maxPartials: number = 10): boolean {
		return this.partials.length >= maxPartials;
	}

	/**
	 * Mark recovery as completed
	 */
	markCompleted(): void {
		this.updateStatus("completed");
	}

	/**
	 * Mark recovery as failed
	 */
	markFailed(error: string): void {
		this.updateStatus("failed", error);
	}

	/**
	 * Mark recovery as escalated
	 */
	markEscalated(): void {
		this.updateStatus("escalated");
	}

	/**
	 * Get recovery status
	 */
	getStatus(): RecoveryStatus {
		const statusPath = join(this.rootDir, "recovery_status.json");
		if (existsSync(statusPath)) {
			try {
				return JSON.parse(readFileSync(statusPath, "utf-8")) as RecoveryStatus;
			} catch {
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
	cleanup(keepMerged: boolean = true): void {
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
			} catch {
				// Ignore errors
			}
		}
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private ensureDir(): void {
		if (!existsSync(this.rootDir)) {
			mkdirSync(this.rootDir, { recursive: true });
		}
	}

	private loadExistingPartials(): void {
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

	private generateId(): string {
		const count = this.partials.length + 1;
		return `partial_${String(count).padStart(3, "0")}`;
	}

	private saveFilesManifest(): void {
		const manifestPath = join(this.rootDir, "files.json");
		const files = this.partials.map((p) => ({
			id: p.id,
			file: `${p.id}.md`,
			timestamp: p.timestamp,
			source: p.source,
		}));
		writeFileSync(manifestPath, JSON.stringify(files, null, 2), "utf-8");
	}

	private updateStatus(status: RecoveryStatus["status"], error?: string): void {
		const statusPath = join(this.rootDir, "recovery_status.json");
		const current = this.getStatus();

		const updated: RecoveryStatus = {
			taskId: this.taskId,
			status,
			partials: this.partials.map((p) => `${p.id}.md`),
			mergedOutput: existsSync(join(this.rootDir, "merged.md"))
				? "merged.md"
				: undefined,
			attempts: current.attempts + 1,
			lastError: error ?? current.lastError,
			completedAt:
				status === "completed" ? new Date().toISOString() : undefined,
		};

		writeFileSync(statusPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
	}

	private mergeAsMarkdownSections(): string {
		return this.partials
			.map((p, i) => `## Partial ${i + 1} (${p.source})\n\n${p.content}`)
			.join("\n\n---\n\n");
	}

	private mergeCodeBlocks(): string {
		const codeBlocks: string[] = [];

		for (const partial of this.partials) {
			const matches = partial.content.match(/```[\s\S]*?```/g);
			if (matches) {
				codeBlocks.push(...matches);
			}
		}

		// Remove duplicates
		const seen = new Set<string>();
		const unique: string[] = [];
		for (const block of codeBlocks) {
			if (!seen.has(block)) {
				seen.add(block);
				unique.push(block);
			}
		}
		return unique.join("\n\n");
	}

	private mergeJson(): string {
		const results: unknown[] = [];

		for (const partial of this.partials) {
			try {
				const parsed = JSON.parse(partial.content);
				if (Array.isArray(parsed)) {
					results.push(...parsed);
				} else {
					results.push(parsed);
				}
			} catch {
				// Not JSON, include as-is
				results.push({ _raw: partial.content });
			}
		}

		return JSON.stringify(results, null, 2);
	}

	private mergePatchBased(): string {
		// Simple approach: concatenate non-overlapping parts
		const parts: string[] = [];

		for (const partial of this.partials) {
			// Look for new content after last marker
			const lines = partial.content.split("\n");
			const newLines: string[] = [];

			for (const line of lines) {
				// Skip if it looks like a duplicate header
				if (
					!parts.some(
						(p) =>
							p.includes(line) ||
							line.startsWith("#") ||
							line.startsWith("---"),
					)
				) {
					newLines.push(line);
				}
			}

			if (newLines.length > 0) {
				parts.push(newLines.join("\n"));
			}
		}

		return parts.join("\n\n---\n\n");
	}

	private removeDuplicates(text: string): string {
		const lines = text.split("\n");
		const seen = new Set<string>();
		const unique: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!seen.has(trimmed) && trimmed.length > 0) {
				seen.add(trimmed);
				unique.push(line);
			}
		}

		return unique.join("\n");
	}
}
