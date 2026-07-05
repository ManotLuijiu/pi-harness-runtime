/**
 * Auto Compact and Continue — RFC-0019
 *
 * Automatically resume work after model/session compaction without requiring
 * human intervention. Keeps the human out of the message-bus role.
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
}

export interface ContinuePrompt {
	taskId: string;
	originalRequirement: string;
	whatWasCompleted: string;
	whatNeedsToBeDone: string;
	partialFiles: string[];
	nextSteps: string;
}

const COMPACTION_PATTERNS = [
	/\[compaction\]/i,
	/compacted from \d+[,.]?\d* tokens/i,
	/model stopped because it reached the maximum output token limit/i,
	/error.*output.*token.*limit/i,
	/context.*truncated/i,
	/session.*compact/i,
];

const CONTINUE_MARKERS = [
	/would you like me to continue/i,
	/should i continue/i,
	/type.*continue/i,
	/\[continue\]/i,
	/waiting for your response/i,
];

export class AutoCompactEngine {
	private readonly rootDir: string;
	private readonly jobId: string;
	private readonly maxAttempts: number;
	private readonly backoffMs: number;
	private continueAttempts = 0;

	constructor(config: CompactionConfig) {
		this.rootDir =
			config.rootDir ??
			join(homedir(), ".pi", "harness", config.jobId, "context");
		this.jobId = config.jobId;
		this.maxAttempts = config.maxContinueAttempts ?? 5;
		this.backoffMs = config.continuationBackoffMs ?? 1000;
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
		const lines = output.split("\n");
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
	 * Generate continue prompt
	 */
	generateContinuePrompt(
		taskId: string,
		completedWork: string,
		remainingWork: string,
	): ContinuePrompt {
		const prompt: ContinuePrompt = {
			taskId,
			originalRequirement: this.getRequirement(),
			whatWasCompleted: completedWork,
			whatNeedsToBeDone: remainingWork,
			partialFiles: this.findPartialFiles(),
			nextSteps: remainingWork,
		};

		const promptPath = join(this.rootDir, "continue_prompt.md");
		const promptContent = this.formatContinuePrompt(prompt);
		writeFileSync(promptPath, promptContent, "utf-8");

		return prompt;
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

	private formatContinuePrompt(prompt: ContinuePrompt): string {
		const lines = [
			"# Continue Previous Task",
			"",
			"## Task Context",
			"",
			"**Requirement:** " + prompt.originalRequirement,
			"",
			"## What Was Completed",
			"",
			prompt.whatWasCompleted ||
				"Work was in progress when session was compacted.",
			"",
		];

		if (prompt.partialFiles.length > 0) {
			lines.push("## Partial Files Created");
			lines.push("");
			for (const file of prompt.partialFiles) {
				lines.push(`- ${file}`);
			}
			lines.push("");
		}

		lines.push("## What Needs To Be Done");
		lines.push("");
		lines.push(
			prompt.whatNeedsToBeDone || "Continue the task from where it left off.",
		);
		lines.push("");
		lines.push("## Instructions");
		lines.push("");
		lines.push("1. Review any partial files created");
		lines.push("2. Continue from where the previous session ended");
		lines.push("3. Complete the remaining work");
		lines.push("4. Ensure all tests pass");
		lines.push("");
		lines.push("**Do not repeat work that was already completed.**");

		return lines.join("\n");
	}

	private getRequirement(): string {
		const checkpointPath = join(
			homedir(),
			".pi",
			"harness",
			this.jobId,
			"checkpoint.json",
		);
		if (existsSync(checkpointPath)) {
			try {
				const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf-8"));
				return checkpoint.requirement ?? "Unknown requirement";
			} catch {
				return "Unknown requirement";
			}
		}
		return "Unknown requirement";
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
