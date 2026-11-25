# Development Rules

## Single Published App (CRITICAL)

**`pi-harness-runtime` is the ONLY npm package a user installs.** Every internal
app (logging, jev-judge, contracts, relay, skills, todo-bd-sync, ...) ships
INSIDE that one tarball - it is never published on its own and a user never
runs `npm install @pi-harness/<anything>`.

**Rules:**

1. Every workspace lives in `packages/<name>/` and is compiled into
   `packages/<name>/dist/`.
2. A runtime **value** import may only point at a built artifact
   (`../packages/<name>/dist/...`). A `packages/<name>/src/<file>.js` specifier
   only exists when somebody compiled the package in place - it is never a
   valid import in shipped code.
3. The package manifest points at the built output (`main`/`exports` →
   `./dist/...`). There is no exception: a package that ships compiled
   JavaScript has no buildable entry point, so it is not a package.
4. Compiled JavaScript never lives next to a TypeScript source. Bun resolves
   the literal `.js` file first, so a stale artifact silently shadows the
   current source.
5. `bun scripts/build-packages.ts` builds every package and fails when a
   published entry point is missing. `bun scripts/verify-package-contents.ts
   --pack` proves the npm tarball contains every runtime import target.
6. Both run in CI, so a release can never publish a tarball with a missing
   internal app.

## Version Management

### The Rule of the Release (CRITICAL)

**Commit, push and release to `develop`. GitHub does the rest.**

The work of the agent ends on `develop`. The agent never opens a pull
request by hand, never merges one, never creates a tag and never
publishes to npm.

```bash
# 1. the change, with its message
git add -A && git commit -m "fix(scope): what the change repairs"

# 2. the branch of the work
git push origin develop

# 3. the version of the release, prepared and pushed on develop
bun scripts/release-all.ts --release-as patch

# 4. the release script dispatches the App-authenticated workflow above
# Recovery only, if a prepared release needs another handoff:
# gh workflow run auto-merge.yml --ref develop -f open_release_pr=true

# 5. the workflow merges the pull request when the gates are green

# 6. tag-release.yml runs after Auto merge and tags the verified main commit

# 7. the tag publishes the package to npm through OIDC
```

**What the agent never does:**

- it never runs `npm publish` (the publication belongs to the workflow),
- it never merges a pull request by hand,
- it never creates a tag on a commit that is not on `main`,
- it never opens a pull request with its own token: the token of the
  agent may not create one (`GraphQL: Resource not accessible by personal
  access token (createPullRequest)`), and that is not a problem - the
  workflow of the repository opens and merges it with its own token.

**The gates of the merge** are the checks of the head commit of the pull
request: `Tests` and `No sensitive terms`. A pull request run of the CI
that fails before a job starts reports no check run at all; that failure
is on the side of GitHub and it does not hold the release, because the
push run of the same commit is green.

### NPM Publishing via GitHub Actions + OIDC

Dependency updates have a separate gate: `dependency-merge.yml` can merge
verified Dependabot minor/patch updates into `develop` after `Tests` and
`No sensitive terms` pass on the exact head. It reads only trusted policy
code and verified metadata. Major upgrades and Pi runtime migrations stay
under explicit review. The release merger still targets only `main`.
Automatic releases must be authored by GitHub Actions or the release App
whose identity is authenticated with this repository's configured App
credentials. Human authors, unrelated Apps and external source repositories
are never eligible for automatic merging.

**The tag publishes the package to npm.** The publication uses **OpenID
Connect (OIDC)**, so no npm token is stored in GitHub secrets, and each
package is configured at: npmjs.com → Package → Settings → Trusted
Publisher

The tag on `main` starts the workflow:
1. GitHub Actions detects the tag
2. Authenticates to npm via OIDC
3. Runs build and tests
4. Publishes to npm with a signed provenance statement

A push to `develop` alone publishes nothing: it runs the checks of the
branch. The publication belongs to the tag.

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

## SSH Necessity Check

Before every SSH invocation:

1. Run `ip address` in the current execution environment.
2. Identify the SSH destination, including any hostname or SSH alias.
3. Compare its resolved address with this environment's local addresses.
4. If the destination is this same server and the required user,
   filesystem, and execution environment match, run the command locally.
5. If SSH is still necessary, briefly state why.

Do not assume the current terminal is on a different machine.

**Automatic enforcement:** The harness intercepts SSH commands and performs this check automatically using `ip -j address` for machine-readable output. If it detects an unnecessary connection back to the current environment, it returns:

> SSH destination matches this environment. Run the command locally, or explain why a separate SSH session is required.

Do not automatically rewrite SSH commands into local commands. SSH may intentionally use another account, a container boundary, or forwarding. Hostnames and SSH aliases need resolution; comparing the command's hostname directly with `ip address` output is insufficient.

## Sensitive Data (STRICT)

**This is a PUBLIC repository. Never put sensitive data in the codebase.**

All secrets, tokens, URLs, API keys, and credentials MUST be stored in key files:

```
~/.pi-harness-runtime/keys/
├── telegram-bot-token.txt      # Telegram bot token
├── telegram-chat-id.txt       # Authorized chat ID
├── telegram-webhook-url.txt   # Webhook URL
├── telegram-webhook-secret.txt # Webhook secret token
├── skills-saas-url.txt        # Skills SaaS base URL
├── paperclip-base-url.txt     # Paperclip API URL
├── r2-account-id.txt        # Cloudflare R2 account ID
├── r2-access-key-id.txt     # R2 access key ID
├── r2-secret-access-key.txt  # R2 secret access key
├── r2-bucket-name.txt       # R2 bucket name
├── r2-endpoint.txt          # R2 endpoint (usually auto)
├── r2-public-url-prefix.txt # R2 public URL prefix (optional)
└── ...
```

**RULES (enforced strictly):**
- No hardcoded URLs, tokens, API keys, or secrets in source code
- No real domain names (use `example.com` or `yourdomain.com` as placeholder)
- No API keys, tokens, or credentials in comments
- No IP addresses in source code
- All external service URLs must be in key files or environment variables
- README/docs must use generic placeholders

**Loading secrets from key files:**
```bash
# Read from key file
TELEGRAM_BOT_TOKEN=$(cat ~/.pi-harness-runtime/keys/telegram-bot-token.txt)

# Or in code
const token = readFileSync("~/.pi-harness-runtime/keys/telegram-bot-token.txt", "utf8").trim();
```

**Scanning:** Before committing, run:
```bash
grep -rn "moo-vpn\|bunchee\|moo-ai\|moocoding\|sk-\|api_key\|token\s*=" --include="*.ts" --include="*.md"
```
