/**
 * Clipboard Bridge Plugin — Main Entry
 *
 * Provides clipboard bridge functionality as a pi plugin.
 * Integrates paste-from-bridge and paste shortcut registration.
 */

import type { FrameworkExtension, ToolExtension } from "@pi/framework-plugin-sdk";
import { pasteFromBridge, registerPasteShortcut } from "@pi/clipboard";

export type { ClipboardBridgeConfig } from "./types.js";

/**
 * Create a clipboard bridge tool plugin.
 * Provides paste-from-bridge functionality.
 */
export function createClipboardBridgeTool(): ToolExtension {
	return {
		capability: "tool",
		name: "Clipboard Bridge",
		tools: [
			{
				name: "paste-from-bridge",
				description: "Read content from the clipboard bridge file (~/.herdr-clipboard)",
				parameters: {
					type: "object",
					properties: {},
					required: [],
				},
				execute: async () => {
					const content = pasteFromBridge();
					return { content };
				},
			},
		],
		config: {},
	};
}

/**
 * Create a clipboard bridge framework extension.
 * For framework detection compatibility.
 */
export function createClipboardBridgePlugin(): FrameworkExtension {
	return {
		capability: "framework",
		name: "Clipboard Bridge Plugin",
		detector: {
			detect: async () => {
				// This plugin doesn't detect frameworks, it's a utility plugin
				return false;
			},
			signals: [],
		},
		config: {},
	};
}

/**
 * Register the paste shortcut with pi runtime.
 * Call this during plugin activation.
 */
export function registerPasteShortcutHandler(
	pi: unknown,
	Key: unknown,
): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	registerPasteShortcut(pi as any, Key as any);
}

/**
 * Default plugin export.
 */
export default createClipboardBridgeTool;
