/**
 * Observability Package - Logger
 *
 * Structured logging with correlation IDs and child loggers.
 */

import { createWriteStream } from "node:fs";
import { mkdir, rename as renameAsync } from "node:fs/promises";
import { dirname } from "node:path";
import type { Writable } from "node:stream";
import type { LogEntry, LogLevel, LoggerConfig } from "./types.js";

// ─── Level Order ────────────────────────────────────────────────────────────

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	fatal: 4,
};

// ─── Default Configuration ─────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<LoggerConfig> = {
	level: "info",
	format: "json",
	output: "stdout",
	filePath: "",
	maxFileSize: 10 * 1024 * 1024, // 10MB
	maxFiles: 5,
	correlationIdHeader: "x-correlation-id",
	defaultMeta: {},
};

// ─── Colors for Pretty Output ───────────────────────────────────────────────

const COLORS: Record<LogLevel, string> = {
	debug: "\x1b[36m", // Cyan
	info: "\x1b[32m", // Green
	warn: "\x1b[33m", // Yellow
	error: "\x1b[31m", // Red
	fatal: "\x1b[35m", // Magenta
};

const RESET = "\x1b[0m";

// ─── UUID Generator ─────────────────────────────────────────────────────────

function generateId(): string {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

// ─── Logger Class ───────────────────────────────────────────────────────────

export class Logger {
	private readonly config: Required<LoggerConfig>;
	private readonly streams: Writable[];
	private currentCorrelationId?: string;
	private fileStream?: Writable;
	private fileSize = 0;

	constructor(config: LoggerConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.streams = this.createStreams();
	}

	/**
	 * Create output streams based on config
	 */
	private createStreams(): Writable[] {
		const streams: Writable[] = [];

		if (this.config.output === "stdout" || this.config.output === "both") {
			streams.push(process.stdout as unknown as Writable);
		}

		if (this.config.output === "stderr" || this.config.output === "both") {
			streams.push(process.stderr as unknown as Writable);
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
	private async initializeFileStream(): Promise<void> {
		if (!this.config.filePath) return;

		try {
			await mkdir(dirname(this.config.filePath), { recursive: true });
			this.fileStream = createWriteStream(this.config.filePath, {
				flags: "a",
				highWaterMark: 64 * 1024, // 64KB
			});

			this.fileStream?.on("error", (err) => {
				console.error("File stream error:", err);
			});
		} catch (err) {
			console.error("Failed to initialize file stream:", err);
		}
	}

	/**
	 * Check if level should be logged
	 */
	private shouldLog(level: LogLevel): boolean {
		return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.config.level];
	}

	/**
	 * Format entry as JSON
	 */
	private formatJSON(entry: LogEntry): string {
		return JSON.stringify(entry) + "\n";
	}

	/**
	 * Format entry as pretty text
	 */
	private formatPretty(entry: LogEntry): string {
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
	private format(entry: LogEntry): string {
		if (this.config.format === "json") {
			return this.formatJSON(entry);
		}
		return this.formatPretty(entry);
	}

	/**
	 * Write log entry
	 */
	private write(entry: LogEntry): void {
		if (!this.shouldLog(entry.level)) return;

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
	private rotateFile(): void {
		if (!this.fileStream || !this.config.filePath) return;

		// Close current stream
		this.fileStream.end();
		this.fileSize = 0;

		// Rename current file for rotation
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const rotatedPath = `${this.config.filePath}.${timestamp}`;

		// Perform rotation asynchronously
		renameAsync(this.config.filePath, rotatedPath).catch((err: unknown) => {
			console.error("Failed to rotate log file:", err);
		});

		// Reopen the stream
		this.initializeFileStream();
	}

	/**
	 * Create log entry with base fields
	 */
	private createEntry(
		level: LogLevel,
		message: string,
		meta?: Record<string, unknown>,
	): LogEntry {
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
	debug(message: string, meta?: Record<string, unknown>): void {
		this.write(this.createEntry("debug", message, meta));
	}

	/**
	 * Log info message
	 */
	info(message: string, meta?: Record<string, unknown>): void {
		this.write(this.createEntry("info", message, meta));
	}

	/**
	 * Log warning message
	 */
	warn(message: string, meta?: Record<string, unknown>): void {
		this.write(this.createEntry("warn", message, meta));
	}

	/**
	 * Log error message
	 */
	error(message: string, error?: Error, meta?: Record<string, unknown>): void {
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
	fatal(message: string, error?: Error, meta?: Record<string, unknown>): void {
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
	child(defaults: Partial<LogEntry> = {}): Logger {
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
	withCorrelationId(id: string): Logger {
		const logger = this.child();
		logger.currentCorrelationId = id;
		return logger;
	}

	/**
	 * Set job ID for this logger
	 */
	withJob(jobId: string): Logger {
		return this.child({ jobId });
	}

	/**
	 * Set task ID for this logger
	 */
	withTask(taskId: string): Logger {
		return this.child({ taskId });
	}

	/**
	 * Set component name for this logger
	 */
	withComponent(component: string): Logger {
		return this.child({ component });
	}

	/**
	 * Generate a new correlation ID and set it on this logger
	 */
	generateCorrelationId(): string {
		const id = generateId();
		this.currentCorrelationId = id;
		return id;
	}

	/**
	 * Get current correlation ID
	 */
	getCorrelationId(): string | undefined {
		return this.currentCorrelationId;
	}

	/**
	 * Close logger and cleanup resources
	 */
	close(): void {
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
export function createLogger(config?: LoggerConfig): Logger {
	return new Logger(config);
}

// ─── Default Logger ──────────────────────────────────────────────────────────

/**
 * Default logger instance
 */
export const defaultLogger = new Logger();
