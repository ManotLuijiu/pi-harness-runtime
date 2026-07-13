# Public Skill Export and Sync Design for `pi-harness-runtime`

## Purpose

This document turns the high-level Herdr adaptation plan into a concrete design for:

1. exporting selected MooCoding skills into `pi-harness-runtime`
2. sanitizing them before publication
3. adding a **sync** function because the live skill source is continuously updated

This design assumes the live private skill corpus remains here:

- `/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills/*`

That location remains the editable operational knowledge base.

---

## Design Principles

### 1. Private source stays private

The bench-side MooCoding skills directory is the authoring source of truth.

It is never treated as:

- a publishable package directory
- a public docs source
- a direct npm skill distribution source

### 2. Sync is not publish

Because the source corpus changes often, we need sync.

But **sync must only move content into a private staging area**, never into public package assets automatically.

### 3. Export is gated

Nothing enters `pi-harness-runtime/skills/*` until it passes:

- sanitization checks
- explicit approval
- manifest tracking

### 4. Public package content must be reproducible

Every public skill should have traceable provenance:

- source skill path
- source fingerprint/hash
- sanitized export timestamp
- approval record

---

## Proposed Directory Layout

## A. Private live source

Outside repo package boundary:

```text
/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills/
  <skill-name>/
    SKILL.md
```

## B. Private repo-local staging area

Inside `pi-harness-runtime`, but excluded from publishable package contents:

```text
harness/skills-staging/
  source-mirror/
    <skill-name>/
      SKILL.md
  sanitized-candidates/
    <skill-name>/
      SKILL.md
  reports/
    sync-report.json
    sanitize-report.json
    approval-report.json
  manifests/
    source-index.json
    approval-index.json
```

Notes:

- `source-mirror/` is a synced private mirror of selected private skills
- `sanitized-candidates/` contains transformed or reviewed versions
- nothing under `harness/skills-staging/` should be treated as publishable skill content by package manifests

## C. Public distributable area

Already exposed by package manifest:

```text
skills/
  <public-skill-name>/
    SKILL.md
```

Only approved sanitized skills may appear here.

---

## Lifecycle Model

Each skill moves through explicit states.

```text
private-source
  -> synced-private-mirror
  -> sanitize-check
  -> sanitized-candidate
  -> approved
  -> exported-public
```

### State meanings

- `private-source`: original bench-side skill
- `synced-private-mirror`: latest mirrored copy inside repo staging
- `sanitize-check`: automated/manual review in progress
- `sanitized-candidate`: safe draft pending approval
- `approved`: explicitly allowed for public export
- `exported-public`: copied into `skills/*`

---

## The Required Sync Function

Because the private source keeps changing, add a **one-way sync** command.

## Sync command responsibility

The sync function should:

1. read selected skills from the private source tree
2. copy them into `harness/skills-staging/source-mirror/`
3. compute fingerprints/hashes
4. record changes since last sync
5. never touch `skills/*`
6. never imply approval

## Command shape

Suggested command surface:

```bash
bun scripts/skills-sync.ts --skill bench-commands
bun scripts/skills-sync.ts --all-from-manifest
bun scripts/skills-sync.ts --changed-only
bun scripts/skills-sync.ts --check-only
```

## Sync modes

### Mode 1 — targeted sync

For one skill:

```bash
bun scripts/skills-sync.ts --skill form-state-persistence-fix
```

Use when preparing a specific skill for review.

### Mode 2 — manifest-driven sync

```bash
bun scripts/skills-sync.ts --all-from-manifest
```

Reads a maintained allowlist of candidate private skills and refreshes their staging mirrors.

### Mode 3 — changed-only sync

```bash
bun scripts/skills-sync.ts --changed-only
```

Only updates staged mirror copies when the source fingerprint differs.

### Mode 4 — check-only sync

```bash
bun scripts/skills-sync.ts --check-only
```

Reports drift without copying files.

---

## Sync Manifest Design

Introduce a manifest that defines which private skills are even eligible for staging sync.

Example:

```json
{
  "sourceRoot": "/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills",
  "skills": [
    {
      "sourceName": "bench-commands",
      "targetName": "bench-commands",
      "sync": true,
      "publicCandidate": false
    },
    {
      "sourceName": "form-state-persistence-fix",
      "targetName": "form-state-persistence-fix",
      "sync": true,
      "publicCandidate": true
    }
  ]
}
```

Suggested file:

```text
harness/skills-staging/manifests/source-index.json
```

## Why this matters

- prevents accidental sync of the entire private corpus
- makes sync selection explicit
- creates a reviewable inventory

---

## Sanitization Design

## Sanitization command responsibility

The sanitization step should take a mirrored private skill and produce a candidate public version.

Suggested command:

```bash
bun scripts/skills-sanitize.ts --skill form-state-persistence-fix
bun scripts/skills-sanitize.ts --all-approved-candidates
bun scripts/skills-sanitize.ts --check-only
```

## Sanitization checks

Automated checks should flag:

- client names
- internal company names when not intended for disclosure
- private domains and internal URLs
- IP addresses
- credentials, tokens, cookies, bearer strings
- SSH host aliases
- private repo URLs
- machine-specific absolute paths when not acceptable for public docs
- support references that reveal private operations

## Sanitization outputs

For each skill, produce:

- candidate sanitized `SKILL.md`
- machine-readable report
- human-readable warnings

Suggested report path:

```text
harness/skills-staging/reports/sanitize-report.json
```

## Sanitization result classes

- `pass`: no blocking issues found
- `warn`: manual review required
- `fail`: cannot proceed without edits

---

## Approval Design

A sanitized candidate still should not publish automatically.

Add an approval manifest, for example:

```json
{
  "skills": [
    {
      "targetName": "form-state-persistence-fix",
      "approved": true,
      "approvedBy": "manual",
      "sourceHash": "abc123",
      "sanitizedHash": "def456",
      "approvedAt": "2026-07-12T00:00:00Z"
    }
  ]
}
```

Suggested file:

```text
harness/skills-staging/manifests/approval-index.json
```

Approval rules:

- only `approved: true` entries may export to `skills/*`
- approval must bind to a specific sanitized hash
- if the private source changes later, the sync hash changes and approval becomes stale

---

## Export Design

## Export command responsibility

The export command copies only approved sanitized candidates into the public package skill directory.

Suggested command:

```bash
bun scripts/skills-export.ts --skill form-state-persistence-fix
bun scripts/skills-export.ts --all-approved
bun scripts/skills-export.ts --check-only
```

## Export rules

- source must exist in `sanitized-candidates/`
- approval record must exist and match current sanitized hash
- export target must be inside `skills/<targetName>/SKILL.md`
- export must not read directly from the private source tree

## Export outputs

- created or updated `skills/<targetName>/SKILL.md`
- export report with source and hash provenance

---

## Recommended Command Pipeline

For a single skill:

```bash
# 1. refresh private staging copy from live source
bun scripts/skills-sync.ts --skill form-state-persistence-fix

# 2. sanitize into candidate public version
bun scripts/skills-sanitize.ts --skill form-state-persistence-fix

# 3. review and mark approved in approval manifest
# (manual step or dedicated approval command)

# 4. export only approved sanitized candidate
bun scripts/skills-export.ts --skill form-state-persistence-fix
```

---

## Drift and Re-Sync Behavior

Because the source skills keep changing, we need clear drift handling.

## Drift rule

If private source hash changes after approval:

- existing public export remains as-is
- approval becomes stale for the next export cycle
- sync report must show the skill as changed
- sanitization and approval must run again before re-export

## Why this is important

This avoids two bad outcomes:

1. silently publishing new private content
2. breaking provenance between approved content and exported content

---

## Suggested Provenance Fields

Each staged and exported skill record should track:

- `sourceName`
- `sourcePath`
- `targetName`
- `sourceHash`
- `mirrorHash`
- `sanitizedHash`
- `lastSyncedAt`
- `lastSanitizedAt`
- `lastApprovedAt`
- `lastExportedAt`
- `status`

This can live in JSON manifests or per-skill metadata files.

---

## Interaction with `packages/skill-registry`

This design keeps publication and runtime discovery separate.

### Short term

No registry changes are required to begin:

- `skills/*` remains the public packaged skill surface
- staging stays private under `harness/skills-staging/*`

### Later optional enhancement

`packages/skill-registry` may support reading:

- bundled public skills from `skills/*`
- local private staged or source skills from configured paths

But that future loader must preserve source classification:

- `public-bundled`
- `private-staged`
- `private-external`

And must never auto-publish private sources.

---

## Minimal First Implementation

To keep scope controlled, implement in this order:

### Step 1

Add manifests and directory structure:

- `harness/skills-staging/manifests/source-index.json`
- `harness/skills-staging/manifests/approval-index.json`

### Step 2

Implement `skills-sync.ts`

- explicit allowlist only
- no package exports touched

### Step 3

Implement `skills-sanitize.ts`

- reports + candidate output
- fail/warn/pass results

### Step 4

Implement `skills-export.ts`

- approved candidates only
- writes to `skills/*`

### Step 5

Document operator workflow

- sync
- sanitize
- approve
- export

---

## Non-Goals

This design does **not** recommend:

- syncing the whole private corpus into public package directories
- publishing directly from `/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills/*`
- replacing the live MooCoding source with `pi-harness-runtime/skills/*`
- auto-approving sanitized output without human review

---

## Recommendation

Add the **sync** function, but make it explicitly:

- one-way
- allowlist-driven
- private-staging-only
- provenance-aware
- separate from export

That gives you freshness from the always-changing MooCoding corpus without sacrificing privacy or accidentally turning the package into a mirror of unsanitized internal knowledge.
