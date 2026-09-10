/**
 * Loop Review Agent (GPT) — coordinates via blackboard.
 *
 * Polls blackboard for nextAction where agentType="review".
 * Reviews code, writes verdict, updates node status.
 *
 * Usage:  bun harness/loop-review-agent.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
    ensureHerdrWorkspace,
    parseVerdict,
} from "../packages/event-bus/src/herdr-bus.js";
import { SharedBlackboard } from "./blackboard.js";
const AGENT_ID = "review-agent";
const AGENT_TYPE = "review";
const POLL_MS = 1000;
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
// Suppress stack traces — only show error message to keep TUI clean
const logError = (err) =>
    console.error(
        `[${AGENT_ID}] Error: ${err instanceof Error ? err.message : String(err)}`,
    );
async function main() {
    console.log(`[${AGENT_ID}] Starting...`);
    const paths = ensureHerdrWorkspace();
    // Find active loop config
    const loopId = await findActiveLoop(paths.root);
    if (!loopId) console.log(`[${AGENT_ID}] No active loop found. Waiting...`);
    const blackboard = new SharedBlackboard(loopId ?? "no-loop", paths.root);
    blackboard.load();
    blackboard.registerAgent(AGENT_ID, "Review Agent", "openai", "gpt-4o");
    blackboard.updateAgentStatus(AGENT_ID, "idle");
    console.log(
        `[${AGENT_ID}] Registered. Blackboard: ${blackboard.getPath()}`,
    );
    while (true) {
        await sleep(POLL_MS);
        blackboard.load();
        const record = blackboard.getRecord();
        if (!record) continue;
        if (record.jobId !== loopId) continue;
        // Check for early exit
        const earlyExit = checkEarlyExit(record);
        if (earlyExit) {
            console.log(`[${AGENT_ID}] Loop ended: ${earlyExit}`);
            break;
        }
        // Check nextAction for review agent
        const action = parseNextAction(record.nextAction);
        if (!action || action.agentType !== AGENT_TYPE) continue;
        // Claim the task
        const locked = blackboard.acquireLock(action.taskId, AGENT_ID);
        if (!locked) continue;
        blackboard.updateAgentStatus(AGENT_ID, "working", action.taskId);
        console.log(`[${AGENT_ID}] Claimed: ${action.taskId}`);
        // Handle report task
        if (action.taskId === "report") {
            await finishReport(blackboard, record);
            break;
        }
        // Do the review
        const verdict = await doReview(action, paths, record.jobId);
        // Update task status
        updateTaskStatus(blackboard, record, action.taskId, verdict);
        // Release and report
        blackboard.releaseLock(action.taskId, AGENT_ID);
        blackboard.writeReport({
            agentId: AGENT_ID,
            taskId: action.taskId,
            status: "success",
            message: verdict,
        });
        blackboard.updateAgentStatus(AGENT_ID, "idle");
        // Decide next action based on verdict
        if (verdict === "approved" || verdict === "blocked") {
            // Early exit — go to report
            blackboard.setNextAction(
                encodeNextAction({
                    taskId: "report",
                    agentType: "review",
                    iteration: 0,
                }),
            );
            console.log(
                `[${AGENT_ID}] ${verdict.toUpperCase()} — nextAction: report`,
            );
        } else {
            // Changes requested — continue to next write
            const nextWrite = getNextWriteTask(record, action.iteration);
            if (nextWrite) {
                blackboard.setNextAction(
                    encodeNextAction({
                        taskId: nextWrite,
                        agentType: "code",
                        iteration: getWriteIteration(nextWrite),
                        prompt: action.prompt,
                    }),
                );
                console.log(
                    `[${AGENT_ID}] CHANGES — nextAction: code ${nextWrite}`,
                );
            } else {
                blackboard.setNextAction({
                    taskId: "report",
                    agentType: "review",
                    iteration: 0,
                });
                console.log(`[${AGENT_ID}] CHANGES — nextAction: report`);
            }
        }
    }
}
// ─── Review Logic ────────────────────────────────────────────────────────
async function doReview(action, paths, loopId) {
    const reviewDir = join(paths.reviews, loopId);
    mkdirSync(reviewDir, { recursive: true });
    const reviewFile = join(reviewDir, `review-${action.iteration}.md`);
    // Read code files
    const codeBlocks = await Promise.all(
        (action.codeFiles ?? []).map(async (file) => {
            const content = existsSync(file)
                ? readFileSync(file, "utf-8").slice(0, 3000)
                : `[Not found: ${file}]`;
            return `## ${file}\n\n\`\`\`\n${content}\n\`\`\`\n`;
        }),
    );
    // Write review stub
    const review = `# Review — Iteration ${action.iteration}

> GPT tab: Edit this file and add your verdict at the bottom.
> Use: \`## Verdict: APPROVED\`, \`## Verdict: CHANGES_REQUESTED\`, or \`## Verdict: BLOCKED\`
> GPT tab has ${REVIEW_TIMEOUT_MS / 1000 / 60} minutes to complete.

${codeBlocks.join("\n")}
`;
    writeFileSync(reviewFile, review);
    console.log(`[${AGENT_ID}] Review stub: ${reviewFile}`);
    console.log(`[${AGENT_ID}] Waiting for GPT verdict...`);
    // Poll for verdict
    return await pollVerdict(reviewFile);
}
async function pollVerdict(reviewFile) {
    const deadline = Date.now() + REVIEW_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (existsSync(reviewFile)) {
            const content = readFileSync(reviewFile, "utf-8");
            const verdict = parseVerdict(content);
            if (verdict) return verdict;
        }
        await sleep(3000);
    }
    console.log(
        `[${AGENT_ID}] Verdict timeout — defaulting to CHANGES_REQUESTED`,
    );
    return "changes_requested";
}
async function finishReport(blackboard, record) {
    const reportNode = record.tasks.nodes["report"];
    reportNode.status = "done";
    blackboard.save();
    console.log(`[${AGENT_ID}] Report complete. Loop finished.`);
}
// ─── Helpers ────────────────────────────────────────────────────────────────
async function findActiveLoop(rootDir) {
    const { readdirSync } = await import("fs");
    try {
        const files = readdirSync(rootDir).filter(
            (f) => f.startsWith("loop-") && f.endsWith(".config.json"),
        );
        if (files.length > 0) {
            const config = JSON.parse(
                readFileSync(join(rootDir, files[0]), "utf-8"),
            );
            return config.loopId;
        }
    } catch {
        // no loop yet
    }
    return null;
}
function checkEarlyExit(record) {
    const reportNode = record.tasks.nodes["report"];
    if (
        reportNode &&
        (reportNode.status === "done" || reportNode.status === "blocked")
    ) {
        return reportNode.status === "done" ? "finished" : "blocked";
    }
    return null;
}
function updateTaskStatus(blackboard, record, taskId, verdict) {
    const node = record.tasks.nodes[taskId];
    if (node) {
        node.status = verdict === "blocked" ? "blocked" : "done";
        node.result = verdict;
        node.updatedAt = new Date().toISOString();
        blackboard.save();
    }
}
function encodeNextAction(action) {
    return {
        taskId: action.taskId,
        instruction: "LOOP:" + JSON.stringify(action),
        priority: "high",
        createdAt: new Date().toISOString(),
    };
}
function parseNextAction(nextAction) {
    if (!nextAction) return null;
    const a = nextAction;
    if (!a.taskId) return null;
    if (
        typeof a.instruction === "string" &&
        a.instruction.startsWith("LOOP:")
    ) {
        try {
            return JSON.parse(a.instruction.slice(5));
        } catch {
            return null;
        }
    }
    return null;
}
function getNextWriteTask(record, currentReviewIteration) {
    // After review N, next write is N+1
    const nextWrite = currentReviewIteration + 1;
    const taskId = `write-${nextWrite}`;
    if (
        record.tasks.nodes[taskId] &&
        record.tasks.nodes[taskId].status === "pending"
    ) {
        return taskId;
    }
    return null;
}
function getWriteIteration(taskId) {
    const m = taskId.match(/^write-(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
main().catch(logError);
//# sourceMappingURL=loop-review-agent.js.map
