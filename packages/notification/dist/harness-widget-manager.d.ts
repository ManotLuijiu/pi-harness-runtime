/**
 * Pi-harness Startup Widget Manager
 *
 * Manages the Pi-harness startup widget with proper styling
 * and overflow protection.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStatus } from "./harness-types.js";
/**
 * Harness Widget Manager
 */
export declare class HarnessWidget {
    private ui;
    private status;
    private expanded;
    private updateTimeout;
    constructor(_pi: ExtensionAPI);
    /**
     * Initialize with UI context (called during setup)
     */
    initWithUI(ui: ExtensionContext["ui"]): void;
    /**
     * Update harness status and refresh widget
     */
    updateStatus(updates: Partial<HarnessStatus>): void;
    /**
     * Update specific component status
     */
    updateComponent<K extends keyof HarnessStatus>(component: K, value: HarnessStatus[K]): void;
    /**
     * Render and display the widget
     */
    render(): void;
    /**
     * Initialize widget with version info
     */
    initialize(version: string, tagline: string): void;
    /**
     * Set runtime status
     */
    setRuntime(status: string): void;
    /**
     * Set Qdrant status
     */
    setQdrant(status: string, details?: string): void;
    /**
     * Set Honcho status
     */
    setHoncho(status: string, sessionId?: string): void;
    /**
     * Set Telegram status
     */
    setTelegram(status: string, botName?: string): void;
    /**
     * Set skills count
     */
    setSkills(count: number): void;
    /**
     * Set commands
     */
    setCommands(commands: string[]): void;
    /**
     * Mark component as complete with icon
     */
    markComplete(component: keyof HarnessStatus, value?: string): void;
    /**
     * Mark component as failed
     */
    markFailed(component: keyof HarnessStatus, error: string): void;
    /**
     * Cleanup
     */
    dispose(): void;
}
/**
 * Create harness widget instance
 */
export declare function createHarnessWidget(_pi: ExtensionAPI): HarnessWidget;
//# sourceMappingURL=harness-widget-manager.d.ts.map