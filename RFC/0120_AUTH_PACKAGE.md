# RFC-0120 — Auth Package

## Purpose

Authentication and authorization for pi-harness-runtime.

## Motivation

Multi-tenant and multi-user support:

- User authentication
- API key management
- Role-based access control
- Session authorization

## Architecture

```text
Request -> Auth Middleware -> Permission Check -> Handler
                |
                +-> API Key validation
                +-> OAuth token verification
                +-> RBAC evaluation
```

## Files

See `IMPLEMENTATION/RFC-0120/FILES.md`.

## Acceptance Criteria

- [ ] API key authentication
- [ ] Role-based permissions
- [ ] Token refresh
- [ ] Audit logging
