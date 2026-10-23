/**
 * In-memory batching buffer for the centralized log pipeline.
 *
 * The buffer is bounded on purpose: a logging subsystem must never be the
 * reason a process runs out of memory. When the buffer is full the LEAST
 * severe record is dropped first, and the drop is counted so the loss is
 * visible instead of silent.
 */
import { type LogRecord } from "./types.js";
export interface LogBufferOptions {
    /** Maximum number of records held in memory. Default 1000. */
    maxSize?: number;
    /** Maximum number of records per batch. Default 100. */
    maxBatchSize?: number;
}
export declare class LogBuffer {
    private readonly records;
    private readonly maxSize;
    private readonly maxBatchSize;
    private droppedCount;
    constructor(options?: LogBufferOptions);
    get size(): number;
    get dropped(): number;
    get batchSize(): number;
    push(record: LogRecord): void;
    /** Remove and return up to `maxBatchSize` of the oldest records. */
    takeBatch(maxBatchSize?: number): LogRecord[];
    /** Peek without removing (used by the synchronous exit path). */
    peekAll(): LogRecord[];
    clear(): void;
    private dropLowestSeverity;
}
//# sourceMappingURL=buffer.d.ts.map