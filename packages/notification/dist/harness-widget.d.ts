/**
 * Pi-harness Startup Widget
 *
 * Renders harness status as a widget with native Pi styling.
 * Handles terminal width detection and overflow protection.
 */
import type { HarnessStatus } from "./harness-types.js";
/**
 * Default config
 */
declare const DEFAULT_CONFIG: {
    headingStyle: string;
    bodyStyle: string;
    indent: string;
    defaultWidth: number;
};
/**
 * Get terminal width
 */
export declare function getTerminalWidth(): number;
/**
 * Truncate text to fit within max width
 */
export declare function truncate(text: string, maxWidth: number): string;
/**
 * Truncate text in the middle (for paths/lists)
 */
export declare function truncateMiddle(text: string, maxWidth: number): string;
/**
 * Render harness status as widget body (string array for setWidget)
 */
export declare function renderWidgetBody(status: HarnessStatus, config?: Partial<typeof DEFAULT_CONFIG>): string[];
/**
 * Create initial pending status
 */
export declare function createInitialStatus(): HarnessStatus;
/**
 * Format status with icons
 */
export declare function formatStatusWithIcon(status: string): {
    status: string;
    icon?: string;
};
export {};
//# sourceMappingURL=harness-widget.d.ts.map