/**
 * CLI runner for the LangChain write-review loop.
 *
 * Usage:
 *   bun harness/langchain/run.ts --mode graph --request "implement X" [--max-iterations 3]
 *   bun harness/langchain/run.ts --mode graph --request "implement X" --dry-run
 *   bun harness/langchain/run.ts --mode supervisor --request "implement X"
 *
 * --dry-run uses deterministic stubs — no API keys needed. Use it to verify
 * the whole loop machinery (plan → write → review → fix → approve).
 *
 * Wiki: wiki/multi-agent-langchain.md
 */
import { randomUUID } from "node:crypto";
import { buildDryRunDeps, buildRealLoopDeps, buildWriteReviewLoop, } from "./graph.js";
function parseArgs(argv) {
    const args = {
        mode: "graph",
        request: "",
        maxIterations: 3,
        dryRun: false,
        daemon: false,
    };
    // Normalize space-separated flags (--mode graph) into --mode=graph form
    const normalized = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const spaced = (arg === "--mode" || arg === "--request" || arg === "--max-iterations") &&
            argv[i + 1] !== undefined &&
            !argv[i + 1].startsWith("--");
        if (spaced) {
            normalized.push(`${arg}=${argv[i + 1]}`);
            i++;
        }
        else {
            normalized.push(arg);
        }
    }
    for (const arg of normalized) {
        if (arg.startsWith("--mode=")) {
            const mode = arg.slice("--mode=".length);
            if (mode !== "graph" && mode !== "supervisor") {
                throw new Error(`Unknown mode: ${mode} (expected graph|supervisor)`);
            }
            args.mode = mode;
        }
        else if (arg.startsWith("--request=")) {
            args.request = arg.slice("--request=".length);
        }
        else if (arg.startsWith("--max-iterations=")) {
            const n = Number.parseInt(arg.slice("--max-iterations=".length), 10);
            if (Number.isNaN(n) || n < 1 || n > 20) {
                throw new Error("--max-iterations must be 1-20");
            }
            args.maxIterations = n;
        }
        else if (arg === "--dry-run") {
            args.dryRun = true;
        }
        else if (arg === "--daemon") {
            args.daemon = true;
        }
        else if (arg === "--help" || arg === "-h") {
            console.log([
                "Usage: bun harness/langchain/run.ts [options]",
                "",
                "Options:",
                "  --mode=graph|supervisor   Loop style (default: graph)",
                '  --request="..."           The feature request',
                "  --max-iterations=N        Max write-review rounds (default: 3)",
                "  --dry-run                 Deterministic stubs, no API calls",
                "  --daemon                  Start as a long-running daemon (auto-trigger loop)",
            ].join("\n"));
            process.exit(0);
        }
        else {
            // Bare positional argument = request
            if (!args.request)
                args.request = arg;
        }
    }
    if (!args.request && !args.daemon) {
        throw new Error('A request is required: --request="..." or a bare string (or use --daemon to start the watcher)');
    }
    return args;
}
function printStep(step, state) {
    const labels = {
        plan: "🧭 GPT planner",
        write: "✍️  MiniMax coder",
        review: "🔍 GPT reviewer",
        finish: "🏁 finish",
    };
    const iter = state.iteration > 0 ? ` (iteration ${state.iteration})` : "";
    console.log(`  ${labels[step] ?? step}${iter}`);
}
async function runGraphLoop(args) {
    console.log(`\n━━━ Write-Review Loop (graph mode)${args.dryRun ? " — DRY RUN" : ""} ━━━`);
    console.log(`Request: ${args.request}\n`);
    const deps = args.dryRun
        ? buildDryRunDeps({ maxIterations: args.maxIterations, onStep: printStep })
        : await buildRealLoopDeps({
            maxIterations: args.maxIterations,
            onStep: printStep,
        });
    const loop = buildWriteReviewLoop(deps);
    const threadId = `loop-${randomUUID().slice(0, 8)}`;
    const finalState = await loop.invoke({ request: args.request }, { configurable: { thread_id: threadId } });
    console.log("\n─── Step log ───");
    for (const line of finalState.log)
        console.log(`  ${line}`);
    console.log("\n─── Verdict ───");
    const review = finalState.review;
    if (review) {
        console.log(`  ${review.verdict.toUpperCase()} — ${review.summary}`);
        if (review.comments.length > 0) {
            console.log("  Open comments:");
            for (const c of review.comments) {
                const file = c.file ? ` (${c.file})` : "";
                console.log(`   - [${c.severity ?? "n/a"}] ${c.comment}${file}`);
            }
        }
    }
    else {
        console.log("  (no review produced)");
    }
}
async function runSupervisor(args) {
    if (args.dryRun) {
        throw new Error("--dry-run is only supported for --mode=graph (supervisor needs real models)");
    }
    console.log("\n━━━ Write-Review Loop (supervisor mode) ━━━");
    console.log(`Request: ${args.request}\n`);
    const { createSupervisor, lastMessage } = await import("./agents.js");
    const supervisor = createSupervisor();
    const result = await supervisor.invoke({
        messages: [{ role: "user", content: args.request }],
    });
    console.log("\n─── Supervisor output ───");
    console.log(lastMessage(result));
}
async function runDaemon(args) {
    const { LoopDaemon } = await import("./daemon.js");
    const daemon = new LoopDaemon({
        maxIterations: args.maxIterations,
        dryRun: args.dryRun,
        sources: ["inbox", "bus"],
    });
    // Graceful shutdown on SIGTERM / SIGINT
    const shutdown = () => {
        daemon.stop();
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    daemon.start();
    // Keep the process alive
    await new Promise(() => { });
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.daemon) {
        await runDaemon(args);
    }
    else if (args.mode === "supervisor") {
        await runSupervisor(args);
    }
    else {
        await runGraphLoop(args);
    }
}
main().catch((err) => {
    console.error(`[run] Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
//# sourceMappingURL=run.js.map