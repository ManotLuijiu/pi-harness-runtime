/**
 * Pi-harness Startup Widget
 *
 * Renders harness status as a widget with native Pi styling.
 * Handles terminal width detection and overflow protection.
 */
import type { HarnessStatus } from "./harness-types.js";
/**
 * Widget configuration
 */
export interface WidgetConfig {
    /** Heading style (matching Pi's mdHeading) */
    headingStyle?: string;
    /** Body text style */
    bodyStyle?: string;
    /** Left indent for body lines */
    indent?: string;
    /** Max terminal width fallback */
    defaultWidth?: number;
}
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
export declare function renderWidgetBody(status: HarnessStatus, config?: Partial<WidgetConfig>): string[];
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
//# sourceMappingURL=harness-widget.d.ts.map