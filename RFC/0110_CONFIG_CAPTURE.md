# RFC-0110 — Config Capture

## Purpose

Detect API responses containing constant configuration values
(DNS records, routes, feature flags) and prompt to document them.

## Motivation

Agents frequently discover config values (DNS, routes, flags)
during work that get lost. This extension logs suggestions.

## Architecture

```text
API Response -> Config Detection -> Suggestion Logger
```

## Config Types

```typescript
type ConfigType =
  | "dns_records"
  | "routes"
  | "feature_flags"
  | "environment_config"
  | "integration_ids"
  | "webhook_urls";
```

## Extension Pattern

Like `todo-bd-sync`, this listens to tool execution events:

```typescript
import { registerConfigCapture } from "@moocoding/config-capture";
registerConfigCapture(pi);
```

## Files

See `IMPLEMENTATION/RFC-0110/FILES.md`.

## Acceptance Criteria

- [ ] Detects DNS records in API responses
- [ ] Detects routes/endpoints in config outputs
- [ ] Logs suggestions without being noisy
- [ ] Integrates with pi-coding-agent extension API
