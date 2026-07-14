# AI Brief — Release Manager (RFC-0078)

**Status:** ✅ Done (Day 4, commit `c252195`)

## Implemented

- `packages/release-manager/`
- `parseVersion()`, `formatVersion()` — semver parse/format
- `bumpVersion()` — major/minor/patch bump
- `compareVersions()` — ordering comparison
- `classifyCommit()` — feat/fix/docs/refactor/perf/test/style detection
- `isBreakingChange()`, `extractScope()` — conventional commit helpers
- `buildChanges()`, `createChangelogEntry()`, `formatChangelogMarkdown()` — changelog generation

## Tests

- 32 tests: version parsing, bumping, commit classification, changelog generation
