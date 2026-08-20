/**
 * Clipboard Bridge Plugin — Main Entry
 *
 * Provides clipboard bridge functionality as a pi plugin.
 * Integrates paste-from-bridge and paste shortcut registration.
 */
import type { FrameworkExtension, ToolExtension } from "@pi/framework-plugin-sdk";
export type { ClipboardBridgeConfig } from "./types.js";
/**
 * Create a clipboard bridge tool plugin.
 * Provides paste-from-bridge functionality.
 */
export declare function createClipboardBridgeTool(): ToolExtension;
/**
 * Create a clipboard bridge framework extension.
 * For framework detection compatibility.
 */
export declare function createClipboardBridgePlugin(): FrameworkExtension;
/**
 * Register the paste shortcut with pi runtime.
 * Call this during plugin activation.
 */
export declare function registerPasteShortcutHandler(pi: unknown, Key: unknown): void;
/**
 * Default plugin export.
 */
export default createClipboardBridgeTool;
//# sourceMappingURL=index.d.ts.map