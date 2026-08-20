/**
 * Clipboard Bridge Plugin — Types
 */
import type { ToolExtension } from "@pi/framework-plugin-sdk";
export interface ClipboardBridgeConfig {
    /** Enable the paste shortcut (default: true) */
    enablePasteShortcut?: boolean;
    /** Bridge file path (default: ~/.herdr-clipboard) */
    bridgePath?: string;
    /** Auto-sync to clipboard (default: true) */
    autoSync?: boolean;
}
export interface ClipboardBridgeTool extends ToolExtension {
    capability: "tool";
    name: "Clipboard Bridge";
    tools: {
        name: "paste-from-bridge";
        description: "Read content from the clipboard bridge file and return it";
        parameters: {
            type: "object";
            properties: {};
            required: [];
        };
        execute: () => Promise<{
            content: string | null;
        }>;
    }[];
    config: ClipboardBridgeConfig;
}
//# sourceMappingURL=types.d.ts.map