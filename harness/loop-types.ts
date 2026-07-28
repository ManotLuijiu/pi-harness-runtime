/**
 * Shared types for loop coordination via blackboard.
 */

import type { TaskGraph, TaskNode } from "../packages/types/src/runtime-types.ts";

export type LoopVerdict = "approved" | "changes_requested" | "blocked";
export type LoopNodeType = "write" | "review" | "decide" | "report";
export type LoopNodeStatus = "pending" | "running" | "done" | "blocked";

export interface LoopNextAction {
	taskId: string;
	agentType: "code" | "review";
	iteration: number;
	prompt?: string;
	codeFiles?: string[];
}

export interface LoopAgentReport {
	agentId: string;
	taskId: string;
	status: "running" | "done" | "failed";
	message?: string;
	files?: string[];
	verdict?: LoopVerdict;
}

export interface LoopTaskGraph {
	nodes: Record<string, TaskNode>;
	topologicalOrder: string[];
}

export function buildLoopTaskGraph(
	writeCount: number,
	reviewCount: number,
	loopId: string,
): TaskGraph {
	const now = new Date().toISOString();
	const nodes: Record<string, TaskNode> = {};
	const order: string[] = [];

	// Write tasks
	for (let i = 1; i <= writeCount; i++) {
		const id = `write-${i}`;
		nodes[id] = {
			id,
			title: `Code Write ${i}`,
			description: `Write iteration ${i}`,
			status: "pending",
			dependencies: [],
			dependents: [],
			createdAt: now,
			updatedAt: now,
		};
		order.push(id);
	}

	// Review tasks
	const step = Math.max(1, Math.floor(writeCount / (reviewCount || 1)));
	for (let i = 1; i <= reviewCount; i++) {
		const id = `review-${i}`;
		const writeIdx = i * step;
		nodes[id] = {
			id,
			title: `Code Review ${i}`,
			description: `Review iteration ${i}`,
			status: "pending",
			dependencies: writeIdx <= writeCount ? [`write-${writeIdx}`] : [],
			dependents: [],
			createdAt: now,
			updatedAt: now,
		};
		// Wire dependencies
		if (writeIdx <= writeCount) {
			nodes[`write-${writeIdx}`].dependents.push(id);
		}
		order.push(id);
	}

	// Report task
	const reportId = "report";
	nodes[reportId] = {
		id: reportId,
		title: "Loop Report",
		description: "Final summary",
		status: "pending",
		dependencies: [],
		dependents: [],
		createdAt: now,
		updatedAt: now,
	};
	order.push(reportId);

	return {
		jobId: loopId,
		nodes,
		topologicalOrder: order,
	};
}

export function getNodeStatus(
	graph: TaskGraph,
	nodeId: string,
): LoopNodeStatus | undefined {
	return graph.nodes[nodeId]?.status as LoopNodeStatus | undefined;
}

export function getReviewVerdict(
	graph: TaskGraph,
	reviewId: string,
): LoopVerdict | undefined {
	const node = graph.nodes[reviewId];
	if (!node) return undefined;
	return (node as unknown as { result?: LoopVerdict }).result;
}
