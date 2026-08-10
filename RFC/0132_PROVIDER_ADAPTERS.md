# RFC-0132 — Provider Adapters

## Purpose

Multi-provider LLM adapter system.

## Motivation

Support multiple LLM providers:

- OpenAI
- Anthropic
- MiniMax
- Custom providers

## Architecture

```text
Provider Adapter SDK
    |
    +-> OpenAI Adapter
    +-> Anthropic Adapter
    +-> MiniMax Adapter
    +-> Custom Adapters
```

## Files

See `IMPLEMENTATION/RFC-0132/FILES.md`.

## Acceptance Criteria

- [ ] Provider abstraction layer
- [ ] Request/response normalization
- [ ] Error handling per provider
- [ ] Rate limiting
