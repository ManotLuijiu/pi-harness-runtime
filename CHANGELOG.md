# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.10.30](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.29...v0.10.30) (2026-08-11)


### Bug Fixes

* **file-copy-helper:** require explicit intent for copy rule injection ([ddfece0](https://github.com/ManotLuijiu/pi-harness-runtime/commit/ddfece0bcbf440dfd4edc0d442b078e84e906c68))
* **release:** add --no-fund --prefer-offline to npm publish ([19adf58](https://github.com/ManotLuijiu/pi-harness-runtime/commit/19adf58c5de3192a2322ec5afe3b8ccb8ecedc3c))
* **release:** add --no-git-checks to pnpm publish ([74f29aa](https://github.com/ManotLuijiu/pi-harness-runtime/commit/74f29aa2220d02be4ba47b1c0f0e22ddcba1ffc9))
* **release:** add retry mechanism for npm publish ([0cfc95d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/0cfc95d33a4cd1cfb629fcbba88dd4a5b931ab8c))
* **release:** allow bun postinstall scripts ([df88c21](https://github.com/ManotLuijiu/pi-harness-runtime/commit/df88c217ffc8c8794ceba49385690901d7673b56))
* **release:** keep bun install, add pnpm for publish ([ab400fc](https://github.com/ManotLuijiu/pi-harness-runtime/commit/ab400fcc33f41ec1e60db21a1c3afb5cecedd494))
* **release:** simpler npm publish with retry ([1508480](https://github.com/ManotLuijiu/pi-harness-runtime/commit/1508480363728cab83ccd5084ca2d17275d88e08))
* **release:** use actions/npm-nodejs-publish action ([d161f3f](https://github.com/ManotLuijiu/pi-harness-runtime/commit/d161f3f986f13926b7865c6d7788a11605d4dfbd))
* **release:** use JS-DevTools/npm-publish action ([a5efce0](https://github.com/ManotLuijiu/pi-harness-runtime/commit/a5efce0cf3fd2d9c85339998e61e65b05766724e))
* **release:** use latest npm to fix exit handler issue ([0ad8da9](https://github.com/ManotLuijiu/pi-harness-runtime/commit/0ad8da9ac84d5134783be4f94fd9e112bb298362))
* **release:** use npm pack + publish pattern ([85efcc1](https://github.com/ManotLuijiu/pi-harness-runtime/commit/85efcc181ca2214dd5a1d01bbeefb46f2a53975f))
* **release:** use npm/publish action ([43c6a20](https://github.com/ManotLuijiu/pi-harness-runtime/commit/43c6a20752e4c7fdb548a8f3e1134188857ce1ca))
* **release:** use pnpm for publish to avoid npm exit handler bug ([a038950](https://github.com/ManotLuijiu/pi-harness-runtime/commit/a03895032a57cee039e2ed4b720e46e3d3c13961))

### [0.10.27](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.27) (2026-08-10)


### Features

* create packages for missing RFC implementations ([e6ce2ff](https://github.com/ManotLuijiu/pi-harness-runtime/commit/e6ce2ffdd455b33c55212ec2b61eedcdcfb43b5e))
* **file-copy-helper:** inject cp rule when user asks to mimic/copy files ([f089f0d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f089f0d5e3e933231c99ee38cf18fa208c8eb8b2))


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* **file-copy-helper:** inject rule for import errors - copy missing files, don't fix one-by-one ([03a5b0a](https://github.com/ManotLuijiu/pi-harness-runtime/commit/03a5b0a1bd899866f76fbd6482b52097c7d27a5b))
* **file-copy-helper:** strengthen rule - agent must NOT read source files before copying ([5bbf7f7](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5bbf7f70f19213f4e08059aa3766301d5966daa8))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))
* **todo-bd-sync:** disable auto-injection completely - was causing noisy output ([699d6de](https://github.com/ManotLuijiu/pi-harness-runtime/commit/699d6de5e7f3b062799a0f791b386d1ecd452b00))
* **todo-bd-sync:** silence all console output - no startup warnings ([2d29bcf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2d29bcf51b25fe1b1253aa965e370852f3cae289))
* update bd install URL to correct repo ([5800f30](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5800f304913912a84c34d3f42a29b01bb2d87b24))

### [0.10.26](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.26) (2026-08-10)


### Features

* **file-copy-helper:** inject cp rule when user asks to mimic/copy files ([f089f0d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f089f0d5e3e933231c99ee38cf18fa208c8eb8b2))


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* **file-copy-helper:** inject rule for import errors - copy missing files, don't fix one-by-one ([03a5b0a](https://github.com/ManotLuijiu/pi-harness-runtime/commit/03a5b0a1bd899866f76fbd6482b52097c7d27a5b))
* **file-copy-helper:** strengthen rule - agent must NOT read source files before copying ([5bbf7f7](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5bbf7f70f19213f4e08059aa3766301d5966daa8))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))
* **todo-bd-sync:** disable auto-injection completely - was causing noisy output ([699d6de](https://github.com/ManotLuijiu/pi-harness-runtime/commit/699d6de5e7f3b062799a0f791b386d1ecd452b00))
* **todo-bd-sync:** silence all console output - no startup warnings ([2d29bcf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2d29bcf51b25fe1b1253aa965e370852f3cae289))
* update bd install URL to correct repo ([5800f30](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5800f304913912a84c34d3f42a29b01bb2d87b24))

### [0.10.25](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.25) (2026-08-10)


### Features

* **file-copy-helper:** inject cp rule when user asks to mimic/copy files ([f089f0d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f089f0d5e3e933231c99ee38cf18fa208c8eb8b2))


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* **file-copy-helper:** strengthen rule - agent must NOT read source files before copying ([5bbf7f7](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5bbf7f70f19213f4e08059aa3766301d5966daa8))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))
* **todo-bd-sync:** disable auto-injection completely - was causing noisy output ([699d6de](https://github.com/ManotLuijiu/pi-harness-runtime/commit/699d6de5e7f3b062799a0f791b386d1ecd452b00))
* **todo-bd-sync:** silence all console output - no startup warnings ([2d29bcf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2d29bcf51b25fe1b1253aa965e370852f3cae289))
* update bd install URL to correct repo ([5800f30](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5800f304913912a84c34d3f42a29b01bb2d87b24))

### [0.10.24](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.24) (2026-08-09)


### Features

* **file-copy-helper:** inject cp rule when user asks to mimic/copy files ([f089f0d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f089f0d5e3e933231c99ee38cf18fa208c8eb8b2))


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))
* **todo-bd-sync:** disable auto-injection completely - was causing noisy output ([699d6de](https://github.com/ManotLuijiu/pi-harness-runtime/commit/699d6de5e7f3b062799a0f791b386d1ecd452b00))
* **todo-bd-sync:** silence all console output - no startup warnings ([2d29bcf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2d29bcf51b25fe1b1253aa965e370852f3cae289))
* update bd install URL to correct repo ([5800f30](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5800f304913912a84c34d3f42a29b01bb2d87b24))

### [0.10.23](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.23) (2026-08-09)


### Features

* **file-copy-helper:** inject cp rule when user asks to mimic/copy files ([f089f0d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f089f0d5e3e933231c99ee38cf18fa208c8eb8b2))


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))
* **todo-bd-sync:** disable auto-injection completely - was causing noisy output ([699d6de](https://github.com/ManotLuijiu/pi-harness-runtime/commit/699d6de5e7f3b062799a0f791b386d1ecd452b00))
* **todo-bd-sync:** silence all console output - no startup warnings ([2d29bcf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2d29bcf51b25fe1b1253aa965e370852f3cae289))

### [0.10.22](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.22) (2026-08-09)


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))
* **todo-bd-sync:** disable auto-injection completely - was causing noisy output ([699d6de](https://github.com/ManotLuijiu/pi-harness-runtime/commit/699d6de5e7f3b062799a0f791b386d1ecd452b00))
* **todo-bd-sync:** silence all console output - no startup warnings ([2d29bcf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2d29bcf51b25fe1b1253aa965e370852f3cae289))

### [0.10.21](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.21) (2026-08-08)


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))
* **todo-bd-sync:** silence all console output - no startup warnings ([2d29bcf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2d29bcf51b25fe1b1253aa965e370852f3cae289))

### [0.10.20](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.14...v0.10.20) (2026-08-08)


### Bug Fixes

* align TS formatting with main (remove 3-line logError) ([2515ad5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2515ad54f43f0566123c686d3ec4f92ad363ea13))
* correct import paths for notification-center dist files ([f248722](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f24872240c07bf115f69530a3bdabedf73e3c858))
* handle array/object content in pi-usage-status build detection ([68b07a8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/68b07a8e8167a95ab1b519782a07ec3a582eec5a))
* skip publish-time scripts in release workflow ([b385148](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b38514835dc3f6fd717ca8c71dbb6d131de4887f))
* suppress noisy stack traces in harness agents ([34bbe98](https://github.com/ManotLuijiu/pi-harness-runtime/commit/34bbe98f59e740fcfcd8622f1dcc09c379f6f3df))

### [0.10.11](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.10.9...v0.10.11) (2026-08-03)


### Features

* add knowledge-retrieval package for TencentDB-Agent-Memory MCP (RFC-0105) ([a4558d0](https://github.com/ManotLuijiu/pi-harness-runtime/commit/a4558d098c7b662b01d9502c8560219eafbf1941))
* add okf-indexer package for SKILL.md indexing (RFC-0106) ([a3cc7da](https://github.com/ManotLuijiu/pi-harness-runtime/commit/a3cc7da0a390d5c8176d0d871418780facabcb5c))
* extend a2a-adapter with discovery server (RFC-0104) ([0c4fc18](https://github.com/ManotLuijiu/pi-harness-runtime/commit/0c4fc1826fd55f10305bfbd894b32b5b55f1ab86))


### Bug Fixes

* act on CONFLICTING immediately even when mergeStateStatus=DIRTY ([b7f290e](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b7f290ece8e0e989635aacc456fffd4ee19183ec))
* add --provenance to npm publish for OIDC ([72aa76f](https://github.com/ManotLuijiu/pi-harness-runtime/commit/72aa76f8a5d4cfba984479da834e6695888902a0))
* add diagnostics to npm publish and remove provenance ([124dabe](https://github.com/ManotLuijiu/pi-harness-runtime/commit/124dabea98b59e891fa95b9c92860d9c85657cd4))
* apply stashed release workflow change ([8257689](https://github.com/ManotLuijiu/pi-harness-runtime/commit/82576896795c7cbc3adfbfa8500a77779896169a))
* auto-merge detects fork PRs and posts helpful comments ([c7ff0b9](https://github.com/ManotLuijiu/pi-harness-runtime/commit/c7ff0b90b7b03ca061b1dcaf4ae8b865050f72a4))
* fall back to local merge for workflow PRs ([5fabebd](https://github.com/ManotLuijiu/pi-harness-runtime/commit/5fabebd293cbb9180f3c6c3887873b645ecc8956))
* improve auto-merge workflow with longer backoff and auto-resolve conflicts ([0c33f29](https://github.com/ManotLuijiu/pi-harness-runtime/commit/0c33f290097cf7c990909dbace88434fab72744b))
* move permissions to job level for OIDC npm publish ([a8345d1](https://github.com/ManotLuijiu/pi-harness-runtime/commit/a8345d1ff2e9ade96335c56b973ba8ccf1df9296))
* npm publish with token and provenance ([4529b4c](https://github.com/ManotLuijiu/pi-harness-runtime/commit/4529b4c72751e07a6e6317133c222a501c828e45))
* remove local keyword from bash script in publish step ([4ef5810](https://github.com/ManotLuijiu/pi-harness-runtime/commit/4ef5810145e1233a66fecde2d985e070ab8f2524))
* remove NPM_TOKEN env - use OIDC only for npm publish ([4107ecf](https://github.com/ManotLuijiu/pi-harness-runtime/commit/4107ecf0eb4217127b57d3be5fa3d2788d1a2175))
* rewrite release workflow - pure OIDC publish ([056d25b](https://github.com/ManotLuijiu/pi-harness-runtime/commit/056d25b5ac673ab6ff9fad88283cd9eb5b3092ae))
* run release workflow on main pushes ([225b284](https://github.com/ManotLuijiu/pi-harness-runtime/commit/225b28489921c1f178fc8586816c8cc8e0019e12))
* use NPM_TOKEN in .npmrc format ([cd6be04](https://github.com/ManotLuijiu/pi-harness-runtime/commit/cd6be048bcfb245c741b3e6b6af92d6400eed621))
* use NPM_TOKEN secret directly for npm publish ([48a3bb2](https://github.com/ManotLuijiu/pi-harness-runtime/commit/48a3bb2bd7ca3c41cd81c2bf4935dc872dc78a57))
* use npm-publish-github-action for OIDC ([dbf3bd4](https://github.com/ManotLuijiu/pi-harness-runtime/commit/dbf3bd47d4448c2df4247fda0b67e3c9315923a9))

## [0.10.0](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.24...v0.10.0) (2026-07-30)


### Features

* blackboard-coordinated loop controller with early exit ([f3cf3ea](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f3cf3ea479170dd75b7e9a7c3515dde230bb0da7))
* herdr inter-agent event bus for autonomous code review ([1490cdd](https://github.com/ManotLuijiu/pi-harness-runtime/commit/1490cddec80dac812065c3c681984524ad3194e1))
* loop controller for write-review cycles with early exit ([95066ce](https://github.com/ManotLuijiu/pi-harness-runtime/commit/95066ce8cb58c55eaa14d69fd826b5aaff680c16))


### Bug Fixes

* **clipboard:** pass UTF-8 bytes directly to xclip via stdin, avoid pipeline corruption ([051ca18](https://github.com/ManotLuijiu/pi-harness-runtime/commit/051ca18fb1deb1169a8a4da16aa9314d2e6ec66d))
* herdr-bus refactoring — rename publishers to *Simple variants ([d727591](https://github.com/ManotLuijiu/pi-harness-runtime/commit/d7275913a89deb56a6bcfdb912ea9d17e3a80ce1))
* import LoopConfig from index.js, remove unused LoopNextAction import ([1100a4e](https://github.com/ManotLuijiu/pi-harness-runtime/commit/1100a4e87433e54416259dfdad41bc5e0def19b3))
* periodic quota refresh every 15 minutes via setInterval ([f28e700](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f28e7004d089aeada1659f4d55a35461baba76fc))
* replace all Unicode box-drawing characters with ASCII ([dd4223a](https://github.com/ManotLuijiu/pi-harness-runtime/commit/dd4223abb0e25f746ee09ced05f6b3e40a10eb85))
* replace Unicode dashes and arrows with ASCII equivalents ([e9027e6](https://github.com/ManotLuijiu/pi-harness-runtime/commit/e9027e689c06fdc1ca2ac4a6365ed6a6a0a384fd))
* trigger cookie sync on startup so pre-existing cookies aren't ignored ([2914299](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2914299b8caa02acbb06620c7cb8e4870acfa40e))

### [0.9.25](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.21...v0.9.25) (2026-07-27)


### Bug Fixes

* **ci:** explicitly list test files to exclude cookie auth tests in release workflow ([1c96002](https://github.com/ManotLuijiu/pi-harness-runtime/commit/1c9600232282a1ef9323300fbd763c962aff49f6))
* **ci:** skip browser auth tests in release workflow ([6117ed5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/6117ed5af11357c6f12d11f4cd8d3441de519043))
* **ci:** skip tests in release workflow ([8357ecd](https://github.com/ManotLuijiu/pi-harness-runtime/commit/8357ecd0b7d9c0c6ef81680902ca731da59a37c4))
* **e2e:** add OpenAIUsageResponse type to fix rate_limit TS error ([2ed0891](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2ed08911410ec07815d828028db1a6c9eaf2df2c))
* **release:** add --workspaces=false to npm publish so only pi-harness-runtime is published ([31e715d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/31e715d97e7fce5b82b503a95b86037d757db906))

### [0.9.24](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.21...v0.9.24) (2026-07-27)


### Bug Fixes

* **ci:** skip browser auth tests in release workflow ([6117ed5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/6117ed5af11357c6f12d11f4cd8d3441de519043))
* **e2e:** add OpenAIUsageResponse type to fix rate_limit TS error ([2ed0891](https://github.com/ManotLuijiu/pi-harness-runtime/commit/2ed08911410ec07815d828028db1a6c9eaf2df2c))
* **release:** add --workspaces=false to npm publish so only pi-harness-runtime is published ([31e715d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/31e715d97e7fce5b82b503a95b86037d757db906))

### [0.9.23](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.21...v0.9.23) (2026-07-27)

### [0.9.22](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.21...v0.9.22) (2026-07-27)

### [0.9.11](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.8...v0.9.11) (2026-07-23)

### Bug Fixes

* **release:** test workflow trigger via manual version bump
* **tests:** update footer-status expectations for provider label prefix
* **tests:** mirror round-trip expects per-provider shape + source field

### [0.9.8](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.5...v0.9.8) (2026-07-23)

### Features

* **cookie-sanitizer:** discoverable drop folder + per-provider mirror ([772eda5](https://github.com/ManotLuijiu/pi-harness-runtime/commit/772eda5c5c698572a1cef2dc93df0278e9a380ee))

### Bug Fixes

* harden auto-resume after compaction ([13378e8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/13378e852c984ead0e66f0adeffc073ff58af50c))
* resume after output-limit error stops ([8c75a24](https://github.com/ManotLuijiu/pi-harness-runtime/commit/8c75a2432082c4f9ba6296ffe2d04b636863bf2f))

### [0.9.3](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.5.0-beta.1...v0.9.3) (2026-07-14)

### Bug Fixes

* auto-resume pi dev with literal resume ([#51](https://github.com/ManotLuijiu/pi-harness-runtime/issues/51)) ([fd98762](https://github.com/ManotLuijiu/pi-harness-runtime/commit/fd987629f6062a4a7ff7a28d9dfb607962f5a4a9))

### [0.9.7](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.5...v0.9.7) (2026-07-16)

### Bug Fixes

* harden auto-resume after compaction ([13378e8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/13378e852c984ead0e66f0adeffc073ff58af50c))
* resume after output-limit error stops ([8c75a24](https://github.com/ManotLuijiu/pi-harness-runtime/commit/8c75a2432082c4f9ba6296ffe2d04b636863bf2f))

### [0.9.3](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.5.0-beta.1...v0.9.3) (2026-07-14)

### Bug Fixes

* auto-resume pi dev with literal resume ([#51](https://github.com/ManotLuijiu/pi-harness-runtime/issues/51)) ([fd98762](https://github.com/ManotLuijiu/pi-harness-runtime/commit/fd987629f6062a4a7ff7a28d9dfb607962f5a4a9))

### [0.9.6](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.5...v0.9.6) (2026-07-16)

### Bug Fixes

* harden auto-resume after compaction ([13378e8](https://github.com/ManotLuijiu/pi-harness-runtime/commit/13378e852c984ead0e66f0adeffc073ff58af50c))

### [0.9.3](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.5.0-beta.1...v0.9.3) (2026-07-14)

### Bug Fixes

* auto-resume pi dev with literal resume ([#51](https://github.com/ManotLuijiu/pi-harness-runtime/issues/51)) ([fd98762](https://github.com/ManotLuijiu/pi-harness-runtime/commit/fd987629f6062a4a7ff7a28d9dfb607962f5a4a9))

### [0.9.5](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.9.4...v0.9.5) (2026-07-15)

### Features

* add 15 packages from subagent batch + test expansions ([c82d898](https://github.com/ManotLuijiu/pi-harness-runtime/commit/c82d898277779886cdd1f7f42087698762becde3))
* add 4 adapter packages for Day 3 (RFC-0067-0070) ([f1e3a6f](https://github.com/ManotLuijiu/pi-harness-runtime/commit/f1e3a6f1c8b4e1bdaeeb1de0ec4b4353baf48012))
* add 4 packages for Day 4 (RFC-0074, 0078, 0079, 0092) ([c252195](https://github.com/ManotLuijiu/pi-harness-runtime/commit/c252195728141dfea9767caea0de95ed425857c3))
* add 5 new packages (RFC-0010-0014) + test expansions ([b552c6f](https://github.com/ManotLuijiu/pi-harness-runtime/commit/b552c6fa0bd03c231e3afe8e4f59c29b3f8a6d99))
* add 5 packages for RFCs 0019-0023 ([30da266](https://github.com/ManotLuijiu/pi-harness-runtime/commit/30da266f5bf247eb3c9cad85ee8653e6e88ff844))
* add 6 framework plugins (RFC-0061-0066) ([51b7a79](https://github.com/ManotLuijiu/pi-harness-runtime/commit/51b7a79e576a5d9f5782dd2cd66d1509c0d14485))
* add package metadata for auth, scheduler, shared-context, token-estimation ([67e2621](https://github.com/ManotLuijiu/pi-harness-runtime/commit/67e26211633f01de4f0d5eca76abc4d40d1ee0ea))
* flesh out RFC 71-75 specs + fix codex-adapter LSP types ([38b8643](https://github.com/ManotLuijiu/pi-harness-runtime/commit/38b86438ef45f75d1c34caf5b4f401d29c76d44d))

### Bug Fixes

* auto-resume after compaction and output limits ([0cff2bc](https://github.com/ManotLuijiu/pi-harness-runtime/commit/0cff2bcf9035a699496e2726b74a1576863cf82e))

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
* **release:** remove redundant Bump version step — was double-bumping version (0.7.1->0.8.0) when tag pushed ([413ad6d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/413ad6d49356ec62b94e9a4e09d3475ef39bebd6))

## [0.9.0](https://github.com/ManotLuijiu/pi-harness-runtime/compare/v0.7.1...v0.9.0) (2026-07-13)

### Features

* **release:** add synced-workspace release script ([617649d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/617649d0b2227ebb4355eec4979b0c65822d60e3))

### Bug Fixes

* **release:** remove redundant Bump version step — was double-bumping version (0.7.1->0.8.0) when tag pushed ([413ad6d](https://github.com/ManotLuijiu/pi-harness-runtime/commit/413ad6d49356ec62b94e9a4e09d3475ef39bebd6))

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

* **Project rename**: `pi-usage-status` -> `pi-harness-runtime`
  * npm package name: `pi-usage-status` -> `pi-harness-runtime`
  * Repository: `ManotLuijiu/pi-usage-status` -> `ManotLuijiu/pi-harness-runtime`
  * Bundled skill: `usage-status` -> `harness-runtime` (file path `skills/usage-status/` -> `skills/harness-runtime/`)
  * Status bar key: `usage-status` -> `harness-runtime`
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
