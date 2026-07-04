/**
 * Agent Handoff Protocol — RFC-0012
 *
 * Clean handoff between agents with context transfer.
 * Ensures continuity when switching agents mid-task.
 */

import type {
	HandoffContext,
	HandoffEvent,
} from "../packages/types/src/runtime-types.ts";
import { writeJson, readJson } from "../cli.ts";
// @ts-expect-error - Bun has built-in Node.js types
import { join } from "node:path";

export interface HandoffData {
	fromAgent: string;
	toAgent: string;
	taskId: string;
	taskSummary: string;
	contextFiles: string[];
	recentHistory: string[];
	currentState: Record<string, unknown>;
}

export class AgentHandoffProtocol {
	private readonly rootDir: string;

	constructor(rootDir: string) {
		this.rootDir = rootDir;
	}

	/**
	 * Create a handoff context for switching agents
	 */
	createHandoff(
		jobId: string,
		taskId: string,
		fromAgent: string,
		toAgent: string,
		currentState?: Record<string, unknown>,
	): HandoffContext {
		const events = this.loadHandoffHistory(jobId, taskId);

		return {
			jobId,
			taskId,
			fromAgent,
			toAgent,
			sharedFiles: [],
			taskHistory: events,
			summary: this.generateSummary(taskId, currentState),
		};
	}

	/**
	 * Record a handoff event
	 */
	recordHandoff(context: HandoffContext, result?: string): void {
		const path = join(
			this.rootDir,
			"jobs",
			context.jobId,
			"handoffs",
			`${context.taskId}.json`,
		);
		const event: HandoffEvent = {
			ts: new Date().toISOString(),
			agentId: context.toAgent,
			action: "handoff_received",
			result,
		};
		context.taskHistory.push(event);
		writeJson(path, context);
	}

	/**
	 * Generate handoff prompt for the receiving agent
	 */
	generateHandoffPrompt(context: HandoffContext): string {
		const lines = [
			`## Agent Handoff`,
			``,
			`**From Agent:** ${context.fromAgent}`,
			`**To Agent:** ${context.toAgent}`,
			`**Task:** ${context.taskId}`,
			``,
			`### Task History`,
		];

		for (const event of context.taskHistory) {
			lines.push(`- [${event.ts}] ${event.agentId}: ${event.action}`);
			if (event.result) {
				lines.push(`  Result: ${event.result}`);
			}
		}

		lines.push(``);
		lines.push(`### Summary`);
		lines.push(context.summary);

		if (context.sharedFiles.length > 0) {
			lines.push(``);
			lines.push(`### Shared Files`);
			for (const file of context.sharedFiles) {
				lines.push(`- ${file}`);
			}
		}

		return lines.join("\n");
	}

	/**
	 * Validate handoff readiness
	 */
	validateHandoff(context: HandoffContext): {
		valid: boolean;
		issues: string[];
	} {
		const issues: string[] = [];

		if (!context.summary) {
			issues.push("Task summary is empty");
		}

		if (context.taskHistory.length === 0) {
			issues.push("No task history recorded");
		}

		// Check for recent handoffs
		const recentHandoffs = context.taskHistory.filter((h) => {
			const age = Date.now() - Date.parse(h.ts);
			return age < 5 * 60 * 1000; // 5 minutes
		});

		if (recentHandoffs.length > 3) {
			issues.push(
				`Too many recent handoffs (${recentHandoffs.length}). Possible ping-pong.`,
			);
		}

		return { valid: issues.length === 0, issues };
	}

	/**
	 * Load handoff history for a task
	 */
	private loadHandoffHistory(jobId: string, taskId: string): HandoffEvent[] {
		const path = join(
			this.rootDir,
			"jobs",
			jobId,
			"handoffs",
			`${taskId}.json`,
		);
		const data = readJson(path) as HandoffContext | null;
		return data?.taskHistory ?? [];
	}

	/**
	 * Generate a summary of the task state
	 */
	private generateSummary(
		taskId: string,
		currentState?: Record<string, unknown>,
	): string {
		if (!currentState) {
			return `Task ${taskId} requires continuation. Check task files for current state.`;
		}

		const lines = [`Task ${taskId} is in progress.`];

		if (currentState.filesModified) {
			lines.push(
				`Files modified: ${(currentState.filesModified as string[]).join(", ")}`,
			);
		}

		if (currentState.lastAction) {
			lines.push(`Last action: ${currentState.lastAction}`);
		}

		if (currentState.blockers) {
			lines.push(`Blockers: ${currentState.blockers}`);
		}

		return lines.join("\n");
	}
}
