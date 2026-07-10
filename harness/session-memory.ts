/**
 * Session Memory — Persistent Knowledge Extraction
 *
 * Extracts key facts and decisions to persistent storage.
 * On resume, re-injects memory as context without re-sending full history.
 *
 * Based on the reference implementation's sessionMemoryCompact pattern.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompactableMessage } from "../packages/types/src/runtime-types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionMemory {
	jobId: string;
	extractedFacts: string[];
	decisions: Decision[];
	filesModified: FileReference[];
	testsStatus: TestResult[];
	artifacts: Record<string, string>;
	lastUpdated: string;
}

export interface Decision {
	text: string;
	rationale?: string;
	timestamp: string;
}

export interface FileReference {
	path: string;
	action: "created" | "modified" | "deleted";
	timestamp: string;
}

export interface TestResult {
	name: string;
	passed: boolean;
	timestamp: string;
}

// ─── Session Memory Manager ─────────────────────────────────────────────────

export class SessionMemoryManager {
	private memory: SessionMemory;
	private readonly memoryPath: string;
	private readonly maxFacts = 50;
	private readonly maxDecisions = 20;

	constructor(jobId: string, rootDir?: string) {
		this.memoryPath = join(
			rootDir ?? join(process.env.HOME ?? ".", ".pi", "harness", jobId),
			"session-memory.json",
		);

		this.memory = this.load() ?? {
			jobId,
			extractedFacts: [],
			decisions: [],
			filesModified: [],
			testsStatus: [],
			artifacts: {},
			lastUpdated: new Date().toISOString(),
		};
	}

	// ─── Public API ───────────────────────────────────────────────────────────

	/**
	 * Extract key facts from recent messages
	 */
	extractFacts(messages: CompactableMessage[]): void {
		for (const msg of messages) {
			const content = msg.content;

			// File creation patterns
			for (const match of content.matchAll(
				/(?:created|created file|created module):?\s*([^\n.]+)/gi,
			)) {
				if (match[1]) {
					this.addFileReference(match[1].trim(), "created");
				}
			}

			// File modification patterns
			for (const match of content.matchAll(
				/(?:modified|updated|changed):?\s*([^\n.]+)/gi,
			)) {
				if (match[1] && !/(?:file|module|code)/i.test(match[0])) {
					this.addFileReference(match[1].trim(), "modified");
				}
			}

			// Test result patterns
			for (const match of content.matchAll(
				/(?:test|spec):?\s*([^\n.]+)\s*(passed|failed|pass|fail)/gi,
			)) {
				if (match[1] && match[2]) {
					this.addTestResult(match[1].trim(), /^pass$/i.test(match[2]));
				}
			}

			// Decision patterns
			for (const match of content.matchAll(
				/(?:decided|choosing|chose|decision|approach|using):?\s*([^\n.]+)/gi,
			)) {
				if (match[1] && match[1].length > 10) {
					this.recordDecision(match[1].trim());
				}
			}

			// Key facts patterns
			for (const match of content.matchAll(
				/(?:important|key|note|facts?:)\s*([^\n]+)/gi,
			)) {
				if (match[1] && match[1].length > 20) {
					this.recordFact(match[1].trim());
				}
			}
		}

		this.memory.lastUpdated = new Date().toISOString();
		this.save();
	}

	/**
	 * Add a decision to memory
	 */
	recordDecision(text: string, rationale?: string): void {
		// Avoid exact duplicates
		if (this.memory.decisions.some((d) => d.text === text)) {
			return;
		}

		this.memory.decisions.push({
			text,
			rationale,
			timestamp: new Date().toISOString(),
		});

		// Trim to max
		if (this.memory.decisions.length > this.maxDecisions) {
			this.memory.decisions = this.memory.decisions.slice(-this.maxDecisions);
		}

		this.save();
	}

	/**
	 * Add a fact to memory
	 */
	recordFact(fact: string): void {
		// Avoid duplicates
		if (this.memory.extractedFacts.includes(fact)) {
			return;
		}

		this.memory.extractedFacts.push(fact);

		// Trim to max
		if (this.memory.extractedFacts.length > this.maxFacts) {
			this.memory.extractedFacts = this.memory.extractedFacts.slice(
				-this.maxFacts,
			);
		}

		this.save();
	}

	/**
	 * Add a file reference
	 */
	addFileReference(
		path: string,
		action: "created" | "modified" | "deleted",
	): void {
		// Avoid exact duplicates
		if (this.memory.filesModified.some((f) => f.path === path)) {
			return;
		}

		this.memory.filesModified.push({
			path,
			action,
			timestamp: new Date().toISOString(),
		});

		this.save();
	}

	/**
	 * Add a test result
	 */
	addTestResult(name: string, passed: boolean): void {
		this.memory.testsStatus.push({
			name,
			passed,
			timestamp: new Date().toISOString(),
		});
		this.save();
	}

	/**
	 * Store an artifact (e.g., generated code snippet)
	 */
	storeArtifact(key: string, content: string): void {
		this.memory.artifacts[key] = content;
		this.save();
	}

	/**
	 * Get memory for re-injection as context
	 */
	getMemoryForContext(): string {
		const parts: string[] = [];

		// Files modified
		if (this.memory.filesModified.length > 0) {
			parts.push("## Files Modified");
			for (const file of this.memory.filesModified.slice(-10)) {
				parts.push(`- [${file.action}] ${file.path}`);
			}
			parts.push("");
		}

		// Key decisions
		if (this.memory.decisions.length > 0) {
			parts.push("## Key Decisions");
			for (const decision of this.memory.decisions.slice(-5)) {
				parts.push(`- ${decision.text}`);
				if (decision.rationale) {
					parts.push(`  Reason: ${decision.rationale}`);
				}
			}
			parts.push("");
		}

		// Extracted facts
		if (this.memory.extractedFacts.length > 0) {
			parts.push("## Key Facts");
			for (const fact of this.memory.extractedFacts.slice(-10)) {
				parts.push(`- ${fact}`);
			}
			parts.push("");
		}

		// Test status
		if (this.memory.testsStatus.length > 0) {
			const passed = this.memory.testsStatus.filter((t) => t.passed).length;
			const total = this.memory.testsStatus.length;
			parts.push(`## Tests: ${passed}/${total} passed`);
			parts.push("");
		}

		if (parts.length === 0) {
			return "";
		}

		return ["## Session Memory", "", ...parts.slice(0, -1)].join("\n");
	}

	/**
	 * Get compact-worthy content (for session memory compaction)
	 */
	getCompactContent(): string {
		const lines: string[] = [];

		if (this.memory.filesModified.length > 0) {
			lines.push("Files modified:");
			for (const file of this.memory.filesModified) {
				lines.push(`  ${file.action}: ${file.path}`);
			}
		}

		if (this.memory.decisions.length > 0) {
			lines.push("Decisions:");
			for (const d of this.memory.decisions) {
				lines.push(`  - ${d.text}`);
			}
		}

		if (this.memory.extractedFacts.length > 0) {
			lines.push("Facts:");
			for (const f of this.memory.extractedFacts) {
				lines.push(`  - ${f}`);
			}
		}

		return lines.join("\n");
	}

	/**
	 * Get test summary
	 */
	getTestSummary(): string {
		const passed = this.memory.testsStatus.filter((t) => t.passed).length;
		const total = this.memory.testsStatus.length;
		return `${passed}/${total}`;
	}

	/**
	 * Check if all tests passed
	 */
	allTestsPassed(): boolean {
		return (
			this.memory.testsStatus.length > 0 &&
			this.memory.testsStatus.every((t) => t.passed)
		);
	}

	/**
	 * Clear memory (e.g., after successful task completion)
	 */
	clear(): void {
		this.memory.extractedFacts = [];
		this.memory.decisions = [];
		this.memory.filesModified = [];
		this.memory.testsStatus = [];
		this.memory.artifacts = {};
		this.memory.lastUpdated = new Date().toISOString();
		this.save();
	}

	/**
	 * Get raw memory object
	 */
	getMemory(): SessionMemory {
		return { ...this.memory };
	}

	/**
	 * Update from another memory object (for merge on resume)
	 */
	merge(other: Partial<SessionMemory>): void {
		if (other.extractedFacts) {
			for (const fact of other.extractedFacts) {
				if (!this.memory.extractedFacts.includes(fact)) {
					this.memory.extractedFacts.push(fact);
				}
			}
		}

		if (other.decisions) {
			for (const decision of other.decisions) {
				if (!this.memory.decisions.some((d) => d.text === decision.text)) {
					this.memory.decisions.push(decision);
				}
			}
		}

		if (other.filesModified) {
			for (const file of other.filesModified) {
				if (!this.memory.filesModified.some((f) => f.path === file.path)) {
					this.memory.filesModified.push(file);
				}
			}
		}

		this.memory.lastUpdated = new Date().toISOString();
		this.save();
	}

	// ─── Private Methods ──────────────────────────────────────────────────

	private load(): SessionMemory | null {
		if (!existsSync(this.memoryPath)) {
			return null;
		}
		try {
			return JSON.parse(readFileSync(this.memoryPath, "utf-8"));
		} catch {
			return null;
		}
	}

	private save(): void {
		const dir = this.memoryPath.substring(0, this.memoryPath.lastIndexOf("/"));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(
			this.memoryPath,
			JSON.stringify(this.memory, null, 2),
			"utf-8",
		);
	}
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a SessionMemoryManager for a job
 */
export function createSessionMemoryManager(
	jobId: string,
	rootDir?: string,
): SessionMemoryManager {
	return new SessionMemoryManager(jobId, rootDir);
}
