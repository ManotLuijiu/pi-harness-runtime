/**
 * Loop Runtime — RFC-0001
 *
 * Core execution loop for the harness runtime.
 * Runs the repeated cycle:
 *   pick task -> assign model -> code -> run tests -> review diff
 *   -> if failed: repair
 *   -> if quota_limit: pause and resume later
 *   -> if context_full: compact + auto-resume
 *
 * Compact integration (RFC-0028):
 *   Uses CompactOrchestrator to proactively manage context window.
 *   On context_full: full compact + continue prompt + auto-retry
 *   On quota: pause job for later resume
 */

import type {
	LoopConfig,
	LoopState,
	JobStatus,
	RuntimeCheckpoint,
	RuntimeTask,
	CompactableMessage,
	InvokeWithCompactOptions,
	InvokeResult,
	CompactResult,
	RuntimeEvent,
} from "../packages/types/src/runtime-types.js";
import {
	JobStateMachine,
	type CheckpointManager,
} from "./job-state-machine.js";
import {
	CompactOrchestrator,
	type CompactOrchestratorCallbacks,
} from "./context-compact-orchestrator.js";
import {
	type SessionMemoryManager,
	createSessionMemoryManager,
} from "./session-memory.js";
import { AutoCompactEngine } from "./auto-compact.js";
import {
	type ForkedSummarizer,
	createForkedSummarizer,
} from "./forked-summarizer.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_COMPACT_RETRIES = 3;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

// ─── Lifecycle Callbacks ────────────────────────────────────────────────────

export interface LoopCallbacks {
	/** Fetch next task from queue */
	onPickTask?: () => Promise<RuntimeTask | null>;
	/** Pick the best model for a task */
	onPickModel?: (task: RuntimeTask) => Promise<string>;
	/** Invoke the agent (returns full assistant text) */
	onInvokeAgent?: (opts: InvokeWithCompactOptions) => Promise<InvokeResult>;
	/** Run local tests */
	onRunTests?: (task: RuntimeTask) => Promise<boolean>;
	/** Run E2E tests */
	onRunE2E?: (task: RuntimeTask) => Promise<boolean>;
	/** Review the diff and decide next step */
	onReview?: (
		task: RuntimeTask,
		testResults: { unit: boolean; e2e: boolean },
	) => Promise<"approve" | "repair" | "escalate">;
	/** Repair a failed task */
	onRepair?: (
		task: RuntimeTask,
		error: string,
	) => Promise<{ success: boolean; patch?: string }>;
	/** Escalate to human */
	onEscalate?: (task: RuntimeTask, reason: string) => Promise<void>;
	/** Notify on quota events */
	onQuotaEvent?: (
		event: "paused" | "resumed" | "exhausted",
		provider?: string,
	) => Promise<void>;
	/** Save checkpoint (call persistence layer) */
	onCheckpoint?: (checkpoint: RuntimeCheckpoint) => Promise<void>;
	/** Notify each loop iteration */
	onIteration?: (iteration: number, status: JobStatus) => void;
	/** Called after every compaction with summary */
	onCompaction?: (result: CompactResult) => void;
}

// ─── Loop Result ───────────────────────────────────────────────────────────

export interface LoopResult {
	success: boolean;
	completed: boolean;
	iterations: number;
	error?: string;
	finalCheckpoint?: RuntimeCheckpoint;
	/** Total compactions performed */
	totalCompactions?: number;
}

// ─── Loop Runtime ───────────────────────────────────────────────────────────

export class LoopRuntime {
	private readonly config: Required<LoopConfig>;
	private readonly state: LoopState;
	private readonly jobState: JobStateMachine;
	private readonly callbacks: LoopCallbacks;
	private running = false;
	private paused = false;

	// Compact-related state
	private readonly maxCompactRetries: number;
	private readonly maxOutputTokens: number;
	private compactOrchestrator?: CompactOrchestrator;
	private forkedSummarizer?: ForkedSummarizer;
	private sessionMemory?: SessionMemoryManager;
	private autoCompactEngine?: AutoCompactEngine;
	private totalCompactions = 0;

	constructor(
		config: LoopConfig,
		callbacks: LoopCallbacks & {
			/** Provider for compact orchestrator */
			provider?: string;
			/** Model for summarization */
			summarizerModel?: string;
			/** Context window size */
			contextWindowSize?: number;
		},
	) {
		this.callbacks = callbacks;
		this.maxCompactRetries =
			config.maxRepairAttempts ?? DEFAULT_MAX_COMPACT_RETRIES;
		this.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;

		this.config = {
			jobId: config.jobId,
			requirement: config.requirement,
			providerPolicy: config.providerPolicy ?? {
				plannerProvider: "openai",
				codeProviders: ["openai"],
				reviewProvider: "openai",
				fallbackProviders: [],
			},
			maxIterations: config.maxIterations ?? 1000,
			autoCheckpoint: config.autoCheckpoint ?? true,
			checkpointInterval: config.checkpointInterval ?? 50,
			pauseOnQuota: config.pauseOnQuota ?? true,
			maxRepairAttempts: config.maxRepairAttempts ?? 3,
		};

		this.state = {
			jobId: config.jobId,
			iteration: 0,
			status: "created",
			currentTaskId: null,
			lastCheckpoint: null,
		};

		this.jobState = new JobStateMachine({
			checkpointManager: {
				async save(ckpt: Parameters<CheckpointManager["save"]>[0]) {
					await callbacks.onCheckpoint?.(ckpt);
				},
				async load(_jobId: string) {
					return null;
				},
				async appendEvent(_jobId: string, _event: RuntimeEvent) {
					// no-op for now
				},
			},
		});

		// Initialize session memory
		this.sessionMemory = createSessionMemoryManager(config.jobId);

		// Initialize auto-compact engine
		this.autoCompactEngine = new AutoCompactEngine({
			jobId: config.jobId,
			requirement: config.requirement,
		});

		// Initialize compact orchestrator if agent callback provided
		if (callbacks.onInvokeAgent) {
			this.compactOrchestrator = new CompactOrchestrator({
				jobId: config.jobId,
				provider: callbacks.provider ?? "openai",
				model: callbacks.summarizerModel ?? "gpt-4",
				contextWindowSize: callbacks.contextWindowSize,
			});

			// Initialize forked summarizer if model provided
			if (callbacks.summarizerModel && callbacks.onInvokeAgent) {
				// Wrap onInvokeAgent to match ForkedSummarizer's InvokeOptions
				const wrappedInvoke = async (opts: {
					messages: Array<{ role: string; content: string }>;
					model: string;
					maxOutputTokens: number;
					systemPrompt?: string;
				}) => {
					return callbacks.onInvokeAgent!(opts as InvokeWithCompactOptions);
				};
				this.forkedSummarizer = createForkedSummarizer(
					callbacks.summarizerModel,
					wrappedInvoke,
				);
			}
		}
	}

	// ─── Public API ─────────────────────────────────────────────────────────

	async run(): Promise<LoopResult> {
		this.running = true;
		this.state.status = "running";

		try {
			while (this.running) {
				// Check for pause
				if (this.paused) {
					await this.saveCheckpoint();
					break;
				}

				this.state.iteration++;

				// Check iteration limit
				if (this.state.iteration > this.config.maxIterations) {
					return {
						success: false,
						completed: false,
						iterations: this.state.iteration,
						error: "Max iterations exceeded",
						totalCompactions: this.totalCompactions,
					};
				}

				this.callbacks.onIteration?.(this.state.iteration, this.state.status);

				// Check job status
				const statusSummary = await this.jobState.getStatusSummary();
				if (statusSummary?.status === "paused_quota") {
					await this.handleQuotaPause();
					continue;
				}

				// Pick a task
				const task = await this.callbacks.onPickTask?.();
				if (!task) {
					this.state.status = "archived";
					break;
				}

				this.state.currentTaskId = task.id;
				await this.executeTaskWithCompact(task);

				// Auto-checkpoint
				if (
					this.config.autoCheckpoint &&
					this.state.iteration % this.config.checkpointInterval === 0
				) {
					await this.saveCheckpoint();
				}
			}

			return {
				success: this.state.status !== "archived",
				completed: this.state.status === "archived",
				iterations: this.state.iteration,
				finalCheckpoint: this.state.lastCheckpoint ?? undefined,
				totalCompactions: this.totalCompactions,
			};
		} finally {
			this.running = false;
		}
	}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		this.paused = false;
		this.state.status = "running";
	}

	stop(): void {
		this.running = false;
	}

	getState(): Readonly<LoopState> {
		return { ...this.state };
	}

	/** Get compact orchestrator for external access */
	getCompactOrchestrator(): CompactOrchestrator | undefined {
		return this.compactOrchestrator;
	}

	/** Get session memory manager */
	getSessionMemory(): SessionMemoryManager | undefined {
		return this.sessionMemory;
	}

	// ─── Task Execution with Compact ───────────────────────────────────────

	private async executeTaskWithCompact(task: RuntimeTask): Promise<void> {
		// 1. Pick model
		const model = (await this.callbacks.onPickModel?.(task)) ?? "claude";

		// 2. Build compactable messages
		const compactMessages: CompactableMessage[] = [
			{
				role: "system",
				content: this.buildSystemPrompt(task),
				timestamp: Date.now(),
			},
			{
				role: "user",
				content: `Task: ${task.id}\nObjective: ${task.description ?? "See task graph."}`,
				timestamp: Date.now(),
			},
		];

		// 3. Inject session memory if available
		const sessionMemoryContext = this.sessionMemory?.getMemoryForContext();
		if (sessionMemoryContext) {
			compactMessages.push({
				role: "system",
				content: sessionMemoryContext,
				timestamp: Date.now(),
				metadata: { sessionMemory: true },
			});
		}

		// 4. Execute with compact support
		let compactRetries = 0;

		while (compactRetries < this.maxCompactRetries) {
			// Build invoke options
			const invokeOptions: InvokeWithCompactOptions = {
				messages: compactMessages,
				model,
				maxOutputTokens: this.maxOutputTokens,
				tools: task.tools,
				systemPrompt: task.instructions,
			};

			// Use compact orchestrator if available
			if (this.compactOrchestrator && this.callbacks.onInvokeAgent) {
				const orchestratorCallbacks = this.buildCompactCallbacks(task, model);
				const result = await this.compactOrchestrator.invokeWithCompact(
					invokeOptions,
					orchestratorCallbacks,
				);

				if (result.success && result.output) {
					// Success — process result
					this.handleInvokeSuccess(compactMessages, result, task);
					await this.runTestsAndReview(task, compactMessages);
					return;
				}

				// Check for circuit breaker
				if (this.compactOrchestrator.isCircuitBroken()) {
					this.state.status = "blocked";
					throw new Error(
						`Compact circuit breaker engaged after ${this.compactOrchestrator.getConsecutiveFailures()} failures.`,
					);
				}

				// Compact happened — retry
				if (result.compactResult) {
					compactRetries++;
					this.totalCompactions++;
					this.onCompactionOccurred(result.compactResult);

					// Append continue message
					if (result.continueMessage) {
						compactMessages.push({
							role: "user",
							content: result.continueMessage,
							timestamp: Date.now(),
						});
					}
					continue;
				}

				// Error without compact — surface it
				throw new Error(result.error ?? "Unknown invoke error");
			}

			// Fallback: direct invoke without orchestrator
			const result = await this.callbacks.onInvokeAgent?.(invokeOptions);
			if (!result || !result.success) {
				throw new Error(result?.error ?? "Invoke failed");
			}

			this.handleInvokeSuccess(compactMessages, result, task);
			await this.runTestsAndReview(task, compactMessages);
			return;
		}

		// Max compact retries exceeded
		this.state.status = "blocked";
		throw new Error(`Max compact retries (${this.maxCompactRetries}) exceeded`);
	}

	/**
	 * Build compact callbacks for the orchestrator
	 */
	private buildCompactCallbacks(
		task: RuntimeTask,
		_model: string,
	): CompactOrchestratorCallbacks {
		return {
			invokeAgent: async (opts) => {
				return (
					(await this.callbacks.onInvokeAgent?.(opts)) ?? {
						success: false,
						error: "No agent",
					}
				);
			},

			onCheckpoint: async (result) => {
				this.callbacks.onCompaction?.(result);
				await this.saveCheckpoint();
			},

			onPreCompact: async (_reason) => {
				// Save partial artifacts before compact
				// Note: we don't have beforeTokens here, but we save the state
				this.autoCompactEngine?.saveCompactionArtifact({
					timestamp: new Date().toISOString(),
					jobId: this.config.jobId,
					taskId: task.id,
					compactedFromTokens: 0,
					reason: _reason,
				} as any);
			},

			onPostCompact: async (result) => {
				// Extract facts from compacted messages for session memory
				this.sessionMemory?.extractFacts([]);
				this.callbacks.onCompaction?.(result);
			},

			onQuotaEvent: this.callbacks.onQuotaEvent,

			summarizeViaForkedAgent: async (messages, reason) => {
				if (this.forkedSummarizer) {
					return this.forkedSummarizer.summarize(messages, {
						focusOn: "work_done",
					});
				}
				// Fallback to heuristic
				return {
					summary: `[Compact: ${reason}] Conversation summarised.`,
					droppedCount: messages.length,
				};
			},
		};
	}

	/**
	 * Handle successful invoke result
	 */
	private handleInvokeSuccess(
		messages: CompactableMessage[],
		result: InvokeResult,
		_task: RuntimeTask,
	): void {
		// Append assistant response to messages
		messages.push({
			role: "assistant",
			content: result.output ?? "",
			timestamp: Date.now(),
			metadata: {
				model: result.model,
				usage: result.usage,
			},
		});

		// Extract facts from output for session memory
		if (result.output) {
			this.sessionMemory?.extractFacts([
				{
					role: "assistant",
					content: result.output,
					timestamp: Date.now(),
				},
			]);
		}

		// Check for continue markers in output
		if (this.autoCompactEngine?.detectCompaction(result.output ?? "")) {
			// This is a continue-required scenario
			const continueMsg = this.autoCompactEngine.buildContinueMessage();
			messages.push({
				role: "user",
				content: continueMsg,
				timestamp: Date.now(),
			});
		}
	}

	/**
	 * Called when compaction occurs
	 */
	private onCompactionOccurred(result: CompactResult): void {
		// Update session memory with compacted content
		this.sessionMemory?.extractFacts([]);

		// Save compaction event
		this.autoCompactEngine?.saveCompactionArtifact({
			timestamp: new Date().toISOString(),
			jobId: this.config.jobId,
			taskId: this.state.currentTaskId ?? "unknown",
			compactedFromTokens: result.beforeTokens,
			reason: result.trigger,
			continuePrompt: result.summary,
		} as any);

		// Notify callbacks
		this.callbacks.onCompaction?.(result);
	}

	/**
	 * Run tests and review
	 */
	private async runTestsAndReview(
		task: RuntimeTask,
		messages: CompactableMessage[],
	): Promise<void> {
		// Run tests
		const unitPassed = (await this.callbacks.onRunTests?.(task)) ?? true;
		const e2ePassed = (await this.callbacks.onRunE2E?.(task)) ?? true;

		// Update session memory with test results
		this.sessionMemory?.addTestResult(task.id, unitPassed && e2ePassed);

		// Review
		const verdict = await this.callbacks.onReview?.(task, {
			unit: unitPassed,
			e2e: e2ePassed,
		});

		if (verdict === "escalate") {
			this.state.status = "waiting_human";
			await this.callbacks.onEscalate?.(task, "Human review required");
			this.paused = true;
		} else if (verdict === "repair") {
			// Append repair instruction
			messages.push({
				role: "user",
				content:
					"Tests failed. Please fix the issues and ensure all tests pass.",
				timestamp: Date.now(),
			});
		}
	}

	/**
	 * Build system prompt for task
	 */
	private buildSystemPrompt(task: RuntimeTask): string {
		const parts = [
			task.instructions ?? "Complete the assigned task.",
			"",
			"## Context Management",
			"- Keep responses concise and focused",
			"- If context becomes full, the system will compact automatically",
			"- Do not repeat work already done",
		];

		if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
			parts.push("", "## Acceptance Criteria");
			for (const criteria of task.acceptanceCriteria) {
				parts.push(`- ${criteria}`);
			}
		}

		return parts.join("\n");
	}

	// ─── Quota Handling ────────────────────────────────────────────────────

	private async handleQuotaPause(): Promise<void> {
		this.paused = true;
		this.state.status = "paused_quota";
		this.jobState.transition("paused_quota");
		await this.callbacks.onQuotaEvent?.("paused");
		await this.saveCheckpoint();
	}

	// ─── Persistence ────────────────────────────────────────────────────────

	private async saveCheckpoint(): Promise<void> {
		const now = new Date().toISOString();
		const checkpoint: RuntimeCheckpoint = {
			version: 1,
			jobId: this.state.jobId,
			requirement: this.config.requirement,
			taskId: this.state.currentTaskId ?? undefined,
			iteration: this.state.iteration,
			status: this.state.status,
			createdAt: now,
			updatedAt: now,
		};
		this.state.lastCheckpoint = checkpoint;
		await this.jobState.transition(this.state.status);
		await this.callbacks.onCheckpoint?.(checkpoint);
	}

	// ─── Resume from Checkpoint ────────────────────────────────────────────

	async resumeFromCheckpoint(
		checkpoint: RuntimeCheckpoint,
	): Promise<LoopResult> {
		this.state.iteration = checkpoint.iteration ?? 0;
		this.state.currentTaskId = checkpoint.taskId ?? null;
		this.state.status = checkpoint.status ?? "running";
		this.paused = false;

		// Check for pending continue prompt
		if (this.autoCompactEngine?.hasContinuePrompt()) {
			const continuePrompt = this.autoCompactEngine.loadContinuePrompt();
			if (continuePrompt) {
				// Resume will inject the continue prompt
				this.callbacks.onIteration?.(this.state.iteration, this.state.status);
			}
		}

		return this.run();
	}
}
