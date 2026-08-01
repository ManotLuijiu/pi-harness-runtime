/**
 * todo-bd-sync extension entry point
 *
 * This extension:
 * 1. Detects if bd is installed and initialized
 * 2. Auto-injects "add tasks to todo-list" when task is complex
 * 3. Provides two-way sync between rpiv-todo and bd (via rpiv-todo)
 *
 * The magic phrase "add tasks to todo-list" triggers rpiv-todo to track the task.
 */

import type { ExtensionAPI, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";
import { getDependencyStatus } from "./detector.js";
import { getOpenBdIssues } from "./sync.js";
import { decideAutoTodo, getTaskComplexityScore } from "./task-analyzer.js";

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
	}

	// ── Smart Auto-Todo Injection ──────────────────────────────────────────
	// Listen to user input and inject "add tasks to todo-list" when needed
	
	pi.on("input", (event: InputEvent): InputEventResult | undefined => {
		// Only process user input (not from extensions or RPC)
		if (event.source !== "interactive") {
			return;
		}

		const text = event.text.trim();
		if (!text || text.length < 10) {
			return; // Skip very short inputs
		}

		const pendingCount = getOpenBdIssues().filter(i => i.status !== "closed").length;
		const decision = decideAutoTodo(text);

		// If should create todo and phrase not already present
		if (decision.shouldCreate && !text.toLowerCase().includes("add tasks to todo-list")) {
			const score = getTaskComplexityScore(text);
			console.log(`[auto-todo] Task detected: ${decision.reason} (score: ${score}/100, pending: ${pendingCount})`);
			
			// Transform the input to add the magic phrase
			return {
				action: "transform",
				text: `${text}\n\nadd tasks to todo-list`,
			};
		}

		return;
	});

	console.log("[todo-bd-sync] Started - smart auto-todo enabled");
}

// Default export for pi extension loading
export default function todoBdSyncExtension(pi: ExtensionAPI): void {
	registerTodoBdSync(pi);
}
