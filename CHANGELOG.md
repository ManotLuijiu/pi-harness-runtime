# Changelog

All notable changes to `pi-usage-status` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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