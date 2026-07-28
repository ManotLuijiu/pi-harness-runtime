/**
 * Loop Review Agent (GPT) — receives review.tick events, produces reviews.
 *
 * Usage:
 *   bun harness/loop-review-agent.ts
 *
 * Subscribes to: review.tick, loop.early_exit, loop.finished
 * Publishes:     review.completed
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
	createHerdrBus,
	ensureHerdrWorkspace,
	publishReviewCompleted,
	parseVerdict,
	parseVerdictMessage,
	type ReviewTickPayload,
	type LoopEarlyExitPayload,
	type LoopFinishedPayload,
	type LoopVerdict,
} from "../packages/event-bus/src/herdr-bus.js";

const AGENT_ID = "review-agent";
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
	console.log(`[${AGENT_ID}] Starting...`);
	const bus = createHerdrBus(AGENT_ID);
	const paths = ensureHerdrWorkspace();

	bus.subscribe("review.tick");
	bus.subscribe("loop.early_exit");
	bus.subscribe("loop.finished");

	let halted = false;

	bus.startPolling(async (payload) => {
		if (halted) return;

		switch (payload.topic) {
			case "review.tick": {
				const data = payload.data as ReviewTickPayload;
				console.log(`[${AGENT_ID}] review.tick #${data.iteration}: ${data.codeFiles.length} files`);

				// Read all code files
				const codeBlocks = await Promise.all(
					(data.codeFiles ?? []).map(async (file) => {
						const content = existsSync(file)
							? readFileSync(file, "utf-8").slice(0, 3000)
							: `[Not found: ${file}]`;
						return `## ${file}\n\n\`\`\`\n${content}\n\`\`\`\n`;
					}),
				);

				// Write review stub — replace with actual GPT call
				// GPT tab should write to the review file directly
				const reviewDir = join(paths.reviews, data.loopId);
				(require("fs") as typeof import("fs")).mkdirSync(reviewDir, {
					recursive: true,
				});
				const reviewFile = join(reviewDir, `review-${data.iteration}.md`);

				const review = `# Review — Iteration ${data.iteration}

> **TODO**: Replace this stub with actual GPT review.
> GPT tab should edit: ${reviewFile}
>
> The code agent wrote: ${data.codeFiles.length} file(s)

${codeBlocks.join("\n")}
`;
				writeFileSync(reviewFile, review);
				console.log(`[${AGENT_ID}] Review stub written: ${reviewFile}`);
				console.log(`[${AGENT_ID}] Waiting for GPT to fill in review...`);

				// Wait for GPT to update the review with verdict
				const verdict = await waitForVerdict(reviewFile);
				if (!verdict) {
					// No verdict found — default to changes_requested
					publishReviewCompleted(
						bus,
						data.loopId,
						data.iteration,
						"changes_requested",
						"No verdict found in review — defaulting to changes_requested",
						reviewFile,
					);
				} else {
					// Re-read the review content to extract message
					const verdictContent = existsSync(reviewFile)
						? readFileSync(reviewFile, "utf-8")
						: "";
					const message = parseVerdictMessage(verdictContent);

					publishReviewCompleted(
						bus,
						data.loopId,
						data.iteration,
						verdict,
						message,
						reviewFile,
					);
				}
				break;
			}

			case "loop.early_exit": {
				const data = payload.data as LoopEarlyExitPayload;
				console.log(`[${AGENT_ID}] Loop early exit: ${data.reason}`);
				halted = true;
				break;
			}

			case "loop.finished": {
				const data = payload.data as LoopFinishedPayload;
				console.log(`[${AGENT_ID}] Loop finished`);
				halted = true;
				break;
			}
		}
	});

	console.log(`[${AGENT_ID}] Polling workspace: ${bus.getWorkspace()}`);
	await new Promise(() => {});
}

async function waitForVerdict(reviewFile: string): Promise<LoopVerdict | null> {
	const deadline = Date.now() + REVIEW_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (existsSync(reviewFile)) {
			const content = readFileSync(reviewFile, "utf-8");
			const verdict = parseVerdict(content);
			if (verdict) return verdict;
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	console.log(`[${AGENT_ID}] Verdict timeout after ${REVIEW_TIMEOUT_MS / 1000}s`);
	return null;
}

main().catch(console.error);
