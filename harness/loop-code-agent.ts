/**
 * Loop Code Agent (Minimax) — coordinates via blackboard.
 *
 * Polls blackboard for nextAction where agentType="code".
 * Writes code, updates node status, sets nextAction for review-agent.
 *
 * Usage:  bun harness/loop-code-agent.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
	createHerdrBus,
	ensureHerdrWorkspace,
} from "../packages/event-bus/src/herdr-bus.js";
import { SharedBlackboard } from "./blackboard.js";
import type { LoopNextAction, LoopAgentReport } from "./loop-types.js";
import type { BlackboardRecord } from "../packages/types/src/runtime-types.js";

const AGENT_ID = "code-agent";
const AGENT_TYPE = "code";
const POLL_MS = 1000;
// Suppress stack traces — only show error message to keep TUI clean
const logError = (err: unknown) =>
	console.error(`[${AGENT_ID}] Error: ${err instanceof Error ? err.message : String(err)}`);

async function main(): Promise<void> {
	console.log(`[${AGENT_ID}] Starting...`);
	const paths = ensureHerdrWorkspace();

	// Find active loop config
	const loopId = await findActiveLoop(paths.root);
	if (!loopId) {
		console.log(`[${AGENT_ID}] No active loop found. Waiting...`);
	}

	const rootDir = paths.root;
	const blackboard = new SharedBlackboard(loopId ?? "no-loop", rootDir);
	blackboard.load();
	blackboard.registerAgent(AGENT_ID, "Code Agent", "minimax", "minimax");
	blackboard.updateAgentStatus(AGENT_ID, "idle");
	console.log(`[${AGENT_ID}] Registered. Blackboard: ${blackboard.getPath()}`);

	while (true) {
		await sleep(POLL_MS);

		blackboard.load();
		const record = blackboard.getRecord();
		if (!record) continue;

		// Check for early exit
		const earlyExit = checkEarlyExit(record);
		if (earlyExit) {
			console.log(`[${AGENT_ID}] Early exit: ${earlyExit}`);
			blackboard.updateAgentStatus(AGENT_ID, "idle");
			break;
		}

		// Check if this loop is ours (loopId matches)
		if (record.jobId !== loopId) continue;

		// Check nextAction for code agent
		const action = parseNextAction(record.nextAction);
		if (!action || action.agentType !== AGENT_TYPE) continue;

		// Claim the task
		const locked = blackboard.acquireLock(action.taskId, AGENT_ID);
		if (!locked) continue;

		blackboard.updateAgentStatus(AGENT_ID, "working", action.taskId);
		console.log(`[${AGENT_ID}] Claimed: ${action.taskId}`);

		// Do the work
		const result = await writeCode(action, paths, record.jobId);

		// Update task status
		updateTaskStatus(blackboard, record, action.taskId, "done", result.files);

		// Set nextAction for review agent
		const nextTaskId = getNextReviewTask(record, action.iteration);
		if (nextTaskId) {
			blackboard.setNextAction(
				encodeNextAction({
					taskId: nextTaskId,
					agentType: "review",
					iteration: getReviewIteration(nextTaskId),
					prompt: action.prompt,
					codeFiles: result.files,
				}),
			);
			console.log(`[${AGENT_ID}] -> nextAction: review ${nextTaskId}`);
		} else {
			// No review needed — go to report
			const writeDone = getNextWriteTask(record, action.iteration);
			if (writeDone) {
				blackboard.setNextAction(
					encodeNextAction({
						taskId: writeDone,
						agentType: "code",
						iteration: getWriteIteration(writeDone),
						prompt: action.prompt,
					}),
				);
				console.log(`[${AGENT_ID}] -> nextAction: code ${writeDone}`);
			} else {
				// All done — go to report
				blackboard.setNextAction(
					encodeNextAction({
						taskId: "report",
						agentType: "review",
						iteration: 0,
					}),
				);
				console.log(`[${AGENT_ID}] -> nextAction: report`);
			}
		}

		// Release lock and report
		blackboard.releaseLock(action.taskId, AGENT_ID);
		blackboard.writeReport({
			agentId: AGENT_ID,
			taskId: action.taskId,
			status: "success",
			files: result.files,
		} satisfies LoopAgentReport);
		blackboard.updateAgentStatus(AGENT_ID, "idle");
	}
}

async function writeCode(
	action: LoopNextAction,
	paths: { code: string },
	loopId: string,
): Promise<{ files: string[] }> {
	const iteration = action.iteration;
	const outputDir = join(paths.code, loopId, `iteration-${iteration}`);
	mkdirSync(outputDir, { recursive: true });

	const codeFile = join(outputDir, `index.ts`);
	// TODO: Replace with actual Minimax call
	const code = `// Iteration ${iteration} — ${action.prompt}
// TODO: Replace with actual Minimax code generation
export const iteration = ${iteration};
export const prompt = ${JSON.stringify(action.prompt)};
`;
	writeFileSync(codeFile, code);
	console.log(`[${AGENT_ID}] Wrote: ${codeFile}`);
	return { files: [codeFile] };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function findActiveLoop(rootDir: string): Promise<string | null> {
	const { readdirSync, existsSync } = await import("fs");
	try {
		const files = readdirSync(rootDir).filter(
			(f) => f.startsWith("loop-") && f.endsWith(".config.json"),
		);
		// Find most recent config that has an active blackboard
		for (const configFile of files.slice(-1)) {
			const config = JSON.parse(
				readFileSync(join(rootDir, configFile), "utf-8"),
			);
			const bbPath = join(rootDir, "jobs", config.loopId, "blackboard");
			if (existsSync(bbPath)) return config.loopId;
		}
	} catch {
		// no loop yet
	}
	return null;
}

function encodeNextAction(action: Partial<LoopNextAction>) {
	return {
		taskId: action.taskId,
		instruction: "LOOP:" + JSON.stringify(action),
		priority: "high" as const,
		createdAt: new Date().toISOString(),
	};
}

function parseNextAction(nextAction: unknown): LoopNextAction | null {
	if (!nextAction) return null;
	const a = nextAction as Record<string, unknown>;
	if (!a.taskId) return null;
	if (typeof a.instruction === "string" && a.instruction.startsWith("LOOP:")) {
		try {
			return JSON.parse(a.instruction.slice(5)) as LoopNextAction;
		} catch {
			return null;
		}
	}
	return null;
}

function checkEarlyExit(record: BlackboardRecord): string | null {
	const blocked = Object.values(record.tasks.nodes).find(
		(n) => n.status === "blocked",
	);
	if (blocked) return `blocked at ${blocked.id}`;
	const approved = Object.values(record.tasks.nodes).find(
		(n) =>
			n.status === "done" && (n as { result?: string }).result === "approved",
	);
	if (approved) return "approved";
	return null;
}

function updateTaskStatus(
	blackboard: SharedBlackboard,
	record: BlackboardRecord,
	taskId: string,
	status: "done" | "running" | "blocked",
	files?: string[],
): void {
	if (record.tasks.nodes[taskId]) {
		(
			record.tasks.nodes[taskId] as unknown as {
				status: string;
				result?: string;
			}
		).status = status;
		if (files)
			(record.tasks.nodes[taskId] as unknown as { result?: string }).result =
				files.join(", ");
		(
			record.tasks.nodes[taskId] as unknown as { updatedAt?: string }
		).updatedAt = new Date().toISOString();
		blackboard.save();
	}
}

function getNextReviewTask(
	record: BlackboardRecord,
	writeIteration: number,
): string | null {
	const reviewCount = Object.keys(record.tasks.nodes).filter((id) =>
		id.startsWith("review-"),
	).length;
	const step = Math.max(
		1,
		Math.floor(
			Object.keys(record.tasks.nodes).filter((id) => id.startsWith("write-"))
				.length / (reviewCount || 1),
		),
	);
	const targetReview = Math.ceil(writeIteration / step);
	const taskId = `review-${targetReview}`;
	if (
		record.tasks.nodes[taskId] &&
		record.tasks.nodes[taskId].status === "pending"
	) {
		return taskId;
	}
	return null;
}

function getNextWriteTask(
	record: BlackboardRecord,
	currentIteration: number,
): string | null {
	const nextWrite = currentIteration + 1;
	const taskId = `write-${nextWrite}`;
	if (
		record.tasks.nodes[taskId] &&
		record.tasks.nodes[taskId].status === "pending"
	) {
		return taskId;
	}
	return null;
}

function getReviewIteration(taskId: string): number {
	const m = taskId.match(/^review-(\d+)$/);
	return m ? parseInt(m[1], 10) : 0;
}

function getWriteIteration(taskId: string): number {
	const m = taskId.match(/^write-(\d+)$/);
	return m ? parseInt(m[1], 10) : 0;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

main().catch(logError);
