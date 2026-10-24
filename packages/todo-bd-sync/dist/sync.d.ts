/**
 * Two-way sync between rpiv-todo and bd
 *
 * This module handles:
 * 1. rpiv-todo → bd: When todo tool is called, sync to bd
 * 2. bd → rpiv-todo: When bd commands are executed, sync to todo
 * 3. Session start: Load existing bd issues into todo
 */
import type { TodoTask, BdIssue, SyncResult } from "./types.js";
import { IdMappingRegistry } from "./types.js";
/**
 * Execute a bd command and return the output
 */
export declare function execBdCommand(command: string): string;
/**
 * Extract bd ID from command or output
 */
export declare function extractBdId(input: string): string | null;
/**
 * Get all open bd issues
 */
export declare function getOpenBdIssues(): BdIssue[];
/**
 * Get all bd issues (including closed)
 */
export declare function getAllBdIssues(): BdIssue[];
/**
 * Create a bd issue from a todo task
 */
export declare function createBdFromTodo(task: TodoTask): SyncResult;
/**
 * Update a bd issue from a todo task update
 */
export declare function updateBdFromTodo(task: TodoTask): SyncResult;
/**
 * Close/delete a bd issue when todo is deleted
 */
export declare function closeBdFromTodo(task: TodoTask): SyncResult;
/**
 * Parse bd create output to extract created issue
 */
export declare function parseBdCreateOutput(output: string): {
    bdId: string;
    title: string;
} | null;
/**
 * Detect if a bash command is a bd command
 */
export declare function isBdCommand(command: string): boolean;
/**
 * Extract bd ID from a command
 */
export declare function extractBdIdFromCommand(command: string): string | null;
/**
 * Get the mapping registry for external access
 */
export declare function getMappingRegistry(): IdMappingRegistry;
/**
 * Clear all mappings (for testing or reset)
 */
export declare function clearMappings(): void;
/**
 * Sync from todo action to bd
 * Called when todo tool is executed
 */
export declare function syncTodoToBd(action: string, task: TodoTask): SyncResult;
/**
 * Parse todo task from tool event
 * This is a simplified parser - actual implementation depends on event structure
 */
export declare function parseTodoTaskFromEvent(event: Record<string, unknown>): TodoTask | null;
//# sourceMappingURL=sync.d.ts.map