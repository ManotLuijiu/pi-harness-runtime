/**
 * Observability Package - Logger
 *
 * Structured logging with correlation IDs and child loggers.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename as renameAsync } from "node:fs/promises";
import { dirname } from "node:path";
// ─── Level Order ────────────────────────────────────────────────────────────
const LOG_LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
};
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    level: "info",
    format: "json",
    output: "stdout",
    filePath: "",
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 5,
    correlationIdHeader: "x-correlation-id",
    defaultMeta: {},
};
// ─── Colors for Pretty Output ───────────────────────────────────────────────
const COLORS = {
    debug: "\x1b[36m",
    info: "\x1b[32m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
    fatal: "\x1b[35m", // Magenta
};
const RESET = "\x1b[0m";
// ─── UUID Generator ─────────────────────────────────────────────────────────
function generateId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
// ─── Logger Class ───────────────────────────────────────────────────────────
export class Logger {
    config;
    streams;
    currentCorrelationId;
    fileStream;
    fileSize = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.streams = this.createStreams();
    }
    /**
     * Create output streams based on config
     */
    createStreams() {
        const streams = [];
        if (this.config.output === "stdout" || this.config.output === "both") {
            streams.push(process.stdout);
        }
        if (this.config.output === "stderr" || this.config.output === "both") {
            streams.push(process.stderr);
        }
        if (this.config.output === "file" || this.config.filePath) {
            if (this.config.filePath) {
                this.initializeFileStream();
                if (this.fileStream) {
                    streams.push(this.fileStream);
                }
            }
        }
        return streams;
    }
    /**
     * Initialize file stream
     */
    async initializeFileStream() {
        if (!this.config.filePath)
            return;
        try {
            await mkdir(dirname(this.config.filePath), { recursive: true });
            this.fileStream = createWriteStream(this.config.filePath, {
                flags: "a",
                highWaterMark: 64 * 1024, // 64KB
            });
            this.fileStream?.on("error", (err) => {
                console.error("File stream error:", err);
            });
        }
        catch (err) {
            console.error("Failed to initialize file stream:", err);
        }
    }
    /**
     * Check if level should be logged
     */
    shouldLog(level) {
        return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.config.level];
    }
    /**
     * Format entry as JSON
     */
    formatJSON(entry) {
        return JSON.stringify(entry) + "\n";
    }
    /**
     * Format entry as pretty text
     */
    formatPretty(entry) {
        const color = COLORS[entry.level];
        const timestamp = new Date(entry.timestamp).toISOString();
        const meta = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : "";
        let line = `${color}[${timestamp}]${RESET} ${color.toUpperCase()[0]} ${entry.message}${meta}`;
        if (entry.correlationId) {
            line += ` ${color}[corr: ${entry.correlationId}]${RESET}`;
        }
        if (entry.jobId) {
            line += ` ${color}[job: ${entry.jobId}]${RESET}`;
        }
        if (entry.taskId) {
            line += ` ${color}[task: ${entry.taskId}]${RESET}`;
        }
        if (entry.component) {
            line += ` ${color}[${entry.component}]${RESET}`;
        }
        if (entry.durationMs !== undefined) {
            line += ` ${color}[${entry.durationMs}ms]${RESET}`;
        }
        return line + "\n";
    }
    /**
     * Format log entry
     */
    format(entry) {
        if (this.config.format === "json") {
            return this.formatJSON(entry);
        }
        return this.formatPretty(entry);
    }
    /**
     * Write log entry
     */
    write(entry) {
        if (!this.shouldLog(entry.level))
            return;
        const formatted = this.format(entry);
        for (const stream of this.streams) {
            stream.write(formatted);
        }
        // Track file size for rotation
        if (this.fileStream) {
            this.fileSize += Buffer.byteLength(formatted);
            if (this.fileSize >= this.config.maxFileSize) {
                this.rotateFile();
            }
        }
    }
    /**
     * Rotate log file
     */
    rotateFile() {
        if (!this.fileStream || !this.config.filePath)
            return;
        // Close current stream
        this.fileStream.end();
        this.fileSize = 0;
        // Rename current file for rotation
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const rotatedPath = `${this.config.filePath}.${timestamp}`;
        // Perform rotation asynchronously
        renameAsync(this.config.filePath, rotatedPath).catch((err) => {
            console.error("Failed to rotate log file:", err);
        });
        // Reopen the stream
        this.initializeFileStream();
    }
    /**
     * Create log entry with base fields
     */
    createEntry(level, message, meta) {
        return {
            timestamp: new Date().toISOString(),
            level,
            message,
            correlationId: this.currentCorrelationId,
            ...this.config.defaultMeta,
            ...meta,
        };
    }
    /**
     * Log debug message
     */
    debug(message, meta) {
        this.write(this.createEntry("debug", message, meta));
    }
    /**
     * Log info message
     */
    info(message, meta) {
        this.write(this.createEntry("info", message, meta));
    }
    /**
     * Log warning message
     */
    warn(message, meta) {
        this.write(this.createEntry("warn", message, meta));
    }
    /**
     * Log error message
     */
    error(message, error, meta) {
        const entry = this.createEntry("error", message, {
            ...meta,
            error: error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                }
                : undefined,
        });
        this.write(entry);
    }
    /**
     * Log fatal message
     */
    fatal(message, error, meta) {
        const entry = this.createEntry("fatal", message, {
            ...meta,
            error: error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                }
                : undefined,
        });
        this.write(entry);
    }
    /**
     * Create child logger with default metadata
     */
    child(defaults = {}) {
        const childLogger = new Logger(this.config);
        childLogger.currentCorrelationId = this.currentCorrelationId;
        childLogger.config.defaultMeta = {
            ...this.config.defaultMeta,
            ...defaults,
        };
        return childLogger;
    }
    /**
     * Set correlation ID for this logger
     */
    withCorrelationId(id) {
        const logger = this.child();
        logger.currentCorrelationId = id;
        return logger;
    }
    /**
     * Set job ID for this logger
     */
    withJob(jobId) {
        return this.child({ jobId });
    }
    /**
     * Set task ID for this logger
     */
    withTask(taskId) {
        return this.child({ taskId });
    }
    /**
     * Set component name for this logger
     */
    withComponent(component) {
        return this.child({ component });
    }
    /**
     * Generate a new correlation ID and set it on this logger
     */
    generateCorrelationId() {
        const id = generateId();
        this.currentCorrelationId = id;
        return id;
    }
    /**
     * Get current correlation ID
     */
    getCorrelationId() {
        return this.currentCorrelationId;
    }
    /**
     * Close logger and cleanup resources
     */
    close() {
        if (this.fileStream) {
            this.fileStream.end();
            this.fileStream = undefined;
        }
    }
}
// ─── Factory Function ────────────────────────────────────────────────────────
/**
 * Create a logger with the given configuration
 */
export function createLogger(config) {
    return new Logger(config);
}
// ─── Default Logger ──────────────────────────────────────────────────────────
/**
 * Default logger instance
 */
export const defaultLogger = new Logger();
//# sourceMappingURL=logger.js.map