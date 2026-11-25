/**
 * Deliver chunk/checkpoint guidance in an already-running inference.
 * This transforms context only: it never queues a message or starts a turn.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CompactCheckpoint } from "../packages/exploration-guard/dist/index.js";
import { contextFillPercent } from "./context-usage.ts";
import type { ResumeWorkState } from "./resume-scope.ts";

export const EXPLORATION_CHUNK_READS = 8;
export const EXPLORATION_CHUNK_TOKENS = 8_000;
export const EXPLORATION_CONTEXT_WARNING_PERCENT = 60;

interface CheckpointSource {
	compactCheckpoint(): CompactCheckpoint | null;
}

function identity(checkpoint: CompactCheckpoint): string {
	return JSON.stringify([
		checkpoint.workspace, checkpoint.sessionId, checkpoint.generation,
		checkpoint.phase, checkpoint.todoId,
	]);
}

const short = (value: string): string => value.slice(0, 400);

/** Bounded factual checkpoint; a list of reads is never presented as findings. */
export function explorationChunkText(checkpoint: CompactCheckpoint): string {
	const lines = [
		"[EXPLORATION CHECKPOINT] Continue only the current authorized request.",
		"Before another broad exploration batch, reconcile `todo list` and split the remaining work into small concrete items using the todo tool. Reuse existing items; do not create duplicates or pull in bd backlog work.",
		"Each implementation chunk needs one outcome, its target files, one unresolved question (if any), and a focused validation command. Keep only one chunk in_progress. Inspect only what that chunk needs; then implement it and run focused checks before exploring the next. Preserve the task's required phase order for review and final validation.",
		"Call exploration_checkpoint now with findings and source locations, remaining questions and the exact next action, including the active todo id. If evidence supports a change, make the smallest justified edit. Otherwise name the missing evidence and do a bounded investigation of that question; never edit merely to satisfy this reminder.",
		"Before compaction, save the active chunk and next action in its Todo description and exploration_checkpoint. After compaction, resume that chunk from the checkpoint; do not restart repository discovery. An unavailable Todo tool must be reported, not treated as an empty list.",
		`Observed coverage: ${checkpoint.readCount} reads, ${checkpoint.repeatCount} repeats; approximately ${checkpoint.estimatedTokens} exploration tokens. Coverage is not proof of understanding.`,
	];
	for (const finding of checkpoint.findings.slice(-6)) {
		lines.push(`Recorded finding: ${short(finding.statement)}${finding.locations?.length ? ` (${short(finding.locations.join(", "))})` : ""}`);
	}
	for (const hypothesis of checkpoint.hypotheses.filter((item) => item.rejected).slice(-4)) {
		lines.push(`Ruled out: ${short(hypothesis.statement)}`);
	}
	for (const question of checkpoint.openQuestions.slice(-4)) {
		lines.push(`Remaining question: ${short(question)}`);
	}
	if (checkpoint.nextAction) lines.push(`Saved next action: ${short(checkpoint.nextAction)}`);
	if (!checkpoint.findings.length && !checkpoint.nextAction) {
		lines.push("No semantic findings or next action were saved. Recover only the smallest missing evidence; do not assume the recorded reads explain the problem.");
	}
	if (checkpoint.references.length) {
		lines.push(`Recorded source references (revalidate before relying on stale findings): ${checkpoint.references.slice(-8).map((ref) => short(ref.path)).join(", ")}`);
	}
	return lines.join("\n");
}

/** Delivery watermarks survive compaction, which does not recreate this instance. */
export class ExplorationContextGuard {
	private key = "";
	private reads = 0;
	private tokens = 0;
	private pressureWarned = false;
	private restoreKey: string | null = null;

	compacted(checkpoint: CompactCheckpoint | null): void {
		this.restoreKey = checkpoint ? identity(checkpoint) : null;
	}

	prepare(checkpoint: CompactCheckpoint, percent?: number): string | undefined {
		const key = identity(checkpoint);
		if (key !== this.key) {
			this.key = key;
			this.reads = 0;
			this.tokens = 0;
			this.pressureWarned = false;
		}
		const restore = this.restoreKey === key;
		const chunkDue = checkpoint.readCount - this.reads >= EXPLORATION_CHUNK_READS ||
			checkpoint.estimatedTokens - this.tokens >= EXPLORATION_CHUNK_TOKENS;
		const pressure = percent !== undefined && percent >= EXPLORATION_CONTEXT_WARNING_PERCENT &&
			(checkpoint.readCount > 0 || checkpoint.estimatedTokens > 0) &&
			!this.pressureWarned;
		if (!restore && !chunkDue && !pressure) return undefined;
		return explorationChunkText(checkpoint);
	}

	delivered(checkpoint: CompactCheckpoint): void {
		this.reads = checkpoint.readCount;
		this.tokens = checkpoint.estimatedTokens;
		this.pressureWarned = true;
		this.restoreKey = null;
	}
}

export function registerExplorationContext(
	pi: ExtensionAPI,
	options: {
		current: () => CheckpointSource | null;
		workState: () => Promise<ResumeWorkState>;
		paused: () => boolean;
	},
): void {
	const guard = new ExplorationContextGuard();
	pi.on("session_compact", () => {
		guard.compacted(options.current()?.compactCheckpoint() ?? null);
	});
	pi.on("context", async (event, ctx): Promise<{ messages: typeof event.messages } | void> => {
		if (options.paused() || ctx.signal?.aborted || ctx.hasPendingMessages()) return;
		const source = options.current();
		const checkpoint = source?.compactCheckpoint();
		if (!checkpoint) return;
		const text = guard.prepare(checkpoint, contextFillPercent(ctx.getContextUsage()));
		if (!text || await options.workState() === "complete") return;
		// A user input/request replacement may have arrived during the read.
		const latest = options.current()?.compactCheckpoint();
		if (options.current() !== source || !latest || identity(latest) !== identity(checkpoint) ||
			options.paused() || ctx.signal?.aborted || ctx.hasPendingMessages()) return;
		guard.delivered(checkpoint);
		return {
			messages: [...event.messages, {
				role: "custom" as const,
				customType: "harness:exploration-chunk",
				content: text,
				display: false,
				timestamp: Date.now(),
			}],
		};
	});
}
