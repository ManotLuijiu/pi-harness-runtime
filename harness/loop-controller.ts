/**
 * Loop Controller — blackboard-coordinated write-review loops.
 *
 * Human types /review-loop <write_count> <review_count> --prompt="..."
 * Controller creates blackboard, sets first nextAction, monitors progress.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { createHerdrBus, ensureHerdrWorkspace, publishLoopStarted,  type LoopConfig } from "../packages/event-bus/src/herdr-bus.js";
import { createBlackboard } from "./blackboard.js";
import { buildLoopTaskGraph, type LoopNextAction } from "./loop-types.js";
import type { SharedBlackboard } from "./blackboard.js";

function encodeNextAction(la: { taskId: string; agentType: string; iteration: number; prompt?: string; codeFiles?: string[] }) {
	return {
		taskId: la.taskId,
		instruction: "LOOP:" + JSON.stringify(la),
		priority: "high" as const,
		createdAt: new Date().toISOString(),
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ─── Monitor ────────────────────────────────────────────────────────────────

async function monitorLoop(blackboard: SharedBlackboard, loopId: string): Promise<void> {
	const paths = ensureHerdrWorkspace();

	while (true) {
		blackboard.load();
		const record = blackboard.getRecord();
		if (!record) { await sleep(500); continue; }

		// Check if report is done
		const reportNode = record.tasks.nodes["report"];
		if (reportNode?.status === "done") {
			const reviews = Object.values(record.tasks.nodes).filter(
				(n) => n.id.startsWith("review-") && n.status === "done",
			);
			const lastReview = reviews.sort(
				(a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
			)[0];
			const verdict = (lastReview as { result?: string }).result ?? "unknown";
			const summary = verdict !== "unknown"
				? `Verdict: ${verdict}`
				: "Loop completed";

			const reportPath = join(paths.reviews, `loop-${loopId.slice(0, 8)}-final.md`);
			writeFileSync(reportPath, `# Loop Result — ${loopId.slice(0, 8)}

## Result
${summary}

## Verdict: **${verdict.toUpperCase()}**
`);
			console.log(`[controller] VERDICT: ${verdict.toUpperCase()}`);
			console.log(`[controller] Report: ${reportPath}`);
			return;
		}

		// Check for blocked
		const blocked = Object.values(record.tasks.nodes).find((n) => n.status === "blocked");
		if (blocked) {
			const reportPath = join(paths.reviews, `loop-${loopId.slice(0, 8)}-final.md`);
			writeFileSync(reportPath, `# Loop Result — ${loopId.slice(0, 8)}

## Result
Blocked at: ${blocked.id}

## Verdict: **BLOCKED**
`);
			console.log(`[controller] VERDICT: BLOCKED (${blocked.id})`);
			return;
		}

		await sleep(500);
	}
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function runLoop(args: string[]): Promise<void> {
	const writeCount = parseInt(args[0] ?? "3", 10);
	const reviewCount = parseInt(args[1] ?? "2", 10);
	const prompt = (args.find((a) => a.startsWith("--prompt=")) ?? "").slice("--prompt=".length).replace(/^["']|["']$/g, "") || "No prompt";

	if (isNaN(writeCount) || writeCount < 1 || writeCount > 20) { console.error("write_count must be 1-20"); process.exit(1); }
	if (isNaN(reviewCount) || reviewCount < 0 || reviewCount > 20) { console.error("review_count must be 0-20"); process.exit(1); }

	const loopId = randomUUID();
	const paths = ensureHerdrWorkspace();
	const taskGraph = buildLoopTaskGraph(writeCount, reviewCount, loopId);

	console.log("=".repeat(60));
	console.log(`LOOP STARTED — ${loopId.slice(0, 8)}`);
	console.log(`  Writes: ${writeCount}  Reviews: ${reviewCount}`);
	console.log(`  Prompt: ${prompt}`);
	console.log("=".repeat(60));

	// Create blackboard
	const blackboard = createBlackboard(loopId, paths.root, taskGraph);
	console.log(`[controller] Blackboard: ${blackboard.getPath()}`);

	// Event bus for cross-process signaling
	const bus = createHerdrBus(`ctrl-${loopId.slice(0, 8)}`);

	// Save config
	// Clean old loop configs
	for (const f of (await import("fs")).readdirSync(paths.root)) {
		if (f.startsWith("loop-") && f.endsWith(".config.json")) {
			(await import("fs")).unlinkSync(join(paths.root, f));
		}
	}

	const config: LoopConfig = {
		loopId, writeCount, reviewCount, prompt,
		nextReviewAfter: Math.max(1, Math.floor(writeCount / (reviewCount || 1))),
		createdAt: new Date().toISOString(),
	};
	writeFileSync(join(paths.root, `loop-${loopId}.config.json`), JSON.stringify(config, null, 2));
	publishLoopStarted(bus, config);

	// Set first action: code agent writes iteration 1
	blackboard.setNextAction(encodeNextAction({
		taskId: "write-1",
		agentType: "code",
		iteration: 1,
		prompt,
	}));
	console.log("[controller] nextAction: code write-1");

	// Monitor until done
	await monitorLoop(blackboard, loopId);
}

// ─── CLI ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (!args.length || args[0] === "--help" || args[0] === "-h") {
	console.log("Usage: bun harness/loop-controller.ts <write_count> <review_count> --prompt=\"...\"\nExample: bun harness/loop-controller.ts 3 2 --prompt=\"build REST API\"");
	process.exit(0);
}

runLoop(args).catch((err) => { console.error("[controller] Fatal:", err); process.exit(1); });
