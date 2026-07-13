# Minimax Prompt — Implement Skills Sync First Slice

Use this prompt with Minimax to implement the first safe slice of the MooCoding skill export pipeline.

---

You are coding inside this repo:

- `/home/frappe/pi-harness-runtime`

Read these planning notes first:

1. `harness/skills-plan/2026-07-12-herdr-moo-skills-adaptation-plan.md`
2. `harness/skills-plan/2026-07-12-public-skill-export-and-sync-design.md`

Also inspect this existing script for repo conventions:

- `scripts/convert-skills-to-okf.ts`

## Goal

Implement only the **first safe slice** of the design:

1. add private staging manifest files
2. add a one-way `skills-sync.ts` command
3. make sure sync updates only private staging and never public package skills

Do **not** implement sanitize or export in this task.

---

## Critical constraints

The live private source of truth is:

- `/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills/*`

This source changes often and may contain private or unsanitized content.

Therefore:

- sync is allowed
- publish is not allowed
- sync must go only into private staging
- sync must never write to `skills/*`
- sync must never mirror the whole private corpus by default
- sync must be allowlist/manifest driven

Treat this as a privacy-sensitive workflow.

---

## Scope to implement

### 1. Create staging manifest files

Create these files:

- `harness/skills-staging/manifests/source-index.json`
- `harness/skills-staging/manifests/approval-index.json`

Use safe initial content.

Suggested initial shape:

`source-index.json`

```json
{
  "version": 1,
  "sourceRoot": "/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills",
  "skills": []
}
```

`approval-index.json`

```json
{
  "version": 1,
  "skills": []
}
```

The `skills` entries in `source-index.json` should support at least:

```json
{
  "sourceName": "form-state-persistence-fix",
  "targetName": "form-state-persistence-fix",
  "sync": true,
  "publicCandidate": true
}
```

You may define TypeScript interfaces in the sync script or a small helper module if needed.

### 2. Create private staging ignore rules

Add a repo-local ignore strategy so private mirrored content is not accidentally treated as public package content.

Preferred approach:

- create `harness/skills-staging/.gitignore`
- ignore these directories:
  - `source-mirror/`
  - `sanitized-candidates/`
  - `reports/`
- do **not** ignore `manifests/`

If you think an additional package-level safeguard is needed, explain it in your final summary, but keep the implementation minimal.

### 3. Implement `scripts/skills-sync.ts`

Create a Bun TypeScript script using repo style similar to `scripts/convert-skills-to-okf.ts`.

Use:

- shebang: `#!/usr/bin/env bun`
- ESM imports
- `fs/promises`
- `existsSync` if useful
- no extra dependencies

### 4. Add package script aliases

Add at least these package.json scripts:

```json
{
  "skills:sync": "bun scripts/skills-sync.ts",
  "skills:sync:check": "bun scripts/skills-sync.ts --check-only"
}
```

Do not remove or alter existing scripts unrelated to this task.

---

## CLI requirements for `skills-sync.ts`

Support these flags:

### Selection

- `--skill <name>`
- `--all-from-manifest`

Exactly one selection mode must be used.

### Modifiers

- `--changed-only`
- `--check-only`

Allowed combinations:

- `--skill <name>`
- `--skill <name> --changed-only`
- `--skill <name> --check-only`
- `--all-from-manifest`
- `--all-from-manifest --changed-only`
- `--all-from-manifest --check-only`

If flags are invalid or missing, print usage and exit non-zero.

---

## Sync behavior

### Source manifest loading

Read `harness/skills-staging/manifests/source-index.json`.

Use `sourceRoot` from that file.

Optionally allow env override:

- `MOO_SKILLS_SOURCE_ROOT`

If you add the override, document it in code comments and final summary.

### Skill selection

- `--skill <name>` should only operate on a matching manifest entry
- `--all-from-manifest` should only operate on manifest entries where `sync: true`
- if a requested skill is not in the manifest, fail clearly
- do not discover and sync arbitrary folders outside the manifest

### Per-skill source path

For each selected skill:

- source file:
  - `<sourceRoot>/<sourceName>/SKILL.md`
- staging target file:
  - `harness/skills-staging/source-mirror/<targetName>/SKILL.md`

### Hashing and drift detection

Compute a SHA-256 hash for the source file.

Also determine previous mirror hash if the mirrored target file already exists.

Use this to calculate:

- `changed: true|false`
- `previousHash`
- `sourceHash`

### `--changed-only`

When enabled:

- only copy files whose source hash differs from the current mirror hash
- unchanged skills should still appear in the report as skipped/unchanged

### `--check-only`

When enabled:

- do not write mirrored skill files
- do not update reports except possibly a dry-run style summary file if you think that is useful
- printing a summary is enough

### Normal sync mode

When not in `--check-only` mode:

- create parent directories as needed
- copy source `SKILL.md` into staging mirror
- never write to `skills/*`
- never modify approval manifest

---

## Reporting requirements

Write a machine-readable report file at:

- `harness/skills-staging/reports/sync-report.json`

Only in non-check mode.

Suggested report structure:

```json
{
  "version": 1,
  "executedAt": "2026-07-12T00:00:00.000Z",
  "mode": {
    "selection": "skill",
    "checkOnly": false,
    "changedOnly": true
  },
  "skills": [
    {
      "sourceName": "form-state-persistence-fix",
      "targetName": "form-state-persistence-fix",
      "sourcePath": "...",
      "mirrorPath": "...",
      "sourceHash": "...",
      "previousHash": "...",
      "changed": true,
      "status": "synced"
    }
  ]
}
```

Reasonable status values:

- `synced`
- `unchanged`
- `missing-source`
- `skipped`
- `error`

Also print a concise human-readable CLI summary.

---

## Error handling

Fail clearly and non-zero for:

- missing manifest file
- invalid manifest JSON
- invalid flags
- requested skill not present in manifest
- missing source `SKILL.md`

For `--all-from-manifest`, if one skill fails, continue collecting results for others if reasonable, but exit non-zero if any error occurred.

---

## Out of scope

Do **not** implement in this task:

- `skills-sanitize.ts`
- `skills-export.ts`
- writing anything into `skills/*`
- package manifest changes beyond adding `skills:sync` scripts
- `packages/skill-registry` loader changes
- automatic approval
- automatic public publishing

---

## Expected files changed

You should likely touch only these areas:

- `package.json`
- `scripts/skills-sync.ts`
- `harness/skills-staging/.gitignore`
- `harness/skills-staging/manifests/source-index.json`
- `harness/skills-staging/manifests/approval-index.json`

If you add a small helper file under `scripts/`, keep it minimal and explain why.

---

## Implementation style

- keep the first slice small and reviewable
- prefer explicit code over framework-heavy abstractions
- keep data shapes simple JSON
- do not introduce dependencies
- follow current repo script style
- keep comments only where they clarify safety boundaries or flag behavior

---

## Final response format

When done, respond with:

1. summary of files changed
2. CLI usage examples
3. safety guarantees confirming sync never writes to `skills/*`
4. any open questions or follow-up suggestions

Do not commit or push anything.
