---
name: release
description: Universal release workflow - git add/commit/push, version bump, tag, publish. Supports Node.js monorepos, Frappe apps, Python packages.
disable-model-invocation: true
argument-hint: "[app_name] [bump_type]"
allowed-tools: Bash(git *), Bash(gh *), Bash(bun *), Bash(yarn *), Bash(pnpm *), Bash(npm *), Bash(npx *), Bash(bench *), Bash(python *), Bash(pip *), Bash(jq *), Bash(cat *), Bash(ls *), Bash(cd *), Bash(node *), Bash(uname *), Bash(find *), Bash(grep *), Bash(awk *), Bash(sed *), Bash(awk *), Read, Edit, Write
---

# Universal Release Workflow

Automated release: `git add` -> `commit` -> `push` -> `version bump` -> `tag` -> `push tags` -> `GitHub Actions publish`.

## Usage

```
/release [{app_name}] [{bump_type}]
```

**Parameters:**

- `app_name` (optional): App/workspace to release - auto-detected from current directory if not provided.
- `bump_type` (optional): Version bump - `patch` (default), `minor`, or `major`

**Examples:**

```
/release                       # patch release (current dir, auto-detect)
/release m_capital            # patch release
/release thai_business_suite minor  # minor release
/release pi-harness-runtime major   # major release
```

## Auto-Detection

The workflow automatically detects:

| What | How |
|------|-----|
| App name | From directory (`apps/{name}/`) or repo root |
| Project type | `scripts/release-all.ts` -> Node monorepo; `__init__.py` -> Frappe app; `pyproject.toml` -> Python |
| Package manager | `pnpm-lock.yaml`, `yarn.lock`, `npm` - checked in order |
| Branch strategy | `develop` + `version-15/16` -> cascade; `main` -> standard Git Flow |
| Current version | `__init__.py` (Frappe) or `package.json` |

## Step-by-Step Workflow

### Step 1: Check current state

```bash
git status
git branch
pwd
```

### Step 2: Detect project type

**Node.js monorepo** (has `scripts/release-all.ts`):

- Uses `bun scripts/release-all.ts --release-as {bump}`
- GitHub Actions OIDC publishes to npm
- Single root package published (`pi-harness-runtime`)

**Frappe app** (has `__init__.py`):

- Updates `__init__.py` version + `frontend/package.json`
- CI auto-merges `develop -> version-15 -> version-16`
- Frappe version constraint managed by CI (not manually)

**Python package** (has `pyproject.toml`):

- Uses `bump2version` or manual version edit
- Standard Git Flow (develop -> main)

### Step 3: Parse git status and commit pending changes

**IMPORTANT**: Always check git status for:

1. Modified files
2. Staged files
3. Untracked files

If ANY exist, they must be committed before releasing.

**Safe staging** - never blindly `git add --all`:

```bash
git add -A -- ':!.env*' ':!*.pem' ':!*.key' ':!credentials*'
```

**Conventional commit messages**:

| Prefix | Use for |
|--------|---------|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `chore:` | Maintenance, deps, config |
| `ci:` | CI/CD changes |
| `docs:` | Documentation |

### Step 4: Version bump

**Node.js monorepo** (pi-harness-runtime pattern):

```bash
bun scripts/release-all.ts --release-as {bump_type}
```

**Frappe app** (if `standard-version` configured):

```bash
yarn release:{bump_type}  # or pnpm/npm
```

**Frappe app** (manual fallback):

```bash
# Detect OS for cross-platform sed
OS=$(uname -s)  # "Darwin" = macOS, "Linux" = Ubuntu

NEW_VERSION="x.y.z"

# Update __init__.py
if [ "$OS" = "Darwin" ]; then
  sed -i '' "s/__version__ = \".*\"/__version__ = \"$NEW_VERSION\"/" {app}/__init__.py
else
  sed -i "s/__version__ = \".*\"/__version__ = \"$NEW_VERSION\"/" {app}/__init__.py
fi

# Update frontend/package.json if exists
if [ -f frontend/package.json ]; then
  # (same sed pattern)
fi

# Amend commit with version changes
git add -A -- ':!.env*' ':!*.pem' ':!*.key'
git commit --amend --no-edit
```

### Step 5: Push with tags

```bash
git push origin $(git rev-parse --abbrev-ref HEAD) --follow-tags
```

If `--follow-tags` doesn't push the tag:

```bash
git push origin v{new_version}
```

### Step 6: GitHub Actions - wait and verify

**Node.js monorepo** (triggers `release.yml`):

```bash
gh run list --workflow=release.yml --limit 3
```

**Frappe apps** (triggers `auto-merge.yml`):

```bash
# For Thai Business Suite / inpac_pharma: develop -> version-15 -> version-16
gh run list --workflow=auto-merge.yml --limit 2
```

### Step 7: Verify release

```bash
# npm packages
npm view {package_name} version

# Python packages
pip show {package_name}

# GitHub release
gh run list --workflow=release.yml --limit 3
```

## App-Specific Patterns

### pi-harness-runtime (Node.js monorepo)

```bash
# 1. Commit all changes
git add --all && git commit -m "feat: description" && git push origin develop

# 2. Bump version (defaults to patch)
bun scripts/release-all.ts --release-as {bump_type}

# 3. Push tags -> GitHub Actions publishes to npm via OIDC
git push --follow-tags origin develop
```

Uses GitHub Actions OIDC - **no npm token needed**.

### Frappe apps (Thai Business Suite / inpac_pharma)

```bash
# 1. Commit
git add -A -- ':!.env*' ':!*.pem' ':!*.key' ':!credentials*'
git commit -m "feat: description"
git push origin develop

# 2. Create version tag
git tag -a v{x.y.z} -m "Release v{x.y.z}"
git push origin develop --tags

# 3. CI auto-merges: develop -> version-15 -> version-16
```

**Frappe version constraint** - CI overwrites `pyproject.toml` after merge:

- `develop` branch: keeps `frappe = ">=16.0.0,<17.0.0"`
- After merge to `version-15`: overwrites with `">=15.40.4,<16.0.0"`
- After merge to `version-16`: overwrites with `">=16.0.0,<17.0.0"`

### Frappe apps (Standard Git Flow)

```bash
# 1. Commit + push to develop
git add -A -- ':!.env*' ':!*.pem' ':!*.key'
git commit -m "feat: description"
git push origin develop

# 2. Merge develop -> main (or auto-merge workflow)
git checkout main && git pull origin main && git merge develop --no-edit && git push origin main

# 3. Create tag
git tag v{x.y.z} && git push origin v{x.y.z}
```

### Python packages

```bash
# 1. Commit
git add -A && git commit -m "feat: description" && git push

# 2. Bump version
bump2version {bump_type}

# 3. Push
git push && git push --tags
```

## Safety Features

- **Git status parsing** - explicitly checks modified, staged, untracked files
- **Safe staging** - excludes `.env*`, `*.pem`, `*.key`, `credentials*`
- **Cross-platform** - detects macOS vs Linux for `sed -i`
- **Package manager detection** - auto-detects pnpm/yarn/npm from lockfiles
- **Version format validation** - semver enforcement
- **Tag existence check** - avoids duplicate tags

## Conventional Commits

| Prefix | CHANGELOG Section |
|--------|-------------------|
| `feat:` | Features |
| `fix:` | Bug Fixes |
| `docs:` | Documentation |
| `chore:` | Maintenance |
| `ci:` | CI/CD |
| `refactor:` | Refactoring |

## Summary Format

```
Release v{version} completed!

App: {app_name}
Type: {Node.js monorepo | Frappe app | Python package}
Version: {old} -> {new}
Branch: {source} -> {target}
Tag: v{version}
Release: https://github.com/{owner}/{repo}/releases/tag/v{version}
```
