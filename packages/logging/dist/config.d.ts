/**
 * Configuration for the centralized log pipeline.
 *
 * Resolution order for credentials:
 *   environment variable -> key file in ~/.pi-harness-runtime/keys
 *
 * Secrets are never hardcoded here. A key file that is missing simply means
 * the corresponding transport is not configured.
 */
import type { LogBufferOptions } from "./buffer.js";
import type { SamplingPolicy } from "./sampler.js";
import type { LogTransport } from "./types.js";
export type LogSinkMode = "off" | "auto" | "r2" | "webhook" | "r2+webhook";
export interface LogSinkConfig {
    /** False when nothing should be shipped (no transports, no spool). */
    enabled: boolean;
    /** Application name reported with every batch. */
    app: string;
    /** Transports in delivery priority order. */
    transports: LogTransport[];
    /** Directory of the local spool (undefined when logging is off). */
    spoolDir?: string;
    sampling: Partial<SamplingPolicy>;
    buffer: LogBufferOptions;
    flushIntervalMs: number;
    /** Human readable notes about what was enabled and why. */
    notes: string[];
}
export interface ResolveConfigOptions {
    env?: Record<string, string | undefined>;
    /** Directory holding the credential key files. */
    keysDir?: string;
}
export declare function defaultKeysDir(): string;
export declare function defaultSpoolDir(): string;
/**
 * Build the log sink configuration from the environment and the key files.
 */
export declare function resolveLogSinkConfig(options?: ResolveConfigOptions): LogSinkConfig;
//# sourceMappingURL=config.d.ts.map