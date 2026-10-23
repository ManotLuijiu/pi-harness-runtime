/**
 * Validation Ledger - a durable record of which validation tier ran, when,
 * how long it took and whether it passed.
 *
 * The harness never runs the tests itself, so the ledger is written by the
 * agent (or by any tool that knows the result) through
 * `scripts/validation-run.ts`. The ledger is the only mechanical source for
 * the question "did the final tier already pass?" - without it the harness
 * would have to trust the agent's own report, and a todo could be completed
 * while its final acceptance check is still pending.
 *
 * Storage is plain NDJSON (one JSON object per line) so the file stays
 * inspectable with `tail`, `jq` or `less`:
 *
 * ```text
 * ~/.pi-harness-runtime/logs/validation-runs.jsonl
 * ```
 *
 * The file is rotated when it grows past `maxBytes` (the previous content
 * becomes `<path>.1`).
 */
import type { TodoItem } from "./todo-provider.js";
import { type ValidationState, type ValidationTierKind, type ValidationTierState } from "./validation-plan.js";
/**
 * Result of a single validation run.
 */
export type ValidationRunStatus = "passed" | "failed" | "timeout" | "error" | "skipped";
/**
 * One recorded validation run.
 */
export interface ValidationRunRecord {
    /** ISO timestamp of the end of the run. */
    ts: string;
    /** Which tier was executed. */
    tier: ValidationTierKind;
    /** Outcome of the run. */
    status: ValidationRunStatus;
    /** Todo item the run belongs to. */
    itemId?: number;
    /** Subject of the todo item (denormalized for readable logs). */
    itemSubject?: string;
    /** The command that was executed. */
    command?: string;
    /** Human label of the tier. */
    label?: string;
    /** Wall-clock duration of the run in milliseconds. */
    durationMs?: number;
    /** Number of records the tier exercised, when it is data-volume bound. */
    datasetSize?: number;
    /** Exit code of the command, when it produced one. */
    exitCode?: number;
    /** Free-form note (e.g. "5 of 320 tests failed"). */
    note?: string;
}
/**
 * Aggregated validation state of a todo item.
 */
export type { ValidationState, ValidationTierState };
/**
 * Options for the ledger.
 */
export interface ValidationLedgerOptions {
    /** Path of the NDJSON ledger file. */
    path?: string;
    /** Rotation threshold in bytes (default 5 MB). */
    maxBytes?: number;
    /**
     * Mirror sink: called for every recorded run.
     *
     * The harness uses it to ship the ledger through the central logging
     * pipeline, so the runs are archived next to the other application logs.
     */
    onRecord?: (record: ValidationRunRecord) => void;
}
/**
 * Default location of the ledger.
 */
export declare function defaultLedgerPath(): string;
/**
 * Parse one ledger line. Returns `null` for malformed lines.
 */
export declare function parseRunRecord(line: string): ValidationRunRecord | null;
/**
 * Parse a whole ledger file. Malformed lines are skipped, not fatal.
 */
export declare function parseLedgerContent(content: string): ValidationRunRecord[];
/**
 * Durable ledger of validation runs.
 */
export declare class ValidationLedger {
    private readonly path;
    private readonly maxBytes;
    private readonly onRecord?;
    constructor(options?: ValidationLedgerOptions);
    /** Path of the ledger file. */
    get filePath(): string;
    /**
     * Record a validation run.
     *
     * Never throws: a broken ledger must not break the work it describes.
     */
    record(input: Omit<ValidationRunRecord, "ts"> & {
        ts?: string;
    }): ValidationRunRecord | null;
    /**
     * Read every recorded run.
     */
    read(): ValidationRunRecord[];
    /**
     * Every run recorded for one todo item.
     */
    runsFor(itemId: number): ValidationRunRecord[];
    /**
     * The latest run of one tier for one todo item.
     */
    latestFor(itemId: number, tier: ValidationTierKind): ValidationRunRecord | undefined;
    /**
     * The aggregated validation state of a todo item.
     */
    stateFor(item: TodoItem | null | undefined): ValidationState;
    /**
     * True when the item must not be completed yet because its final tier is
     * still pending.
     */
    isFinalTierPending(item: TodoItem | null | undefined): boolean;
    private append;
    private rotateIfNeeded;
}
//# sourceMappingURL=validation-ledger.d.ts.map