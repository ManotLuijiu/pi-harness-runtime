/**
 * Loop Controller — orchestrates write-review loops.
 *
 * Human types /review-loop <write_count> <review_count> --prompt="..."
 * This script parses the args, creates the loop config, and orchestrates
 * code-agent + review-agent via the herdr event bus.
 *
 * Usage:
 *   bun harness/loop-controller.ts 3 2 --prompt="build a REST API"
 *
 * The controller is a state machine:
 *   init -> running -> [approved|blocked|finished]
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
	createHerdrBus,
	ensureHerdrWorkspace,
	publishCodeTick,
	publishReviewTick,
	publishLoopStarted,
	publishLoopFinished,
	publishLoopEarlyExit,
	type LoopConfig,
	type CodeWrittenPayload,
	type ReviewCompletedPayload,
	type LoopVerdict,
} from "../packages/event-bus/src/herdr-bus.js";

// ─── State Machine ─────────────────────────────────────────────────────────

interface LoopState {
	config: LoopConfig;
	currentWrite: number;
	currentReview: number;
	nextReviewAfter: number; // which write iteration triggers next review
	reviewIteration: number;
	executed: Set<string>; // eventIds we've processed
	halted: boolean;
	haltReason?: LoopVerdict;
}

function buildConfig(args: string[]): LoopConfig {
	const writeCount = parseInt(findArg(args, /^\d+$/) ?? "3", 10);
	const reviewCount = parseInt(findArg(args, /^\d+$/, 2) ?? "2", 10);
	const prompt = findArg(args, /--prompt=(.+)/)?.[1] ?? "No prompt provided";

	// Spread reviews evenly across writes
	const step = Math.max(1, Math.floor(writeCount / reviewCount));

	return {
		loopId: randomUUID(),
		writeCount,
		reviewCount,
		prompt,
		nextReviewAfter: step, // first review after write #step
		createdAt: new Date().toISOString(),
	};
}

function findArg(args: string[], pattern: RegExp, index = 0): string | undefined {
	for (const arg of args) {
		const m = String(arg).match(pattern);
		if (m) return index === 0 ? m[1] : m[index] ?? m[1];
	}
	return undefined;
}

// ─── Controller Logic ─────────────────────────────────────────────────────

async function runLoop(args: string[]): Promise<void> {
	const config = buildConfig(args);
	const paths = ensureHerdrWorkspace();

	console.log("=".repeat(60));
	console.log(`LOOP STARTED — ${config.loopId.slice(0, 8)}`);
	console.log(`  Writes:  ${config.writeCount}`);
	console.log(`  Reviews: ${config.reviewCount}`);
	console.log(`  Prompt:  ${config.prompt}`);
	console.log(`  Reviews after writes: ${config.nextReviewAfter}, ${config.nextReviewAfter * 2}, ...`);
	console.log("=".repeat(60));

	const bus = createHerdrBus(`loop-controller-${config.loopId.slice(0, 8)}`);

	// Write config to workspace so other agents can read it
	const configPath = join(paths.root, `loop-${config.loopId}.config.json`);
	writeFileSync(configPath, JSON.stringify(config, null, 2));

	const state: LoopState = {
		config,
		currentWrite: 0,
		currentReview: 0,
		nextReviewAfter: config.nextReviewAfter,
		reviewIteration: 0,
		executed: new Set(),
		halted: false,
	};

	// Subscribe to all loop events
	bus.subscribe("loop.started");
	bus.subscribe("code.written");
	bus.subscribe("review.completed");
	bus.subscribe("loop.early_exit");

	bus.startPolling(async (payload) => {
		if (state.halted) return;
		if (state.executed.has(payload.eventId)) return;
		state.executed.add(payload.eventId);

		switch (payload.topic) {
			case "loop.started": {
				// First agent to subscribe fires the first code.tick
				if (payload.source !== bus["agentId"]) {
					emitNextWrite(state, bus);
				}
				break;
			}

			case "code.written": {
				const data = payload.data as CodeWrittenPayload;
				if (data.loopId !== config.loopId) break;

				state.currentWrite = data.iteration;
				console.log(`[controller] code.written #${data.iteration} — ${data.files.length} files`);

				// Check if this write triggers a review
				if (data.iteration >= state.nextReviewAfter && state.currentReview < config.reviewCount) {
					state.reviewIteration++;
					state.currentReview = state.reviewIteration;
					state.nextReviewAfter += config.nextReviewAfter;

					console.log(`[controller] -> review.tick #${state.reviewIteration} (after write #${data.iteration})`);
					publishReviewTick(bus, config.loopId, state.reviewIteration, data.files);

					// If this was the last review trigger, emit final write ticks
				} else if (data.iteration < config.writeCount) {
					// More writes coming
				} else if (state.currentReview === 0) {
					// No reviews configured, just finish
				}
				break;
			}

			case "review.completed": {
				const data = payload.data as ReviewCompletedPayload;
				if (data.loopId !== config.loopId) break;

				console.log(`[controller] review.completed #${data.iteration} — ${data.verdict}`);

				switch (data.verdict) {
					case "approved":
						state.halted = true;
						state.haltReason = "approved";
						console.log(`[controller] APPROVED — early exit`);
						publishLoopEarlyExit(bus, config.loopId, "approved", data.message);
						emitLoopFinished(state, bus, `Approved after ${state.currentWrite} writes and ${state.currentReview} reviews.\n\n${data.message}`);
						break;

					case "blocked":
						state.halted = true;
						state.haltReason = "blocked";
						console.log(`[controller] BLOCKED — early exit`);
						publishLoopEarlyExit(bus, config.loopId, "blocked", data.message);
						emitLoopFinished(state, bus, `Blocked after ${state.currentWrite} writes and ${state.currentReview} reviews.\n\n${data.message}`);
						break;

					case "changes_requested":
						if (state.currentWrite < config.writeCount) {
							// Continue to next write
							emitNextWrite(state, bus);
						} else if (state.currentReview < config.reviewCount) {
							// Run remaining reviews
							state.reviewIteration++;
							state.currentReview = state.reviewIteration;
							console.log(`[controller] -> review.tick #${state.reviewIteration} (final)`);
							publishReviewTick(bus, config.loopId, state.reviewIteration, []);
						} else {
							// All done
							emitLoopFinished(state, bus, `Changes requested. Completed ${state.currentWrite} writes, ${state.currentReview} reviews.\n\n${data.message}`);
						}
						break;
				}
				break;
			}

			case "loop.early_exit": {
				const data = payload.data as { loopId: string; reason: LoopVerdict };
				if (data.loopId !== config.loopId) break;
				state.halted = true;
				break;
			}
		}
	});

	// Start the loop by publishing loop.started
	publishLoopStarted(bus, config);

	// Keep alive until halted
	await new Promise<void>((resolve) => {
		const check = setInterval(() => {
			if (state.halted) {
				clearInterval(check);
				setTimeout(resolve, 1000); // let final events settle
			}
		}, 1000);
	});
}

function emitNextWrite(state: LoopState, bus: ReturnType<typeof createHerdrBus>): void {
	if (state.currentWrite >= state.config.writeCount) return;
	state.currentWrite++;
	console.log(`[controller] -> code.tick #${state.currentWrite}`);
	publishCodeTick(bus, state.config.loopId, state.currentWrite, state.config.prompt);
}

function emitLoopFinished(state: LoopState, bus: ReturnType<typeof createHerdrBus>, summary: string): void {
	publishLoopFinished(
		bus,
		state.config.loopId,
		summary,
		state.currentWrite,
		state.currentReview,
		state.haltReason ?? (state.currentReview > 0 ? "changes_requested" : "blocked"),
	);

	// Write final report
	const paths = ensureHerdrWorkspace();
	const reportPath = join(paths.reviews, `loop-${state.config.loopId.slice(0, 8)}-final.md`);
	const report = `# Loop Result — ${state.config.loopId.slice(0, 8)}

## Config
- Writes: ${state.config.writeCount}
- Reviews: ${state.config.reviewCount}
- Prompt: ${state.config.prompt}

## Result
${summary}

## Iterations
- Writes completed: ${state.currentWrite}
- Reviews completed: ${state.currentReview}
${state.haltReason ? `- Final verdict: **${state.haltReason.toUpperCase()}**` : ""}
`;
	writeFileSync(reportPath, report);
	console.log(`[controller] Final report: ${reportPath}`);
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	console.log(`
Loop Controller — orchestrates write-review loops between agents.

Usage:
  bun harness/loop-controller.ts <write_count> <review_count> --prompt="..."

Example:
  bun harness/loop-controller.ts 3 2 --prompt="build a REST API with auth"

  Writes 3 times, reviews 2 times (after writes 3 and 6 in 6-write loop).
  Any write triggers:
    - APPROVED  -> stops immediately
    - BLOCKED   -> stops immediately
    - CHANGES   -> continues to next write

File output:
  /tmp/herdr-workspace/reviews/loop-<id>-final.md
`);
	process.exit(0);
}

const writeCount = parseInt(args[0], 10);
const reviewCount = parseInt(args[1] ?? "1", 10);

if (isNaN(writeCount) || writeCount < 1 || writeCount > 20) {
	console.error("write_count must be 1-20");
	process.exit(1);
}
if (isNaN(reviewCount) || reviewCount < 0 || reviewCount > 20) {
	console.error("review_count must be 0-20");
	process.exit(1);
}

runLoop(args).catch((err) => {
	console.error("[controller] Fatal:", err);
	process.exit(1);
});
