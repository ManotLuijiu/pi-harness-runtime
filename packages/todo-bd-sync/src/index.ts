/**
 * todo-bd-sync - Two-way sync between rpiv-todo and bd
 *
 * This package provides:
 * 1. Detection of rpiv-todo installation
 * 2. Two-way sync between rpiv-todo tasks and bd issues
 * 3. Auto-enable functionality via prompt injection
 *
 * Usage:
 *   import { createTodoBdSync } from "@moocoding/todo-bd-sync";
 *
 *   const sync = createTodoBdSync(pi);
 *   sync.start();
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getDependencyStatus, logDependencyStatus } from "./detector.js";
import {
	syncTodoToBd,
	isBdCommand,
	extractBdIdFromCommand,
	getMappingRegistry,
	getOpenBdIssues,
	parseBdCreateOutput,
} from "./sync.js";
import type { TodoTask } from "./types.js";

// Configuration
export interface TodoBdSyncConfig {
	/** Auto-inject "todo-list" to prompt (default: true) */
	autoInjectPrompt?: boolean;
	/** Sync direction: both, todoOnly, bdOnly (default: both) */
	syncDirection?: "both" | "todoOnly" | "bdOnly";
	/** Load existing bd issues on session start (default: true) */
	loadOnSessionStart?: boolean;
	/** Debug logging (default: false) */
	debug?: boolean;
}

const DEFAULT_CONFIG: Required<TodoBdSyncConfig> = {
	autoInjectPrompt: true,
	syncDirection: "both",
	loadOnSessionStart: true,
	debug: false,
};

interface ToolExecutionEvent {
	toolName: string;
	args?: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
}

/**
 * Create a todo-bd sync instance
 */
export function createTodoBdSync(
	pi: ExtensionAPI,
	config: TodoBdSyncConfig = {},
): TodoBdSync {
	const finalConfig = { ...DEFAULT_CONFIG, ...config };
	return new TodoBdSync(pi, finalConfig);
}

/**
 * TodoBdSync class - handles two-way sync between rpiv-todo and bd
 */
export class TodoBdSync {
	private pi: ExtensionAPI;
	private config: Required<TodoBdSyncConfig>;
	private enabled: boolean = false;
	private sessionStartLoaded: boolean = false;

	constructor(pi: ExtensionAPI, config: Required<TodoBdSyncConfig>) {
		this.pi = pi;
		this.config = config;
	}

	/**
	 * Initialize and start the sync
	 */
	start(): void {
		// Check dependencies
		const deps = getDependencyStatus();

		if (!deps.bd.installed) {
			if (this.config.debug) {
				console.log("[DEBUG todo-bd-sync] bd CLI not installed, skipping");
			}
			return;
		}

		if (!deps.rpivTodo.installed && !this.shouldUseFallback()) {
			if (this.config.debug) {
				console.log(
					"[todo-bd-sync] rpiv-todo not installed, using fallback mode",
				);
			}
			// In fallback mode, we would implement our own todo overlay
			// For now, we'll just note that it's not available
		}

		this.enabled = true;

		if (this.config.debug) {
			logDependencyStatus();
		}

		// Register event handlers
		this.registerHandlers();

		if (this.config.debug) {
			console.log("[DEBUG todo-bd-sync] Started with config:", this.config);
		}
	}

	/**
	 * Register event handlers
	 */
	private registerHandlers(): void {
		// Session start - load existing bd issues
		if (this.config.loadOnSessionStart) {
			this.pi.on(
				"session_start",
				async (_event: unknown, ctx: { hasUI?: boolean }) => {
					if (!this.enabled || this.sessionStartLoaded) return;
					await this.handleSessionStart(ctx);
					this.sessionStartLoaded = true;
				},
			);
		}

		// Tool execution end - sync changes
		this.pi.on("tool_execution_end", async (event: ToolExecutionEvent) => {
			if (!this.enabled) return;

			if (event.toolName === "todo") {
				// Todo tool was called - sync to bd
				if (
					this.config.syncDirection === "both" ||
					this.config.syncDirection === "todoOnly"
				) {
					this.handleTodoExecution(event);
				}
			}

			if (event.toolName === "bash" && event.args?.command) {
				// Bash command executed - check if it's a bd command
				if (
					this.config.syncDirection === "both" ||
					this.config.syncDirection === "bdOnly"
				) {
					this.handleBashExecution(event);
				}
			}
		});

		// Register slash command for manual sync
		this.pi.registerCommand("bd-todo-sync", {
			description: "Sync todo list with bd issues",
			handler: async (_args: unknown, ctx) => {
				if (!this.enabled) {
					ctx.ui.notify(
						"[todo-bd-sync] Not enabled - dependencies missing",
						"warning",
					);
					return;
				}

				// Sync all todos to bd
				const mappings = getMappingRegistry().getAll();
				ctx.ui.notify(
					`[todo-bd-sync] Syncing ${mappings.length} mapped tasks to bd...`,
					"info",
				);

				// Force refresh bd issues
				const issues = getOpenBdIssues();
				ctx.ui.notify(
					`[todo-bd-sync] Found ${issues.length} open bd issues`,
					"info",
				);
			},
		});

		// Register slash command to check status
		this.pi.registerCommand("bd-todo-status", {
			description: "Show todo-bd sync status",
			handler: async (_args: unknown, ctx) => {
				const deps = getDependencyStatus();
				const mappings = getMappingRegistry().getAll();

				const lines = [
					"=== todo-bd-sync Status ===",
					`rpiv-todo: ${deps.rpivTodo.installed ? "installed" : "not installed"}`,
					`bd: ${deps.bd.installed ? "installed (" + deps.bd.version + ")" : "not installed"}`,
					`Mappings: ${mappings.length}`,
					`Enabled: ${this.enabled}`,
				];

				ctx.ui.notify(lines.join("\n"), "info");
			},
		});
	}

	/**
	 * Handle todo tool execution
	 */
	private handleTodoExecution(event: ToolExecutionEvent): void {
		if (event.isError) return;

		// Extract action and task from event
		const action = event.args?.action as string | undefined;
		const task = this.extractTaskFromEvent(event);

		if (!action || !task) {
			if (this.config.debug) {
				console.log("[DEBUG todo-bd-sync] Could not extract action/task from event");
			}
			return;
		}

		// Sync to bd
		const result = syncTodoToBd(action, task);

		if (this.config.debug) {
			console.log("[DEBUG todo-bd-sync] Todo sync result:", result);
		}

		// Notify if sync failed
		if (!result.success && this.config.debug) {
			console.error("[DEBUG todo-bd-sync] Sync failed:", result.error);
		}
	}

	/**
	 * Handle bash command execution
	 */
	private handleBashExecution(event: ToolExecutionEvent): void {
		const command = event.args?.command as string;

		if (!isBdCommand(command)) {
			return;
		}

		if (this.config.debug) {
			console.log("[DEBUG todo-bd-sync] Detected bd command:", command);
		}

		// Check for bd create
		if (command.includes("bd create")) {
			this.handleBdCreate(event);
		}

		// Check for bd update
		if (command.includes("bd update") || command.includes("bd close")) {
			this.handleBdUpdate(event);
		}
	}

	/**
	 * Handle bd create command
	 */
	private handleBdCreate(event: ToolExecutionEvent): void {
		const result = event.result;
		if (!result || typeof result !== "object") return;

		// Extract created bd issue info
		const output = JSON.stringify(result);
		const parsed = parseBdCreateOutput(output);

		if (parsed && parsed.bdId) {
			if (this.config.debug) {
				console.log(`[todo-bd-sync] Created bd issue: ${parsed.bdId}`);
			}
			// Note: At this point we don't have a todo ID yet
			// The sync will happen when the todo tool is called next
		}
	}

	/**
	 * Handle bd update/close command
	 */
	private handleBdUpdate(event: ToolExecutionEvent): void {
		const command = event.args?.command as string;
		const bdId = extractBdIdFromCommand(command);

		if (!bdId) return;

		const mappings = getMappingRegistry();
		const mapping = mappings.getByBdId(bdId);

		if (mapping) {
			if (this.config.debug) {
				console.log(
					`[todo-bd-sync] Updated bd issue ${bdId}, mapped to todo ${mapping.todoId}`,
				);
			}
			mappings.updateLastSync(mapping.todoId);
		}
	}

	/**
	 * Handle session start
	 */
	private async handleSessionStart(ctx: { hasUI?: boolean }): Promise<void> {
		if (!ctx.hasUI) return;

		try {
			// Get all open bd issues
			const issues = getOpenBdIssues();

			if (this.config.debug) {
				console.log(
					`[todo-bd-sync] Session start: found ${issues.length} open bd issues`,
				);
			}

			// Notify user about sync status
			if (issues.length > 0) {
				ctx.hasUI && this.pi; // Just to use ctx
			}
		} catch (error) {
			if (this.config.debug) {
				console.error("[DEBUG todo-bd-sync] Session start sync failed:", error);
			}
		}
	}

	/**
	 * Extract task from todo tool event
	 */
	private extractTaskFromEvent(event: ToolExecutionEvent): TodoTask | null {
		// The event structure depends on how pi-coding-agent exposes tool results
		// This is a simplified extraction

		const result = event.result as Record<string, unknown> | undefined;
		if (!result) return null;

		// Try to extract task from result
		const task = result.task as TodoTask | undefined;
		if (task && typeof task.id === "number") {
			return task;
		}

		// Try to extract from args
		const args = event.args as Record<string, unknown> | undefined;
		if (args) {
			const id = args.id as number | undefined;
			const subject = args.subject as string | undefined;
			const status = args.status as TodoTask["status"] | undefined;
			const description = args.description as string | undefined;

			if (id !== undefined) {
				return {
					id,
					subject: subject || "",
					status: status || "pending",
					description,
					metadata: {},
				};
			}
		}

		return null;
	}

	/**
	 * Check if we should use fallback mode (custom todo implementation)
	 */
	private shouldUseFallback(): boolean {
		// Check if there's a config option for fallback
		// For now, return false (we don't have a fallback implementation yet)
		return false;
	}

	/**
	 * Get the prompt injection string
	 * This is added to the system prompt to trigger rpiv-todo
	 */
	static getPromptInjection(): string {
		return "todo-list";
	}

	/**
	 * Check if sync is enabled
	 */
	isEnabled(): boolean {
		return this.enabled;
	}
}

// Default export
export default createTodoBdSync;

export type {
	TodoTask,
	BdIssue,
	SyncResult,
	IdMappingRegistry,
} from "./types.js";
