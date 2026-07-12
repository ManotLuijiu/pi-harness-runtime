/**
 * Forked Summarizer — RFC-0028
 *
 * Summarizes old messages via a separate LLM call (forked context).
 * This prevents the summarization request from hitting the same
 * context-too-long error that triggered compaction.
 */

import type {
	CompactableMessage,
	CompactTriggerReason,
	InvokeResult,
} from "../packages/types/src/runtime-types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SummarizerConfig {
	/** Model to use for summarization */
	model: string;
	/** Provider for API calls */
	provider?: string;
	/** Max tokens for summary output */
	maxSummaryTokens: number;
	/** Custom system prompt */
	systemPrompt?: string;
	/** Focus of summarization */
	focusOn?: "work_done" | "decisions" | "all";
}

export interface SummarizerResult {
	summary: string;
	droppedCount: number;
	tokensUsed?: number;
}

export interface InvokeOptions {
	messages: Array<{
		role: "system" | "user" | "assistant";
		content: string;
	}>;
	model: string;
	maxOutputTokens: number;
	systemPrompt?: string;
}

// ─── Default System Prompt ───────────────────────────────────────────────────

const DEFAULT_SUMMARY_SYSTEM = `You are a conversation summarizer. Your task is to create concise, accurate summaries that preserve essential context for continuing a conversation.

Focus on:
- What was the goal/problem being addressed?
- What approaches were tried and what were the results?
- What decisions were made and why?
- What remains to be done?
- What files or code sections are relevant?

IMPORTANT: Do NOT include tool_result content verbatim. Instead, summarize the outcomes.`;

const WORK_DONE_FOCUS = `Focus specifically on:
1. What work was accomplished?
2. What files were created, modified, or deleted?
3. What tests passed or failed?
4. What errors or issues were encountered and resolved?
5. What is the current state of the project?`;

const DECISIONS_FOCUS = `Focus specifically on:
1. What architectural decisions were made?
2. What approaches were chosen over alternatives?
3. What was the rationale for each decision?
4. What constraints or requirements influenced the decisions?
5. Any lessons learned or trade-offs considered?`;

// ─── Forked Summarizer ──────────────────────────────────────────────────────

export class ForkedSummarizer {
	private readonly config: SummarizerConfig;
	private readonly invokeAgent: (opts: InvokeOptions) => Promise<InvokeResult>;

	constructor(
		config: SummarizerConfig,
		invokeAgent: (opts: InvokeOptions) => Promise<InvokeResult>,
	) {
		this.config = {
			provider: "openai",
			focusOn: "all",
			...config,
		};
		this.invokeAgent = invokeAgent;
	}

	/**
	 * Summarize old messages, keeping recent ones as context
	 */
	async summarize(
		messages: CompactableMessage[],
		options?: {
			/** Number of recent messages to keep (default: 5) */
			keepRecentCount?: number;
			/** Override focus for this call */
			focusOn?: "work_done" | "decisions" | "all";
		},
	): Promise<SummarizerResult> {
		const keepRecentCount = options?.keepRecentCount ?? 5;
		const focusOn = options?.focusOn ?? this.config.focusOn ?? "all";

		// Split messages
		const recentMessages = messages.slice(-keepRecentCount);
		const oldMessages = messages.slice(0, -keepRecentCount);

		if (oldMessages.length === 0) {
			return { summary: "", droppedCount: 0 };
		}

		// Build summary prompt
		const summaryPrompt = this.buildSummaryPrompt(oldMessages, { focusOn });

		// Create summarization messages
		const summarizationMessages = [
			{
				role: "system" as const,
				content: this.config.systemPrompt ?? DEFAULT_SUMMARY_SYSTEM,
			},
			{
				role: "user" as const,
				content: summaryPrompt,
			},
		];

		// Call summarization model
		try {
			const result = await this.invokeAgent({
				messages: summarizationMessages,
				model: this.config.model,
				maxOutputTokens: this.config.maxSummaryTokens,
			});

			if (!result.success || !result.output) {
				throw new Error(`Summarization failed: ${result.error ?? "unknown"}`);
			}

			return {
				summary: result.output.trim(),
				droppedCount: oldMessages.length,
				tokensUsed: result.usage?.totalTokens,
			};
		} catch (error) {
			// Return heuristic summary on failure
			return {
				summary: this.heuristicSummary(oldMessages, focusOn),
				droppedCount: oldMessages.length,
			};
		}
	}

	/**
	 * Build the summary prompt for the LLM
	 */
	private buildSummaryPrompt(
		messages: CompactableMessage[],
		options: { focusOn?: "work_done" | "decisions" | "all" },
	): string {
		const focusOn = options.focusOn ?? "all";
		const formattedMessages = messages
			.map((m) => `[${m.role}]\n${this.truncateContent(m.content, 2000)}`)
			.join("\n\n---\n\n");

		const focusInstructions = {
			work_done: WORK_DONE_FOCUS,
			decisions: DECISIONS_FOCUS,
			all: "Provide a comprehensive summary covering all important aspects of the conversation.",
		}[focusOn];

		return `Summarize the following conversation concisely.

${focusInstructions}

## Conversation to Summarize
${formattedMessages}

## Output Format
Provide a summary in 500-1000 tokens that:
1. Captures the essential context
2. Preserves key decisions and their rationale
3. Notes any ongoing work or next steps
4. Lists any important files or code sections referenced

Do not include verbatim tool results — summarize their outcomes instead.`;
	}

	/**
	 * Truncate content to max length
	 */
	private truncateContent(content: string, maxLength: number): string {
		if (content.length <= maxLength) return content;
		return content.substring(0, maxLength) + "... [truncated]";
	}

	/**
	 * Heuristic summary when LLM summarization fails
	 */
	private heuristicSummary(
		messages: CompactableMessage[],
		focusOn: "work_done" | "decisions" | "all",
	): string {
		const summaries: string[] = [];
		const keyFiles: Set<string> = new Set();
		const decisions: string[] = [];

		// Extract patterns from last 20 messages
		for (const msg of messages.slice(-20)) {
			const content = msg.content;

			// Look for file references
			const filePatterns = [
				/created (?:file|module):?\s*([^\n.]+)/gi,
				/modified (?:file|module):?\s*([^\n.]+)/gi,
				/wrote to ([\w./-]+)/gi,
				/updated ([\w./-]+)/gi,
			];

			for (const pattern of filePatterns) {
				for (const match of content.matchAll(pattern)) {
					if (match[1]) keyFiles.add(match[1].trim());
				}
			}

			// Look for decisions
			const decisionPatterns = [
				/(?:decided|choosing|choice|chose):?\s*([^\n.]+)/gi,
				/(?:approach|strategy):?\s*([^\n.]+)/gi,
			];

			for (const pattern of decisionPatterns) {
				for (const match of content.matchAll(pattern)) {
					if (match[1]) decisions.push(match[1].trim());
				}
			}

			// Extract key user messages
			if (msg.role === "user" && content.length > 50) {
				summaries.push(`- User: ${content.substring(0, 300)}`);
			}

			// Extract significant actions from assistant
			if (msg.role === "assistant" && msg.metadata?.action) {
				summaries.push(`- Action: ${msg.metadata.action}`);
			}
		}

		// Build heuristic summary
		const parts: string[] = [
			`[Context compacted — ${messages.length} messages summarized by heuristic]`,
			"",
		];

		if (keyFiles.size > 0) {
			parts.push("## Files Referenced");
			for (const file of Array.from(keyFiles).slice(0, 10)) {
				parts.push(`- ${file}`);
			}
			parts.push("");
		}

		if (decisions.length > 0) {
			parts.push("## Key Points");
			for (const decision of Array.from(new Set(decisions)).slice(0, 5)) {
				parts.push(`- ${decision}`);
			}
			parts.push("");
		}

		if (summaries.length > 0) {
			parts.push("## Summary");
			for (const summary of summaries.slice(0, 10)) {
				parts.push(summary);
			}
			parts.push("");
		}

		parts.push("Please continue from the recent messages provided.");

		return parts.join("\n");
	}
}

// ─── Convenience Factory ────────────────────────────────────────────────────

/**
 * Create a ForkedSummarizer with default config
 */
export function createForkedSummarizer(
	model: string,
	invokeAgent: (opts: InvokeOptions) => Promise<InvokeResult>,
	config?: Partial<SummarizerConfig>,
): ForkedSummarizer {
	return new ForkedSummarizer(
		{
			model,
			maxSummaryTokens: 4096,
			...config,
		},
		invokeAgent,
	);
}
