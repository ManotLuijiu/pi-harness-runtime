/**
 * todo-reminder.ts - Inject reminders to continue remaining todos
 *
 * ARCHITECTURE NOTES:
 * - Reminders are DISABLED by default (Phase 1 emergency containment)
 *   until proper scoping is implemented.
 * - Triggers are narrowed: only after agent_end, not every bash command.
 * - Deduplication is persistent via file-based hash (survives process restart).
 * - Source is scoped to sync-layer-mapped tasks only.
 *
 * This module does NOT modify the overlay (it works fine).
 * It ONLY injects reminders into the LLM context when todos remain.
 */
import { execBdCommand } from "./sync.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
// ─── Persistent state file ────────────────────────────────────────────────────
const STATE_DIR = join(homedir(), ".pi-harness-runtime");
const STATE_FILE = join(STATE_DIR, "todo-reminder-state.json");
function ensureStateDir() {
    if (!existsSync(STATE_DIR)) {
        mkdirSync(STATE_DIR, { recursive: true });
    }
}
function loadState() {
    try {
        if (existsSync(STATE_FILE)) {
            const raw = readFileSync(STATE_FILE, "utf-8");
            return JSON.parse(raw);
        }
    }
    catch {
        // ignore
    }
    return { lastDeliveredHash: "", lastDeliveredAt: 0 };
}
function saveState(state) {
    ensureStateDir();
    try {
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    }
    catch {
        // ignore — best-effort
    }
}
/**
 * Generate a stable content hash for deduplication.
 * Uses a simple non-crypto hash — we need dedup, not security.
 */
function contentHash(tasks) {
    const ids = tasks
        .map((t) => t.id)
        .sort()
        .join("|");
    let hash = 0;
    for (let i = 0; i < ids.length; i++) {
        hash = (hash * 31 + ids.charCodeAt(i)) & 0xffffffff;
    }
    return `t${Math.abs(hash).toString(16)}`;
}
/**
 * Default reminder template
 */
const DEFAULT_REMINDER_TEMPLATE = `
Remaining todos detected:
{summary}

Please continue with the next pending task or ask the user which to prioritize.
`.trim();
/**
 * Default configuration
 * NOTE: autoRemind is FALSE by default — Phase 1 emergency containment.
 * Enable only after proper task scoping is in place.
 */
const DEFAULT_CONFIG = {
    autoRemind: false, // DISABLED by default — see bug report
    template: DEFAULT_REMINDER_TEMPLATE,
    minPendingTasks: 1,
    deliverAs: "steer", // steer does NOT append to transcript
    verbose: false,
};
/**
 * Create a todo reminder instance
 */
export function createTodoReminder(pi, config = {}) {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    return new TodoReminder(pi, finalConfig);
}
/**
 * TodoReminder class — injects reminders when todos remain.
 *
 * Key design decisions:
 * 1. DISABLED by default (autoRemind: false) — Phase 1 containment
 * 2. Deduplication is persistent via file-based hash (survives process restart)
 * 3. Narrow trigger: only agent_end, never generic bash
 * 4. deliverAs: "steer" avoids transcript growth
 */
export class TodoReminder {
    pi;
    config;
    lastReminderAt = 0;
    state;
    constructor(pi, config) {
        this.pi = pi;
        this.config = config;
        // Load persistent state from file — survives process restart
        this.state = loadState();
    }
    /**
     * Start the reminder system
     */
    start() {
        if (!this.config.autoRemind) {
            return;
        }
        // Only trigger on agent_end — not on every bash command.
        // Bash triggers were too broad and caused spam during analysis sessions.
        this.pi.on("agent_end", async () => {
            await this.checkAndRemind();
        });
    }
    /**
     * Check if reminders should be sent and send them
     */
    async checkAndRemind() {
        try {
            const remaining = this.getTrackedTodos();
            if (remaining.length < this.config.minPendingTasks) {
                return;
            }
            // Persistent content-based deduplication — survives process restart.
            // Even if pi restarts, we won't re-deliver the same reminder payload.
            const hash = contentHash(remaining);
            if (hash === this.state.lastDeliveredHash) {
                return;
            }
            await this.sendReminder(remaining);
            this.lastReminderAt = Date.now();
            // Persist the hash so restart doesn't cause replay
            this.state.lastDeliveredHash = hash;
            this.state.lastDeliveredAt = this.lastReminderAt;
            saveState(this.state);
        }
        catch (e) {
            // Non-fatal - reminders are best-effort
            console.warn("[DEBUG todo-reminder] Failed to check todos:", e);
        }
    }
    /**
     * Get remaining (pending/in-progress) todos from bd.
     *
     * NOTE: This returns ALL open bd issues, not just mapped ones.
     * When the mapping registry is integrated, this should be scoped.
     */
    getTrackedTodos() {
        try {
            const output = execBdCommand("bd ready --json");
            const issues = JSON.parse(output);
            return issues
                .filter((issue) => issue.status !== "closed" && issue.status !== "done")
                .map((issue) => ({
                id: issue.id,
                title: issue.title,
                status: issue.status,
            }));
        }
        catch {
            return [];
        }
    }
    /**
     * Format the reminder message
     */
    formatReminder(remaining) {
        const summary = remaining
            .map((t) => `[${t.id}] ${t.title} (${t.status})`)
            .join("\n");
        return this.config.template.replace("{summary}", summary);
    }
    /**
     * Send the reminder to the LLM.
     *
     * FIX: Re-check state before send to prevent stale reminders.
     * If a task was closed after we prepared the reminder, skip delivery.
     */
    async sendReminder(remaining) {
        // CRITICAL FIX: Re-check state immediately before sending.
        // A task may have been closed between checkAndRemind() and now.
        // We must not deliver reminders for already-closed tasks.
        const freshState = this.getTrackedTodos();
        const freshHash = contentHash(freshState);
        const preparedHash = contentHash(remaining);
        // If the fresh state differs from what we prepared, tasks were modified
        if (freshHash !== preparedHash) {
            // Task was closed or modified — suppress stale reminder
            if (this.config.verbose ?? false) {
                console.log("[DEBUG todo-reminder] State changed since check — suppressing reminder");
            }
            return;
        }
        const message = this.formatReminder(remaining);
        try {
            this.pi.sendUserMessage(message, {
                deliverAs: this.config.deliverAs,
            });
        }
        catch (e) {
            console.warn("[DEBUG todo-reminder] Failed to send reminder:", e);
        }
    }
    /**
     * Manually trigger a reminder (for slash command)
     */
    async triggerNow() {
        await this.checkAndRemind();
    }
    /**
     * Get current remaining count
     */
    getRemainingCount() {
        return this.getTrackedTodos().length;
    }
    /**
     * Clear the persistent dedupe state (for testing or manual reset)
     */
    clearState() {
        this.state = { lastDeliveredHash: "", lastDeliveredAt: 0 };
        saveState(this.state);
    }
}
/**
 * Create a reminder with custom todos source (for tighter scoping)
 * @param pi - Extension API
 * @param getRemaining - Function that returns remaining todos
 * @param config - Reminder config
 */
export function createCustomReminder(pi, getRemaining, config = {}) {
    return new CustomTodoReminder(pi, getRemaining, config);
}
/**
 * Custom reminder with injectable todos source.
 * Use this to scope reminders to only mapped/created tasks.
 */
class CustomTodoReminder {
    pi;
    getRemaining;
    config;
    lastReminderAt = 0;
    state;
    constructor(pi, getRemaining, config) {
        this.pi = pi;
        this.getRemaining = getRemaining;
        this.config = { ...DEFAULT_CONFIG, ...config };
        // Load persistent state from file
        this.state = loadState();
    }
    start() {
        if (!this.config.autoRemind)
            return;
        // Only trigger on agent_end — not on every bash command
        this.pi.on("agent_end", async () => {
            await this.checkAndRemind();
        });
    }
    async checkAndRemind() {
        try {
            const remaining = this.getRemaining();
            if (remaining.length < this.config.minPendingTasks)
                return;
            // Persistent content-based deduplication
            const hash = contentHash(remaining);
            if (hash === this.state.lastDeliveredHash)
                return;
            await this.sendReminder(remaining);
            this.lastReminderAt = Date.now();
            // Persist so restart doesn't replay
            this.state.lastDeliveredHash = hash;
            this.state.lastDeliveredAt = this.lastReminderAt;
            saveState(this.state);
        }
        catch (e) {
            console.warn("[DEBUG todo-reminder] Failed to check todos:", e);
        }
    }
    formatReminder(remaining) {
        const summary = remaining
            .map((t) => `[${t.id}] ${t.title} (${t.status})`)
            .join("\n");
        return this.config.template.replace("{summary}", summary);
    }
    async sendReminder(remaining) {
        // CRITICAL FIX: Re-check state immediately before sending.
        // A task may have been closed between checkAndRemind() and now.
        const freshState = this.getRemaining();
        const freshHash = contentHash(freshState);
        const preparedHash = contentHash(remaining);
        // If the fresh state differs from what we prepared, tasks were modified
        if (freshHash !== preparedHash) {
            if (this.config.verbose ?? false) {
                console.log("[DEBUG todo-reminder] State changed since check — suppressing reminder");
            }
            return;
        }
        const message = this.formatReminder(remaining);
        try {
            this.pi.sendUserMessage(message, {
                deliverAs: this.config.deliverAs,
            });
        }
        catch (e) {
            console.warn("[DEBUG todo-reminder] Failed to send reminder:", e);
        }
    }
    async triggerNow() {
        await this.checkAndRemind();
    }
    getRemainingCount() {
        return this.getRemaining().length;
    }
    /**
     * Clear the persistent dedupe state
     */
    clearState() {
        this.state = { lastDeliveredHash: "", lastDeliveredAt: 0 };
        saveState(this.state);
    }
}
//# sourceMappingURL=todo-reminder.js.map