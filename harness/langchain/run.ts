/**
 * CLI runner for the LangChain write-review loop.
 *
 * Usage:
 *   # Run a single task
 *   bun run harness/langchain/run.ts --request "implement X"
 *
 *   # Run with dry-run (no API calls)
 *   bun run harness/langchain/run.ts --request "implement X" --dry-run
 *
 *   # Run with max iterations
 *   bun run harness/langchain/run.ts --request "implement X" --max-iterations 5
 *
 *   # Run as daemon (with watchers - configure sources in code)
 *   bun run harness/langchain/run.ts --daemon
 */

import { randomUUID } from "node:crypto";
import {
	buildDryRunDeps,
	buildRealLoopDeps,
	buildWriteReviewLoop,
} from "./graph.js";
import { loadKeys } from "../key-loader.js";
interface CliArgs {
	mode: "graph" | "supervisor";
	request: string;
	maxIterations: number;
	dryRun: boolean;
	daemon: boolean;
	telegramBotToken?: string;
	telegramChatId?: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		mode: "graph",
		request: "",
		maxIterations: 3,
		dryRun: false,
		daemon: false,
		telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
		telegramChatId: process.env.TELEGRAM_CHAT_ID,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--request" || arg === "-r") {
			args.request = argv[++i] ?? "";
		} else if (arg === "--dry-run") {
			args.dryRun = true;
		} else if (arg === "--daemon") {
			args.daemon = true;
		} else if (arg === "--max-iterations") {
			args.maxIterations = parseInt(argv[++i] ?? "3", 10);
		} else if (arg === "--mode") {
			args.mode = argv[++i] as "graph" | "supervisor";
		}
	}

	return args;
}

async function runGraphMode(args: CliArgs): Promise<void> {
	const loopId = `loop-${randomUUID().slice(0, 8)}`;
	const log = (msg: string) => console.log(`[${loopId}] ${msg}`);

	// Build deps
	const deps = await (args.dryRun
		? buildDryRunDeps({ maxIterations: args.maxIterations })
		: buildRealLoopDeps({
				maxIterations: args.maxIterations,
				request: args.request,
			}));

	// Create loop
	const loop = buildWriteReviewLoop(deps);

	// Run
	log(`Starting write-review loop (maxIterations=${args.maxIterations})`);

	try {
		const result = await loop.invoke(
			{ request: args.request },
			{ configurable: { thread_id: loopId }, recursionLimit: 50 },
		);
		log(`Loop completed! Final state: ${JSON.stringify(result, null, 2)}`);
	} catch (err) {
		console.error(`[${loopId}] Error:`, err);
		process.exit(1);
	}
}

async function runDaemonMode(_args: CliArgs): Promise<void> {
	console.log("Daemon mode - use --request to run a task or configure watchers");
	process.exit(0);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	// Load API keys
	loadKeys();

	if (!args.request && !args.daemon) {
		console.error("Usage: bun run harness/langchain/run.ts --request 'task description'");
		console.error("Options:");
		console.error("  --request, -r    Task description");
		console.error("  --dry-run        Run without API calls");
		console.error("  --max-iterations N  Max iterations (default: 3)");
		console.error("  --daemon         Run in daemon mode");
		process.exit(1);
	}

	if (args.daemon) {
		await runDaemonMode(args);
	} else {
		await runGraphMode(args);
	}
}

main().catch(console.error);
