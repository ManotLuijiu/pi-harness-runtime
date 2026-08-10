# RFC-0111 — File Copy Helper

## Purpose

Injects "use cp instead of writing from scratch" reminder when copying files.

## Motivation

Agents often rewrite files from scratch instead of using `sudo cp`. This:

- Wastes tokens
- Introduces subtle differences
- Misses file permissions/metadata

## Keywords

```typescript
const COPY_KEYWORDS = [
  "mimic", "copy from", "copy to",
  "clone from", "clone to", "replicate",
  "port from", "migrate from",
  "bring from", "move from",
];
```

## Import Error Handling

When copied files have import errors (missing `@repo/` packages):

```text
Agent: "Fixing import @repo/auth/server..."
  STOP! Don't fix one-by-one
  Copy those files too via sudo cp
```

```typescript
const IMPORT_ERROR_TRIGGERS = [
  "cannot find module", "@repo/",
  "import error", "fix errors one by one",
  "roll back",
];
```

## Rule Injection

```text
STOP READING - JUST COPY
=============================
When user asks to mimic/copy/clone files:
1. sudo cp SOURCE DEST
2. NO reading SOURCE files
3. If import errors -> copy those files too
=============================
```

## Files

See `IMPLEMENTATION/RFC-0111/FILES.md`.

## Acceptance Criteria

- [ ] Injects copy rule on keywords
- [ ] Stops agent from reading source files
- [ ] Handles import errors by copying missing files
- [ ] No roll-back behavior
