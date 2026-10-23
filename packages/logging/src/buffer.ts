/**
 * In-memory batching buffer for the centralized log pipeline.
 *
 * The buffer is bounded on purpose: a logging subsystem must never be the
 * reason a process runs out of memory. When the buffer is full the LEAST
 * severe record is dropped first, and the drop is counted so the loss is
 * visible instead of silent.
 */

import { LOG_LEVEL_SEVERITY, type LogRecord } from "./types.js";

export interface LogBufferOptions {
	/** Maximum number of records held in memory. Default 1000. */
	maxSize?: number;
	/** Maximum number of records per batch. Default 100. */
	maxBatchSize?: number;
}

export class LogBuffer {
	private readonly records: LogRecord[] = [];
	private readonly maxSize: number;
	private readonly maxBatchSize: number;
	private droppedCount = 0;

	constructor(options: LogBufferOptions = {}) {
		this.maxSize = Math.max(1, options.maxSize ?? 1000);
		this.maxBatchSize = Math.max(1, options.maxBatchSize ?? 100);
	}

	get size(): number {
		return this.records.length;
	}

	get dropped(): number {
		return this.droppedCount;
	}

	get batchSize(): number {
		return this.maxBatchSize;
	}

	push(record: LogRecord): void {
		if (this.records.length >= this.maxSize) {
			this.dropLowestSeverity();
		}
		this.records.push(record);
	}

	/** Remove and return up to `maxBatchSize` of the oldest records. */
	takeBatch(maxBatchSize: number = this.maxBatchSize): LogRecord[] {
		const count = Math.min(Math.max(0, maxBatchSize), this.records.length);
		return this.records.splice(0, count);
	}

	/** Peek without removing (used by the synchronous exit path). */
	peekAll(): LogRecord[] {
		return [...this.records];
	}

	clear(): void {
		this.records.length = 0;
	}

	private dropLowestSeverity(): void {
		let index = 0;
		let lowest = Number.POSITIVE_INFINITY;
		for (let i = 0; i < this.records.length; i++) {
			const severity = LOG_LEVEL_SEVERITY[this.records[i].level];
			if (severity < lowest) {
				lowest = severity;
				index = i;
			}
		}
		this.records.splice(index, 1);
		this.droppedCount++;
	}
}
