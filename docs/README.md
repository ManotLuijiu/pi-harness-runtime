# pi-harness-runtime

Autonomous, quota-aware, resumable AI coding harness runtime for pi.dev.

This repository treats the AI coding agent as a runtime problem, not only a prompt-engineering problem.

## Day 1 Documents

- `PRD/00_PROJECT_RULES.md`
- `PRD/01_PROJECT_VISION.md`
- `PRD/02_GLOSSARY.md`

## Core Idea

Human gives requirement once. The runtime plans, assigns work to models, manages quotas, checkpoints progress, resumes after failure, reviews output, and prepares code for client review.

## Current Status

Draft specification package for architecture planning and initial implementation.

Day 3 adds runtime-brain RFCs and TypeScript code skeletons.

## RFCs

- RFC/0006_CHECKPOINT_MANAGER.md
- RFC/0007_SCHEDULER.md
- RFC/0008_PROVIDER_ROUTER.md
- RFC/0009_SHARED_CONTEXT.md

## Code

- packages/types/src/runtime-types.ts
- packages/checkpoint/src/checkpoint-manager.ts
- packages/scheduler/src/scheduler.ts
- packages/provider-router/src/provider-router.ts
- packages/shared-context/src/shared-context.ts

Day 4 adds autonomous-runtime architecture:

- RFC-0010 Context Window Manager
- RFC-0011 Shared Blackboard
- RFC-0012 Agent Handoff Protocol
- RFC-0013 E2E Test Engine
- RFC-0014 Project Detector and Test Data Engine

These RFCs solve the human bottleneck:

- context windows fill up before the job finishes
- GPT/Codex, MiniMax, and GLM need to know each other's task status
- E2E testing needs framework-aware dummy data

# Day5 Package
