/**
 * Autonomous Review Agent — polls for code.written events and auto-triggers review.
 * Human on the loop, not in the loop.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
	createHerdrBus,
	ensureHerdrWorkspace,
	publishReviewCompletedSimple,
	publishReviewRequestedSimple,
} from "../packages/event-bus/src/herdr-bus.js";

const AGENT_ID = "review-agent";
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
// Suppress stack traces — only show error message to keep TUI clean
const logError = (err: unknown) =>
	console.error(`[${AGENT_ID}] Error: ${err instanceof Error ? err.message : String(err)}`);

type CodeWrittenPayload = { taskId: string; files: string[]; branch?: string };

async function runReview(
	bus: ReturnType<typeof createHerdrBus>,
	codePayload: CodeWrittenPayload,
): Promise<void> {
	const { taskId, files } = codePayload;
	const reportFile = join(
		ensureHerdrWorkspace().reviews,
		`${taskId}-review.md`,
	);
	console.log(`[${AGENT_ID}] Reviewing task ${taskId}, ${files.length} files`);

	try {
		publishReviewRequestedSimple(bus, taskId, taskId);

		const fileBlocks = await Promise.all(
			files.map(async (file) => {
				const content = existsSync(file)
					? readFileSync(file, "utf-8").slice(0, 5000)
					: `[Not found: ${file}]`;
				return `## ${file}\n\n\`\`\`\n${content}\n\`\`\`\n`;
			}),
		);

		const report = `# Code Review — Task ${taskId}
## Files: ${files.join(", ")}

> Auto-generated. GPT review tab fills this in.

${fileBlocks.join("\n")}
`;
		writeFileSync(reportFile, report);
		console.log(`[${AGENT_ID}] Report: ${reportFile}`);
		publishReviewCompletedSimple(bus, taskId, reportFile, "changes_requested");

		// Wait for GPT tab to update
		await waitForGptReview(reportFile);
	} catch (err) {
		console.error(`[${AGENT_ID}] Review failed:`, err);
		publishReviewCompletedSimple(bus, taskId, reportFile, "failed");
	}
}

async function waitForGptReview(reportFile: string): Promise<void> {
	const deadline = Date.now() + REVIEW_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (existsSync(reportFile)) {
			const content = readFileSync(reportFile, "utf-8");
			if (!content.includes("Pending")) return;
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	console.log(`[${AGENT_ID}] GPT review timed out`);
}

async function main(): Promise<void> {
	console.log(`[${AGENT_ID}] Starting...`);
	const bus = createHerdrBus(AGENT_ID);
	ensureHerdrWorkspace();
	bus.subscribe("code.written");
	bus.startPolling(async (payload) => {
		if (payload.topic === "code.written") {
			const data = payload.data as CodeWrittenPayload;
			if (data.files?.length) runReview(bus, data).catch(logError);
		}
	});
	console.log(`[${AGENT_ID}] Workspace: ${bus.getWorkspace()}`);
	console.log(`[${AGENT_ID}] Polling for code.written...`);
}

main().catch(logError);
