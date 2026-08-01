/**
 * todo-bd-sync extension entry point
 *
 * This extension:
 * 1. Detects if bd is installed and initialized
 * 2. Logs auto-todo suggestion when bd issues are pending
 * 3. Provides two-way sync between rpiv-todo and bd (via rpiv-todo)
 *
 * Usage: Agent follows the smart-auto-todo-algorithm skill:
 * - Analyze user message for complexity signals
 * - If complex, call `bd create` for each task
 * - rpiv-todo displays synced tasks automatically
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getDependencyStatus } from "./detector.js";
import { getOpenBdIssues } from "./sync.js";

/**
 * Register the todo-bd-sync extension
 */
export function registerTodoBdSync(pi: ExtensionAPI): void {
	const deps = getDependencyStatus();

	// Check if bd is installed
	if (!deps.bd.installed) {
		console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  bd (beads) is not installed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To use todo-bd-sync, install bd first:

   https://github.com/gastownhall/beads

Quick install:

   npm install -g @gastownhall/beads

   OR

   pi install npm:@gastownhall/beads

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
		return;
	}

	// Check if bd is initialized in this project
	if (!deps.bd.initialized) {
		console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 bd (beads) detected but not initialized
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run the following command to initialize:

   bd init

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
		return;
	}

	// Log open issues count
	const openIssues = getOpenBdIssues().filter(i => i.status !== "closed");
	if (openIssues.length > 0) {
		console.log(`[todo-bd-sync] ${openIssues.length} open issue(s) in bd`);
	}

	console.log("[todo-bd-sync] Started - smart auto-todo ready");
	console.log("             See skill: smart-auto-todo-algorithm");
}

// Default export for pi extension loading
export default function todoBdSyncExtension(pi: ExtensionAPI): void {
	registerTodoBdSync(pi);
}
