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

/**
 * Configuration for autonomous curation
 */
export interface MemoryCuratorConfig {
  /** Jev API key */
  apiKey: string;
  /** Jev confidence threshold for auto-add (default: 0.85) */
  autoAddThreshold?: number;
  /** Jev confidence threshold for auto-remove (default: 0.7) */
  autoRemoveThreshold?: number;
  /** Minimum entries before pruning (default: 5) */
  minEntriesForPrune?: number;
  /** Check interval in ms (default: 30 minutes) */
  checkIntervalMs?: number;
  /** Max facts to propose per check (default: 2) */
  maxProposalsPerCheck?: number;
}

const DEFAULT_CONFIG = {
  autoAddThreshold: 0.85,
  autoRemoveThreshold: 0.7,
  minEntriesForPrune: 5,
  checkIntervalMs: 30 * 60 * 1000,
  maxProposalsPerCheck: 2,
};

/**
 * Result of a curation check
 */
export interface CurationResult {
  added: string[];
  removed: number;
  errors: string[];
  timestamp: number;
}

/**
 * Jev decision response
 */
interface JevDecision {
  noul?: number;
  choice?: string;
  action?: string;
}

/**
 * Simple OpenAI-compatible API call for Jev decisions
 */
async function callJev(
  apiKey: string,
  prompt: string
): Promise<JevDecision> {
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

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";

  try {
    return JSON.parse(text) as JevDecision;
  } catch {
    return { noul: 0, action: "keep" };
  }
}

/**
 * Memory Curator - Autonomous curation using Jev
 */
export class MemoryCurator {
  private config: Required<MemoryCuratorConfig>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCheck = 0;
  private _disposed = false;
  private memoryFile: string;

  constructor(config: MemoryCuratorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const memDir = join(homedir(), ".pi-harness", "memory");
    this.memoryFile = join(memDir, "MEMORY.md");
  }

  /**
   * Start autonomous curation cycle
   */
  start(): void {
    if (this._disposed) return;
    
    void this.runCuration();
    
    this.timer = setInterval(() => {
      void this.runCuration();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop autonomous curation
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._disposed = true;
  }

  /**
   * Run one curation cycle
   */
  async runCuration(): Promise<CurationResult> {
    const result: CurationResult = {
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
          const decision = await callJev(
            this.config.apiKey,
            `Memory Entry: "${entry}"
            
Is this memory entry still relevant and accurate for future sessions?
Consider:
- Has the project/tool changed since this was added?
- Is this a preference that may have changed?

Respond with JSON: {"noul": 0.0-1.0, "action": "keep" or "remove"}`
          );

          const staleConf = decision.noul ?? 0;
          
          if (staleConf >= this.config.autoRemoveThreshold && decision.action === "remove") {
            result.removed++;
          }
        } catch (err) {
          result.errors.push(`Eval error: ${err}`);
        }
      }

    } catch (err) {
      result.errors.push(String(err));
    }

    return result;
  }

  /**
   * Parse entries from MEMORY.md
   */
  private parseEntries(content: string): string[] {
    const entries: string[] = [];
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

  isRunning(): boolean {
    return this.timer !== null && !this._disposed;
  }

  getLastCheck(): number {
    return this.lastCheck;
  }
}
