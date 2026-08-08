/**
 * Herdr Agent Commands
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
	createHerdrBus,
	getHerdrWorkspacePaths,
	ensureHerdrWorkspace,
} from "../packages/event-bus/src/herdr-bus.js";

// Suppress stack traces — only show error message to keep TUI clean
const logError = (err: unknown) =>
	console.error(
		`[herdr] Error: ${err instanceof Error ? err.message : String(err)}`,
	);

async function startReviewAgent(): Promise<void> {
	console.log("[herdr:review] Starting review agent...");
	const bus = createHerdrBus("review-agent");
	ensureHerdrWorkspace();
	bus.subscribe("code.written");
	bus.startPolling(async (payload) => {
		if (payload.topic === "code.written") {
			const data = payload.data as { taskId: string; files: string[] };
			console.log(
				`[herdr:review] code.written: task=${data.taskId} files=${data.files.length}`,
			);
			for (const file of data.files ?? []) {
				console.log(`[herdr:review] Reviewing: ${file}`);
			}
		}
	});
	console.log(`[herdr:review] Workspace: ${bus.getWorkspace()}`);
	await new Promise(() => {});
}

async function startCodeAgent(): Promise<void> {
	console.log("[herdr:code] Starting code agent...");
	const bus = createHerdrBus("code-agent");
	ensureHerdrWorkspace();
	bus.subscribe("review.completed");
	bus.startPolling(async (payload) => {
		if (payload.topic === "review.completed") {
			const data = payload.data as {
				taskId: string;
				reportFile: string;
				status: string;
			};
			console.log(
				`[herdr:code] Review done: task=${data.taskId} status=${data.status} report=${data.reportFile}`,
			);
		}
	});
	console.log(`[herdr:code] Workspace: ${bus.getWorkspace()}`);
	await new Promise(() => {});
}

function showStatus(): void {
	const paths = getHerdrWorkspacePaths();
	console.log(`Workspace: ${paths.root}`);
	const evPath = join(paths.root, "events.jsonl");
	if (existsSync(evPath)) {
		const lines = readFileSync(evPath, "utf-8")
			.split("\n")
			.filter(Boolean)
			.slice(-10);
		console.log("Recent events:");
		for (const line of lines) {
			try {
				const { topic, ts } = JSON.parse(line);
				console.log(`  ${ts} ${topic}`);
			} catch {
				/* skip */
			}
		}
	}
	if (existsSync(paths.subscriptions)) {
		const agents = readdirSync(paths.subscriptions);
		console.log(`Active agents: ${agents.join(", ") || "none"}`);
	}
}

const [command] = process.argv.slice(2);
switch (command) {
	case "review":
		startReviewAgent().catch(logError);
		break;
	case "code":
		startCodeAgent().catch(logError);
		break;
	case "status":
		showStatus();
		break;
	default:
		console.log("Usage: bun harness/herdr-agents.ts <review|code|status>");
}
