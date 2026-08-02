/**
 * Two-way sync between rpiv-todo and bd
 *
 * This module handles:
 * 1. rpiv-todo → bd: When todo tool is called, sync to bd
 * 2. bd → rpiv-todo: When bd commands are executed, sync to todo
 * 3. Session start: Load existing bd issues into todo
 */

import { execSync } from "node:child_process";
import type { TodoTask, BdIssue, SyncResult } from "./types.js";
import { IdMappingRegistry, STATUS_MAP } from "./types.js";

// Mapping registry singleton
const mappingRegistry = new IdMappingRegistry();

/**
 * Execute a bd command and return the output
 */
export function execBdCommand(command: string): string {
	try {
		return execSync(command, {
			encoding: "utf8",
			timeout: 10000,
			cwd: process.cwd(),
		});
	} catch (error: unknown) {
		const err = error as { message?: string; stderr?: string };
		return err.stderr || err.message || "";
	}
}

/**
 * Extract bd ID from command or output
 */
export function extractBdId(input: string): string | null {
	// Match patterns like: bd-a1b2, bd-a1b2.1, BD-a1b2, etc.
	const match = input.match(/bd-[a-z0-9]+(\.[0-9]+)?/i);
	return match ? match[0].toLowerCase() : null;
}

/**
 * Get all open bd issues
 */
export function getOpenBdIssues(): BdIssue[] {
	try {
		const output = execBdCommand("bd ready --json");
		const issues = JSON.parse(output);
		return issues.map((issue: Record<string, unknown>) => ({
			id: issue.id as string,
			title: issue.title as string,
			status: issue.status as BdIssue["status"],
			priority: issue.priority as number | undefined,
			createdAt: issue.created_at as string | undefined,
			updatedAt: issue.updated_at as string | undefined,
		}));
	} catch {
		return [];
	}
}

/**
 * Get all bd issues (including closed)
 */
export function getAllBdIssues(): BdIssue[] {
	try {
		const output = execBdCommand("bd list --json");
		const issues = JSON.parse(output);
		return issues.map((issue: Record<string, unknown>) => ({
			id: issue.id as string,
			title: issue.title as string,
			status: issue.status as BdIssue["status"],
			priority: issue.priority as number | undefined,
			createdAt: issue.created_at as string | undefined,
			updatedAt: issue.updated_at as string | undefined,
		}));
	} catch {
		return [];
	}
}

/**
 * Create a bd issue from a todo task
 */
export function createBdFromTodo(task: TodoTask): SyncResult {
	const priority = inferPriorityFromTask(task);

	try {
		const command = `bd create "${escapeShell(task.subject)}" -p ${priority} --json`;
		const output = execBdCommand(command);

		// Try to extract bd ID from output
		let bdId = extractBdId(output);

		// If not found in output, try to get it from the created issue
		if (!bdId) {
			const issues = getOpenBdIssues();
			// Match by title (not ideal but fallback)
			const match = issues.find((i) => i.title === task.subject);
			bdId = match?.id || null;
		}

		if (bdId) {
			mappingRegistry.set(task.id, bdId);
		}

		return {
			success: true,
			direction: "todo_to_bd",
			taskId: task.id,
			bdId: bdId || undefined,
			action: "create",
		};
	} catch (error: unknown) {
		return {
			success: false,
			direction: "todo_to_bd",
			taskId: task.id,
			action: "create",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Update a bd issue from a todo task update
 */
export function updateBdFromTodo(task: TodoTask): SyncResult {
	const mapping = mappingRegistry.getByTodoId(task.id);
	if (!mapping) {
		// No mapping exists, create new bd issue
		return createBdFromTodo(task);
	}

	try {
		const bdStatus = STATUS_MAP[task.status];
		const command = `bd update ${mapping.bdId} --status ${bdStatus} --json`;
		execBdCommand(command);

		// Update last sync timestamp
		mappingRegistry.updateLastSync(task.id);

		return {
			success: true,
			direction: "todo_to_bd",
			taskId: task.id,
			bdId: mapping.bdId,
			action: "update",
		};
	} catch (error: unknown) {
		return {
			success: false,
			direction: "todo_to_bd",
			taskId: task.id,
			bdId: mapping.bdId,
			action: "update",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Close/delete a bd issue when todo is deleted
 */
export function closeBdFromTodo(task: TodoTask): SyncResult {
	const mapping = mappingRegistry.getByTodoId(task.id);
	if (!mapping) {
		return {
			success: true, // Nothing to close
			direction: "todo_to_bd",
			taskId: task.id,
			action: "delete",
		};
	}

	try {
		const command = `bd close ${mapping.bdId} --reason "Closed from todo" --json`;
		execBdCommand(command);

		// Remove mapping
		mappingRegistry.delete(task.id);

		return {
			success: true,
			direction: "todo_to_bd",
			taskId: task.id,
			bdId: mapping.bdId,
			action: "delete",
		};
	} catch (error: unknown) {
		return {
			success: false,
			direction: "todo_to_bd",
			taskId: task.id,
			bdId: mapping.bdId,
			action: "delete",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Infer priority from task metadata
 */
function inferPriorityFromTask(task: TodoTask): number {
	if (task.metadata?.priority !== undefined) {
		return task.metadata.priority as number;
	}
	// Default priority 2 (medium)
	return 2;
}

/**
 * Parse bd create output to extract created issue
 */
export function parseBdCreateOutput(
	output: string,
): { bdId: string; title: string } | null {
	try {
		const json = JSON.parse(output);
		if (json.id) {
			return {
				bdId: json.id,
				title: json.title || "",
			};
		}
	} catch {
		// Not JSON, try text extraction
	}

	const bdId = extractBdId(output);
	if (bdId) {
		return { bdId, title: "" };
	}

	return null;
}

/**
 * Detect if a bash command is a bd command
 */
export function isBdCommand(command: string): boolean {
	const trimmed = command.trim().toLowerCase();
	return (
		trimmed.startsWith("bd ") ||
		trimmed.startsWith("beads ") ||
		trimmed.includes("bd create") ||
		trimmed.includes("bd update") ||
		trimmed.includes("bd close") ||
		trimmed.includes("bd ready") ||
		trimmed.includes("bd list")
	);
}

/**
 * Extract bd ID from a command
 */
export function extractBdIdFromCommand(command: string): string | null {
	return extractBdId(command);
}

/**
 * Get the mapping registry for external access
 */
export function getMappingRegistry(): IdMappingRegistry {
	return mappingRegistry;
}

/**
 * Clear all mappings (for testing or reset)
 */
export function clearMappings(): void {
	mappingRegistry.clear();
}

/**
 * Escape shell arguments
 */
function escapeShell(str: string): string {
	// Escape double quotes and backslashes
	return str.replace(/["\\]/g, "\\$&");
}

/**
 * Sync from todo action to bd
 * Called when todo tool is executed
 */
export function syncTodoToBd(action: string, task: TodoTask): SyncResult {
	switch (action) {
		case "create":
			return createBdFromTodo(task);
		case "update":
			return updateBdFromTodo(task);
		case "delete":
			return closeBdFromTodo(task);
		default:
			return {
				success: true,
				direction: "todo_to_bd",
				taskId: task.id,
				action,
			};
	}
}

/**
 * Parse todo task from tool event
 * This is a simplified parser - actual implementation depends on event structure
 */
export function parseTodoTaskFromEvent(
	event: Record<string, unknown>,
): TodoTask | null {
	// The event structure depends on how pi-coding-agent exposes it
	// This is a placeholder - actual implementation needs event inspection

	const task = event.task as TodoTask | undefined;
	if (!task || typeof task.id !== "number") {
		return null;
	}

	return task;
}
