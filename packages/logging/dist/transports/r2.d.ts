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
export declare function r2ObjectKey(prefix: string, batch: LogBatch): string;
export declare function createR2Transport(options: R2TransportOptions): LogTransport;
//# sourceMappingURL=r2.d.ts.map