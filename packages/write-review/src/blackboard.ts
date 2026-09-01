/**
 * Write-Review Blackboard
 *
 * File-based coordination between writer and reviewer agents.
 * Location: {project}/.write-review/status.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { WriteReviewStatus, ReviewPhase, Verdict } from "./types.js";

const DEFAULT_DIR = ".write-review";
const STATUS_FILE = "status.json";

export class WriteReviewBlackboard {
	private readonly projectPath: string;
	private readonly dir: string;
	private status: WriteReviewStatus | null = null;

	constructor(projectPath: string, dir: string = DEFAULT_DIR) {
		this.projectPath = projectPath;
		this.dir = join(projectPath, dir);
	}

	/**
	 * Initialize a new write-review session
	 */
	init(): void {
		mkdirSync(this.dir, { recursive: true });
		this.status = {
			projectPath: this.projectPath,
			phase: "idle",
			writerDone: false,
			iteration: 0,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		this.save();
	}

	/**
	 * Load status from disk
	 */
	load(): WriteReviewStatus | null {
		const path = join(this.dir, STATUS_FILE);
		if (!existsSync(path)) {
			return null;
		}
		try {
			this.status = JSON.parse(readFileSync(path, "utf-8"));
			return this.status;
		} catch {
			return null;
		}
	}

	/**
	 * Save status to disk
	 */
	save(): void {
		if (!this.status) return;
		this.status.updatedAt = new Date().toISOString();
		mkdirSync(this.dir, { recursive: true });
		const path = join(this.dir, STATUS_FILE);
		writeFileSync(path, JSON.stringify(this.status, null, 2));
	}

	/**
	 * Get current status
	 */
	getStatus(): WriteReviewStatus | null {
		return this.status;
	}

	/**
	 * Start a new write session
	 */
	startWriting(): void {
		if (!this.status) this.init();
		this.status!.phase = "writing";
		this.status!.writerDone = false;
		this.status!.iteration++;
		this.save();
	}

	/**
	 * Mark writer as done
	 */
	writerDone(message?: string): void {
		if (!this.status) return;
		this.status.writerDone = true;
		this.status.writerMessage = message;
		this.status.phase = "pending_review";
		this.save();
	}

	/**
	 * Start reviewing
	 */
	startReview(): void {
		if (!this.status) return;
		this.status.phase = "reviewing";
		this.status.reviewerStarted = new Date().toISOString();
		this.save();
	}

	/**
	 * Record verdict
	 */
	setVerdict(verdict: Verdict, message?: string): void {
		if (!this.status) return;
		this.status.verdict = verdict;
		this.status.verdictMessage = message;

		switch (verdict) {
			case "approved":
				this.status.phase = "approved";
				this.status.approvedAt = new Date().toISOString();
				break;
			case "blocked":
				this.status.phase = "blocked";
				this.status.blockedAt = new Date().toISOString();
				break;
			case "changes_requested":
				this.status.phase = "changes_requested";
				break;
		}
		this.save();
	}

	/**
	 * Record code files written
	 */
	setCodeFiles(files: string[]): void {
		if (!this.status) return;
		this.status.codeFiles = files;
		this.save();
	}

	/**
	 * Record requested changes
	 */
	setChangesRequested(changes: string[]): void {
		if (!this.status) return;
		this.status.changesRequested = changes;
		this.save();
	}

	/**
	 * Get current phase
	 */
	getPhase(): ReviewPhase {
		return this.status?.phase ?? "idle";
	}

	/**
	 * Get iteration number
	 */
	getIteration(): number {
		return this.status?.iteration ?? 0;
	}

	/**
	 * Check if build is allowed
	 */
	canBuild(): boolean {
		return this.status?.phase === "approved";
	}

	/**
	 * Get blackboard directory path
	 */
	getPath(): string {
		return this.dir;
	}

	/**
	 * Reset to idle
	 */
	reset(): void {
		if (!this.status) return;
		this.status.phase = "idle";
		this.status.writerDone = false;
		this.status.verdict = undefined;
		this.status.verdictMessage = undefined;
		this.status.reviewerStarted = undefined;
		this.status.approvedAt = undefined;
		this.status.blockedAt = undefined;
		this.status.codeFiles = undefined;
		this.status.changesRequested = undefined;
		this.save();
	}

	/**
	 * Check if a review session exists for this project
	 */
	exists(): boolean {
		const path = join(this.dir, STATUS_FILE);
		return existsSync(path);
	}

	/**
	 * Export status as markdown for display.
	 * Injected into every agent prompt so each agent sees the shared scoreboard.
	 * Matches the pi-lens pattern: persistent artifact encountered naturally.
	 */
	toMarkdown(): string {
		if (!this.status) return "No active write-review session.";

		const {
			phase,
			iteration,
			verdict,
			verdictMessage,
			codeFiles,
			changesRequested,
		} = this.status;

		const verdictIcon =
			verdict === "approved"
				? "✅"
				: verdict === "blocked"
					? "⛔"
				: verdict === "changes_requested"
					? "🔄"
					: "⏳";

		const lines: string[] = [
			`## Write-Review Scoreboard`,
			``,
			`| Field | Value |`,
			`|-------|-------|`,
			`| Phase | ${verdictIcon} ${phase} |`,
			`| Iteration | ${iteration} |`,
			`| Verdict | ${verdict ?? "(none yet)"} |`,
		];

		if (verdictMessage) {
			lines.push(`| Summary | ${verdictMessage} |`);
		}

		if (codeFiles && codeFiles.length > 0) {
			lines.push(``, `### Code Files Written`);
			for (const file of codeFiles) {
				lines.push(`- ${file}`);
			}
		}

		if (changesRequested && changesRequested.length > 0) {
			lines.push(``, `### Changes Requested (${changesRequested.length})`);
			for (const change of changesRequested) {
				lines.push(`- ${change}`);
			}
		}

		return lines.join("\n");
	}

	/**
	 * Extract file paths from a fenced code block string.
	 * Looks for common patterns: ```path/to/file
	 */
	extractFilePaths(code: string): string[] {
		const files = new Set<string>();
		// Match ```<whitespace>path (with optional language tag)
		const fencedRe = /^```(?:\w+)?\s+([^\n]+)/gm;
		let match;
		while ((match = fencedRe.exec(code)) !== null) {
			const path = match[1]!.trim();
			// Skip if it looks like a filename with spaces (not a path)
			if (path && !path.includes(" ") && (path.includes("/") || path.includes("\\") || path.endsWith(".ts") || path.endsWith(".js") || path.endsWith(".tsx") || path.endsWith(".json") || path.endsWith(".md"))) {
				files.add(path);
			}
		}
		return [...files];
	}
}

/**
 * Create or get blackboard for project
 */
export function createBlackboard(
	projectPath: string,
	dir?: string,
): WriteReviewBlackboard {
	const bb = new WriteReviewBlackboard(projectPath, dir);
	if (bb.exists()) {
		bb.load();
	} else {
		bb.init();
	}
	return bb;
}
