/**
 * Configuration for the centralized log pipeline.
 *
 * Resolution order for credentials:
 *   environment variable -> key file in ~/.pi-harness-runtime/keys
 *
 * Secrets are never hardcoded here. A key file that is missing simply means
 * the corresponding transport is not configured.
 */
import { type ClassificationPolicy } from "./classification.js";
import type { LogBufferOptions } from "./buffer.js";
import type { SamplingPolicy } from "./sampler.js";
import type { LogTransport } from "./types.js";
import type { DeliveryMode } from "./shipper.js";
export type LogSinkMode = "off" | "auto" | "r2" | "webhook" | "r2+webhook";
export interface LogSinkConfig {
    /** False when nothing should be shipped (no transports, no spool). */
    enabled: boolean;
    /** Application name reported with every batch. */
    app: string;
    /** Version of the emitting application. */
    appVersion?: string;
    /** Stable id of this installation. */
    installationId: string;
    /** Transports in delivery priority order. */
    transports: LogTransport[];
    /**
     * How the transports are used. `fallback` (the default) lets the first
     * transport that accepts a batch win; `fanout` delivers every batch to
     * every transport.
     */
    delivery?: DeliveryMode;
    /** Directory of the local spool (undefined when logging is off). */
    spoolDir?: string;
    sampling: Partial<SamplingPolicy>;
    buffer: LogBufferOptions;
    flushIntervalMs: number;
    /** What may leave the machine. */
    classification: ClassificationPolicy;
    /** Human readable notes about what was enabled and why. */
    notes: string[];
}
export interface ResolveConfigOptions {
    env?: Record<string, string | undefined>;
    /** Directory holding the credential key files. */
    keysDir?: string;
    /** Overrides the installation id (tests, containers). */
    installationId?: string;
}
export declare function defaultKeysDir(): string;
export declare function defaultSpoolDir(): string;
/**
 * Build the log sink configuration from the environment and the key files.
 */
export declare function resolveLogSinkConfig(options?: ResolveConfigOptions): LogSinkConfig;
//# sourceMappingURL=config.d.ts.map