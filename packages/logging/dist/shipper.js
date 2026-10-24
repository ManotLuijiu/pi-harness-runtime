/**
 * The shipper owns the delivery decision.
 *
 * Producers call `log()`. The shipper redacts, samples, buffers, and then
 * delivers a batch through the configured transports.
 *
 * Two delivery modes exist:
 *
 *   fallback (the default) - the transports form a chain. The first
 *     transport that accepts the batch wins and the later ones are not
 *     called:
 *
 *       R2 (durable archive) -> webhook (live) -> local spool
 *
 *   fanout (explicit opt-in) - the transports are independent. Every
 *     transport receives the batch, each one tracks its own success, and
 *     the batch is spooled only when EVERY transport failed:
 *
 *       R2 (durable archive) + webhook (live) -> local spool
 *
 * Fallback is the default because it avoids duplicate records in the
 * archive. Fanout is opt-in because it deliberately creates a second copy
 * of every batch.
 *
 * If every transport fails the batch is spooled to disk and retried on the
 * next flush, so a temporary outage costs latency, not data.
 */
import { hostname } from "node:os";
import { LogBuffer } from "./buffer.js";
import { DEFAULT_CLASSIFICATION_POLICY, prepareRemoteRecord, } from "./classification.js";
import { redactFields, redactText } from "./redact.js";
import { LogSampler } from "./sampler.js";
import { LOG_SCHEMA_VERSION, } from "./types.js";
function defaultBatchId() {
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
    return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
function toErrorInfo(error) {
    if (error instanceof Error) {
        const info = { name: error.name, message: error.message };
        if (error.stack)
            info.stack = error.stack;
        return info;
    }
    return { name: "Error", message: String(error) };
}
export class LogShipper {
    app;
    appVersion;
    installationId;
    hostLabel;
    sessionId;
    transports;
    delivery;
    transportStatus = new Map();
    spool;
    buffer;
    sampler;
    redaction;
    classification;
    flushIntervalMs;
    now;
    createBatchId;
    timer;
    flushing;
    stats = {
        shipped: 0,
        spooled: 0,
        dropped: 0,
        sampled: 0,
        localOnly: 0,
        errors: {},
    };
    constructor(options = {}) {
        this.app = options.app ?? "pi-harness";
        this.appVersion = options.appVersion;
        this.installationId = options.installationId ?? "unknown";
        this.hostLabel = options.hostLabel ?? hostname();
        this.sessionId = options.sessionId;
        this.transports = options.transports ?? [];
        this.delivery = options.delivery ?? "fallback";
        this.spool = options.spool;
        this.buffer = new LogBuffer(options.buffer);
        this.sampler = new LogSampler(options.sampling);
        this.redaction = options.redaction ?? {};
        this.classification = options.classification ?? DEFAULT_CLASSIFICATION_POLICY;
        this.flushIntervalMs = options.flushIntervalMs ?? 15_000;
        this.now = options.now ?? (() => Date.now());
        this.createBatchId = options.createBatchId ?? defaultBatchId;
    }
    /** Record a log event. Never throws. */
    log(input) {
        try {
            const record = this.buildRecord(input);
            if (!this.sampler.shouldLog(record, this.now())) {
                this.stats.sampled++;
                return;
            }
            // What must stay on the machine never enters the shipping path.
            const remote = prepareRemoteRecord(record, this.classification);
            if (!remote) {
                this.stats.localOnly++;
                return;
            }
            this.buffer.push(remote);
            if (this.buffer.size >= this.buffer.batchSize) {
                void this.flush();
            }
        }
        catch {
            // A logging failure must never break the caller.
        }
    }
    /** Convenience wrappers around `log()`. */
    debug(source, event, message, fields) {
        this.log({ level: "debug", source, event, message, fields });
    }
    info(source, event, message, fields) {
        this.log({ level: "info", source, event, message, fields });
    }
    warn(source, event, message, fields) {
        this.log({ level: "warn", source, event, message, fields });
    }
    error(source, event, message, fields, error) {
        this.log({ level: "error", source, event, message, fields, error });
    }
    /** Deliver buffered records (and drain the spool). Never throws. */
    async flush() {
        if (this.flushing)
            return this.flushing;
        this.flushing = this.doFlush().finally(() => {
            this.flushing = undefined;
        });
        return this.flushing;
    }
    /**
     * Synchronous last resort used on process exit: whatever is still in
     * memory is written to the local spool so it is not lost.
     */
    flushSync() {
        try {
            const records = this.buffer.peekAll();
            if (records.length === 0)
                return;
            this.buffer.clear();
            if (!this.spool)
                return;
            this.spool.append(this.buildBatch(records));
            this.stats.spooled += records.length;
        }
        catch {
            // Nothing else we can do at exit time.
        }
    }
    /** Start the periodic flush timer. */
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            void this.flush();
        }, this.flushIntervalMs);
        // Never keep the process alive just for log delivery.
        this.timer.unref?.();
    }
    /** Stop the timer and flush once more. */
    async stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        await this.flush();
    }
    getStats() {
        return {
            ...this.stats,
            dropped: this.stats.dropped + this.buffer.dropped,
            errors: { ...this.stats.errors },
        };
    }
    /**
     * The delivery state of every transport.
     *
     * In fanout mode this is the only way to see that one transport is
     * broken while the others still deliver.
     */
    getTransportStatus() {
        return [...this.transportStatus.values()].map((status) => ({ ...status }));
    }
    /** The delivery mode of the shipper. */
    get deliveryMode() {
        return this.delivery;
    }
    buildRecord(input) {
        const record = {
            ts: new Date(this.now()).toISOString(),
            level: input.level,
            source: input.source,
            event: input.event,
        };
        if (input.message !== undefined) {
            record.message = redactText(input.message, this.redaction.placeholder);
        }
        if (input.sessionId)
            record.sessionId = input.sessionId;
        if (typeof input.durationMs === "number")
            record.durationMs = input.durationMs;
        const fields = redactFields(input.fields, this.redaction);
        if (fields && Object.keys(fields).length > 0)
            record.fields = fields;
        if (input.error !== undefined) {
            const info = toErrorInfo(input.error);
            record.error = {
                name: info.name,
                message: redactText(info.message, this.redaction.placeholder),
                ...(info.stack ? { stack: redactText(info.stack, this.redaction.placeholder) } : {}),
            };
        }
        return record;
    }
    buildBatch(records) {
        const sessionId = this.sessionId ?? records.find((record) => record.sessionId)?.sessionId;
        const batch = {
            schemaVersion: LOG_SCHEMA_VERSION,
            batchId: this.createBatchId(),
            app: this.app,
            installationId: this.installationId,
            sentAt: new Date(this.now()).toISOString(),
            records,
        };
        if (this.appVersion)
            batch.appVersion = this.appVersion;
        if (this.hostLabel)
            batch.hostLabel = this.hostLabel;
        if (sessionId)
            batch.sessionId = sessionId;
        return batch;
    }
    async doFlush() {
        try {
            await this.drainSpool();
            const records = this.buffer.takeBatch();
            if (records.length === 0)
                return;
            const batch = this.buildBatch(records);
            const delivered = await this.deliver(batch);
            if (delivered) {
                this.stats.shipped += records.length;
                return;
            }
            if (this.spool) {
                this.spool.append(batch);
                this.stats.spooled += records.length;
            }
            else {
                this.stats.dropped += records.length;
            }
        }
        catch {
            // Never let a flush failure escape.
        }
    }
    /**
     * Deliver the batch to the transports.
     *
     * In `fallback` mode the transports form a chain: the first one that
     * accepts the batch wins and the later ones are not called.
     *
     * In `fanout` mode every transport receives the batch independently.
     * Each transport tracks its own success, so a broken transport does not
     * hide the success of the others. The batch is only lost when EVERY
     * transport failed.
     */
    async deliver(batch) {
        if (this.delivery === "fanout")
            return this.deliverToAll(batch);
        for (const transport of this.transports) {
            try {
                await transport.send(batch);
                this.noteSuccess(transport.name);
                return true;
            }
            catch (error) {
                this.noteFailure(transport.name, error);
            }
        }
        return false;
    }
    /** Deliver the batch to every transport. Returns true when one accepted it. */
    async deliverToAll(batch) {
        let accepted = false;
        for (const transport of this.transports) {
            try {
                await transport.send(batch);
                this.noteSuccess(transport.name);
                accepted = true;
            }
            catch (error) {
                this.noteFailure(transport.name, error);
            }
        }
        return accepted;
    }
    /** Record a successful delivery. */
    noteSuccess(name) {
        const status = this.statusFor(name);
        status.delivered++;
        status.lastSuccessAt = new Date(this.now()).toISOString();
        delete status.lastError;
    }
    /** Record a failed delivery. */
    noteFailure(name, error) {
        const message = error instanceof Error ? error.message : String(error);
        this.stats.errors[name] = message;
        const status = this.statusFor(name);
        status.failed++;
        status.lastError = message;
    }
    /** The delivery state of one transport. */
    statusFor(name) {
        let status = this.transportStatus.get(name);
        if (!status) {
            status = { name, delivered: 0, failed: 0 };
            this.transportStatus.set(name, status);
        }
        return status;
    }
    /** Re-send spooled files. Stops at the first failure. */
    async drainSpool() {
        if (!this.spool)
            return;
        const files = this.spool.list();
        for (const file of files) {
            const records = this.spool.read(file);
            if (records.length === 0) {
                this.spool.remove(file);
                continue;
            }
            const batch = this.buildBatch(records);
            const delivered = await this.deliver(batch);
            if (!delivered)
                return;
            this.spool.remove(file);
            this.stats.shipped += records.length;
        }
    }
}
//# sourceMappingURL=shipper.js.map