/**
 * todo-bd-sync extension entry point
 *
 * This extension:
 * 1. Detects if bd is installed and initialized
 * 2. Auto-injects todo tool call when task is complex
 * 3. Provides two-way sync between rpiv-todo and bd (via rpiv-todo)
 */

import type {
	ExtensionAPI,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
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
	// Listen to user input and inject todo tool call when task is complex

	pi.on("input", (event: InputEvent): InputEventResult | undefined => {
		// Only process user input (not from extensions or RPC)
		if (event.source !== "interactive") {
			return;
		}

		const text = event.text.trim();
		if (!text || text.length < 5) {
			return; // Skip very short inputs
		}

		const pendingCount = getOpenBdIssues().filter(
			(i) => i.status !== "closed",
		).length;
		const decision = decideAutoTodo(text);

		// If should create todo and phrase not already present
		if (decision.shouldCreate) {
			// Check if already has explicit todo instruction
			const hasExplicitTodo =
				text.toLowerCase().includes("use the todo") ||
				text.toLowerCase().includes("add to todo") ||
				text.toLowerCase().includes("track as todo") ||
				text.toLowerCase().includes("todo list") ||
				text.toLowerCase().includes("create todo");

			if (!hasExplicitTodo) {
				const score = getTaskComplexityScore(text);
				console.log(
					`[auto-todo] Task detected: ${decision.reason} (score: ${score}/100, pending: ${pendingCount})`,
				);

				// Clearer instruction that explicitly tells LLM to use todo tool
				// This is more direct than just adding text - it tells LLM to CALL the todo tool
				const injection = `

IMPORTANT: Use the \`todo\` tool to track this task:
1. Create a todo item with subject: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"
2. Mark it as in_progress
3. Track your progress as you work

\`\`\`json
{"action": "create", "subject": "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}", "activeForm": "working on task"}
\`\`\`
`;

				return {
					action: "transform",
					text: text + injection,
				};
			}
		}

		return;
	});

	console.log("[todo-bd-sync] Started - smart auto-todo enabled");
}

// Default export for pi extension loading
export default function todoBdSyncExtension(pi: ExtensionAPI): void {
	registerTodoBdSync(pi);
}
