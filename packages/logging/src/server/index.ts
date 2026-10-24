/**
 * Server side of the logging pipeline.
 *
 * The server is the only component that writes to the archive: clients ship
 * batches to the ingest endpoint, the server derives the tenant from the
 * credential, queues the batch durably and a worker uploads it.
 */

export {
	DEFAULT_TENANT_ID,
	LOG_READ_SCOPE,
	LOG_WRITE_SCOPE,
	LogCredentialStore,
	hashToken,
	readBearerToken,
} from "./credentials.js";
export type {
	AuthenticatedCredential,
	LogCredential,
	LogCredentialStoreOptions,
} from "./credentials.js";

export { LogOutbox, outboxKey, safeSegment } from "./outbox.js";
export type {
	EnqueueResult,
	LogOutboxOptions,
	OutboxBatch,
	OutboxEntry,
	OutboxStats,
} from "./outbox.js";

export { LogOutboxWorker } from "./outbox-worker.js";
export type { LogOutboxWorkerOptions, WorkerRunResult } from "./outbox-worker.js";

export { LogIndexStore } from "./index-store.js";
export type {
	LogIndexEntry,
	LogIndexStoreOptions,
	LogQueryParams,
	LogQueryResult,
} from "./index-store.js";

export { serverObjectKey } from "./keys.js";
export type { ObjectKeyInput } from "./keys.js";

export { LogIngestService } from "./service.js";
export type {
	IngestFailure,
	IngestResult,
	IngestSuccess,
	LogIngestServiceOptions,
	QuerySuccess,
} from "./service.js";

export { createLogHttpHandler } from "./http.js";
export type { LogHttpHandler, LogHttpOptions } from "./http.js";
