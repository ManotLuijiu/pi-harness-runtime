/**
 * File logger for notification package
 * Routes console output to file to avoid TUI interference
 */
import { appendFileSync } from "node:fs";
const LOG_FILE = "/tmp/pi-harness-notifications.log";
export function logToFile(prefix, ...parts) {
    try {
        const msg = parts
            .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
            .join(" ");
        appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${prefix} ${msg}\n`);
    }
    catch {
        // Silently fail if logging fails
    }
}
export function logError(prefix, err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(prefix, msg);
}
export function logInfo(prefix, ...parts) {
    logToFile(prefix, ...parts);
}
export function logWarn(prefix, ...parts) {
    logToFile(prefix, ...parts);
}
//# sourceMappingURL=file-logger.js.map