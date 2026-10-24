# @pi-harness/logging

Centralized structured application logging for pi-harness.

```text
client: producer -> classify -> redact -> sample -> buffer -> webhook -> local spool
server: POST /api/logs -> authenticate -> validate -> durable outbox -> 202
                                                        |
                                                        v
                                              worker -> R2 -> done
```

- **Classification**: an event allowlist decides what may leave the machine. Prompts,
  responses, command output and the catch-all `harness.log` mirror stay local.
- **Redaction**: credential-looking keys, bearer tokens, JWTs and long token runs are
  replaced; strings are truncated and structures are depth limited.
- **Sampling**: minimum level, a deterministic sample rate for `debug` records and a
  per source+event rate limit. Errors are never sampled away.
- **Buffering**: bounded in-memory buffer; when it is full the least severe record is
  dropped and the drop is counted.
- **Delivery**: transports are a FALLBACK chain by default (the first success wins,
  the rest are skipped - never a broadcast). `PI_LOG_DELIVERY=fanout` switches to
  BROADCAST: every transport receives every batch, each transport tracks its own
  success (`getTransportStatus()`), and the batch is spooled only when *every*
  transport failed. If all of them fail the batch is spooled to disk as NDJSON and
  retried on the next flush.
- **Durability**: the server only answers `202` after the batch is written to its
  durable outbox. A background worker uploads it to R2 with a bounded backoff.

## Usage

```ts
import { centralInfo, centralWarn, initCentralLogging } from "./packages/logging/dist/index.js";

initCentralLogging();                       // reads the environment and the key files
centralInfo("harness.service-diagnostics", "service.check", "service is up", { durationMs: 3 });
```

The event name decides whether the record may be shipped: use an allowlisted shape
(`service.*`, `session.*`, `validation.*`, `harness.service-diagnostics.*`,
`harness.planner.decision`, `harness.glm-quota.quota`) or a `warn`/`error` level.

## Transports

| Transport | Purpose |
|-----------|---------|
| `createWebhookTransport` | HTTP POST to the unified webhook server (`/api/logs`) - the client ingress point |
| `createR2Transport` | Cloudflare R2 (S3 API), gzipped NDJSON under a date prefix - normally used by the server, not by clients |
| `LogSpool` | Local NDJSON fallback, rotated by size, with retention |

## Server side

```ts
import {
  LogCredentialStore,
  LogIndexStore,
  LogIngestService,
  LogOutbox,
  LogOutboxWorker,
  createLogHttpHandler,
} from "./packages/logging/dist/index.js";

const credentials = LogCredentialStore.load();
const outbox = new LogOutbox({ dir: `${home}/.pi-harness-runtime/logs/outbox` });
const index = new LogIndexStore({ dir: `${home}/.pi-harness-runtime/logs/index` });
const service = new LogIngestService({ credentials, outbox, index });
const handler = createLogHttpHandler({ service, outbox, index });
```

The credential store decides whether the endpoint exists: without a credential every
write is refused (`503`). The tenant comes from the credential, never from the body.

### Incidents

A log record is a moment, an incident is a recurring problem. The server derives the
incidents from the records it accepts:

- **Versioned**: every incident carries `schemaVersion: 1`; the Qdrant collection is
  `log_incidents_v1`, so a schema change means a new collection.
- **Stable fingerprint**: the same failure produces the same fingerprint even when the
  message carries a changing timestamp, id, path or number.
- **Server derived tenant**: the `tenant_id` comes from the ingest credential, never
  from the request body, and it is the filter of every query.
- **Durable**: the source of truth is plain NDJSON
  (`~/.pi-harness-runtime/logs/incidents/<tenant>/incidents-<day>.ndjson`); Qdrant
  holds the searchable view.

```ts
import { IncidentStore, IncidentQdrantWriter } from "./packages/logging/dist/index.js";

const incidents = new IncidentStore({ dir: `${home}/.pi-harness-runtime/logs/incidents` });
const service = new LogIngestService({ credentials, outbox, index, incidents });
// POST /api/logs/incidents - tenant scoped, bounded
```

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/logs` | POST | Accept a batch. `202` only after the durable write. |
| `/api/logs/query` | POST | Read-only, tenant scoped metadata query. |
| `/api/logs/incidents` | POST | Read-only, tenant scoped incident query. |
| `/api/logs/health` | GET | Queue depth, oldest pending age, failure count. |

## Configuration

See the "Centralized Application Logging" section in the repository `AGENTS.md`.
