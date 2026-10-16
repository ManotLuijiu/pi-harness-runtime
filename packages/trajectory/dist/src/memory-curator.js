/**
 * Memory Curator - Autonomous self-improvement for MEMORY.md
 *
 * Uses Jev to judge:
 * 1. Is this a stable fact worth adding to MEMORY.md?
 * 2. Is anything in MEMORY.md stale/outdated?
 *
 * Based on Hermes Agent's self-improvement pattern.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const DEFAULT_CONFIG = {
    autoAddThreshold: 0.85,
    autoRemoveThreshold: 0.7,
    minEntriesForPrune: 5,
    checkIntervalMs: 30 * 60 * 1000,
    maxProposalsPerCheck: 2,
};
/**
 * Simple OpenAI-compatible API call for Jev decisions
 */
async function callJev(apiKey, prompt) {
    const systemPrompt = "You are a memory curator. Evaluate facts and respond with confidence scores. Reply with JSON: {\"noul\": 0.0-1.0, \"action\": \"keep\" or \"remove\"}";
    const response = await fetch("https://api.typesafe.ai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: "system-one",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt },
            ],
            temperature: 0.1,
        }),
    });
    if (!response.ok) {
        throw new Error(`Jev API error: ${response.status}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    try {
        return JSON.parse(text);
    }
    catch {
        return { noul: 0, action: "keep" };
    }
}
/**
 * Memory Curator - Autonomous curation using Jev
 */
export class MemoryCurator {
    config;
    timer = null;
    lastCheck = 0;
    _disposed = false;
    memoryFile;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        const memDir = join(homedir(), ".pi-harness", "memory");
        this.memoryFile = join(memDir, "MEMORY.md");
    }
    /**
     * Start autonomous curation cycle
     */
    start() {
        if (this._disposed)
            return;
        void this.runCuration();
        this.timer = setInterval(() => {
            void this.runCuration();
        }, this.config.checkIntervalMs);
    }
    /**
     * Stop autonomous curation
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this._disposed = true;
    }
    /**
     * Run one curation cycle
     */
    async runCuration() {
        const result = {
            added: [],
            removed: 0,
            errors: [],
            timestamp: Date.now(),
        };
        if (this._disposed) {
            return result;
        }
        try {
            if (Date.now() - this.lastCheck < this.config.checkIntervalMs / 2) {
                return result;
            }
            this.lastCheck = Date.now();
            if (!existsSync(this.memoryFile)) {
                return result;
            }
            const content = readFileSync(this.memoryFile, "utf-8");
            const entries = this.parseEntries(content);
            for (const entry of entries) {
                try {
                    const decision = await callJev(this.config.apiKey, `Memory Entry: "${entry}"
            
Is this memory entry still relevant and accurate for future sessions?
Consider:
- Has the project/tool changed since this was added?
- Is this a preference that may have changed?

Respond with JSON: {"noul": 0.0-1.0, "action": "keep" or "remove"}`);
                    const staleConf = decision.noul ?? 0;
                    if (staleConf >= this.config.autoRemoveThreshold && decision.action === "remove") {
                        result.removed++;
                    }
                }
                catch (err) {
                    result.errors.push(`Eval error: ${err}`);
                }
            }
        }
        catch (err) {
            result.errors.push(String(err));
        }
        return result;
    }
    /**
     * Parse entries from MEMORY.md
     */
    parseEntries(content) {
        const entries = [];
        const lines = content.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(/^[-*]\s+(?:\[.+\]\s+)?(.+)/);
            if (match) {
                entries.push(match[1]);
            }
        }
        return entries;
    }
    isRunning() {
        return this.timer !== null && !this._disposed;
    }
    getLastCheck() {
        return this.lastCheck;
    }
}
//# sourceMappingURL=memory-curator.js.map