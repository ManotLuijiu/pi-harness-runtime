/**
 * Pi-harness Startup Widget Manager
 *
 * Manages the Pi-harness startup widget with proper styling
 * and overflow protection.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStatus } from "./harness-types.js";
import { logError } from "./file-logger.js";
import {
	renderWidgetBody,
	createInitialStatus,
	getTerminalWidth,
} from "./harness-widget.js";

// Widget key constant
const HARNESS_WIDGET_KEY = "pi-harness-startup";

/**
 * Harness Widget Manager
 */
export class HarnessWidget {
	private ui: ExtensionContext["ui"] | null = null;
	private status: HarnessStatus;
	private expanded: boolean = false;
	private updateTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(_pi: ExtensionAPI) {
		this.status = createInitialStatus();
		
		// Get ui from ExtensionContext if available
		// In extensions, pi.ui is available through ctx.ui in event handlers
		// We store a reference during session_start
	}

	/**
	 * Initialize with UI context (called during setup)
	 */
	initWithUI(ui: ExtensionContext["ui"]): void {
		this.ui = ui;
		this.render();
	}

	/**
	 * Update harness status and refresh widget
	 */
	updateStatus(updates: Partial<HarnessStatus>): void {
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
	updateComponent<K extends keyof HarnessStatus>(
		component: K,
		value: HarnessStatus[K],
	): void {
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
	render(): void {
		if (!this.ui) return;

		const body = renderWidgetBody(this.status);

		// Build widget content with heading
		const heading = `[Pi-harness]`;
		const content = [heading, ...body];

		// Use setWidget
		try {
			this.ui.setWidget(HARNESS_WIDGET_KEY, content);
		} catch (err) {
			// Fallback: log to stderr if widget fails
			logError("[pi-harness]", `Widget render failed: ${err}`);
		}
	}

	/**
	 * Initialize widget with version info
	 */
	initialize(version: string, tagline: string): void {
		this.status.version = version;
		this.status.tagline = tagline;
		this.render();
	}

	/**
	 * Set runtime status
	 */
	setRuntime(status: string): void {
		this.updateComponent("runtime", { status });
	}

	/**
	 * Set Qdrant status
	 */
	setQdrant(status: string, details?: string): void {
		this.updateComponent("qdrant", { status, details });
	}

	/**
	 * Set Honcho status
	 */
	setHoncho(status: string, sessionId?: string): void {
		this.updateComponent("honcho", { status, sessionId });
	}

	/**
	 * Set Telegram status
	 */
	setTelegram(status: string, botName?: string): void {
		this.updateComponent("telegram", { status, botName });
	}

	/**
	 * Set skills count
	 */
	setSkills(count: number): void {
		this.updateComponent("skills", { count });
	}

	/**
	 * Set commands
	 */
	setCommands(commands: string[]): void {
		this.updateComponent("commands", commands);
	}

	/**
	 * Mark component as complete with icon
	 */
	markComplete(component: keyof HarnessStatus, value?: string): void {
		const completeStatus = value ? `${value} ✓` : "ready ✓";
		this.updateComponent(component, { status: completeStatus } as HarnessStatus[keyof HarnessStatus]);
	}

	/**
	 * Mark component as failed
	 */
	markFailed(component: keyof HarnessStatus, error: string): void {
		this.updateComponent(component, { status: "failed", error } as HarnessStatus[keyof HarnessStatus]);
	}

	/**
	 * Cleanup
	 */
	dispose(): void {
		if (this.updateTimeout) {
			clearTimeout(this.updateTimeout);
		}
		// Remove widget
		try {
			this.ui?.setWidget(HARNESS_WIDGET_KEY, undefined);
		} catch {
			// Ignore cleanup errors
		}
	}
}

/**
 * Create harness widget instance
 */
export function createHarnessWidget(_pi: ExtensionAPI): HarnessWidget {
	const widget = new HarnessWidget(_pi);
	return widget;
}
