# Changelog

All notable changes to `pi-harness-runtime` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-29

### Changed

- **Project rename**: `pi-usage-status` → `pi-harness-runtime`
  - npm package name: `pi-usage-status` → `pi-harness-runtime`
  - Repository: `ManotLuijiu/pi-usage-status` → `ManotLuijiu/pi-harness-runtime`
  - Bundled skill: `usage-status` → `harness-runtime` (file path `skills/usage-status/` → `skills/harness-runtime/`)
  - Status bar key: `usage-status` → `harness-runtime`
  - **Data directory unchanged**: still `~/.pi/usage-status/` (preserves existing user data)
  - **Env var unchanged**: still `PI_USAGE_DIR` (preserves existing user configs)
  - **Extension symlink unchanged**: still `~/.pi/agent/extensions/pi-usage-status` (repointed to renamed project directory)
  - Added `"files"` whitelist to `package.json` — publish only the 7 runtime `.ts` files, `skills/`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` (excludes `test/`, `ADR/`, `docs/`, `examples/`, `packages/`, `PRD/`, `RFC/`)

## [0.1.0] - 2026-06-26

### Added

- Initial release
- `/usage` slash command — show Codex-style usage status (model, directory, local tracking, provider mirror)
- `/usage sync` slash command — open form to manually mirror provider-side quota from console.minimax.io
- `/usage today` / `/usage week` / `/usage reset` focused views
- Local SQLite tracking of every assistant message (input/output tokens + cost)
- Manual provider-mirror JSON at `~/.pi/usage-status/mirror.json` (synced_at, 5h_used_pct, 5h_resets_at, weekly_used_pct, weekly_resets_at)
- Rolling 5h window aggregation (auto-computed from local data)
- Rolling weekly window aggregation
- Reset-time computation (`oldest_request_in_window + window_duration`)
- Progress bar renderer matching Codex's `[████████░░░░░░░░░░░░]` style
- Local-vs-mirror divergence detection (warns if local tracking diverges from manual mirror by >5%)
- Burn-rate projection ("Weekly burn rate: 11.4% / day")
- Bundled skill `usage-status` (loaded automatically)
- MIT license
