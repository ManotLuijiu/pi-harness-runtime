---
name: release
description: Automated release workflow for any project — git add, status, commit, push, bump version, and publish via GitHub Actions. Detects app type automatically.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *), Bash(bun *), Bash(npm *), Bash(bench *), Bash(pip *), Bash(python *), Bash(cat *), Bash(ls *), Bash(jq *), Bash(pwd *), Bash(realpath *), Read, Edit
---

# Release Workflow — Universal

Automated release workflow that detects the current project type and applies the appropriate release process.

## Usage

```
/release {bump_type}
```

**Parameters:**

- `bump_type` (optional): `patch` (default), `minor`, or `major`

**Examples:**

```
/release           # patch (default)
/release minor     # minor bump
/release major     # major bump
```

## Complete Workflow

### Step 1: Detect app type and check git status

```bash
pwd
git status
git pull --rebase
```

Detect app type:
- **pi-harness-runtime**: Node.js monorepo with `bun scripts/release-all.ts`
- **Frappe app** (`frappe-bench/apps/{app}/`): Python app with `bench` commands
- **Other**: Standard git tag + GitHub Actions

### Step 2: Stage and commit all changes

```bash
git add --all
git commit -m "{auto-generated message or user-provided}"
git push origin {branch}
```

### Step 3: Bump version and create tag

**For pi-harness-runtime:**
```bash
bun scripts/release-all.ts --release-as {bump_type}
```

**For Frappe apps:**
```bash
# Version stored in __init__.py or pyproject.toml
# Edit version file, commit, tag
```

### Step 4: Push with tags (triggers GitHub Actions)

```bash
git push --follow-tags origin {branch}
git status
```

### Step 5: Verify

```bash
# For npm packages
npm view {package_name} version

# For GitHub releases
gh run list --workflow=release.yml --limit 3
```

## App-Specific Details

### pi-harness-runtime (Node.js Monorepo)

- **Version script**: `bun scripts/release-all.ts`
- **Default bump**: `patch` (0.9.22 → 0.9.23)
- **Publishes**: Root `pi-harness-runtime` package to npm
- **Workspace packages**: Bundled into root, not published separately
- **NPM Trusted Publishing**: Uses GitHub Actions OIDC (no token needed)

### Frappe Apps (Python)

- **Version**: In `{app}/__init__.py` → `__version__`
- **Build**: `bench build --app {app}` (if needed)
- **CI/CD**: Check for `.github/workflows/release.yml` or use generic workflow

## Notes

- **Default bump**: Always `patch` unless user specifies `minor` or `major`
- **Always git status first**: Before committing, show current status
- **GitHub Actions**: Push tags to trigger CI/CD builds
- **Frappe bench apps**: Use `bench` commands for build/test/deploy
