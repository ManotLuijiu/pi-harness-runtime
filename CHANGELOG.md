# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.9.4](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.5.0-beta.1...v0.9.4) (2026-07-14)


### Features

* configure Dependabot to target develop with auto-merge ([9e12b46](https://github.com/ManotLuijiu/pi-harness-runtime/commit/9e12b4620179b91d2dc1a4627e199920d3890f31))
* persist memory engine bundles ([07af7a9](https://github.com/ManotLuijiu/pi-harness-runtime/commit/07af7a96e301bfd8afadd82547cb93e8bec26b12))
* RFC-0052 skill-registry gap fixes + 40 new RFCs (0061-0100) ([6defd26](https://github.com/ManotLuijiu/pi-harness-runtime/commit/6defd26ff931fb9f93548647bf3a76098aa1d48b))
* RFC-0060 memory-engine fixes + simplify auto-resume ([#52](https://github.com/ManotLuijiu/pi-harness-runtime/issues/52)) ([fb4de1a](https://github.com/ManotLuijiu/pi-harness-runtime/commit/fb4de1a9d1de74b875aabb58d0c06f7116994ca3))


### Bug Fixes

* collapse duplicate version keys in workspace package.json files ([f3a7289](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f3a728923a96308296e45d7ce3db8fe3ad36780a))

### [0.4.2-beta.1](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.4.1-beta.1...v0.4.2-beta.1) (2026-07-12)

### [0.9.1](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.7.1...v0.9.1) (2026-07-13)


### Features

* **release:** add synced-workspace release script ([617649d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/617649d0b2227ebb4355eec4979b0c65822d60e3))


### Bug Fixes

* publish missing runtime modules ([3fc7058](https://github.com/ManotLuijiu/pi-harness-runtime/commit/3fc70586d0cd10f4d38eab67e4cadaec20aaeb56))
* **release:** remove redundant Bump version step — was double-bumping version (0.7.1→0.8.0) when tag pushed ([413ad6d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/413ad6d49356ec62b94e9a4e09d3475ef39bebd6))

## [0.9.0](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.7.1...v0.9.0) (2026-07-13)


### Features

* **release:** add synced-workspace release script ([617649d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/617649d0b2227ebb4355eec4979b0c65822d60e3))


### Bug Fixes

* **release:** remove redundant Bump version step — was double-bumping version (0.7.1→0.8.0) when tag pushed ([413ad6d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/413ad6d49356ec62b94e9a4e09d3475ef39bebd6))

### [0.7.1](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.6.3...v0.7.1) (2026-07-13)


### Bug Fixes

* **release:** set make_latest=true so new releases auto-mark as Latest ([26a7bb9](https://github.com/ManotLuijiu/pi-harness-runtime/commit/26a7bb98f3e603a9d68cbf39ca1558bc579d1a4a))

### [0.6.3](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.4.0...v0.6.3) (2026-07-13)

## [0.4.0](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.3.1...v0.4.0) (2026-07-05)

### Features

* **auth:** Add curator-mode MiniMax browser authentication ([4914517](https://github.com/ManotLuijiu/pi-harness-runtime/commit/49145171d0205e78454472f5f4e540ff7c70a711))
* **auth:** Add MiniMax browser authentication prototype ([75e294e](https://github.com/ManotLuijiu/pi-harness-runtime/commit/75e294e31f582521a48b66d1ce05e1cc3f581750))
* **auth:** Add persistent browser profile auth for MiniMax ([f725d2b](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f725d2b89aa61d6e1cd5de0458b4d2c80efb6e7a))
* Fixed Chrome ([98becb8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/98becb8bed6b94612db648d4bdd58f8a45d23040))
* implement RFC-0019 through RFC-0022 ([4468dcb](https://github.com/ManotLuijiu/pi-harness-runtime/commit/4468dcb1cfcb320f8eeab50c8ef590de74de979a))

### Bug Fixes

* **auth:** Don't re-navigate after login detection ([133e6d5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/133e6d5ac852cc3048881eb4e28700c3aceca792))
* **auth:** Poll for content AND URL, log URL changes for debugging ([4a197fe](https://github.com/ManotLuijiu/pi-harness-runtime/commit/4a197febec24efe85568c3ce35286f45602f5e23))
* **auth:** Poll URL instead of stdin for login detection ([04ced9a](https://github.com/ManotLuijiu/pi-harness-runtime/commit/04ced9a76753e6b6d4b8e43c97fe19830ab08af1))
* **skill:** Add description field to harness-runtime SKILL.md ([d06d37b](https://github.com/ManotLuijiu/pi-harness-runtime/commit/d06d37becfd92e17ffe27dfbeac04da61f0d89df))

## [0.2.0] - 2026-06-29

### Changed

* **Project rename**: `pi-usage-status` → `pi-harness-runtime`
  * npm package name: `pi-usage-status` → `pi-harness-runtime`
  * Repository: `ManotLuijiu/pi-usage-status` → `ManotLuijiu/pi-harness-runtime`
  * Bundled skill: `usage-status` → `harness-runtime` (file path `skills/usage-status/` → `skills/harness-runtime/`)
  * Status bar key: `usage-status` → `harness-runtime`
  * **Data directory unchanged**: still `~/.pi/usage-status/` (preserves existing user data)
  * **Env var unchanged**: still `PI_USAGE_DIR` (preserves existing user configs)
  * **Extension symlink unchanged**: still `~/.pi/agent/extensions/pi-usage-status` (repointed to renamed project directory)
  * Added `"files"` whitelist to `package.json` — publish only the 7 runtime `.ts` files, `skills/`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` (excludes `test/`, `ADR/`, `docs/`, `examples/`, `packages/`, `PRD/`, `RFC/`)

## [0.1.0] - 2026-06-26

### Added

* Initial release
* `/usage` slash command — show Codex-style usage status (model, directory, local tracking, provider mirror)
* `/usage today` / `/usage week` / `/usage reset` focused views
* Local SQLite tracking of every assistant message (input/output tokens + cost)
* Provider-mirror JSON at `~/.pi/usage-status/mirror.json` (synced_at, 5h_used_pct, 5h_resets_at, weekly_used_pct, weekly_resets_at)
* Rolling 5h window aggregation (auto-computed from local data)
* Rolling weekly window aggregation
* Reset-time computation (`oldest_request_in_window + window_duration`)
* Progress bar renderer matching Codex's `[████████░░░░░░░░░░░░]` style
* Local-vs-mirror divergence detection (warns if local tracking diverges from provider mirror by >5%)
* Burn-rate projection ("Weekly burn rate: 11.4% / day")
* Bundled skill `usage-status` (loaded automatically)
* MIT license
