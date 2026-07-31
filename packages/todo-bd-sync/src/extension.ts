/**
 * todo-bd-sync extension entry point
 *
 * This is the pi-coding-agent extension that:
 * 1. Auto-injects "todo-list" to prompt to enable rpiv-todo
 * 2. Sets up two-way sync between rpiv-todo and bd
 * 3. Loads existing bd issues on session start
 *
 * To use this extension:
 * 1. Install dependencies:
 *    pi install npm:@juicesharp/rpiv-todo
 *    (bd should already be installed)
 *
 * 2. The extension auto-enables when rpiv-todo is detected
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createTodoBdSync,
	type TodoBdSync,
	type TodoBdSyncConfig,
} from "./index.js";
import {
	getDependencyStatus,
	logDependencyStatus,
} from "./detector.js";
import { createCustomReminder } from "./todo-reminder.js";
import { getOpenBdIssues } from "./sync.js";

/**
 * Register the todo-bd-sync extension
 */
export function registerTodoBdSync(
	pi: ExtensionAPI,
	config?: TodoBdSyncConfig,
): TodoBdSync | null {
	const deps = getDependencyStatus();

	// Check if bd is installed
	if (!deps.bd.installed) {
		// Show user how to install bd
		const installMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  bd (beads) is not installed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To use todo-bd-sync, install bd first:

   https://github.com/gastownhall/beads

Quick install (requires Node.js):

   npm install -g @gastownhall/beads

   OR

   pi install npm:@gastownhall/beads

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
		console.log(installMsg);
		return null;
	}

	// Check if bd is initialized in this project
	if (!deps.bd.initialized) {
		const initMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 bd (beads) detected but not initialized
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run the following command to initialize:

   bd init

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
		console.log(initMsg);
	}

	// Log dependency status for debugging (only if debug mode)
	if (config?.debug) {
		logDependencyStatus();
	}

	// Create and start sync
	const sync = createTodoBdSync(pi, {
		autoInjectPrompt: true,
		syncDirection: "both",
		loadOnSessionStart: true,
		...config,
	});

	sync.start();

	// Start todo reminder (DISABLED by default — Phase 1 emergency containment)
	// Reminder spam was causing transcript growth. Enable only after proper task scoping.
	const reminder = createCustomReminder(
		pi,
		() => {
			// Get remaining todos from bd
			const issues = getOpenBdIssues();
			return issues
				.filter((i) => i.status !== "closed")
				.map((i) => ({
					id: i.id,
					title: i.title,
					status: i.status,
				}));
		},
		{
			autoRemind: false, // DISABLED — fix reminder spam before re-enabling
			minPendingTasks: 1,
		},
	);
	reminder.start();

	return sync;
}

// Default export for pi extension loading
export default function todoBdSyncExtension(pi: ExtensionAPI): void {
	registerTodoBdSync(pi, { debug: false });
}
