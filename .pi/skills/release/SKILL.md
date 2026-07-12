---
name: release
description: Automated release workflow for pi-harness-runtime monorepo - bump version, update CHANGELOG, commit, push, and publish to NPM.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *), Bash(bun *), Bash(npm *), Bash(cat *), Bash(ls *), Bash(jq *), Read, Edit
---

# Release Workflow for pi-harness-runtime

Automated release workflow for the pi-harness-runtime Node.js monorepo with workspaces.

## Usage

```
release [bump_type]
```

**Parameters:**

- `bump_type` (optional): `patch` (default), `minor`, or `major`

## Quick Start

```bash
# Standard release from develop branch
/release

# Minor bump
/release minor
```

## Complete Workflow

### Step 1: Check Current State

```bash
git status
git branch
git log --oneline -3
```

### Step 2: Detect Pending Changes

**IMPORTANT**: Check ALL of these conditions:

1. **Modified files** (under "Changes not staged for commit")
2. **Staged files** (under "Changes to be committed")
3. **Untracked files** (under "Untracked files")

If ANY exist, they must be committed before release.

### Step 3: Commit Pending Changes

```bash
# Stage files safely (exclude sensitive files)
git add -A -- ':!.env*' ':!*.pem' ':!*.key' ':!credentials*'

# Commit with conventional format
git commit -m "feat: add new feature"
```

### Step 4: Merge to Main (if on develop)

```bash
# Fetch and merge origin/main into develop
git fetch origin main
git merge origin/main -m "chore: merge main into develop"

# Push to develop (triggers auto-merge workflow)
git push origin develop
```

### Step 5: Push to Main

```bash
# Checkout main and merge develop
git checkout main
git pull origin main
git merge develop --no-edit

# Push main (triggers release workflow)
git push origin main
```

### Step 6: Tag and Release

```bash
# Create tag (use bump_type for version)
VERSION="0.6.0-beta.1"  # example
git tag v$VERSION
git push origin v$VERSION

# This triggers the Release workflow which:
# 1. Builds all packages
# 2. Runs tests
# 3. Publishes to NPM
# 4. Creates GitHub Release
```

## NPM Publishing

The release workflow publishes these packages:

| Package | Name | Scope |
|---------|------|-------|
| Root | `pi-harness-runtime` | public |
| Workspace | `@pi-harness/capability-registry` | public |
| Workspace | `@pi-harness/model-registry` | public |
| Workspace | `@pi-harness/skill-registry` | public |
| Workspace | `@pi-harness/cost-optimizer` | public |
| Workspace | `@pi-harness/provider-router` | public |

## Version Strategy

- **Beta releases**: `vX.Y.Z-beta.N` for development
- **Stable releases**: `vX.Y.Z` for production
- **Workspaces**: All packages share the same version
- **Branch flow**: develop → main (release workflow triggers on tag)

## Workflow Files

- `.github/workflows/release.yml` - Publishes to NPM on tag push
- `.github/workflows/auto-merge-develop.yml` - Merges develop → main automatically

## Common Issues

### Build fails

- Check `bun run build` locally before pushing
- Ensure all TypeScript compiles without errors

### NPM publish fails

- Verify `NPM_TOKEN` secret is set in GitHub Actions
- Check package names match NPM organization scope

### Auto-merge stuck

- Check PR status at: `gh pr list --state open`
- Resolve conflicts locally and push

## Safety Features

- **Safe staging**: Excludes `.env*`, `*.pem`, `*.key`, `credentials*`
- **Version alignment**: All workspace packages share same version
- **Auto-merge**: develop → main handled by CI
- **Approval bypass**: Uses NPM_TOKEN with bypass-2FA scope

## Summary Format

```
Release v{version} completed successfully!

Type: Node.js monorepo with workspaces
Version: {old} -> {new}
Tag: v{version}
Release: https://github.com/{owner}/{repo}/releases/tag/v{version}
NPM: https://www.npmjs.com/package/{package_name}

Packages published:
- pi-harness-runtime@{version}
- @pi-harness/capability-registry@{version}
- @pi-harness/model-registry@{version}
- @pi-harness/skill-registry@{version}
- @pi-harness/cost-optimizer@{version}
- @pi-harness/provider-router@{version}
```
