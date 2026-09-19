/**
 * todo-bd-sync extension entry point
 *
 * PURPOSE: Bridge between the **todo tool** (local task overlay) and **bd** (GitHub issue tracker).
 *
 * TERMINOLOGY CLARIFICATION (IMPORTANT):
 * - **bd** (beads): CLI commands like `bd create`, `bd list`, `bd close` - GitHub issue tracker
 * - **todo**: The local task overlay tool - session-only task list
 *
 * This extension helps agents understand when to use each system and provides
 * two-way sync between them.
 *
 * NOTE: Auto-injection disabled - was causing noisy output.
 * Only provides dependency detection status and slash commands.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register the todo-bd-sync extension
 *
 * Provides:
 * - Dependency status logging on startup
 * - Slash command: /bd-todo-status (check sync status)
 * - Slash command: /bd-todo-sync (manual sync)
 *
 * NOTE: Auto-injection disabled - was causing issues with bd working.
 * The todo tool call injection has been removed.
 */
export function registerTodoBdSync(_pi: ExtensionAPI): void {
	// Silent - no registration, no injection, no console output
	// The main clarification comes from index.ts system prompts
}

// Default export for pi extension loading
export default function todoBdSyncExtension(pi: ExtensionAPI): void {
	registerTodoBdSync(pi);
}
