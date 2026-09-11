/**
 * Status line manager — drives the harness loop status in the pi host.
 *
 * Architecture:
 *
 *   Pi-lens installed?
 *   ├─ YES → LoopWidget.makeRenderer() → pi host's ui.setWidget("harness-loop", ...)
 *   └─ NO  → write to .harness-status → pi host reads and displays
 *
 * The status line shows two tiers of information:
 *   [loop status]  [API quota]
 *   [P] planning  |  MiniMax: 5h: 89% left · week: 90% left
 *
 * API quota is read from ~/.pi-harness/quota.json (written by the pi host
 * process that has access to the TUI quota signals).  The daemon polls this
 * file every 60s so the status line stays fresh even when no task is running.
 *
 * Wiki: wiki/pi-lens-status-line.md
 */
export interface QuotaData {
    /** MiniMax 5-hour window usage percentage (0–100). Undefined = unknown. */
    fiveHourPercent?: number;
    /** MiniMax weekly window usage percentage (0–100). Undefined = unknown. */
    weeklyPercent?: number;
    /** ISO timestamp of when the 5-hour quota resets. */
    fiveHourResetAt?: string;
    /** ISO timestamp of when the weekly quota resets. */
    weeklyResetAt?: string;
    /** Raw message from GLM quota signal (for display) */
    rawMessage?: string;
}
/** True when the daemon is running inside a pi-lens-equipped pi host. */
export declare function isPiLensAvailable(): boolean;
/**
 * Build a one-line status string.
 * Format: "MiniMax: 5h: 89% left (resets in 2h) · week: 90% left"
 */
export declare function formatQuotaLine(q: QuotaData): string;
/**
 * Drives the harness status line in the pi host.
 *
 * - When pi-lens is available: provides the LoopWidget renderer factory
 *   for the pi host to integrate via `ui.setWidget("harness-loop", factory)`.
 * - When pi-lens is not available: writes a plain-text status to
 *   `<workspace>/.harness-status` every time update() is called.
 *
 * The pi host can read `.harness-status` and display it in its own UI.
 */
export declare class StatusLineManager {
    private readonly workspace;
    private readonly quotaFile;
    private lastQuota;
    private timer?;
    private loopStatus;
    constructor(workspace: string);
    /**
     * Start polling the quota file.
     * Call once after construction.
     */
    start(): void;
    /** Stop polling. */
    stop(): void;
    /**
     * Update the loop status (planning/writing/reviewing/finished).
     * Call this from the daemon's onStep handler.
     */
    updateLoopStatus(status: string): void;
    /**
     * Update the full status — call after each loop transition.
     * Writes the status file (when no pi-lens) and logs to console.
     */
    update(data: {
        loopStatus?: string;
        quota?: QuotaData;
    }): void;
    /**
     * Returns a rendered one-line status string for the pi host to display.
     * Combines loop status + quota into a single readable line.
     */
    getLine(): string;
    private _pollQuota;
    private _writeStatusFile;
}
/**
 * Write quota data to the shared quota file.
 * Call this from the pi host process that receives GLM TUI signals.
 *
 * The daemon reads this file to keep its status line fresh.
 */
export declare function writeQuotaFile(data: QuotaData): void;
//# sourceMappingURL=status-line.d.ts.map