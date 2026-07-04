/**
 * Shared Blackboard — RFC-0011
 *
 * Durable file-based coordination so agents communicate without the human
 * acting as message bus.
 *
 * Layout:
 *   harness/blackboard/
 *     status.json
 *     next_action.json
 *     tasks.json
 *     agent_registry.json
 *     locks/
 *     reports/
 *     context/
 *     events.jsonl
 */

import type {
	BlackboardRecord,
	NextAction,
	AgentRegistry,
	AgentReport,
	LockInfo,
	RuntimeEvent,
	TaskGraph,
} from "../packages/types/src/runtime-types.ts";
import { writeJson, readJson, appendJsonl, ensureUsageDir } from "../cli.ts";
// @ts-expect-error - Bun has built-in Node.js types
import { join, dirname } from "node:path";

export class SharedBlackboard {
	private readonly jobDir: string;
	private record: BlackboardRecord | null = null;

	constructor(jobId: string, rootDir: string) {
		this.jobDir = join(rootDir, "jobs", jobId, "blackboard");
	}

	/**
	 * Initialize a new blackboard for a job
	 */
	init(jobId: string, taskGraph: TaskGraph): void {
		const now = new Date().toISOString();
		this.record = {
			jobId,
			status: "created",
			nextAction: undefined,
			tasks: taskGraph,
			agentRegistry: { agents: {} },
			reports: {},
			locks: {},
			updatedAt: now,
		};
		this.save();
	}

	/**
	 * Load blackboard from disk
	 */
	load(): BlackboardRecord | null {
		const path = join(this.jobDir, "status.json");
		this.record = readJson(path) as BlackboardRecord | null;
		return this.record;
	}

	/**
	 * Save blackboard to disk
	 */
	save(): void {
		if (!this.record) return;
		this.record.updatedAt = new Date().toISOString();
		ensureUsageDir();
		const path = join(this.jobDir, "status.json");
		writeJson(path, this.record);
	}

	/**
	 * Update job status
	 */
	updateStatus(status: BlackboardRecord["status"]): void {
		if (!this.record) return;
		this.record.status = status;
		this.save();
		this.appendEvent("StatusUpdated", { status });
	}

	/**
	 * Set the next action for agents to pick up
	 */
	setNextAction(action: NextAction): void {
		if (!this.record) return;
		this.record.nextAction = action;
		this.save();
		this.appendEvent("NextActionUpdated", {
			taskId: action.taskId,
			agentId: action.agentId,
			priority: action.priority,
		});
	}

	/**
	 * Clear the next action (after agent picks it up)
	 */
	clearNextAction(): void {
		if (!this.record) return;
		this.record.nextAction = undefined;
		this.save();
	}

	/**
	 * Register an agent
	 */
	registerAgent(
		agentId: string,
		name: string,
		provider: string,
		model?: string,
	): void {
		if (!this.record) return;
		this.record.agentRegistry.agents[agentId] = {
			id: agentId,
			name,
			provider,
			model,
			status: "idle",
			startedAt: new Date().toISOString(),
		};
		this.save();
	}

	/**
	 * Update agent status
	 */
	updateAgentStatus(
		agentId: string,
		status: AgentRegistry["agents"][string]["status"],
		currentTaskId?: string,
	): void {
		if (!this.record) return;
		const agent = this.record.agentRegistry.agents[agentId];
		if (!agent) return;
		agent.status = status;
		agent.currentTaskId = currentTaskId;
		agent.lastHeartbeat = new Date().toISOString();
		this.save();
	}

	/**
	 * Unregister an agent
	 */
	unregisterAgent(agentId: string): void {
		if (!this.record) return;
		delete this.record.agentRegistry.agents[agentId];
		this.save();
	}

	/**
	 * Write an agent report
	 */
	writeReport(report: AgentReport): void {
		if (!this.record) return;
		this.record.reports[report.agentId] = report;
		this.save();
		this.appendEvent("AgentReportWritten", {
			agentId: report.agentId,
			taskId: report.taskId,
			status: report.status,
		});
	}

	/**
	 * Acquire a lock on a task
	 */
	acquireLock(taskId: string, agentId: string): boolean {
		if (!this.record) return false;
		if (this.record.locks[taskId]) {
			return false; // Already locked
		}
		this.record.locks[taskId] = {
			taskId,
			agentId,
			acquiredAt: new Date().toISOString(),
		};
		this.save();
		this.appendEvent("LockAcquired", { taskId, agentId });
		return true;
	}

	/**
	 * Release a lock on a task
	 */
	releaseLock(taskId: string, agentId: string): boolean {
		if (!this.record) return false;
		const lock = this.record.locks[taskId];
		if (!lock || lock.agentId !== agentId) {
			return false; // Not locked by this agent
		}
		delete this.record.locks[taskId];
		this.save();
		this.appendEvent("LockReleased", { taskId, agentId });
		return true;
	}

	/**
	 * Check if a task is locked
	 */
	isLocked(taskId: string): boolean {
		return !!this.record?.locks[taskId];
	}

	/**
	 * Get lock info for a task
	 */
	getLock(taskId: string): LockInfo | null {
		return this.record?.locks[taskId] ?? null;
	}

	/**
	 * Get the current record
	 */
	getRecord(): BlackboardRecord | null {
		return this.record;
	}

	/**
	 * Get active agents
	 */
	getActiveAgents(): AgentRegistry["agents"][string][] {
		if (!this.record) return [];
		return Object.values(this.record.agentRegistry.agents);
	}

	/**
	 * Check for stale agents (no heartbeat in N minutes)
	 */
	getStaleAgents(
		maxAgeMinutes: number = 10,
	): AgentRegistry["agents"][string][] {
		if (!this.record) return [];
		const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
		return Object.values(this.record.agentRegistry.agents).filter((a) => {
			if (!a.lastHeartbeat) return false;
			return Date.parse(a.lastHeartbeat) < cutoff;
		});
	}

	/**
	 * Append an event to the event log
	 */
	private appendEvent(type: string, data?: Record<string, unknown>): void {
		if (!this.record) return;
		const event: RuntimeEvent = {
			ts: new Date().toISOString(),
			jobId: this.record.jobId,
			type,
			message: `Blackboard event: ${type}`,
			data,
		};
		const path = join(this.jobDir, "events.jsonl");
		ensureUsageDir();
		appendJsonl(path, event);
	}

	/**
	 * Export full blackboard state
	 */
	export(): string {
		return JSON.stringify(this.record, null, 2);
	}

	/**
	 * Get blackboard directory path
	 */
	getPath(): string {
		return this.jobDir;
	}
}

/**
 * Create and initialize a blackboard for a job
 */
export function createBlackboard(
	jobId: string,
	rootDir: string,
	taskGraph: TaskGraph,
): SharedBlackboard {
	const blackboard = new SharedBlackboard(jobId, rootDir);
	blackboard.init(jobId, taskGraph);
	return blackboard;
}
