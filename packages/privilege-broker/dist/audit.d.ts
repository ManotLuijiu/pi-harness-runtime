import type { AuditEntry, AuditLogger } from "./types.js";
/** No-op logger — discards all events. */
export declare class NoOpAuditLogger implements AuditLogger {
    log(_entry: AuditEntry): void;
}
/** Console logger — writes human-readable lines to stdout/stderr. */
export declare class ConsoleAuditLogger implements AuditLogger {
    log(entry: AuditEntry): void;
}
/**
 * JSON Lines file logger — appends one JSON object per event.
 * Auto-creates parent directory. Auto-rotates when file exceeds maxSizeBytes.
 */
export declare class FileAuditLogger implements AuditLogger {
    private readonly logPath;
    private readonly maxSizeBytes;
    private readonly maxRotations;
    constructor(options?: {
        logPath?: string;
        maxSizeBytes?: number;
        maxRotations?: number;
    });
    log(entry: AuditEntry): void;
    private _ensureDir;
    private _rotateIfNeeded;
    /**
     * Read recent audit entries.
     * Returns newest entries last.
     */
    query(options?: {
        workerId?: string;
        taskId?: string;
        capability?: string;
        success?: boolean;
        limit?: number;
    }): AuditEntry[];
}
//# sourceMappingURL=audit.d.ts.map