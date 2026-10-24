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
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readBearerToken } from "./credentials.js";
function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}
async function readBody(req, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes)
            return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
/**
 * Write a human readable copy of the accepted records next to the other
 * server logs. Best effort: a failing copy never affects the request.
 */
function writeLocalCopy(dir, payload) {
    if (!dir)
        return;
    const records = payload.records;
    if (!Array.isArray(records) || records.length === 0)
        return;
    try {
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        const day = new Date().toISOString().slice(0, 10);
        const file = join(dir, `logs-${day}.ndjson`);
        appendFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    }
    catch {
        // The copy is a convenience, not a requirement.
    }
}
/**
 * Build the HTTP handler for the log routes.
 */
export function createLogHttpHandler(options) {
    const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
    const maxQueryBytes = options.maxQueryBytes ?? 64 * 1024;
    return async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const token = readBearerToken(req.headers.authorization);
        if (url.pathname === "/api/logs" && req.method === "POST") {
            // Fail closed: without a credential the endpoint does not exist.
            if (!options.service.configured) {
                sendJson(res, 503, { error: "log ingest is not configured", code: "ingest_unconfigured" });
                return;
            }
            if (!options.service.authenticate(token)) {
                sendJson(res, 401, { error: "unauthorized", code: "unauthorized" });
                return;
            }
            const raw = await readBody(req, maxBodyBytes);
            if (!raw) {
                sendJson(res, 413, { error: "payload too large", code: "payload_too_large" });
                return;
            }
            let payload;
            try {
                payload = JSON.parse(raw.toString());
            }
            catch {
                sendJson(res, 400, { error: "invalid json", code: "invalid_json" });
                return;
            }
            const result = options.service.ingest(payload, token);
            sendJson(res, result.status, result.body);
            if (result.status === 202)
                writeLocalCopy(options.localCopyDir, payload);
            return;
        }
        if (url.pathname === "/api/logs/query" && req.method === "POST") {
            if (!options.service.configured) {
                sendJson(res, 503, { error: "log ingest is not configured", code: "ingest_unconfigured" });
                return;
            }
            const raw = await readBody(req, maxQueryBytes);
            if (!raw) {
                sendJson(res, 413, { error: "payload too large", code: "payload_too_large" });
                return;
            }
            let params = {};
            if (raw.length > 0) {
                try {
                    params = JSON.parse(raw.toString());
                }
                catch {
                    sendJson(res, 400, { error: "invalid json", code: "invalid_json" });
                    return;
                }
            }
            const result = options.service.query({
                installationId: params.installationId,
                sessionId: params.sessionId,
                since: params.since,
                until: params.until,
                levels: params.levels,
                source: params.source,
                event: params.event,
                limit: params.limit,
                cursor: params.cursor,
            }, token);
            sendJson(res, result.status, result.body);
            return;
        }
        if (url.pathname === "/api/logs/incidents" && req.method === "POST") {
            if (!options.service.configured) {
                sendJson(res, 503, { error: "log ingest is not configured", code: "ingest_unconfigured" });
                return;
            }
            const raw = await readBody(req, maxQueryBytes);
            if (!raw) {
                sendJson(res, 413, { error: "payload too large", code: "payload_too_large" });
                return;
            }
            let params = {};
            if (raw.length > 0) {
                try {
                    params = JSON.parse(raw.toString());
                }
                catch {
                    sendJson(res, 400, { error: "invalid json", code: "invalid_json" });
                    return;
                }
            }
            const result = options.service.queryIncidents({
                severity: params.severity,
                source: params.source,
                event: params.event,
                since: params.since,
                until: params.until,
                limit: params.limit,
            }, token);
            sendJson(res, result.status, result.body);
            return;
        }
        if (url.pathname === "/api/logs/health" && req.method === "GET") {
            if (!options.service.configured) {
                sendJson(res, 503, { configured: false });
                return;
            }
            if (!options.service.authenticate(token)) {
                sendJson(res, 401, { error: "unauthorized", code: "unauthorized" });
                return;
            }
            sendJson(res, 200, { configured: true, outbox: options.outbox.stats() });
            return;
        }
        sendJson(res, 404, { error: "not found" });
    };
}
//# sourceMappingURL=http.js.map