---
name: release
description: Automated release workflow for pi-harness-runtime — git add, commit, push, bump version, and publish to npm via GitHub Actions.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *), Bash(bun *), Bash(npm *), Bash(cat *), Bash(ls *), Bash(jq *)
---

# Release Workflow for pi-harness-runtime

Automated release workflow for the pi-harness-runtime Node.js monorepo.

## Usage

```
/release {bump_type}
```

**Parameters:**

- `bump_type` (optional): `patch` (default), `minor`, or `major`

**Examples:**

```
/release           # patch (0.9.22 → 0.9.23)
/release minor     # minor (0.9.22 → 0.10.0)
/release major     # major (0.9.22 → 1.0.0)
```

## Complete Workflow

### Step 1: Check git status

```bash
git status
```

If there are uncommitted changes → must commit before releasing.

### Step 2: Stage and commit all changes

```bash
git add --all
git commit -m "feat: add new feature"
git push origin develop
```

Wait for CI to pass, then continue.

### Step 3: Bump version and create tag

```bash
bun scripts/release-all.ts --release-as {bump_type}
```

- Defaults to `patch` if `bump_type` not specified
- Updates root `package.json` and all workspace packages
- Amends the commit with workspace version changes
- Creates git tag (e.g., `v0.9.23`)

### Step 4: Push with tags

```bash
git push --follow-tags origin develop
```

### Step 5: GitHub Actions builds and publishes

The `release.yml` workflow triggers automatically on tag push:

1. Checkout + install dependencies
2. Build all packages (`bun run build`)
3. Publish to npm via **GitHub Actions OIDC** (no token needed)
4. Create GitHub Release

### Step 6: Verify

```bash
npm view pi-harness-runtime version
gh run list --workflow=release.yml --limit 3
```

## Notes

- **Only root package is published**: `pi-harness-runtime` (workspace packages are bundled)
- **NPM Trusted Publishing**: Uses GitHub Actions OIDC — no long-lived npm token required
- **Default bump**: Always `patch` unless user specifies `minor` or `major`
- **AGENTS.md workflow**: git add --all → git commit → git push (step 4 of session completion)
- **Version script**: `bun scripts/release-all.ts --release-as patch` (default if not specified)
