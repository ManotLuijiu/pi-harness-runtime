/**
 * Loop Code Agent (Minimax) — receives code.tick events, writes code.
 *
 * Usage:
 *   bun harness/loop-code-agent.ts
 *
 * Subscribes to: code.tick, loop.early_exit, loop.finished
 * Publishes:     code.written
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
	createHerdrBus,
	ensureHerdrWorkspace,
	publishCodeWritten,
	type CodeTickPayload,
	type LoopEarlyExitPayload,
	type LoopFinishedPayload,
} from "../packages/event-bus/src/herdr-bus.js";

const AGENT_ID = "code-agent";

async function main(): Promise<void> {
	console.log(`[${AGENT_ID}] Starting...`);
	const bus = createHerdrBus(AGENT_ID);
	const paths = ensureHerdrWorkspace();

	bus.subscribe("loop.started");
	bus.subscribe("code.tick");
	bus.subscribe("loop.early_exit");
	bus.subscribe("loop.finished");

	let halted = false;

	bus.startPolling(async (payload) => {
		if (halted) return;

		switch (payload.topic) {
			case "code.tick": {
				const data = payload.data as CodeTickPayload;
				console.log(`[${AGENT_ID}] code.tick #${data.iteration}: ${data.prompt.slice(0, 80)}`);

				// Find the loop config
				let configFiles = (await import("fs"))
					.readdirSync(paths.root)
					.filter((f) => f.startsWith("loop-") && f.endsWith(".config.json"));

				let configLoopId: string | null = null;
				for (const cf of configFiles) {
					try {
						const cfg = JSON.parse(
							readFileSync(join(paths.root, cf), "utf-8"),
						);
						if (cfg.loopId === data.loopId) {
							configLoopId = data.loopId;
							break;
						}
					} catch {
						// skip
					}
				}

				// Write code stub — replace with actual Minimax call
				const iteration = data.iteration;
				const outputDir = join(paths.code, data.loopId);
				if (!existsSync(outputDir)) {
					(require("fs") as typeof import("fs")).mkdirSync(outputDir, {
						recursive: true,
					});
				}

				const codeFile = join(outputDir, `iteration-${iteration}.ts`);
				const code = `// Iteration ${iteration} — ${data.prompt}
// This is a stub. Replace with actual Minimax code generation.
export const code = "iteration-${iteration}";
export const prompt = ${JSON.stringify(data.prompt)};
`;
				writeFileSync(codeFile, code);
				console.log(`[${AGENT_ID}] Wrote: ${codeFile}`);

				publishCodeWritten(bus, data.loopId, iteration, [codeFile], data.prompt);
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
				console.log(`[${AGENT_ID}] Loop finished: ${data.summary.slice(0, 100)}`);
				halted = true;
				break;
			}
		}
	});

	console.log(`[${AGENT_ID}] Polling workspace: ${bus.getWorkspace()}`);
	await new Promise(() => {});
}

main().catch(console.error);
