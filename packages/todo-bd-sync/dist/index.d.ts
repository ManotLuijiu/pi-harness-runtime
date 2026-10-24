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
/**
 * Create a todo-bd sync instance
 */
export declare function createTodoBdSync(pi: ExtensionAPI, config?: TodoBdSyncConfig): TodoBdSync;
/**
 * TodoBdSync class - handles two-way sync between rpiv-todo and bd
 */
export declare class TodoBdSync {
    private pi;
    private config;
    private enabled;
    private sessionStartLoaded;
    constructor(pi: ExtensionAPI, config: Required<TodoBdSyncConfig>);
    /**
     * Initialize and start the sync
     */
    start(): void;
    /**
     * Register event handlers
     */
    private registerHandlers;
    /**
     * Handle todo tool execution
     */
    private handleTodoExecution;
    /**
     * Handle bash command execution
     */
    private handleBashExecution;
    /**
     * Handle bd create command
     */
    private handleBdCreate;
    /**
     * Handle bd update/close command
     */
    private handleBdUpdate;
    /**
     * Handle session start
     */
    private handleSessionStart;
    /**
     * Extract task from todo tool event
     */
    private extractTaskFromEvent;
    /**
     * Check if we should use fallback mode (custom todo implementation)
     */
    private shouldUseFallback;
    /**
     * Get the prompt injection string
     * This is added to the system prompt to trigger rpiv-todo
     */
    static getPromptInjection(): string;
    /**
     * Check if sync is enabled
     */
    isEnabled(): boolean;
}
export default createTodoBdSync;
export type { TodoTask, BdIssue, SyncResult, IdMappingRegistry, } from "./types.js";
//# sourceMappingURL=index.d.ts.map