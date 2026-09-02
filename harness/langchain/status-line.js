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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
// ─── Detection ───────────────────────────────────────────────────────────────
/** True when the daemon is running inside a pi-lens-equipped pi host. */
export function isPiLensAvailable() {
    return (Boolean(process.env.PI_LENS_PID) ||
        Boolean(process.env.PI_LENS_SOCKET) ||
        process.env.PI_LENS === "1");
}
// ─── Status line format ──────────────────────────────────────────────────────
/**
 * Format a quota percentage for display.
 * Shows "N% left" when known, "?" when unknown.
 */
function fmtPercent(p) {
    if (p === undefined || p < 0)
        return "?";
    if (p >= 100)
        return "0% left";
    return `${p}% left`;
}
/**
 * Format an ISO reset timestamp as a human-readable countdown.
 * "in 2h 30m", "in 45m", "at 19:17", etc.
 */
function fmtResetAt(iso) {
    if (!iso)
        return "";
    try {
        const reset = new Date(iso);
        if (isNaN(reset.getTime()))
            return "";
        const now = new Date();
        const diffMs = reset.getTime() - now.getTime();
        if (diffMs <= 0)
            return " (resetting soon)";
        const mins = Math.floor(diffMs / 60_000);
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        if (hours > 0)
            return ` (resets in ${hours}h ${remMins}m)`;
        return ` (resets in ${remMins}m)`;
    }
    catch {
        return "";
    }
}
/**
 * Build a one-line status string.
 * Format: "MiniMax: 5h: 89% left (resets in 2h) · week: 90% left"
 */
export function formatQuotaLine(q) {
    const fiveHour = q.fiveHourPercent === undefined
        ? null
        : `5h: ${fmtPercent(q.fiveHourPercent)}${fmtResetAt(q.fiveHourResetAt)}`;
    const weekly = q.weeklyPercent === undefined ? null : `week: ${fmtPercent(q.weeklyPercent)}`;
    const parts = [fiveHour, weekly].filter(Boolean);
    if (parts.length === 0)
        return "MiniMax: quota unknown";
    return `MiniMax: ${parts.join(" · ")}`;
}
// ─── StatusLineManager ───────────────────────────────────────────────────────
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
export class StatusLineManager {
    workspace;
    quotaFile;
    lastQuota = {};
    timer;
    loopStatus = "";
    constructor(workspace) {
        this.workspace = workspace;
        // Quota file written by the pi host (which has access to TUI signals)
        this.quotaFile = join(homedir(), ".pi-harness", "quota.json");
    }
    // ─── Public API ──────────────────────────────────────────────────────────
    /**
     * Start polling the quota file.
     * Call once after construction.
     */
    start() {
        this._pollQuota();
        this.timer = setInterval(() => this._pollQuota(), 60_000);
    }
    /** Stop polling. */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    /**
     * Update the loop status (planning/writing/reviewing/finished).
     * Call this from the daemon's onStep handler.
     */
    updateLoopStatus(status) {
        this.loopStatus = status;
        this._writeStatusFile();
    }
    /**
     * Update the full status — call after each loop transition.
     * Writes the status file (when no pi-lens) and logs to console.
     */
    update(data) {
        if (data.loopStatus !== undefined)
            this.loopStatus = data.loopStatus;
        if (data.quota)
            this.lastQuota = data.quota;
        this._writeStatusFile();
    }
    /**
     * Returns a rendered one-line status string for the pi host to display.
     * Combines loop status + quota into a single readable line.
     */
    getLine() {
        const quotaLine = formatQuotaLine(this.lastQuota);
        if (this.loopStatus) {
            return `${this.loopStatus}  |  ${quotaLine}`;
        }
        return quotaLine;
    }
    // ─── Internal ───────────────────────────────────────────────────────────
    _pollQuota() {
        try {
            if (!existsSync(this.quotaFile))
                return;
            const raw = readFileSync(this.quotaFile, "utf8");
            const data = JSON.parse(raw);
            if (data.miniMax) {
                this.lastQuota = {
                    fiveHourPercent: data.miniMax.fiveHour?.percent,
                    fiveHourResetAt: data.miniMax.fiveHour?.resetAt,
                    weeklyPercent: data.miniMax.weekly?.percent,
                    weeklyResetAt: data.miniMax.weekly?.resetAt,
                    rawMessage: data.miniMax.fiveHour?.resetAt
                        ? `5h quota resets at ${data.miniMax.fiveHour.resetAt}`
                        : undefined,
                };
                this._writeStatusFile();
            }
        }
        catch {
            // Quota file missing or invalid — skip
        }
    }
    _writeStatusFile() {
        if (isPiLensAvailable())
            return; // pi-lens handles its own display
        const line = this.getLine();
        const statusFile = join(this.workspace, ".harness-status");
        try {
            // Ensure directory exists
            const dir = dirname(statusFile);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(statusFile, line + "\n", "utf8");
        }
        catch {
            // Ignore write errors (read-only filesystem, etc.)
        }
    }
}
// ─── Quota file writer (for the pi host) ─────────────────────────────────────
/**
 * Write quota data to the shared quota file.
 * Call this from the pi host process that receives GLM TUI signals.
 *
 * The daemon reads this file to keep its status line fresh.
 */
export function writeQuotaFile(data) {
    const dir = join(homedir(), ".pi-harness");
    const file = join(dir, "quota.json");
    try {
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        const payload = {
            miniMax: {
                fiveHour: {
                    percent: data.fiveHourPercent,
                    resetAt: data.fiveHourResetAt,
                },
                weekly: {
                    percent: data.weeklyPercent,
                    resetAt: data.weeklyResetAt,
                },
            },
            updatedAt: new Date().toISOString(),
        };
        writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    }
    catch {
        // Ignore write errors
    }
}
//# sourceMappingURL=status-line.js.map