/**
 * TrajectoryStore — persists Trajectory records to `~/.pi-harness/trajectories/`.
 *
 * Format: newline-delimited JSON (NDJSON), one Trajectory per line.
 * - Append-only writes (no locking needed for single-daemon writes)
 * - Grep-friendly for manual inspection
 * - Compact: no document overhead like JSON-array-with-commas
 *
 * File naming: `YYYY-MM/YYYY-MM-DD.ndjson`
 * - Daily rotation keeps files small and manageable
 * - Directory by month for easy archival
 *
 * Directory structure:
 *   ~/.pi-harness/trajectories/
 *     2025-07/
 *       2025-07-14.ndjson
 *       2025-07-15.ndjson
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
	Trajectory,
	TrajectorySummary,
	TrajectoryStats,
	TrajectoryClassification,
	TrajectoryLabel,
} from "./types.js";
export type {
	Trajectory,
	TrajectorySummary,
	TrajectoryStats,
	TrajectoryClassification,
	TrajectoryLabel,
} from "./types.js";

const DEFAULT_TRAJ_DIR = ".pi-harness/trajectories";

function getTrajDir(dir?: string): string {
	const base = dir ?? DEFAULT_TRAJ_DIR;
	// Absolute paths (starting with / or ~) are used as-is
	if (base.startsWith("/") || base.startsWith("~")) return base;
	return join(homedir(), base);
}

function getDatePath(dir: string, timestamp: Date = new Date()): { dir: string; file: string } {
	const y = timestamp.getFullYear();
	const m = String(timestamp.getMonth() + 1).padStart(2, "0");
	const d = String(timestamp.getDate()).padStart(2, "0");
	return {
		dir: join(dir, `${y}-${m}`),
		file: join(dir, `${y}-${m}`, `${y}-${m}-${d}.ndjson`),
	};
}

/** Ensure the directory and daily file exist. */
function ensureFile(file: string): void {
	mkdirSync(dirname(file), { recursive: true });
}

/** Parse a single NDJSON line, skipping malformed lines. */
function parseLine(line: string): Trajectory | null {
	try {
		return JSON.parse(line) as Trajectory;
	} catch {
		return null;
	}
}

/** Read all trajectory files for a given directory. */
function readTrajDir(dir: string): Trajectory[] {
	if (!existsSync(dir)) return [];
	const trajectories: Trajectory[] = [];
	for (const entry of readdirSync(dir)) {
		if (!entry.endsWith(".ndjson")) continue;
		const content = readFileSync(join(dir, entry), "utf8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			const t = parseLine(line);
			if (t) trajectories.push(t);
		}
	}
	return trajectories;
}

/**
 * TrajectoryStore — append-only persistence for write-review cycle records.
 *
 * Usage:
 * ```ts
 * const store = new TrajectoryStore();
 *
 * // At cycle start
 * const id = store.start("fix the login bug");
 *
 * // At cycle finish
 * store.append({
 *   id,
 *   taskRequest: "fix the login bug",
 *   createdAt: new Date(startMs).toISOString(),
 *   durationMs: Date.now() - startMs,
 *   iterations: 2,
 *   verdict: "approved",
 *   reason: "reviewer approved",
 *   plan: "...",
 *   code: "...",
 *   files: ["auth.ts"],
 *   comments: [],
 *   summary: "looks good",
 *   classified: false,
 * });
 * ```
 */
export class TrajectoryStore {
	private readonly _trajDir: string;

	constructor(trajDir?: string) {
		this._trajDir = getTrajDir(trajDir);
	}

	/** List all trajectories, newest first. */
	list(): Trajectory[] {
		if (!existsSync(this._trajDir)) return [];

		const all: Trajectory[] = [];
		for (const monthDir of readdirSync(this._trajDir)) {
			const monthPath = join(this._trajDir, monthDir);
			if (!existsSync(monthPath)) continue;
			all.push(...readTrajDir(monthPath));
		}
		// Sort newest first
		all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return all;
	}

	/** Summaries only (lightweight list). */
	listSummaries(): TrajectorySummary[] {
		return this.list().map((t) => ({
			id: t.id,
			taskRequest: t.taskRequest,
			createdAt: t.createdAt,
			durationMs: t.durationMs,
			iterations: t.iterations,
			verdict: t.verdict,
			reason: t.reason,
			files: t.files,
			classified: t.classified,
		}));
	}

	/** Append a completed trajectory record. */
	append(trajectory: Trajectory): void {
		const { file } = getDatePath(this._trajDir, new Date(trajectory.createdAt));
		ensureFile(file);
		appendFileSync(file, JSON.stringify(trajectory) + "\n", "utf8");
	}

	/** Start a new trajectory — returns a UUID for the cycle. */
	start(_request: string): string {
		return randomUUID();
	}

	/** Build aggregate statistics. */
	stats(): TrajectoryStats {
		const all = this.list();
		if (all.length === 0) {
			return {
				total: 0,
				byVerdict: { approved: 0, blocked: 0, changes_requested: 0 },
				byLabel: { converged: 0, stuck: 0, blocked: 0, "max-iterations": 0 },
				avgIterations: 0,
				avgDurationMs: 0,
				byFile: {} as Record<string, number>,
			};
		}

		const byVerdict: TrajectoryStats["byVerdict"] = { approved: 0, blocked: 0, changes_requested: 0 };
		const byLabel: TrajectoryStats["byLabel"] = { converged: 0, stuck: 0, blocked: 0, "max-iterations": 0 };
		const byFile = {} as Record<string, number>;
		let totalIterations = 0;
		let totalDuration = 0;

		for (const t of all) {
			byVerdict[t.verdict] = (byVerdict[t.verdict] ?? 0) + 1;
			totalIterations += t.iterations;
			totalDuration += t.durationMs;

			// Derive label from reason string
			const label = classifyLabel(t);
			byLabel[label] = (byLabel[label] ?? 0) + 1;

			// Count files
			for (const file of t.files) {
				byFile[file] = (byFile[file] ?? 0) + 1;
			}
		}

		return {
			total: all.length,
			byVerdict,
			byLabel,
			avgIterations: Math.round(totalIterations / all.length),
			avgDurationMs: Math.round(totalDuration / all.length),
			byFile,
		};
	}

	/** Classify a single trajectory. */
	classify(trajectory: Trajectory): TrajectoryClassification {
		const label = classifyLabel(trajectory);
		let confidence = 0.9;
		let pattern: string | undefined;
		let recommendation: string;

		if (label === "converged") {
			recommendation =
				trajectory.iterations <= 2
					? "Fast convergence — good pattern"
					: "Slow but successful — consider review depth";
		} else if (label === "stuck") {
			confidence = 0.7;
			pattern = "same-file-repeated";
			recommendation =
				"Loop stuck on same file. Consider pre-flight file analysis or splitting the task.";
		} else if (label === "max-iterations") {
			recommendation =
				"Hit iteration cap. Increase maxIterations or simplify the task scope.";
		} else {
			recommendation = "Reviewer blocked — escalate to human.";
		}

		return { trajectoryId: trajectory.id, label, confidence, pattern, recommendation };
	}

	/** Get trajectories by verdict (for training set building). */
	byVerdict(verdict: Trajectory["verdict"]): Trajectory[] {
		return this.list().filter((t) => t.verdict === verdict);
	}
}

/** Derive a TrajectoryLabel from a Trajectory's reason string. */
function classifyLabel(t: Trajectory): TrajectoryLabel {
	const r = t.reason.toLowerCase();
	if (r.includes("converged")) return "converged";
	if (r.includes("max iterations")) return "max-iterations";
	if (r.includes("stuck")) return "stuck";
	if (t.verdict === "blocked") return "blocked";
	return "converged"; // fallback
}

/** Singleton factory — one store per process. */
let _store: TrajectoryStore | undefined;
export function getTrajectoryStore(): TrajectoryStore {
	if (!_store) _store = new TrajectoryStore();
	return _store;
}
export function resetTrajectoryStore(): void {
	_store = undefined;
}
