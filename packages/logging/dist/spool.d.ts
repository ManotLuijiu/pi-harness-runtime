/**
 * Local NDJSON spool - the last-resort destination for log batches.
 *
 * When every transport fails (no network, R2 down, webhook server down) the
 * batch is written to disk instead of being lost. The spool is drained on
 * the next successful flush, so a temporary outage does not cost data.
 *
 * Files are plain NDJSON, one record per line, so an operator can inspect
 * them with `tail`, `jq` or `less` without any tooling.
 */
import type { LogBatch, LogRecord } from "./types.js";
export interface LogSpoolOptions {
    /** Directory that holds the spool files. */
    dir: string;
    /** Rotate a file when it would exceed this size. Default 5 MB. */
    maxFileBytes?: number;
    /** Maximum number of spool files kept. Default 20. */
    maxFiles?: number;
}
export declare class LogSpool {
    private readonly dir;
    private readonly maxFileBytes;
    private readonly maxFiles;
    constructor(options: LogSpoolOptions);
    /** Append a batch to the spool. Returns the file that was written. */
    append(batch: LogBatch, now?: Date): string;
    /** Spool files, oldest first. */
    list(): string[];
    /** Read the records of a spool file. */
    read(file: string): LogRecord[];
    /** Delete a spool file after it was shipped. */
    remove(file: string): void;
    private ensureDir;
    private currentFile;
    private shouldRotate;
    private rotate;
    private enforceRetention;
}
//# sourceMappingURL=spool.d.ts.map