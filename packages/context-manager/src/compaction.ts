/**
 * Context Manager — Compaction Engine (RFC-0010)
 */

import type {
	ContextItem,
	CompactionResult,
	ResumePrompt,
	TriggerPolicy,
} from "./types.js";
import { DEFAULT_POLICY } from "./core.js";
import { prioritize } from "./core.js";

/** Extract decisions from messages (lines starting with DECISION markers). */
function extractDecisions(messages: ContextItem[]): string[] {
	const decisions: string[] = [];
	for (const msg of messages) {
		for (const line of msg.content.split("\n")) {
			const trimmed = line.trim();
			if (
				trimmed.startsWith("- DECISION:") ||
				trimmed.startsWith("**DECISION**") ||
				/^(?:decision|decided):/i.test(trimmed)
			) {
				decisions.push(trimmed.replace(/^[*>-]+\s*/i, "").trim());
			}
		}
	}
	return [...new Set(decisions)];
}

/** Extract open questions (lines with ?, TODO, TBD, OPEN markers). */
function extractQuestions(messages: ContextItem[]): string[] {
	const questions: string[] = [];
	for (const msg of messages) {
		for (const line of msg.content.split("\n")) {
			const trimmed = line.trim();
			if (
				trimmed.includes("?") ||
				/\bTODO\b/i.test(trimmed) ||
				/\bTBD\b/i.test(trimmed)
			) {
				const cleaned = trimmed.replace(/^[*>-]+\s*/, "").trim();
				if (cleaned.length > 5) questions.push(cleaned);
			}
		}
	}
	return [...new Set(questions)];
}

/** Extract task progress from messages. */
function extractTaskProgress(messages: ContextItem[]): Record<string, string> {
	const progress: Record<string, string> = {};
	for (const msg of messages) {
		for (const line of msg.content.split("\n")) {
			const match = line.match(
				/^(?:progress|task|step)[:\s]+([^|]+)\|\s*(.+)/i,
			);
			if (match) progress[match[1].trim()] = match[2].trim();
		}
	}
	return progress;
}

/** Compact context by extracting durable state and keeping high-priority items. */
export function compactContext(
	messages: ContextItem[],
	maxTokens: number,
	policy: TriggerPolicy = DEFAULT_POLICY,
): CompactionResult {
	const decisions = extractDecisions(messages);
	const openQuestions = extractQuestions(messages);
	const taskProgress = extractTaskProgress(messages);

	const prioritized = prioritize(messages, Math.floor(messages.length * 0.6));
	let tokenCount = 0;
	const kept: string[] = [];

	for (const msg of prioritized) {
		if (
			tokenCount + msg.tokens <=
			Math.floor(maxTokens * policy.compactThreshold)
		) {
			kept.push(msg.content);
			tokenCount += msg.tokens;
		}
	}

	return {
		decisions,
		openQuestions,
		taskProgress,
		remainingTokens: tokenCount,
		compactedContent: kept.join("\n\n"),
	};
}

/** Generate a resume prompt from compaction result. */
export function generateResumePrompt(
	result: CompactionResult,
	nextAction?: string,
): ResumePrompt {
	const summary = [
		"## Session Summary",
		`Decisions: ${result.decisions.length > 0 ? result.decisions.join("; ") : "none"}`,
		`Questions: ${result.openQuestions.length > 0 ? result.openQuestions.join("; ") : "none"}`,
		`Context size: ${result.remainingTokens} tokens`,
	].join("\n");

	return {
		summary,
		decisions: result.decisions,
		openQuestions: result.openQuestions,
		taskProgress: result.taskProgress,
		nextAction: nextAction ?? "Continue from last position",
	};
}

/** Format resume prompt as markdown string. */
export function formatResumeMarkdown(prompt: ResumePrompt): string {
	const lines = [
		"# Resume Prompt",
		"",
		prompt.summary,
		"",
		"## Decisions",
		...prompt.decisions.map((d) => `- ${d}`),
		"",
		"## Open Questions",
		...prompt.openQuestions.map((q) => `- ${q}`),
		"",
		"## Task Progress",
		...Object.entries(prompt.taskProgress).map(([k, v]) => `- **${k}**: ${v}`),
		"",
		"## Next Action",
		`- ${prompt.nextAction}`,
	];
	return lines.filter((l) => l).join("\n");
}
