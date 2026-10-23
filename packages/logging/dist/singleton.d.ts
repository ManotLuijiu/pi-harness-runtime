/**
 * The process-wide logging singleton.
 *
 * The singleton lives in the package (not in the harness) so that every
 * producer - the root extension and the harness modules - shares exactly one
 * shipper, one buffer and one spool.
 *
 * Nothing here throws: a logging failure must never break the caller.
 */
import { type LogSinkConfig } from "./config.js";
import { LogShipper } from "./shipper.js";
import type { LogLevel } from "./types.js";
export interface InitCentralLoggingOptions {
    /** Environment used for the configuration. Defaults to `process.env`. */
    env?: Record<string, string | undefined>;
    /** Directory holding the credential key files. */
    keysDir?: string;
}
/**
 * Initialize the centralized logging pipeline.
 *
 * Calling it twice is safe: the second call returns the existing
 * configuration without creating a second shipper.
 */
export declare function initCentralLogging(options?: InitCentralLoggingOptions): LogSinkConfig | null;
/** The active shipper, or null when logging is not initialized. */
export declare function getCentralShipper(): LogShipper | null;
/** The resolved configuration, or null when logging was never initialized. */
export declare function getCentralLogConfig(): LogSinkConfig | null;
/** Emit one record. No-op when the pipeline is not initialized. */
export declare function centralLog(level: LogLevel, source: string, event: string, message?: string, fields?: Record<string, unknown>, error?: unknown): void;
export declare function centralDebug(source: string, event: string, message?: string, fields?: Record<string, unknown>): void;
export declare function centralInfo(source: string, event: string, message?: string, fields?: Record<string, unknown>): void;
export declare function centralWarn(source: string, event: string, message?: string, fields?: Record<string, unknown>): void;
export declare function centralError(source: string, event: string, message?: string, fields?: Record<string, unknown>, error?: unknown): void;
/** Flush and stop the pipeline. Safe to call when it was never started. */
export declare function shutdownCentralLogging(): Promise<void>;
//# sourceMappingURL=singleton.d.ts.map