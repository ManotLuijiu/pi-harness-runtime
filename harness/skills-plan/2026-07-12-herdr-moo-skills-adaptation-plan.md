# Herdr-style Skill Adaptation Plan for `pi-harness-runtime`

## Goal

Study Herdr's reusable `SKILL.md` distribution model and adapt the idea to `pi-harness-runtime` **without** treating the live MooCoding skill corpus as publishable package content.

## Source Context

### External reference

- Herdr docs: `https://herdr.dev/docs/agent-skill/`
- Herdr source skill: `https://github.com/ogulcancelik/herdr/blob/master/SKILL.md`

### Local source of truth to protect

- Live skills: `/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills/*`

### Current runtime state

- `pi-harness-runtime` already exposes bundled skills via:
  - `package.json` → `pi.skills = ["./skills"]`
- Current bundled repo skill set is minimal:
  - `skills/harness-runtime/SKILL.md`
- `packages/skill-registry` is currently an in-memory registry, not a filesystem `SKILL.md` loader.

---

## Critical Constraints

### 1. Live MooCoding skills must remain the evolving knowledge base

The directory:

`/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills/*`

is continuously updated and acts as the operational knowledge base.

Implication:

- `pi-harness-runtime` must **not** become the primary authoring location for those skills.
- Any adaptation must preserve the bench-side corpus as the editable source of truth.

### 2. Live MooCoding skills are not yet safe to publish

Those skills may still contain:

- client names
- project-specific identifiers
- internal procedures
- sensitive business context
- unsanitized examples

Implication:

- Do **not** copy the entire MooCoding corpus into the publishable `pi-harness-runtime` package.
- Do **not** expose those files through npm/GitHub package distribution until sanitization is proven.
- Treat publication as a separate release stage with explicit validation gates.

---

## What Herdr Actually Gives Us

Herdr demonstrates a **distribution pattern**, not a safe-content pipeline:

- repository-hosted `SKILL.md`
- installable via `npx skills add <repo> --skill <name> -g`
- raw `SKILL.md` is the manual fallback/source of truth

Useful takeaway:

- `pi-harness-runtime` can adopt Herdr's packaging/install ergonomics for skills
- but must add a stronger separation between **live private skill source** and **sanitized public skill artifacts**

---

## Recommended Architecture

Use a **three-tier model**.

### Tier A — Private live source

Location:

- `/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills/*`

Role:

- authoritative editable knowledge base
- may contain unsanitized internal content
- never published directly

### Tier B — Curated staging area

Proposed role:

- local-only review area for candidate skills
- explicit human or automated sanitization review
- contains only skills being prepared for distribution

Possible future location options:

- `pi-harness-runtime/harness/skills-staging/`
- separate private repo
- generated temporary export directory outside package root

### Tier C — Public distributable skills

Location:

- `pi-harness-runtime/skills/*`

Role:

- sanitized, approved subset only
- package-safe
- installable Herdr-style through repo/package distribution

---

## Recommended Plan

## Phase 1 — Keep publication and live authoring separate

Decision:

- Keep MooCoding skills authored only in the bench-side directory
- Keep `pi-harness-runtime/skills/*` as a **public distribution surface**, not the live working corpus

Actions:

1. Document the split-brain model clearly:
   - private live source
   - public curated export
2. Do not auto-sync all live skills into the package
3. Only allow explicit export of selected skills

Success criteria:

- no accidental publication path from private corpus to npm package
- package repo remains safe by default

## Phase 2 — Define a sanitization gate before export

Create a formal checklist for any skill before publication.

Required checks:

- no client names
- no private URLs/IPs/domains
- no credentials/tokens/cookies
- no environment-specific hostnames
- no private repo names unless intended for public disclosure
- no business-sensitive examples
- no customer-specific workflow assumptions

Recommended validation modes:

1. automated scanner
2. manual human review
3. approved export manifest

Success criteria:

- every published skill has traceable sanitization approval
- the export path is auditable

## Phase 3 — Add an explicit export workflow

Instead of publishing directly from the live skill tree, add a tool/script that:

1. selects one or more source skills from the private corpus
2. copies them into a staging/export area
3. runs sanitization checks
4. writes approved results into `pi-harness-runtime/skills/`

Important rule:

- export should be **pull-based and explicit**, never automatic background mirroring

Suggested future command shape:

- `scripts/export-skill.ts --source <private-skill> --target <public-skill>`
- optional `--check-only`
- optional `--manifest approved-skills.json`

Success criteria:

- no bulk one-shot publish of the entire MooCoding corpus
- each public skill has an intentional export event

## Phase 4 — Use Herdr-style installation only for approved public skills

Once a sanitized skill exists inside `pi-harness-runtime/skills/<name>/SKILL.md`:

- expose it through the existing `pi.skills` package field
- document Herdr-style installation ergonomics for the public subset

This gives the benefit of Herdr's distribution model without risking raw private content leakage.

Success criteria:

- only sanitized skills are installable from the public runtime package
- public docs never point users at the live private MooCoding corpus

## Phase 5 — Optional local filesystem loader for private use

If desired, extend `packages/skill-registry` later to read `SKILL.md` files from configurable local directories.

This should be treated as a **local runtime feature**, not a publication mechanism.

Potential capabilities:

- discover local private skills from configured paths
- list them in the runtime
- mark source type: `bundled` vs `external-private`
- never publish external-private skills automatically

Important safeguard:

- external-private discovery must not imply packaging or registry distribution

Success criteria:

- local users can benefit from private skills dynamically
- private skill ingestion remains isolated from public release paths

---

## Non-Goals

The following should **not** happen in the first implementation:

- copying the full MooCoding skill corpus into `pi-harness-runtime/skills/`
- publishing unsanitized skills to npm/GitHub
- treating the package repo as the authoring source of truth
- building automatic bidirectional sync between private and public skill trees
- assuming Herdr's install model is sufficient without a content-safety layer

---

## Proposed Deliverables

### Immediate deliverable

- this planning note in `harness/skills-plan/`

### Next implementation deliverables

1. `PUBLIC_SKILLS_POLICY.md` or similar policy doc
2. sanitization checklist/spec
3. explicit export script for selected skills
4. public skill index for approved packaged skills
5. optional file-backed registry loader for local-only skill discovery

---

## Suggested Execution Order

1. Write policy: private vs public skill boundary
2. Define sanitization rules and approval process
3. Implement export workflow for selected skills only
4. Publish one or two proven-safe sample skills first
5. Only then consider broader Herdr-style public skill distribution
6. Later, separately, consider local private skill loading in `packages/skill-registry`

---

## Recommendation

**Do not adapt by importing the full MooCoding corpus into `pi-harness-runtime` right now.**

Best first move:

- keep MooCoding skills private and live
- make `pi-harness-runtime` the home only for **sanitized exported skills**
- treat Herdr as the inspiration for install UX, not as the whole architecture

This preserves your knowledge base, avoids accidental disclosure, and still leaves room for a clean public skill distribution story later.
