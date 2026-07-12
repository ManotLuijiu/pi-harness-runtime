/**
 * Context Compact Orchestrator — Integration Layer
 *
 * Connects token estimation + microcompact + full compact into the harness loop.
 * Enhanced with proper proactive/reactive compact and circuit breaker.
 *
 * Architecture:
 *   LoopRuntime.executeTask()
 *     └─> CompactOrchestrator.invokeWithCompact()
 *           ├─> beforeInvoke():
 *           │     1. Estimate token count with buffer awareness
 *           │     2. Check circuit breaker status
 *           │     3. Microcompact: prune old tool results if time-based
 *           │     4. If over autoCompactThreshold → Full compact via forked summarization
 *           └─> afterInvoke():
 *                 1. Update token stats
 *                 2. Handle reactive 413 (context too long)
 *                 3. Generate continue prompt
 */

import type {
	CompactableMessage,
	InvokeWithCompactOptions,
	InvokeResult,
	CompactResult,
	CompactTriggerReason,
} from "../packages/types/src/runtime-types.js";
import {
	roughTokenCount,
	roughMessagesTokens,
} from "../packages/token-estimation/src/index.js";
import {
	ContextWindowManager,
	microcompactToolResults,
	parseTokenGapFromError,
	AUTOCOMPACT_BUFFER_TOKENS,
	MAX_CONSECUTIVE_COMPACT_FAILURES,
} from "./context-window-manager.js";
import { continuePromptGenerator } from "./continue-prompt.js";

// ─── Re-exports ────────────────────────────────────────────────────────────────

/** Re-export CompactTriggerReason so harness/index.ts can re-export from here */
export type { CompactTriggerReason } from "../packages/types/src/runtime-types.js";

// ─── Callbacks ────────────────────────────────────────────────────────────────

/** Callbacks provided by the harness to handle compact side-effects */
export interface CompactOrchestratorCallbacks {
	/**
	 * The actual LLM invocation.
	 * Required unless opts.invokeAgent is passed to invokeWithCompact.
	 */
	invokeAgent?: (opts: InvokeWithCompactOptions) => Promise<InvokeResult>;
	/** Called after every successful compaction with a summary */
	onCheckpoint?: (result: CompactResult) => void;
	/** Called when quota events occur during compact */
	onQuotaEvent?: (
		event: "paused" | "resumed" | "exhausted",
		provider?: string,
	) => void;
	/** Called before compact starts */
	onPreCompact?: (reason: CompactTriggerReason) => void;
	/** Called after compact completes */
	onPostCompact?: (result: CompactResult) => void;
	/**
	 * Forked summarization: summarize old messages via a separate LLM call.
	 * Returns { summary, droppedCount }.
	 * If not provided, falls back to heuristic truncation.
	 */
	summarizeViaForkedAgent?: (
		messages: CompactableMessage[],
		reason: CompactTriggerReason,
	) => Promise<{ summary: string; droppedCount: number }>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface CompactOrchestratorConfig {
	jobId: string;
	/** Provider name for ContextWindowManager (default: "openai") */
	provider?: string;
	/** Model for token estimation (default: "gpt-4") */
	model?: string;
	/** Trigger auto-compact at this usage pct (0-1). Default: 0.85 */
	autoCompactThreshold?: number;
	/** Stop API calls at this pct (0-1). Default: 0.97 */
	blockingThreshold?: number;
	/** Max compact attempts before circuit breaker. Default: 3 */
	maxCompactAttempts?: number;
	/** Time gap (ms) after which to microcompact old tool results. Default: 30 min */
	microcompactTimeGapMs?: number;
	/** Keep this many recent tool results during microcompact. Default: 2 */
	microcompactKeepRecent?: number;
	/** Context window size for the model */
	contextWindowSize?: number;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Compact Orchestrator
 *
 * Wraps LLM invocations with compact checks.
 * Call invokeWithCompact() instead of calling the LLM directly.
 *
 * Usage:
 *   const orchestrator = new CompactOrchestrator({ jobId: "job-1" });
 *   const result = await orchestrator.invokeWithCompact(
 *     { messages, model, maxOutputTokens, tools },
 *     { onCheckpoint, onQuotaEvent, summarizeViaForkedAgent }
 *   );
 */
export class CompactOrchestrator {
	private readonly provider: string;
	private readonly model: string;
	private readonly autoCompactThreshold: number;
	private readonly blockingThreshold: number;
	private readonly maxCompactAttempts: number;
	private readonly microcompactTimeGapMs: number;
	private readonly microcompactKeepRecent: number;
	private readonly contextWindow: ContextWindowManager;

	private compactAttempts = 0;
	private lastAssistantTimestamp = 0;

	// Tool result tracking for microcompact
	private toolResultsById = new Map<
		string,
		{ timestamp: number; tokens: number }
	>();

	constructor(config: CompactOrchestratorConfig) {
		this.provider = config.provider ?? "openai";
		this.model = config.model ?? "gpt-4";
		this.autoCompactThreshold = config.autoCompactThreshold ?? 0.85;
		this.blockingThreshold = config.blockingThreshold ?? 0.97;
		this.maxCompactAttempts =
			config.maxCompactAttempts ?? MAX_CONSECUTIVE_COMPACT_FAILURES;
		this.microcompactTimeGapMs = config.microcompactTimeGapMs ?? 30 * 60 * 1000;
		this.microcompactKeepRecent = config.microcompactKeepRecent ?? 2;
		this.contextWindow = new ContextWindowManager();

		// Set context window size if provided
		if (config.contextWindowSize) {
			this.contextWindow.setContextWindow(
				this.provider,
				this.model,
				config.contextWindowSize,
			);
		}
	}

	/**
	 * Main entry point: invoke LLM with compact checks.
	 *
	 * @param opts - InvokeWithCompactOptions (messages array is modified in-place on compact)
	 * @param callbacks - CompactOrchestratorCallbacks (for side-effects)
	 */
	async invokeWithCompact(
		opts: InvokeWithCompactOptions,
		callbacks: CompactOrchestratorCallbacks,
	): Promise<
		InvokeResult & { compactResult?: CompactResult; continueMessage?: string }
	> {
		const { messages, model, maxOutputTokens } = opts;
		this.compactAttempts++;

		// ── Estimate tokens with buffer awareness ─────────────────────────────
		const estimate = this.contextWindow.estimateTokensWithBuffer({
			messages,
			tools: opts.tools,
			systemPrompt: opts.systemPrompt,
			provider: this.provider,
			model: model ?? this.model,
		});

		// ── Circuit breaker check ─────────────────────────────────────────────
		if (this.contextWindow.shouldCircuitBreak()) {
			return {
				success: false,
				error: `Compact circuit breaker engaged after ${this.contextWindow.getConsecutiveFailures()} consecutive failures.`,
			};
		}

		// ── Blocking: must compact before API call ───────────────────────────
		if (this.contextWindow.shouldBlockApiCall(estimate)) {
			callbacks.onPreCompact?.("token_threshold");
			const compact = await this.runFullCompact(
				messages,
				model ?? this.model,
				maxOutputTokens,
				"token_threshold",
				callbacks,
			);
			if (!compact.success) {
				return {
					success: false,
					error: `Context too large and compact failed: ${compact.error}`,
				};
			}
			if (compact.result) {
				callbacks.onPostCompact?.(compact.result);
				callbacks.onCheckpoint?.(compact.result);
			}
			this.contextWindow.recordCompactSuccess();
		}

		// ── Time-based microcompact ─────────────────────────────────────────
		this.tryMicrocompact(messages);

		// ── Proactive auto-compact at 85% ──────────────────────────────────
		if (this.contextWindow.shouldProactiveCompact(estimate)) {
			callbacks.onPreCompact?.("token_threshold");
			const compact = await this.runFullCompact(
				messages,
				model ?? this.model,
				maxOutputTokens,
				"token_threshold",
				callbacks,
			);
			if (compact.success) {
				this.contextWindow.recordCompactSuccess();
				if (compact.result) {
					callbacks.onPostCompact?.(compact.result);
					callbacks.onCheckpoint?.(compact.result);
				}
			}
		}

		// ── Make the LLM call ───────────────────────────────────────────────
		const invoke = opts.invokeAgent ?? callbacks.invokeAgent;
		if (!invoke) {
			return {
				success: false,
				error:
					"No invokeAgent provided — must pass invokeAgent in opts or callbacks",
			};
		}
		const result = await invoke!(opts);

		// Track tool results
		this.trackToolResults(messages);

		// ── Update stats ─────────────────────────────────────────────────────
		if (result.usage) {
			this.contextWindow.updateStats({
				provider: this.provider,
				model: model ?? this.model,
				maxTokens: estimate.total + (result.usage.outputTokens ?? 0),
				usedTokens: result.usage.inputTokens ?? estimate.total,
			});
		}

		// ── Reactive compact on context-too-long error ─────────────────────
		const isContextError = this.isContextTooLongError(result.error);

		if (isContextError) {
			const failures = this.contextWindow.recordCompactFailure();
			if (this.contextWindow.shouldCircuitBreak()) {
				return {
					success: false,
					error: `Context too long, compact circuit breaker engaged after ${failures} failures.`,
				};
			}

			callbacks.onPreCompact?.("output_limit");
			const compact = await this.runFullCompact(
				messages,
				model ?? this.model,
				maxOutputTokens,
				"output_limit",
				callbacks,
			);

			if (compact.success) {
				this.contextWindow.recordCompactSuccess();
				if (compact.result) {
					callbacks.onPostCompact?.(compact.result);
					callbacks.onCheckpoint?.(compact.result);
				}

				// Retry once after compact
				const retryResult = await invoke!(opts);
				if (retryResult.success) {
					this.lastAssistantTimestamp = Date.now();
					return retryResult;
				}
			}
		}

		if (result.success) {
			this.lastAssistantTimestamp = Date.now();
		}

		return result;
	}

	/**
	 * Run full compact: summarize old messages.
	 */
	private async runFullCompact(
		messages: CompactableMessage[],
		model: string,
		maxOutputTokens: number,
		reason: CompactTriggerReason,
		callbacks: CompactOrchestratorCallbacks,
	): Promise<{
		success: boolean;
		result?: CompactResult;
		error?: string;
		continueMessage?: string;
	}> {
		const beforeTokens = this.estimateTokens({
			messages,
			model,
			maxOutputTokens,
		});

		// Keep last 5-10 messages; compact everything before that
		const keepRecent = Math.min(10, Math.floor(messages.length * 0.2));
		const recentMessages = messages.slice(-keepRecent);
		const oldMessages = messages.slice(0, -keepRecent);

		if (oldMessages.length === 0) {
			return { success: false, error: "Nothing to compact" };
		}

		// ── Generate summary ────────────────────────────────────────────────
		let summary = "";
		let droppedCount = oldMessages.length;

		if (callbacks.summarizeViaForkedAgent) {
			try {
				const result = await callbacks.summarizeViaForkedAgent(
					oldMessages,
					reason,
				);
				summary = result.summary;
				droppedCount = result.droppedCount;
			} catch {
				summary = this.heuristicSummary(oldMessages, reason);
			}
		} else {
			summary = this.heuristicSummary(oldMessages, reason);
		}

		// ── Build compact boundary message ───────────────────────────────────
		const boundaryMsg: CompactableMessage = {
			role: "system",
			content: continuePromptGenerator.generateBoundary({
				summary,
				reason,
				messagesCompacted: droppedCount,
			}),
			timestamp: Date.now(),
			metadata: {
				compactBoundary: true,
				reason,
				compactedMessages: droppedCount,
			},
		};

		// ── Preserve tool results from recent messages ───────────────────────
		const preservedRecent = recentMessages.map((msg) => {
			if (msg.role !== "assistant" || !msg.toolResults) return msg;
			return {
				...msg,
				toolResults: this.preserveRecentToolResults(
					msg,
					this.microcompactKeepRecent,
				),
			};
		});

		// ── Rebuild message array ───────────────────────────────────────────
		messages.length = 0;
		messages.push(boundaryMsg, ...preservedRecent);

		const afterTokens = this.estimateTokens({
			messages,
			model,
			maxOutputTokens,
		});

		const result: CompactResult = {
			trigger: reason,
			beforeTokens,
			afterTokens,
			messagesCompacted: droppedCount,
			summary,
		};

		const continueMessage = continuePromptGenerator.generateMinimal({
			summary,
			recentMessages: preservedRecent,
		});

		return { success: true, result, continueMessage };
	}

	/**
	 * Preserve only recent N tool results per message
	 */
	private preserveRecentToolResults(
		msg: CompactableMessage,
		keepCount: number,
	): CompactableMessage["toolResults"] {
		if (!msg.toolResults) return undefined;

		const sorted = [...msg.toolResults]
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, keepCount);

		return sorted.map((tr) => ({
			...tr,
			content: tr.content.substring(0, 1000),
		}));
	}

	/**
	 * Heuristic summary when LLM summarization unavailable
	 */
	private heuristicSummary(
		messages: CompactableMessage[],
		reason: CompactTriggerReason,
	): string {
		const summaries: string[] = [];

		// Extract key information from last 20 messages
		for (const msg of messages.slice(-20)) {
			if (msg.role === "user" && msg.content.length > 50) {
				summaries.push(`- User: ${msg.content.substring(0, 200)}`);
			}
			if (msg.metadata?.action) {
				summaries.push(`- Action: ${msg.metadata.action}`);
			}
		}

		return [
			`[Context compacted due to: ${reason}]`,
			"",
			"The conversation history was too long to fit in the context window.",
			"Key context from earlier conversation:",
			"",
			summaries.join("\n") || "- Conversation was in progress",
			"",
			"Please continue from the recent messages provided.",
		].join("\n");
	}

	/**
	 * Microcompact: prune old tool results based on time gap.
	 * Uses the microcompactToolResults helper from context-window-manager.
	 */
	private tryMicrocompact(messages: CompactableMessage[]): void {
		if (Date.now() - this.lastAssistantTimestamp < this.microcompactTimeGapMs) {
			return;
		}

		const freed = microcompactToolResults(messages, {
			maxAgeMs: this.microcompactTimeGapMs,
			keepRecent: this.microcompactKeepRecent,
		});

		if (freed > 0) {
			this.lastAssistantTimestamp = Date.now();
		}
	}

	/**
	 * Check if error is a context-too-long error
	 */
	private isContextTooLongError(error: string | undefined): boolean {
		if (!error) return false;
		return (
			/context.*(length|window).*exceed/i.test(error) ||
			/too many (tokens|input tokens)/i.test(error) ||
			/413/i.test(error) ||
			/prompt is too long/i.test(error)
		);
	}

	/**
	 * Estimate token count for an invoke call.
	 */
	estimateTokens(opts: InvokeWithCompactOptions): number {
		const messageTokens = roughMessagesTokens(
			opts.messages.map((m) => ({ role: m.role, content: m.content })),
		);
		const toolTokens = (opts.tools ?? []).reduce(
			(sum, tool) =>
				sum +
				roughTokenCount(tool.name) +
				roughTokenCount(tool.description ?? "") +
				roughTokenCount(JSON.stringify(tool.input_schema ?? {})),
			0,
		);
		return messageTokens + toolTokens;
	}

	/**
	 * Track tool results for microcompact decisions.
	 */
	private trackToolResults(messages: CompactableMessage[]): void {
		for (const msg of messages) {
			if (msg.role !== "assistant" || !msg.toolResults) continue;
			for (const tr of msg.toolResults) {
				this.toolResultsById.set(tr.id, {
					timestamp: tr.timestamp,
					tokens: tr.tokens,
				});
			}
		}
	}

	/** Get current compact attempt count */
	getCompactAttempts(): number {
		return this.compactAttempts;
	}

	/** Get consecutive failure count */
	getConsecutiveFailures(): number {
		return this.contextWindow.getConsecutiveFailures();
	}

	/** Check if circuit breaker is engaged */
	isCircuitBroken(): boolean {
		return this.contextWindow.shouldCircuitBreak();
	}

	/** Reset compact state for a new task */
	reset(): void {
		this.compactAttempts = 0;
		this.toolResultsById.clear();
		this.contextWindow.resetCircuitBreaker();
	}

	/** Get utilization status for a model */
	getUtilizationStatus(
		provider: string,
		model: string,
	): "ok" | "warning" | "critical" | "unknown" {
		return this.contextWindow.getUtilizationStatus(provider, model);
	}

	/** Generate utilization report */
	generateUtilizationReport(): string {
		return this.contextWindow.generateReport();
	}
}
