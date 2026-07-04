/**
 * Loop Runtime — RFC-0001
 *
 * Core execution loop for the harness runtime.
 * Runs the repeated cycle:
 *   pick task -> assign model -> code -> run tests -> review diff
 *   -> if failed: repair
 *   -> if quota_limit: pause and resume later
 *   -> if blocked: escalate to human
 */

import type {
	LoopConfig,
	LoopState,
	JobStatus,
	RuntimeCheckpoint,
	RuntimeTask,
} from "../packages/types/src/runtime-types.ts";
import { JobStateMachine } from "./job-state-machine.ts";
import { TaskGraphManager } from "./task-graph.ts";
import { RepairEngine } from "./repair-engine.ts";
import type { CheckpointManager } from "./job-state-machine.ts";

export interface LoopResult {
	success: boolean;
	completed: boolean;
	iterations: number;
	error?: string;
}

export interface LoopCallbacks {
	onTaskStart?: (taskId: string) => Promise<void>;
	onTaskComplete?: (taskId: string, report: unknown) => Promise<void>;
	onTaskFailure?: (taskId: string, error: string) => Promise<void>;
	onQuotaExceeded?: (provider: string) => Promise<void>;
	onHumanEscalation?: (taskId: string, reason: string) => Promise<void>;
	onIteration?: (iteration: number, status: string) => Promise<void>;
	invokeAgent?: (
		task: RuntimeTask,
		context: unknown,
	) => Promise<{ success: boolean; output?: string; error?: string }>;
	runTests?: (
		taskId: string,
		worktreePath?: string,
	) => Promise<{ passed: boolean; output?: string }>;
	runReview?: (
		taskId: string,
		diffPath: string,
	) => Promise<{ approved: boolean; comments?: string }>;
}

export class LoopRuntime {
	private state: LoopState;
	private machine: JobStateMachine;
	private graph: TaskGraphManager;
	private repairEngine: RepairEngine;
	private callbacks: LoopCallbacks;
	private running = false;
	private paused = false;

	constructor(
		config: LoopConfig,
		checkpointManager: CheckpointManager,
		callbacks: LoopCallbacks,
	) {
		this.state = {
			jobId: config.jobId,
			iteration: 0,
			status: "running",
		};

		this.machine = new JobStateMachine({ checkpointManager });
		this.graph = new TaskGraphManager({ jobId: config.jobId });
		this.repairEngine = new RepairEngine(config.jobId);
		this.callbacks = callbacks;
	}

	/**
	 * Initialize the loop with a job
	 */
	async init(requirement: string): Promise<void> {
		await this.machine.createJob(this.state.jobId, requirement);
		await this.machine.transition("planning");
	}

	/**
	 * Resume from checkpoint
	 */
	async resume(checkpoint: RuntimeCheckpoint): Promise<void> {
		this.state.iteration = 0;
		await this.machine.resumeJob(checkpoint.jobId);
	}

	/**
	 * Run the main loop
	 */
	async run(): Promise<LoopResult> {
		this.running = true;

		try {
			while (this.running) {
				// Check for pause
				if (this.paused) {
					await this.saveCheckpoint();
					break;
				}

				this.state.iteration++;

				// Check iteration limit
				if (this.state.iteration > 1000) {
					return {
						success: false,
						completed: false,
						iterations: this.state.iteration,
						error: "Max iterations exceeded",
					};
				}

				await this.callbacks.onIteration?.(
					this.state.iteration,
					this.state.status,
				);

				// Check job status
				if (this.machine.isTerminal()) {
					return {
						success: true,
						completed: true,
						iterations: this.state.iteration,
					};
				}

				// Pick next task
				const nextTask = await this.pickNextTask();
				if (!nextTask) {
					// No more tasks, job is complete
					await this.machine.transition("ready_for_client");
					return {
						success: true,
						completed: true,
						iterations: this.state.iteration,
					};
				}

				this.state.currentTaskId = nextTask.id;
				this.state.status = "running";

				// Execute task
				const result = await this.executeTask(nextTask);

				if (!result.success) {
					// Handle failure
					const { repairTask } = this.repairEngine.analyzeAndRepair(
						nextTask.id,
						result.error ?? "Unknown error",
					);

					if (this.repairEngine.shouldEscalate(repairTask.id)) {
						await this.machine.transition("waiting_human");
						await this.callbacks.onHumanEscalation?.(
							nextTask.id,
							result.error ?? "Unknown error",
						);
					} else {
						await this.machine.transition("repairing");
						// Continue loop to attempt repair
					}
				} else {
					// Task succeeded
					this.graph.updateTaskStatus(nextTask.id, "done");
					await this.machine.transition("testing");

					// Run tests
					const testResult = await this.callbacks.runTests?.(
						nextTask.id,
						nextTask.worktreePath,
					);
					if (!testResult?.passed) {
						await this.machine.transition("repairing");
						this.graph.updateTaskStatus(nextTask.id, "failed");
					} else {
						await this.machine.transition("reviewing");

						// Run review
						const reviewResult = await this.callbacks.runReview?.(
							nextTask.id,
							nextTask.worktreePath ?? "",
						);
						if (!reviewResult?.approved) {
							await this.machine.transition("repairing");
						}
					}
				}

				await this.saveCheckpoint();
			}

			return {
				success: true,
				completed: false,
				iterations: this.state.iteration,
			};
		} catch (error) {
			return {
				success: false,
				completed: false,
				iterations: this.state.iteration,
				error: String(error),
			};
		} finally {
			this.running = false;
		}
	}

	/**
	 * Pick the next task to execute
	 */
	private async pickNextTask(): Promise<RuntimeTask | null> {
		const readyTasks = this.graph.getReadyTasks();

		// Pick the first ready task that's not assigned
		for (const task of readyTasks) {
			if (!task.assignedAgent) {
				this.graph.assignAgent(task.id, "loop-runtime");
				return task as unknown as RuntimeTask;
			}
		}

		return null;
	}

	/**
	 * Execute a single task
	 */
	private async executeTask(task: RuntimeTask): Promise<{
		success: boolean;
		output?: string;
		error?: string;
	}> {
		try {
			await this.callbacks.onTaskStart?.(task.id);

			const result = await this.callbacks.invokeAgent?.(task, {
				jobId: this.state.jobId,
				requirement: this.machine.getCheckpoint()?.requirement,
			});

			if (result?.success) {
				await this.callbacks.onTaskComplete?.(task.id, {
					output: result.output,
				});
				return { success: true, output: result.output };
			} else {
				const error = result?.error ?? "Agent returned failure";
				await this.callbacks.onTaskFailure?.(task.id, error);
				return { success: false, error };
			}
		} catch (error) {
			return { success: false, error: String(error) };
		}
	}

	/**
	 * Pause the loop
	 */
	pause(): void {
		this.paused = true;
		this.state.status = "paused";
	}

	/**
	 * Resume the loop
	 */
	async resumeLoop(): Promise<void> {
		this.paused = false;
		this.state.status = "running";
	}

	/**
	 * Stop the loop
	 */
	stop(): void {
		this.running = false;
		this.state.status = "failed";
	}

	/**
	 * Save checkpoint
	 */
	private async saveCheckpoint(): Promise<void> {
		const checkpoint = this.machine.getCheckpoint();
		if (checkpoint) {
			await this.machine.transition(checkpoint.status, {
				currentTaskId: this.state.currentTaskId,
			});
		}
	}

	/**
	 * Get current state
	 */
	getState(): LoopState {
		return this.state;
	}

	/**
	 * Get job status
	 */
	getStatus(): {
		status: JobStatus;
		canResume: boolean;
		isTerminal: boolean;
	} | null {
		const summary = this.machine.getStatusSummary();
		if (!summary) return null;
		return {
			status: summary.status,
			canResume: summary.canResume,
			isTerminal: summary.isTerminal,
		};
	}

	/**
	 * Check if loop is running
	 */
	isRunning(): boolean {
		return this.running && !this.paused;
	}

	/**
	 * Check if loop is paused
	 */
	isPaused(): boolean {
		return this.paused;
	}
}
