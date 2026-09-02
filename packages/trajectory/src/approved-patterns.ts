/**
 * ApprovedPatternStore — tracks review patterns that have been approved.
 *
 * Once a reviewer approves code with a given comment, that comment pattern is
 * "learned" and the reviewer should not re-flag it in future sessions.
 *
 * Storage: `~/.pi-harness/approved-patterns.json`
 * Format: keyed by pattern-hash so lookup is O(1)
 *
 * Usage:
 * - Load patterns before each review → inject into reviewer prompt
 * - After "approved" verdict → call .approve() to persist new patterns
 */

import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const APPROVED_PATTERNS_FILE = ".pi-harness/approved-patterns.json";

export interface ApprovedPattern {
	hash: string;
	file?: string;
	comment: string;
	severity: string;
	approvedAt: string; // ISO
	approvalCount: number; // how many times this pattern was approved
}

interface ApprovedPatternStoreData {
	version: number;
	patterns: Record<string, ApprovedPattern>;
}

function getPatternsPath(): string {
	return join(homedir(), APPROVED_PATTERNS_FILE);
}

function defaultData(): ApprovedPatternStoreData {
	return { version: 1, patterns: {} };
}

function hashPattern(
	file: string | undefined,
	comment: string,
	severity: string,
): string {
	return createHash("sha256")
		.update(`${file ?? ""}|${comment}|${severity}`)
		.digest("hex")
		.slice(0, 16);
}

/** Singleton store for approved review patterns. */
export class ApprovedPatternStore {
	private readonly _path: string;
	private _data: ApprovedPatternStoreData;

	constructor(path?: string) {
		this._path = path ?? getPatternsPath();
		this._data = this._load();
	}

	private _load(): ApprovedPatternStoreData {
		if (!existsSync(this._path)) return defaultData();
		try {
			const raw = readFileSync(this._path, "utf8");
			return JSON.parse(raw) as ApprovedPatternStoreData;
		} catch {
			return defaultData();
		}
	}

	private _save(): void {
		mkdirSync(dirname(this._path), { recursive: true });
		// Atomic write: temp file + rename
		const tmp = `${this._path}.${Date.now()}.tmp`;
		writeFileSync(tmp, JSON.stringify(this._data, null, "\t"), "utf8");
		renameSync(tmp, this._path);
	}

	/** Check if a comment matches an approved pattern. Returns the pattern or null. */
	get(
		file: string | undefined,
		comment: string,
		severity: string,
	): ApprovedPattern | null {
		const hash = hashPattern(file, comment, severity);
		return this._data.patterns[hash] ?? null;
	}

	/** Record that a pattern was approved. Called after "approved" verdict. */
	approve(
		comments: Array<{ file?: string; comment: string; severity?: string }>,
	): void {
		const now = new Date().toISOString();
		let changed = false;
		for (const c of comments) {
			const sev = c.severity ?? "minor";
			const hash = hashPattern(c.file, c.comment, sev);
			const existing = this._data.patterns[hash];
			if (existing) {
				existing.approvalCount++;
				existing.approvedAt = now;
			} else {
				this._data.patterns[hash] = {
					hash,
					file: c.file,
					comment: c.comment,
					severity: sev,
					approvedAt: now,
					approvalCount: 1,
				};
			}
			changed = true;
		}
		if (changed) this._save();
	}

	/**
	 * Build a markdown section for injecting into the reviewer prompt.
	 * Lists previously-approved patterns so the reviewer can skip them.
	 */
	toMarkdown(): string {
		const patterns = Object.values(this._data.patterns);
		if (patterns.length === 0) return "";

		// Show the most recently approved first (top 20)
		const recent = patterns
			.sort((a, b) => b.approvalCount - a.approvalCount)
			.slice(0, 20);

		const lines = ["## Previously Approved Patterns", ""];
		for (const p of recent) {
			const file = p.file ? `\`${p.file}\`: ` : "";
			lines.push(
				`- ${file}${p.comment} [${p.severity}, approved ${p.approvalCount}x]`,
			);
		}
		lines.push("");
		lines.push(
			"Do NOT flag these patterns again — they were approved in previous reviews.",
		);
		return lines.join("\n");
	}

	/** Get count of known patterns. */
	get size(): number {
		return Object.keys(this._data.patterns).length;
	}

	/** Export all patterns as an array. */
	toArray(): ApprovedPattern[] {
		return Object.values(this._data.patterns);
	}

	/** Clear all patterns (for testing). */
	clear(): void {
		this._data = defaultData();
		this._save();
	}
}

/** Singleton. */
let _store: ApprovedPatternStore | undefined;
export function getApprovedPatternStore(): ApprovedPatternStore {
	if (!_store) _store = new ApprovedPatternStore();
	return _store;
}

export function resetApprovedPatternStore(): void {
	_store = undefined;
}
