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
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseValidationPlan, summarizeValidationState, } from "./validation-plan.js";
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Default location of the ledger.
 */
export function defaultLedgerPath() {
    return join(homedir(), ".pi-harness-runtime", "logs", "validation-runs.jsonl");
}
function isRunStatus(value) {
    return (value === "passed" ||
        value === "failed" ||
        value === "timeout" ||
        value === "error" ||
        value === "skipped");
}
/**
 * Copy the optional fields of a raw ledger object onto a typed record.
 */
function copyOptionalFields(record, out) {
    if (typeof record.itemId === "number" && Number.isFinite(record.itemId))
        out.itemId = record.itemId;
    if (typeof record.itemSubject === "string")
        out.itemSubject = record.itemSubject;
    if (typeof record.command === "string")
        out.command = record.command;
    if (typeof record.label === "string")
        out.label = record.label;
    if (typeof record.durationMs === "number" && Number.isFinite(record.durationMs)) {
        out.durationMs = record.durationMs;
    }
    if (typeof record.datasetSize === "number" && Number.isFinite(record.datasetSize)) {
        out.datasetSize = record.datasetSize;
    }
    if (typeof record.exitCode === "number" && Number.isFinite(record.exitCode)) {
        out.exitCode = record.exitCode;
    }
    if (typeof record.note === "string")
        out.note = record.note;
}
/**
 * Parse one ledger line. Returns `null` for malformed lines.
 */
export function parseRunRecord(line) {
    const text = line.trim();
    if (!text)
        return null;
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const record = raw;
    const tier = record.tier === "fast" || record.tier === "full" ? record.tier : undefined;
    if (!tier)
        return null;
    if (!isRunStatus(record.status))
        return null;
    const out = {
        ts: typeof record.ts === "string" ? record.ts : new Date(0).toISOString(),
        tier,
        status: record.status,
    };
    copyOptionalFields(record, out);
    return out;
}
/**
 * Parse a whole ledger file. Malformed lines are skipped, not fatal.
 */
export function parseLedgerContent(content) {
    const records = [];
    for (const line of content.split("\n")) {
        const record = parseRunRecord(line);
        if (record)
            records.push(record);
    }
    return records;
}
/**
 * Durable ledger of validation runs.
 */
export class ValidationLedger {
    path;
    maxBytes;
    onRecord;
    constructor(options = {}) {
        this.path = options.path ?? process.env.PI_VALIDATION_LEDGER ?? defaultLedgerPath();
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.onRecord = options.onRecord;
    }
    /** Path of the ledger file. */
    get filePath() {
        return this.path;
    }
    /**
     * Record a validation run.
     *
     * Never throws: a broken ledger must not break the work it describes.
     */
    record(input) {
        const record = {
            ts: input.ts ?? new Date().toISOString(),
            tier: input.tier,
            status: input.status,
        };
        if (input.itemId !== undefined)
            record.itemId = input.itemId;
        if (input.itemSubject !== undefined)
            record.itemSubject = input.itemSubject;
        if (input.command !== undefined)
            record.command = input.command;
        if (input.label !== undefined)
            record.label = input.label;
        if (input.durationMs !== undefined)
            record.durationMs = input.durationMs;
        if (input.datasetSize !== undefined)
            record.datasetSize = input.datasetSize;
        if (input.exitCode !== undefined)
            record.exitCode = input.exitCode;
        if (input.note !== undefined)
            record.note = input.note;
        try {
            this.append(record);
        }
        catch {
            // A ledger write failure is not a reason to fail the run it describes.
        }
        try {
            this.onRecord?.(record);
        }
        catch {
            // The mirror sink must never break the producer either.
        }
        return record;
    }
    /**
     * Read every recorded run.
     */
    read() {
        try {
            if (!existsSync(this.path))
                return [];
            return parseLedgerContent(readFileSync(this.path, "utf-8"));
        }
        catch {
            return [];
        }
    }
    /**
     * Every run recorded for one todo item.
     */
    runsFor(itemId) {
        return this.read().filter((run) => run.itemId === itemId);
    }
    /**
     * The latest run of one tier for one todo item.
     */
    latestFor(itemId, tier) {
        const runs = this.runsFor(itemId).filter((run) => run.tier === tier);
        if (runs.length === 0)
            return undefined;
        // The ledger is append-only: with an equal timestamp the later run wins.
        return runs.reduce((a, b) => (a.ts > b.ts ? a : b));
    }
    /**
     * The aggregated validation state of a todo item.
     */
    stateFor(item) {
        const plan = parseValidationPlan(item);
        const runs = item?.id === undefined ? [] : this.runsFor(item.id);
        return summarizeValidationState(plan, runs);
    }
    /**
     * True when the item must not be completed yet because its final tier is
     * still pending.
     */
    isFinalTierPending(item) {
        return this.stateFor(item).finalTierPending;
    }
    append(record) {
        const dir = dirname(this.path);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        this.rotateIfNeeded();
        appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf-8");
    }
    rotateIfNeeded() {
        if (!existsSync(this.path))
            return;
        let size = 0;
        try {
            size = statSync(this.path).size;
        }
        catch {
            return;
        }
        if (size < this.maxBytes)
            return;
        try {
            renameSync(this.path, `${this.path}.1`);
        }
        catch {
            // Rotation is best effort: an unwritable directory must not lose runs.
        }
    }
}
//# sourceMappingURL=validation-ledger.js.map