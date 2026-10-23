/**
 * Webhook transport.
 *
 * Delivers batches over HTTP to the existing unified webhook server
 * (`POST /api/logs`). This is the low-latency path: the server can fan the
 * batch out to alerting, while R2 keeps the durable archive.
 */

import type { LogBatch, LogTransport } from "../types.js";

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

export function createWebhookTransport(options: WebhookTransportOptions): LogTransport {
	const timeoutMs = options.timeoutMs ?? 10_000;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	return {
		name: "webhook",
		async send(batch: LogBatch): Promise<void> {
			if (batch.records.length === 0) return;
			if (typeof fetchImpl !== "function") {
				throw new Error("Webhook transport requires a fetch implementation");
			}

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...options.headers,
			};
			if (options.token) headers.Authorization = `Bearer ${options.token}`;

			const response = await fetchImpl(options.url, {
				method: "POST",
				headers,
				body: JSON.stringify(batch),
				signal: AbortSignal.timeout(timeoutMs),
			});

			if (!response.ok) {
				throw new Error(`Webhook transport failed with HTTP ${response.status}`);
			}
		},
	};
}
