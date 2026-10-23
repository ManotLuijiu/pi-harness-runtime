# @pi-harness/logging

Centralized structured application logging for pi-harness.

```text
producer -> redact -> sample -> buffer -> R2 -> webhook -> local spool
```

- **Redaction**: credential-looking keys, bearer tokens, JWTs and long token runs are
  replaced; strings are truncated and structures are depth limited.
- **Sampling**: minimum level, a deterministic sample rate for `debug` records and a
  per source+event rate limit. Errors are never sampled away.
- **Buffering**: bounded in-memory buffer; when it is full the least severe record is
  dropped and the drop is counted.
- **Delivery**: transports are tried in order (R2, webhook). If all of them fail the
  batch is spooled to disk as NDJSON and retried on the next flush.

## Usage

```ts
import { centralInfo, centralWarn, initCentralLogging } from "./packages/logging/dist/index.js";

initCentralLogging();                       // reads the environment and the key files
centralInfo("harness", "startup", "ready", { pid: process.pid });
```

## Transports

| Transport | Purpose |
|-----------|---------|
| `createR2Transport` | Cloudflare R2 (S3 API), gzipped NDJSON under a date prefix |
| `createWebhookTransport` | HTTP POST to the unified webhook server (`/api/logs`) |
| `LogSpool` | Local NDJSON fallback, rotated by size, with retention |

## Configuration

See the "Centralized Application Logging" section in the repository `AGENTS.md`.
