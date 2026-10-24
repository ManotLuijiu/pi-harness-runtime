/**
 * HTTP surface of the log service.
 *
 * The handlers live here (not in the server script) so the whole request
 * path - authentication, size limits, validation, durable acceptance - can
 * be tested over a real socket.
 *
 * Routes:
 *   POST /api/logs              accept a batch (202 after the durable write)
 *   POST /api/logs/query        read-only, tenant scoped metadata query
 *   POST /api/logs/incidents    read-only, tenant scoped incident query
 *   GET  /api/logs/health       queue depth, oldest pending age, failure count
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogIndexStore } from "./index-store.js";
import type { LogOutbox } from "./outbox.js";
import type { LogIngestService } from "./service.js";
export interface LogHttpOptions {
    service: LogIngestService;
    outbox: LogOutbox;
    index: LogIndexStore;
    /** Largest accepted ingest body. Default 2 MB. */
    maxBodyBytes?: number;
    /** Largest accepted query body. Default 64 KB. */
    maxQueryBytes?: number;
    /**
     * Directory for a human readable copy of the accepted batches
     * (`logs-<day>.ndjson`). Optional.
     */
    localCopyDir?: string;
}
export type LogHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Build the HTTP handler for the log routes.
 */
export declare function createLogHttpHandler(options: LogHttpOptions): LogHttpHandler;
//# sourceMappingURL=http.d.ts.map