/**
 * The process-wide logging singleton.
 *
 * The singleton lives in the package (not in the harness) so that every
 * producer - the root extension and the harness modules - shares exactly one
 * shipper, one buffer and one spool.
 *
 * Nothing here throws: a logging failure must never break the caller.
 */

import { resolveLogSinkConfig, type LogSinkConfig } from "./config.js";
import { LogShipper } from "./shipper.js";
import { LogSpool } from "./spool.js";
import type { LogLevel } from "./types.js";

export interface InitCentralLoggingOptions {
	/** Environment used for the configuration. Defaults to `process.env`. */
	env?: Record<string, string | undefined>;
	/** Directory holding the credential key files. */
	keysDir?: string;
}

let shipper: LogShipper | null = null;
let config: LogSinkConfig | null = null;

/**
 * Initialize the centralized logging pipeline.
 *
 * Calling it twice is safe: the second call returns the existing
 * configuration without creating a second shipper.
 */
export function initCentralLogging(
	options: InitCentralLoggingOptions = {},
): LogSinkConfig | null {
	if (config) return config;

	try {
		const resolved = resolveLogSinkConfig({
			env: options.env ?? process.env,
			keysDir: options.keysDir,
		});
		config = resolved;

		if (!resolved.enabled) return resolved;

		const spool = resolved.spoolDir ? new LogSpool({ dir: resolved.spoolDir }) : undefined;
		shipper = new LogShipper({
			app: resolved.app,
			transports: resolved.transports,
			spool,
			buffer: resolved.buffer,
			sampling: resolved.sampling,
			flushIntervalMs: resolved.flushIntervalMs,
		});
		shipper.start();

		// The exit handler is synchronous on purpose: an async flush cannot
		// run during `exit`, so the remaining records go to the local spool.
		process.once("exit", () => {
			shipper?.flushSync();
		});

		return resolved;
	} catch {
		return null;
	}
}

/** The active shipper, or null when logging is not initialized. */
export function getCentralShipper(): LogShipper | null {
	return shipper;
}

/** The resolved configuration, or null when logging was never initialized. */
export function getCentralLogConfig(): LogSinkConfig | null {
	return config;
}

/** Emit one record. No-op when the pipeline is not initialized. */
export function centralLog(
	level: LogLevel,
	source: string,
	event: string,
	message?: string,
	fields?: Record<string, unknown>,
	error?: unknown,
): void {
	try {
		shipper?.log({ level, source, event, message, fields, error });
	} catch {
		// Never let logging break the caller.
	}
}

export function centralDebug(
	source: string,
	event: string,
	message?: string,
	fields?: Record<string, unknown>,
): void {
	centralLog("debug", source, event, message, fields);
}

export function centralInfo(
	source: string,
	event: string,
	message?: string,
	fields?: Record<string, unknown>,
): void {
	centralLog("info", source, event, message, fields);
}

export function centralWarn(
	source: string,
	event: string,
	message?: string,
	fields?: Record<string, unknown>,
): void {
	centralLog("warn", source, event, message, fields);
}

export function centralError(
	source: string,
	event: string,
	message?: string,
	fields?: Record<string, unknown>,
	error?: unknown,
): void {
	centralLog("error", source, event, message, fields, error);
}

/** Flush and stop the pipeline. Safe to call when it was never started. */
export async function shutdownCentralLogging(): Promise<void> {
	if (!shipper) return;
	const current = shipper;
	shipper = null;
	try {
		await current.stop();
	} catch {
		// Nothing to do at shutdown time.
	}
}
