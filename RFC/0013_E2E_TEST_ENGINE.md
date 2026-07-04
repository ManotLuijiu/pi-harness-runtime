# RFC 0013 - E2E Test Engine

## Purpose
Define browser-based end-to-end testing before work is marked ready for client.

## Core Rule
No client-ready status without required E2E scenarios passing or being explicitly waived by the human.

## Motivation
E2E testing is expensive because it requires environment readiness, login/session handling, dummy data, browser navigation, screenshots, traces, cleanup, and failure repair.

## Runtime Stage
```text
code -> unit_test -> e2e_test -> review -> ready_for_client
```

## Tooling Modes
1. Scripted Playwright tests.
2. Playwright CLI / agent tool.
3. Hybrid: generate script from observed browser interaction.

## Artifact Layout
```text
harness/e2e/
  scenarios/
  test-data/
  reports/
  artifacts/screenshots/
  artifacts/traces/
  artifacts/videos/
```

## Failure Handling
```text
E2EFailed -> write report -> create repair task -> assign repair agent -> rerun E2E
```

## Acceptance Criteria
- Runtime can run E2E scenario.
- Runtime saves screenshot/trace paths.
- Runtime creates repair task from failed E2E.
- Runtime blocks ready_for_client on required E2E failure.
