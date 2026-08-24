/**
 * GLM Quota Logger — Structured logging for GLM quota events
 *
 * Logs are written to:
 *   ~/.pi/harness-logs/glm-quota.log
 *
 * Log levels:
 *   INFO  - Normal events (countdown started, resume triggered)
 *   WARN  - Warnings (quota still exhausted, notification failed)
 *   ERROR - Errors (auto-resume failed, mirror update failed)
 *
 * Format: [ISO_TIMESTAMP] [LEVEL] [jobId] message
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type LogLevel = "INFO" | "WARN" | "ERROR";

const LOG_DIR = join(homedir(), ".pi", "harness-logs");
const LOG_FILE = join(LOG_DIR, "glm-quota.log");

/** Ensure log directory exists */
function ensureLogDir(): void {
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}
}

/** Format log entry */
function formatLog(
	level: LogLevel,
	jobId: string | null,
	message: string,
): string {
	const timestamp = new Date().toISOString();
	const job = jobId ? `[${jobId}]` : "[system]";
	return `[${timestamp}] [${level}] ${job} ${message}`;
}

/**
 * Write a log entry to file
 */
function writeLog(
	level: LogLevel,
	jobId: string | null,
	message: string,
): void {
	try {
		ensureLogDir();
		const entry = formatLog(level, jobId, message) + "\n";
		appendFileSync(LOG_FILE, entry);
	} catch {
		// Non-fatal - just log to console
		console.error(`[GLMQuotaLogger] Failed to write log: ${message}`);
	}
}

// --- Public API ---

/**
 * Log info level event
 */
export function logInfo(jobId: string | null, message: string): void {
	console.log(`[GLMQuota] ${jobId ? `[${jobId}] ` : ""}${message}`);
	writeLog("INFO", jobId, message);
}

/**
 * Log warning level event
 */
export function logWarn(jobId: string | null, message: string): void {
	console.warn(`[GLMQuota] ${jobId ? `[${jobId}] ` : ""}${message}`);
	writeLog("WARN", jobId, message);
}

/**
 * Log error level event
 */
export function logError(
	jobId: string | null,
	message: string,
	error?: unknown,
): void {
	const errorMsg = error instanceof Error ? error.message : String(error ?? "");
	const fullMessage = errorMsg ? `${message}: ${errorMsg}` : message;
	console.error(`[GLMQuota] ${jobId ? `[${jobId}] ` : ""}${fullMessage}`);
	writeLog("ERROR", jobId, fullMessage);
}

// --- Event-specific log helpers ---

/** Log countdown started */
export function logCountdownStarted(
	jobId: string,
	resetAt: string,
	totalSeconds: number,
): void {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	logInfo(jobId, `Countdown started: ${hours}h ${minutes}m until ${resetAt}`);
}

/** Log countdown tick */
export function logCountdownTick(
	jobId: string,
	remainingSeconds: number,
): void {
	const hours = Math.floor(remainingSeconds / 3600);
	const minutes = Math.floor((remainingSeconds % 3600) / 60);
	const secs = remainingSeconds % 60;
	logInfo(jobId, `Countdown tick: ${hours}h ${minutes}m ${secs}s remaining`);
}

/** Log countdown completed */
export function logCountdownComplete(jobId: string): void {
	logInfo(jobId, "Countdown complete, triggering auto-resume");
}

/** Log auto-resume success */
export function logAutoResumeSuccess(jobId: string): void {
	logInfo(jobId, "Auto-resume succeeded, job resumed");
}

/** Log auto-resume failed */
export function logAutoResumeFailed(jobId: string, error: string): void {
	logError(jobId, "Auto-resume failed", error);
}

/** Log notification sent */
export function logNotificationSent(jobId: string, beforeReset: number): void {
	const minutes = Math.floor(beforeReset / 60);
	logInfo(jobId, `Notification sent: ${minutes} minutes before reset`);
}

/** Log notification failed */
export function logNotificationFailed(jobId: string, error: string): void {
	logWarn(jobId, `Notification failed: ${error}`);
}

/** Log mirror update */
export function logMirrorUpdate(jobId: string, success: boolean): void {
	if (success) {
		logInfo(jobId, "Mirror store updated with reset time");
	} else {
		logWarn(jobId, "Failed to update mirror store");
	}
}

/** Log quota exhaustion detected */
export function logQuotaExhausted(jobId: string, resetAt: string): void {
	logInfo(jobId, `GLM 5h quota exhausted, reset at ${resetAt}`);
}

/** Log countdown cancelled */
export function logCountdownCancelled(jobId: string): void {
	logInfo(jobId, "Countdown cancelled");
}

/** Log error parsing reset time */
export function logResetTimeParseError(jobId: string): void {
	logWarn(jobId, "Could not parse reset time from error message");
}

/** Get the log file path */
export function getLogFilePath(): string {
	return LOG_FILE;
}
