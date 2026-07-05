/**
 * Output Token Limit Handler — RFC-0020
 *
 * Handles model responses that stop because the maximum output token limit was reached.
 * Coordinates with AutoCompactEngine (RFC-0019) and PartialRecovery (RFC-0021).
 *
 * Classification Matrix:
 * | Failure Type       | Runtime Action           |
 * |--------------------|--------------------------|
 * | Quota exhausted    | pause until reset        |
 * | Context full       | compact and resume       |
 * | Output token limit | continue same task       |
 * | Unknown error      | retry or escalate        |
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CompactionEvent } from "./auto-compact.js";

export interface OutputLimitConfig {
	jobId: string;
	taskId: string;
	rootDir?: string;
	maxContinueAttempts?: number;
	continuationBackoffMs?: number;
	requireExpectedOutputValidation?: boolean;
}

export interface OutputLimitEvent {
	timestamp: string;
	jobId: string;
	taskId: string;
	reason: string;
	partialContent: string;
	finishReason: "length" | "stop" | "content_filter" | "error";
	attempts: number;
	continueSucceeded?: boolean;
}

export interface ExpectedOutput {
	description: string;
	validate?: (content: string) => boolean;
}

const OUTPUT_LIMIT_PATTERNS = [
	/reached the maximum output token limit/i,
	/output token limit/i,
	/response may be incomplete/i,
	/stop_reason.*length/i,
	/finish_reason.*length/i,
	/max_tokens.*exceeded/i,
	/completion.*truncated/i,
	/model.*stopped.*token/i,
];

export class OutputLimitHandler {
	private readonly rootDir: string;
	private readonly jobId: string;
	private readonly taskId: string;
	private readonly maxAttempts: number;
	private readonly backoffMs: number;
	private readonly requireValidation: boolean;
	private attempts = 0;
	private partials: string[] = [];

	constructor(config: OutputLimitConfig) {
		this.rootDir =
			config.rootDir ??
			join(homedir(), ".pi", "harness", config.jobId, "partial", config.taskId);
		this.jobId = config.jobId;
		this.taskId = config.taskId;
		this.maxAttempts = config.maxContinueAttempts ?? 5;
		this.backoffMs = config.continuationBackoffMs ?? 1000;
		this.requireValidation = config.requireExpectedOutputValidation ?? true;
		this.ensureDir();
	}

	/**
	 * Detect if an error or response indicates output limit was reached
	 */
	detectOutputLimit(
		error: unknown,
		response?: { finishReason?: string },
	): boolean {
		// Check error message
		if (error) {
			const errorStr = String(error).toLowerCase();
			for (const pattern of OUTPUT_LIMIT_PATTERNS) {
				if (pattern.test(errorStr)) {
					return true;
				}
			}
		}

		// Check finish reason
		if (response?.finishReason === "length") {
			return true;
		}

		return false;
	}

	/**
	 * Classify the type of failure for proper handling
	 */
	classifyFailure(
		error: unknown,
		response?: { finishReason?: string; content?: string },
	): "quota_exhausted" | "context_full" | "output_limit" | "unknown" {
		const errorStr = String(error ?? "").toLowerCase();

		// Check for quota exhaustion
		if (
			/error.*quota/i.test(errorStr) ||
			/error.*2056/i.test(errorStr) ||
			/error.*insufficient_quota/i.test(errorStr)
		) {
			return "quota_exhausted";
		}

		// Check for context/sequence length
		if (
			/error.*context.*length/i.test(errorStr) ||
			/error.*too many tokens/i.test(errorStr) ||
			/error.*maximum context/i.test(errorStr)
		) {
			return "context_full";
		}

		// Check for output token limit
		if (
			this.detectOutputLimit(error, response) ||
			response?.finishReason === "length"
		) {
			return "output_limit";
		}

		return "unknown";
	}

	/**
	 * Handle output limit - save partial and prepare continuation
	 */
	async handleOutputLimit(
		partialContent: string,
		finishReason: string = "length",
	): Promise<OutputLimitEvent> {
		this.attempts++;
		const timestamp = new Date().toISOString();

		// Save partial response
		const partialPath = this.savePartial(partialContent, this.attempts);
		this.partials.push(partialPath);

		// Create event
		const event: OutputLimitEvent = {
			timestamp,
			jobId: this.jobId,
			taskId: this.taskId,
			reason: "output_token_limit",
			partialContent,
			finishReason: finishReason as OutputLimitEvent["finishReason"],
			attempts: this.attempts,
		};

		// Save event
		this.saveEvent(event);

		// Wait with backoff before continuing
		await this.backoff();

		return event;
	}

	/**
	 * Check if we should continue (respects max attempts)
	 */
	shouldContinue(): boolean {
		return this.attempts < this.maxAttempts;
	}

	/**
	 * Get current attempt count
	 */
	getAttempts(): number {
		return this.attempts;
	}

	/**
	 * Get all partial responses
	 */
	getPartials(): string[] {
		return [...this.partials];
	}

	/**
	 * Merge partial responses
	 */
	mergePartials(): string {
		const merged: string[] = [];

		for (const partialPath of this.partials) {
			if (existsSync(partialPath)) {
				const content = readFileSync(partialPath, "utf-8");
				merged.push(content);
			}
		}

		// v0.1: simple concatenation as markdown sections
		return merged
			.map((p, i) => `## Partial ${i + 1}\n\n${p}`)
			.join("\n\n---\n\n");
	}

	/**
	 * Build continue message for the next turn
	 */
	buildContinueMessage(additionalContext?: string): string {
		const merged = this.mergePartials();

		const lines = [
			"# Continue From Partial Response",
			"",
			"The previous response was truncated due to output token limit.",
			"",
			"## Merged Partial Content",
			"",
			merged,
		];

		if (additionalContext) {
			lines.push("", "## Additional Context");
			lines.push("", additionalContext);
		}

		lines.push("", "## Instructions");
		lines.push("");
		lines.push("1. Review the partial content above");
		lines.push("2. Continue from where the response was truncated");
		lines.push("3. Do not repeat content that already appears above");
		lines.push(
			`4. This is attempt ${this.attempts + 1} of ${this.maxAttempts}`,
		);

		return lines.join("\n");
	}

	/**
	 * Validate expected output if configured
	 */
	validateOutput(content: string, expected: ExpectedOutput): boolean {
		if (!this.requireValidation) {
			return true;
		}

		if (expected.validate) {
			return expected.validate(content);
		}

		// Basic validation: content should be longer than partial
		return content.length > this.getPartials()[0]?.length ?? 0;
	}

	/**
	 * Reset for a new task
	 */
	reset(): void {
		this.attempts = 0;
		this.partials = [];
	}

	/**
	 * Check if escalation is needed (max attempts reached)
	 */
	shouldEscalate(): boolean {
		return this.attempts >= this.maxAttempts;
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private ensureDir(): void {
		if (!existsSync(this.rootDir)) {
			mkdirSync(this.rootDir, { recursive: true });
		}
	}

	private savePartial(content: string, attempt: number): string {
		const filename = `partial_${String(attempt).padStart(3, "0")}.md`;
		const path = join(this.rootDir, filename);
		writeFileSync(path, content, "utf-8");
		return path;
	}

	private saveEvent(event: OutputLimitEvent): void {
		const eventsPath = join(this.rootDir, "events.jsonl");
		writeFileSync(eventsPath, JSON.stringify(event) + "\n", "utf-8");

		// Also save recovery status
		const statusPath = join(this.rootDir, "recovery_status.json");
		const status = {
			taskId: this.taskId,
			status: this.shouldContinue() ? "continuing" : "escalated",
			partials: this.partials.map((p) => p.split("/").pop()),
			mergedOutput: "merged.md",
			attempts: this.attempts,
			lastError: event.reason,
		};
		writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n", "utf-8");
	}

	private async backoff(): Promise<void> {
		const delay = this.backoffMs * 2 ** (this.attempts - 1);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
}
