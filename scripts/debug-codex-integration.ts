#!/usr/bin/env bun
/**
 * Debug Codex Integration Script
 * 
 * Tests the PING-PONG Codex watcher pipeline:
 * 1. Checks if Codex sessions exist in ~/.codex/
 * 2. Tests classifyMessage() function
 * 3. Verifies CodexWatcher is finding sessions
 * 4. Shows PING-PONG decisions for found messages
 * 
 * Usage:
 *   bun run scripts/debug-codex-integration.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { classifyMessage } from "../packages/codex-watcher/dist/src/parser.js";
import { analyzePingPongDecision } from "../packages/intent-analyzer/dist/src/ping-pong.js";
import { scanCodebaseComplexity } from "../packages/intent-analyzer/dist/src/ping-pong.js";

const CODEX_DIR = join(homedir(), ".codex");
const SESSIONS_DIR = join(CODEX_DIR, "sessions");

console.log("=".repeat(60));
console.log("CODEX INTEGRATION DEBUG");
console.log("=".repeat(60));

// 1. Check Codex directory
console.log("\n[1] Checking Codex directory...");
if (!existsSync(CODEX_DIR)) {
    console.log(`   ❌ ~/.codex/ not found at ${CODEX_DIR}`);
    console.log("   → Install Codex CLI or set CODEX_DIR env var");
    process.exit(1);
}
console.log(`   ✓ ~/.codex/ exists at ${CODEX_DIR}`);

// 2. Check sessions directory
console.log("\n[2] Checking sessions directory...");
if (!existsSync(SESSIONS_DIR)) {
    console.log(`   ⚠️  ~/.codex/sessions/ not found`);
    console.log("   → No active Codex sessions yet");
} else {
    const years = readdirSync(SESSIONS_DIR).filter(f => /^\d{4}$/.test(f));
    console.log(`   ✓ Found ${years.length} year(s): ${years.join(", ")}`);
    
    let totalSessions = 0;
    let totalMessages = 0;
    
    for (const year of years) {
        const yearPath = join(SESSIONS_DIR, year);
        const months = readdirSync(yearPath).filter(f => /^\d{2}$/.test(f));
        
        for (const month of months) {
            const monthPath = join(SESSIONS_DIR, year, month);
            const days = readdirSync(monthPath).filter(f => /^\d{2}$/.test(f));
            
            for (const day of days) {
                const dayPath = join(SESSIONS_DIR, year, month, day);
                const files = readdirSync(dayPath).filter(f => f.includes("rollout") && f.endsWith(".jsonl"));
                totalSessions += files.length;
                
                for (const file of files) {
                    const content = readFileSync(join(dayPath, file), "utf8");
                    const lines = content.split("\n").filter(l => l.trim());
                    totalMessages += lines.length;
                }
            }
        }
    }
    
    console.log(`   ✓ Found ${totalSessions} session file(s) with ${totalMessages} message(s)`);
}

// 3. Test classifyMessage function
console.log("\n[3] Testing classifyMessage() function...");
const testMessages = [
    { text: "Let me implement the feature", expected: "plan" },
    { text: "I need to fix this bug", expected: "plan" },
    { text: "The code has an issue in the auth module", expected: "plan" },
    { text: "I will refactor the database layer", expected: "plan" },
    { text: "What is the current status?", expected: "other" },
    { text: "Show me the logs", expected: "other" },
    { text: "Let me explain the architecture", expected: "other" },
];

for (const { text, expected } of testMessages) {
    const result = classifyMessage(text);
    const icon = result === expected ? "✓" : "✗";
    console.log(`   ${icon} "${text.slice(0, 40)}..." → ${result} (expected: ${expected})`);
}

// 4. Find actual plan messages in sessions
console.log("\n[4] Scanning for plan messages in sessions...");
let planCount = 0;
const planMessages: Array<{ session: string; text: string; classification: string }> = [];

if (existsSync(SESSIONS_DIR)) {
    const scanDir = (dir: string, depth = 0) => {
        if (depth > 4 || planCount >= 10) return; // Limit scan
        
        try {
            const entries = readdirSync(dir);
            for (const entry of entries) {
                if (planCount >= 10) break;
                
                const fullPath = join(dir, entry);
                if (entry.endsWith(".jsonl") && entry.includes("rollout")) {
                    const content = readFileSync(fullPath, "utf8");
                    const lines = content.split("\n").filter(l => l.trim());
                    
                    for (const line of lines) {
                        try {
                            const msg = JSON.parse(line);
                            if (msg.text && typeof msg.text === "string") {
                                const cls = classifyMessage(msg.text);
                                if (cls === "plan") {
                                    planCount++;
                                    planMessages.push({
                                        session: entry,
                                        text: msg.text.slice(0, 100),
                                        classification: cls
                                    });
                                    if (planCount >= 10) break;
                                }
                            }
                        } catch {
                            // Ignore parse errors for non-JSON lines
                        }
                    }
                } else if (!entry.includes(".")) {
                    // Likely a directory, recurse
                    scanDir(fullPath, depth + 1);
                }
            }
        } catch {}
    };
    
    scanDir(SESSIONS_DIR);
}

if (planCount === 0) {
    console.log("   ⚠️  No plan messages found (Codex might not be running)");
} else {
    console.log(`   ✓ Found ${planCount} plan message(s):`);
    for (const msg of planMessages) {
        console.log(`     - [${msg.session}] "${msg.text}..."`);
    }
}

// 5. Test PING-PONG decision for sample messages
console.log("\n[5] Testing PING-PONG decisions for sample messages...");
const sampleRequests = [
    "Good plan, then write down plan to wiki/ then I will ask Minimax to write code then you review",
    "analyze why the loop is quiet, do not edit code",
    "implement user authentication with JWT tokens",
    "fix the memory leak in the worker process",
];

for (const request of sampleRequests) {
    const result = analyzePingPongDecision(request, {
        codebase: scanCodebaseComplexity(process.cwd())
    });
    console.log(`\n   Request: "${request.slice(0, 50)}..."`);
    console.log(`   Decision: ${result.decision}`);
    console.log(`   Score: ${result.score} (run>=9, suggest>=6)`);
    console.log(`   Reasons: ${result.reasons.slice(0, 3).join("; ")}`);
}

// 6. Summary
console.log("\n" + "=".repeat(60));
console.log("SUMMARY");
console.log("=".repeat(60));

const issues: string[] = [];

if (!existsSync(SESSIONS_DIR)) {
    issues.push("No sessions directory - Codex CLI not running or not set up");
}

if (planCount === 0) {
    issues.push("No plan messages found - Codex might not have generated any plans yet");
}

if (issues.length === 0) {
    console.log("✓ All checks passed!");
    console.log("\nTo verify PING-PONG is working:");
    console.log("  1. Start Codex CLI in one terminal: codex");
    console.log("  2. Ask Codex to make a plan (e.g., 'implement X')");
    console.log("  3. Check daemon logs for:");
    console.log("     [codex-watcher] Session started:");
    console.log("     [daemon] Ping-pong decision for [codex]:");
} else {
    console.log("⚠️  Issues found:");
    for (const issue of issues) {
        console.log(`  - ${issue}`);
    }
}

console.log("\nTo manually test PING-PONG:");
console.log("  1. Create a task file in /tmp/herdr-workspace/inbox/");
console.log("  2. Or use the API directly:");
console.log("     curl -X POST http://localhost:8100/api/ping-pong -d '{\"request\": \"implement X\"}'");
