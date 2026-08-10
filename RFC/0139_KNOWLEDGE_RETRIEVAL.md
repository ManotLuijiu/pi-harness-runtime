# RFC-0139 — Knowledge Retrieval

## Purpose

Retrieve knowledge via MCP from TencentDB.

## Motivation

Unified knowledge access:

- Hybrid search (BM25 + vector)
- Context-aware retrieval
- Citation preservation
- Consumer-server architecture

## Architecture

```text
Consumer Server
    |
    +-> MCP Client -> TencentDB Proxy (8096)
                            |
                            +-> Knowledge Service (8424)
                            +-> Memory Core (8420)
```

## Files

See `IMPLEMENTATION/RFC-0139/FILES.md`.

## Acceptance Criteria

- [ ] Hybrid search via MCP
- [ ] Knowledge API integration
- [ ] Source attribution
- [ ] Proxy fallback
