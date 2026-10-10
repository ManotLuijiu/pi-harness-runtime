# Development Rules

## Version Management

### NPM Publishing via GitHub Actions + OIDC

**GitHub Actions automatically publishes to npm when you push to `develop` branch.**

- Uses **OpenID Connect (OIDC)** for secure npm authentication
- No npm token stored in GitHub secrets
- Each package is configured at: npmjs.com → Package → Settings → Trusted Publisher

After every `git push` to `develop`:
1. GitHub Actions detects the push
2. Authenticates to npm via OIDC
3. Runs build and tests
4. Publishes to npm automatically

You do NOT need to manually run `npm publish` or manage tokens.

### Version Bump Process

**Before pushing a version bump, check npm to use the correct next version:**

```bash
# 1. Check current npm version
npm view pi-harness-runtime version
# Example output: 1.1.184

# 2. Update package.json to next version (npm + 1)
sed -i 's/"version": "1.1.184"/"version": "1.1.185"/' package.json

# 3. Commit and tag with SAME version
git add -A && git commit -m "bump: version to 1.1.185"
git tag v1.1.185
git push origin develop --tags
```

**Important:**
- Never reuse a version number already on npm
- Use patch-level only (`1.1.x`) until production-ready
- GitHub Actions reads the `tag` event to trigger npm publish

### Why This Matters

- If the tag already exists on npm, publish fails with: `You cannot publish over the previously published versions`
- Using a new unique version ensures clean publish

## Commit Messages

Follow conventional commits:
- `fix:` for bug fixes
- `feat:` for new features
- `chore:` for maintenance tasks
