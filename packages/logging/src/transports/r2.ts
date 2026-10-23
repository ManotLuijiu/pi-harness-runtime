/**
 * Cloudflare R2 transport.
 *
 * Batches are uploaded as NDJSON objects under a date-partitioned prefix so
 * a bucket can be queried by day without listing every object:
 *
 *   logs/harness/2026/10/24/09/20261024T091500-abc123.ndjson.gz
 *
 * The AWS SDK is imported lazily so the package stays usable (and testable)
 * without the SDK installed, and so a missing dependency surfaces as a
 * transport error instead of a crash at startup.
 */

import { gzipSync } from "node:zlib";
import type { LogBatch, LogTransport } from "../types.js";

export interface R2TransportOptions {
	/** R2 bucket name. */
	bucket: string;
	/** R2 endpoint, e.g. https://<account>.r2.cloudflarestorage.com */
	endpoint: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** Key prefix inside the bucket. Default "logs/harness". */
	prefix?: string;
	/** Region label; R2 uses "auto". Default "auto". */
	region?: string;
	/** gzip the payload. Default true. */
	gzip?: boolean;
}

/** Build the date-partitioned object key for a batch. */
export function r2ObjectKey(prefix: string, batch: LogBatch): string {
	const sentAt = new Date(batch.sentAt);
	const year = sentAt.getUTCFullYear();
	const month = String(sentAt.getUTCMonth() + 1).padStart(2, "0");
	const day = String(sentAt.getUTCDate()).padStart(2, "0");
	const hour = String(sentAt.getUTCHours()).padStart(2, "0");
	return `${prefix}/${year}/${month}/${day}/${hour}/${batch.batchId}.ndjson`;
}

export function createR2Transport(options: R2TransportOptions): LogTransport {
	const prefix = options.prefix ?? "logs/harness";
	const region = options.region ?? "auto";
	const gzip = options.gzip ?? true;

	return {
		name: "r2",
		async send(batch: LogBatch): Promise<void> {
			if (batch.records.length === 0) return;

			let s3: typeof import("@aws-sdk/client-s3");
			try {
				s3 = await import("@aws-sdk/client-s3");
			} catch (error) {
				throw new Error(
					`R2 transport requires @aws-sdk/client-s3: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			const client = new s3.S3Client({
				region,
				endpoint: options.endpoint,
				credentials: {
					accessKeyId: options.accessKeyId,
					secretAccessKey: options.secretAccessKey,
				},
			});

			const payload = batch.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
			const body = gzip ? gzipSync(payload) : payload;
			const key = `${r2ObjectKey(prefix, batch)}${gzip ? ".gz" : ""}`;

			await client.send(
				new s3.PutObjectCommand({
					Bucket: options.bucket,
					Key: key,
					Body: body,
					ContentType: gzip ? "application/gzip" : "application/x-ndjson",
				}),
			);

			client.destroy();
		},
	};
}
