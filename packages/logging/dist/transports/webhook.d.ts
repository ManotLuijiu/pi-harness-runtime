/**
 * Webhook transport.
 *
 * Delivers batches over HTTP to the existing unified webhook server
 * (`POST /api/logs`). This is the low-latency path: the server can fan the
 * batch out to alerting, while R2 keeps the durable archive.
 */
import type { LogTransport } from "../types.js";
export interface WebhookTransportOptions {
    /** Full URL of the ingest endpoint. */
    url: string;
    /** Optional bearer token. */
    token?: string;
    /** Extra headers. */
    headers?: Record<string, string>;
    /** Request timeout in milliseconds. Default 10000. */
    timeoutMs?: number;
    /** Custom fetch implementation (tests). */
    fetchImpl?: typeof fetch;
}
export declare function createWebhookTransport(options: WebhookTransportOptions): LogTransport;
//# sourceMappingURL=webhook.d.ts.map