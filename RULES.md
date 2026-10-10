# Development Rules

## Version Management

### NPM and GitHub Version Sync

**Versions MUST match between npm and GitHub tags before push.**

Before pushing any version bump:
1. Check current npm version: `npm view pi-harness-runtime version`
2. Use the next version number (e.g., if npm is 1.1.184, bump to 1.1.185)
3. Never reuse a version number that's already on npm

```bash
# Check npm version
npm view pi-harness-runtime version

# Update package.json BEFORE git add/commit
sed -i 's/"version": "X.X.X"/"version": "Y.Y.Y"/' package.json

# Commit and tag with SAME version
git add -A && git commit -m "bump: version to Y.Y.Y"
git tag vY.Y.Y
git push origin develop --tags
```

### Why This Matters

- GitHub Actions reads the `tag` event to trigger npm publish
- If the tag already exists on npm, publish fails with: `You cannot publish over the previously published versions`
- Using a new version ensures clean publish

## Patch Version Convention

- Use only **patch-level updates** (`1.1.x`) until production-ready
- This allows rapid iteration without version conflicts

## Commit Messages

Follow conventional commits:
- `fix:` for bug fixes
- `feat:` for new features
- `chore:` for maintenance tasks
