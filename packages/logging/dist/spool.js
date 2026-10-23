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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, } from "node:fs";
import { join } from "node:path";
const FILE_PREFIX = "logs-spool-";
const FILE_SUFFIX = ".ndjson";
export class LogSpool {
    dir;
    maxFileBytes;
    maxFiles;
    constructor(options) {
        this.dir = options.dir;
        this.maxFileBytes = Math.max(1024, options.maxFileBytes ?? 5 * 1024 * 1024);
        this.maxFiles = Math.max(1, options.maxFiles ?? 20);
    }
    /** Append a batch to the spool. Returns the file that was written. */
    append(batch, now = new Date()) {
        this.ensureDir();
        const file = this.currentFile(now);
        const payload = batch.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
        if (this.shouldRotate(file, payload.length)) {
            this.rotate(file);
        }
        appendFileSync(file, payload, "utf8");
        this.enforceRetention();
        return file;
    }
    /** Spool files, oldest first. */
    list() {
        if (!existsSync(this.dir))
            return [];
        return readdirSync(this.dir)
            .filter((name) => name.startsWith(FILE_PREFIX) &&
            (name.endsWith(FILE_SUFFIX) || new RegExp(`\\${FILE_SUFFIX}\\.\\d+$`).test(name)))
            .map((name) => join(this.dir, name))
            .sort();
    }
    /** Read the records of a spool file. */
    read(file) {
        if (!existsSync(file))
            return [];
        const content = readFileSync(file, "utf8");
        const records = [];
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                records.push(JSON.parse(trimmed));
            }
            catch {
                // A truncated last line is expected after a crash; skip it.
            }
        }
        return records;
    }
    /** Delete a spool file after it was shipped. */
    remove(file) {
        try {
            rmSync(file, { force: true });
        }
        catch {
            // Nothing to do - the file stays and is retried later.
        }
    }
    ensureDir() {
        if (!existsSync(this.dir)) {
            mkdirSync(this.dir, { recursive: true });
        }
    }
    currentFile(now) {
        const day = now.toISOString().slice(0, 10);
        return join(this.dir, `${FILE_PREFIX}${day}${FILE_SUFFIX}`);
    }
    shouldRotate(file, incomingBytes) {
        if (!existsSync(file))
            return false;
        try {
            return statSync(file).size + incomingBytes > this.maxFileBytes;
        }
        catch {
            return false;
        }
    }
    rotate(file) {
        for (let index = 1; index <= this.maxFiles; index++) {
            const candidate = `${file}.${index}`;
            if (!existsSync(candidate)) {
                renameSync(file, candidate);
                return;
            }
        }
    }
    enforceRetention() {
        const files = this.list();
        const extra = files.length - this.maxFiles;
        for (let i = 0; i < extra; i++) {
            this.remove(files[i]);
        }
    }
}
//# sourceMappingURL=spool.js.map