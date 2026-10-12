/**
 * Pi-harness Startup Widget Manager
 *
 * Manages the Pi-harness startup widget with proper styling
 * and overflow protection.
 */
import { logError } from "./file-logger.js";
import { renderWidgetBody, createInitialStatus, } from "./harness-widget.js";
// Widget key constant
const HARNESS_WIDGET_KEY = "pi-harness-startup";
/**
 * Harness Widget Manager
 */
export class HarnessWidget {
    ui = null;
    status;
    expanded = false;
    updateTimeout = null;
    constructor(_pi) {
        this.status = createInitialStatus();
        // Get ui from ExtensionContext if available
        // In extensions, pi.ui is available through ctx.ui in event handlers
        // We store a reference during session_start
    }
    /**
     * Initialize with UI context (called during setup)
     */
    initWithUI(ui) {
        this.ui = ui;
        this.render();
    }
    /**
     * Update harness status and refresh widget
     */
    updateStatus(updates) {
        // Merge updates
        this.status = {
            ...this.status,
            ...updates,
        };
        // Debounce updates to avoid excessive re-renders
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
            this.render();
        }, 100);
    }
    /**
     * Update specific component status
     */
    updateComponent(component, value) {
        this.status = {
            ...this.status,
            [component]: value,
        };
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => {
            this.render();
        }, 100);
    }
    /**
     * Render and display the widget
     */
    render() {
        if (!this.ui)
            return;
        const body = renderWidgetBody(this.status);
        // Build widget content with heading
        const heading = `[Pi-harness]`;
        const content = [heading, ...body];
        // Use setWidget
        try {
            this.ui.setWidget(HARNESS_WIDGET_KEY, content);
        }
        catch (err) {
            // Fallback: log to stderr if widget fails
            logError("[pi-harness]", `Widget render failed: ${err}`);
        }
    }
    /**
     * Initialize widget with version info
     */
    initialize(version, tagline) {
        this.status.version = version;
        this.status.tagline = tagline;
        this.render();
    }
    /**
     * Set runtime status
     */
    setRuntime(status) {
        this.updateComponent("runtime", { status });
    }
    /**
     * Set Qdrant status
     */
    setQdrant(status, details) {
        this.updateComponent("qdrant", { status, details });
    }
    /**
     * Set Honcho status
     */
    setHoncho(status, sessionId) {
        this.updateComponent("honcho", { status, sessionId });
    }
    /**
     * Set Telegram status
     */
    setTelegram(status, botName) {
        this.updateComponent("telegram", { status, botName });
    }
    /**
     * Set skills count
     */
    setSkills(count) {
        this.updateComponent("skills", { count });
    }
    /**
     * Set commands
     */
    setCommands(commands) {
        this.updateComponent("commands", commands);
    }
    /**
     * Mark component as complete with icon
     */
    markComplete(component, value) {
        const completeStatus = value ? `${value} ✓` : "ready ✓";
        this.updateComponent(component, { status: completeStatus });
    }
    /**
     * Mark component as failed
     */
    markFailed(component, error) {
        this.updateComponent(component, { status: "failed", error });
    }
    /**
     * Cleanup
     */
    dispose() {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        // Remove widget
        try {
            this.ui?.setWidget(HARNESS_WIDGET_KEY, undefined);
        }
        catch {
            // Ignore cleanup errors
        }
    }
}
/**
 * Create harness widget instance
 */
export function createHarnessWidget(_pi) {
    const widget = new HarnessWidget(_pi);
    return widget;
}
//# sourceMappingURL=harness-widget-manager.js.map