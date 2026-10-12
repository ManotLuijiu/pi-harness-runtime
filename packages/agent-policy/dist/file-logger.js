/**
 * File logger for agent-policy package
 * Routes console output to file to avoid TUI interference
 */
import { appendFileSync } from "node:fs";
const LOG_FILE = "/tmp/pi-harness-agent-policy.log";
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
export function logError(prefix, msg) {
    logToFile(prefix, msg);
}
export function logInfo(prefix, ...parts) {
    logToFile(prefix, ...parts);
}
export function logWarn(prefix, msg) {
    logToFile(prefix, msg);
}
//# sourceMappingURL=file-logger.js.map