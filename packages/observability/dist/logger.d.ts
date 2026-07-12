/**
 * Observability Package - Logger
 *
 * Structured logging with correlation IDs and child loggers.
 */
import type { LogEntry, LoggerConfig } from "./types.js";
export declare class Logger {
    private readonly config;
    private readonly streams;
    private currentCorrelationId?;
    private fileStream?;
    private fileSize;
    constructor(config?: LoggerConfig);
    /**
     * Create output streams based on config
     */
    private createStreams;
    /**
     * Initialize file stream
     */
    private initializeFileStream;
    /**
     * Check if level should be logged
     */
    private shouldLog;
    /**
     * Format entry as JSON
     */
    private formatJSON;
    /**
     * Format entry as pretty text
     */
    private formatPretty;
    /**
     * Format log entry
     */
    private format;
    /**
     * Write log entry
     */
    private write;
    /**
     * Rotate log file
     */
    private rotateFile;
    /**
     * Create log entry with base fields
     */
    private createEntry;
    /**
     * Log debug message
     */
    debug(message: string, meta?: Record<string, unknown>): void;
    /**
     * Log info message
     */
    info(message: string, meta?: Record<string, unknown>): void;
    /**
     * Log warning message
     */
    warn(message: string, meta?: Record<string, unknown>): void;
    /**
     * Log error message
     */
    error(message: string, error?: Error, meta?: Record<string, unknown>): void;
    /**
     * Log fatal message
     */
    fatal(message: string, error?: Error, meta?: Record<string, unknown>): void;
    /**
     * Create child logger with default metadata
     */
    child(defaults?: Partial<LogEntry>): Logger;
    /**
     * Set correlation ID for this logger
     */
    withCorrelationId(id: string): Logger;
    /**
     * Set job ID for this logger
     */
    withJob(jobId: string): Logger;
    /**
     * Set task ID for this logger
     */
    withTask(taskId: string): Logger;
    /**
     * Set component name for this logger
     */
    withComponent(component: string): Logger;
    /**
     * Generate a new correlation ID and set it on this logger
     */
    generateCorrelationId(): string;
    /**
     * Get current correlation ID
     */
    getCorrelationId(): string | undefined;
    /**
     * Close logger and cleanup resources
     */
    close(): void;
}
/**
 * Create a logger with the given configuration
 */
export declare function createLogger(config?: LoggerConfig): Logger;
/**
 * Default logger instance
 */
export declare const defaultLogger: Logger;
//# sourceMappingURL=logger.d.ts.map