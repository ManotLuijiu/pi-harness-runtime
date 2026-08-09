/**
 * todo-bd-sync extension entry point
 *
 * NOTE: Auto-injection disabled - was causing noisy output.
 * Only provides dependency detection status.
 */

import type {
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

/**
 * Register the todo-bd-sync extension
 * 
 * NOTE: Auto-injection disabled - was causing issues with bd working.
 * The todo tool call injection has been removed.
 */
export function registerTodoBdSync(_pi: ExtensionAPI): void {
	// Silent - no registration, no injection, no console output
}

// Default export for pi extension loading
export default function todoBdSyncExtension(pi: ExtensionAPI): void {
	registerTodoBdSync(pi);
}
