/**
 * Clipboard Bridge Plugin — Types
 */
import type { ToolExtension } from "@pi/framework-plugin-sdk";
/**
 * Declared as a type alias rather than an interface on purpose: only type
 * aliases receive an implicit index signature, so this shape stays
 * structurally assignable to `Record<string, unknown>` (the shape
 * `ToolExtension.config` requires) without an explicit index signature that
 * would weaken every property to `unknown`.
 */
export type ClipboardBridgeConfig = {
    /** Enable the paste shortcut (default: true) */
    enablePasteShortcut?: boolean;
    /** Bridge file path (default: ~/.herdr-clipboard) */
    bridgePath?: string;
    /** Auto-sync to clipboard (default: true) */
    autoSync?: boolean;
};
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