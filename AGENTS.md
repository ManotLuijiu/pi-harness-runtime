# Agent Instructions

## Pre-Commit/Build Checklist

**BEFORE any `git commit`, `git push`, or `bench build`:**

1. Run `bd ready` to check for pending tasks
2. Check if any todo-list items are marked as done → **mark them complete** with `bd close <id>`
3. Ensure all pending tasks are tracked in bd before committing
4. If todos exist, acknowledge them in response before proceeding

```bash
# Check pending todos before commit
bd ready
bd list --status pending
```

**Why**: Agent often builds/commits without checking todos. This causes incomplete tasks to be forgotten.

## Versioning Convention

**Only patch-level updates (`0.10.x`)** — no minor/major bumps until the app is fully functional.

When releasing:

```bash
bun scripts/release-all.ts --release-as patch   # default, use this
bun scripts/release-all.ts --release-as minor   # only if explicitly requested
bun scripts/release-all.ts --release-as major   # only if explicitly requested
```

## Release Tag Convention (CRITICAL)

**ALWAYS release a tag after ANY code change.** Use patch version bump (0.10.x → 0.10.x+1).

This repo uses tag-based GitHub Actions builds — no CI on push. Every code change should be tagged for release.

```bash
# After git push, immediately tag and push:
git tag v0.10.32 && git push origin v0.10.32

# Or use the release script:
bun scripts/release-all.ts --release-as patch
```

**Rule**: Every `git push` should be followed by a tag push. No code change should go unreleased.

## npm Publish Authentication

- **GitHub Actions OIDC release path should not require `npm login`.**
- If a **local/manual npm publish fallback** is needed and `npm whoami` fails, ask the user to run:

  ```bash
  npm login
  ```

  before retrying the publish.
- Do not assume a previous local npm login is still valid.

## Context-Mode Tool Priority

Use tools in this order (highest to lowest priority):

1. **`ctx_batch_execute`** — Multiple commands with queries in one call
2. **`ctx_execute`** — Single command or data derivation
3. **`ctx_execute_file`** — Read/analyze file before editing
4. **`ctx_search`** — Query indexed knowledge base

**File operations**: Always use `ctx_execute_file` to read/analyze files before editing.

## File Copy Rule (Mimic/Clone Between Folders)

**When asked to mimic, clone, or copy code/files from one folder to another:**

1. **USE `cp` or `sudo cp`** instead of writing files from scratch
2. **Do NOT write files from scratch** — copying is faster, more accurate, and preserves exact code
3. **Use `sudo cp` when permissions require it** (different owners, protected directories)

```bash
# ✅ CORRECT - direct copy
cp /path/to/source/file.ts /path/to/dest/file.ts

# ✅ CORRECT - sudo for permission issues
sudo cp /path/to/source/file.ts /path/to/dest/file.ts

# ❌ WRONG - writing from scratch (loses fidelity, wastes time)
write /path/to/dest/file.ts
<content>
```

**Why**: Copying preserves exact code including comments, formatting, and subtle details. Writing from scratch introduces drift and incompleteness.

## NPM Package Build Issues (Important!)

### Bug: Missing `dist/` Directories in Packages

**Problem**: When `packages/*/dist/` is gitignored and a package has `.js` imports but no compiled output, the published npm package will crash pi on load with:

```
Cannot find module '../packages/notification/dist/notification-center.js'
```

**Root Cause**:

- The main build script (`bun run build`) only compiles packages with `tsconfig.json`
- If TypeScript is missing from `devDependencies`, `node_modules/.bin/tsc` doesn't exist
- The build loop silently ignores errors: `|| true`
- Packages get published WITHOUT their `dist/` directories
- Runtime imports from `dist/*.js` fail

**Solution**:

1. Ensure `typescript` is in `devDependencies` (so `tsc` is available)
2. Run `bun run build` locally BEFORE pushing
3. Verify `packages/*/dist/` contains compiled `.js` files
4. Commit the `dist/` output or ensure build succeeds in CI

```bash
# Check if dist exists before publishing
ls packages/notification/dist/

# If missing, build and check again
bun run build
ls packages/notification/dist/
```

**Prevention**: Add `typescript` to `devDependencies`:

```bash
bun add -d typescript
```
