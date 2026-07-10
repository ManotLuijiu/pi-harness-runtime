/**
 * Auto Compact and Continue — RFC-0019
 *
 * Automatically resume work after model/session compaction without requiring
 * human intervention. Keeps the human out of the message-bus role.
 *
 * This module integrates with:
 * - `continue-prompt.ts` for prompt generation
 * - `context-compact-orchestrator.ts` for compact decisions
 * - `partial-recovery.ts` for artifact persistence
 *
 * Artifact Layout:
 *   harness/context/
 *     compaction_events.jsonl
 *     latest_compaction_summary.md
 *     continue_prompt.md
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
	continuePromptGenerator,
	type ContinueContext,
} from "./continue-prompt.js";

export interface CompactionEvent {
	timestamp: string;
	jobId: string;
	taskId: string;
	compactedFromTokens: number;
	reason: string;
	errorMessage?: string;
	partialOutput?: string;
	continuePrompt?: string;
}

export interface CompactionConfig {
	jobId: string;
	rootDir?: string;
	maxContinueAttempts?: number;
	continuationBackoffMs?: number;
	requirement?: string;
}

const COMPACTION_PATTERNS = [
	/\[compaction\]/i,
	/compacted from \d+[,.]?\d* tokens/i,
	/model stopped because it reached the maximum output token limit/i,
	/error.*output.*token.*limit/i,
	/context.*truncated/i,
	/session.*compact/i,
	/\[Earlier conversation summarized\]/i,
];

const CONTINUE_MARKERS = [
	/would you like me to continue/i,
	/should i continue/i,
	/type.*continue/i,
	/\[continue\]/i,
	/waiting for your response/i,
	/do not repeat work already completed/i,
];

export class AutoCompactEngine {
	private readonly rootDir: string;
	private readonly jobId: string;
	private readonly requirement: string;
	private readonly maxAttempts: number;
	private continueAttempts = 0;

	constructor(config: CompactionConfig) {
		this.rootDir =
			config.rootDir ??
			join(homedir(), ".pi", "harness", config.jobId, "context");
		this.jobId = config.jobId;
		this.requirement = config.requirement ?? "";
		this.maxAttempts = config.maxContinueAttempts ?? 5;
	}

	/**
	 * Detect if output contains compaction markers
	 */
	detectCompaction(output: string): boolean {
		return COMPACTION_PATTERNS.some((pattern) => pattern.test(output));
	}

	/**
	 * Detect if output is waiting for continue signal
	 */
	isWaitingForContinue(output: string): boolean {
		return CONTINUE_MARKERS.some((pattern) => pattern.test(output));
	}

	/**
	 * Parse compaction details from output
	 */
	parseCompactionEvent(output: string, taskId: string): CompactionEvent | null {
		let compactedFromTokens = 0;
		let reason = "unknown";
		let errorMessage: string | undefined;

		// Extract compacted token count
		const tokenMatch = output.match(
			/compacted from ([,\d]+(?:\.\d+)?)\s*tokens/i,
		);
		if (tokenMatch) {
			compactedFromTokens = parseInt(tokenMatch[1].replace(/,/g, ""), 10);
		}

		// Extract reason
		if (/output.*token.*limit/i.test(output)) {
			reason = "output_token_limit";
		} else if (/context.*truncated/i.test(output)) {
			reason = "context_truncated";
		} else if (/session.*compact/i.test(output)) {
			reason = "session_compact";
		} else if (/\[Earlier conversation summarized\]/i.test(output)) {
			reason = "context_compact";
		}

		// Extract error message
		const errorMatch = output.match(/error[:\s]+(.+)/i);
		if (errorMatch) {
			errorMessage = errorMatch[1].trim();
		}

		return {
			timestamp: new Date().toISOString(),
			jobId: this.jobId,
			taskId,
			compactedFromTokens,
			reason,
			errorMessage,
			partialOutput: output,
		};
	}

	/**
	 * Save compaction artifact
	 */
	saveCompactionArtifact(event: CompactionEvent): void {
		this.ensureDir();

		// Append to events log
		const eventsPath = join(this.rootDir, "compaction_events.jsonl");
		appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf-8");

		// Write latest summary
		const summaryPath = join(this.rootDir, "latest_compaction_summary.md");
		const summary = this.generateSummary(event);
		writeFileSync(summaryPath, summary, "utf-8");
	}

	/**
	 * Generate continue prompt using ContinuePromptGenerator
	 */
	generateContinuePrompt(
		taskId: string,
		completedWork: string[],
		remainingWork: string[],
	): string {
		const context: ContinueContext = {
			taskId,
			requirement: this.requirement || "Continue from previous session",
			whatWasCompleted: completedWork,
			whatNeedsToBeDone: remainingWork,
			partialFiles: this.findPartialFiles(),
			decisions: [],
		};

		const prompt = continuePromptGenerator.generate(context);

		// Also save to file for persistence
		const promptPath = join(this.rootDir, "continue_prompt.md");
		writeFileSync(promptPath, prompt, "utf-8");

		return prompt;
	}

	/**
	 * Generate minimal continue prompt
	 */
	generateMinimalContinuePrompt(
		summary: string,
		recentContent: string,
	): string {
		return [
			"Continue from where you left off.",
			"",
			"## Summary",
			summary,
			"",
			"## Recent Context",
			recentContent.substring(0, 2000),
			"",
			"**Do not repeat work already completed.** Focus on completing the remaining work.",
		].join("\n");
	}

	/**
	 * Check if we should continue (respects max attempts)
	 */
	shouldContinue(): boolean {
		this.continueAttempts++;
		return this.continueAttempts <= this.maxAttempts;
	}

	/**
	 * Get current continue attempt count
	 */
	getContinueAttempts(): number {
		return this.continueAttempts;
	}

	/**
	 * Reset continue attempts
	 */
	resetAttempts(): void {
		this.continueAttempts = 0;
	}

	/**
	 * Build the continue message for the next turn
	 */
	buildContinueMessage(): string {
		const promptPath = join(this.rootDir, "continue_prompt.md");
		if (existsSync(promptPath)) {
			const prompt = readFileSync(promptPath, "utf-8");
			return `continue\n\n${prompt}`;
		}
		return "continue";
	}

	/**
	 * Load continue prompt from file
	 */
	loadContinuePrompt(): string | null {
		const promptPath = join(this.rootDir, "continue_prompt.md");
		if (existsSync(promptPath)) {
			return readFileSync(promptPath, "utf-8");
		}
		return null;
	}

	/**
	 * Check if there's a pending continue prompt
	 */
	hasContinuePrompt(): boolean {
		return existsSync(join(this.rootDir, "continue_prompt.md"));
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private ensureDir(): void {
		if (!existsSync(this.rootDir)) {
			mkdirSync(this.rootDir, { recursive: true });
		}
	}

	private generateSummary(event: CompactionEvent): string {
		return `# Compaction Summary

**Time:** ${event.timestamp}
**Job:** ${event.jobId}
**Task:** ${event.taskId}
**Reason:** ${event.reason}
**Tokens Compacted:** ${event.compactedFromTokens.toLocaleString()}

${event.errorMessage ? `**Error:** ${event.errorMessage}` : ""}

## What Happened

Session was compacted due to ${event.reason}.

${
	event.compactedFromTokens > 0
		? `Context was reduced from approximately ${event.compactedFromTokens.toLocaleString()} tokens.`
		: "Context was compacted."
}

## Next Step

Runtime will automatically continue this task.

Continue attempts: ${this.continueAttempts}/${this.maxAttempts}
`;
	}

	private findPartialFiles(): string[] {
		const partialDir = join(this.rootDir, "..", "partial", this.jobId);
		if (!existsSync(partialDir)) {
			return [];
		}

		try {
			const files = readFileSync(join(partialDir, "files.json"), "utf-8");
			return JSON.parse(files) as string[];
		} catch {
			return [];
		}
	}
}
