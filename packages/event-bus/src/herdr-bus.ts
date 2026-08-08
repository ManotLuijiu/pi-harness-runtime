/**
 * HerdrEventBus — File-based cross-process event bus for herdr tabs.
 *
 * Uses JSONL files in a shared workspace so separate pi processes
 * (coding agent, review agent, etc.) can communicate.
 *
 * Architecture:
 *   Workspace (shared dir)
 *   ├── events.jsonl          # Append-only event log
 *   ├── subscriptions/       # Per-agent subscription markers
 *   └── payloads/             # Event payload files
 *
 * Flow:
 *   1. Agent publishes event → append to events.jsonl + write payload
 *   2. Other agents poll events.jsonl → process matching events
 *   3. Each agent tracks last-read offset in subscriptions/{agentId}.json
 */

import { randomUUID } from "crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "fs";
import { join } from "path";
import type { EventPayload } from "./types.js";

interface LogEvent {
	eventId: string;
	topic: string;
	data?: unknown;
	_byteOffset: number;
}

// ─── Config ──────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 2_000; // 2s poll
// Suppress stack traces — only show error message to keep TUI clean
const logError = (err: unknown) =>
	console.error(
		`[herdr:bus] Error: ${err instanceof Error ? err.message : String(err)}`,
	);
const MAX_EVENTS_PER_POLL = 50;
const PAYLOADS_DIR = "payloads";
const SUBSCRIPTIONS_DIR = "subscriptions";

export interface HerdrBusConfig {
	workspace: string;
	pollIntervalMs?: number;
	agentId: string;
}

export interface HerdrSubscription {
	id: string;
	topic: string;
	lastOffset: number; // bytes read from events.jsonl
	filter?: (data: unknown) => boolean;
}

// ─── HerdrEventBus ────────────────────────────────────────────────────

export class HerdrEventBus {
	private readonly workspace: string;
	private readonly agentId: string;
	private readonly pollIntervalMs: number;
	private readonly subscriptions = new Map<string, HerdrSubscription>();
	private polling = false;
	private pollTimer?: ReturnType<typeof setInterval>;

	constructor(config: HerdrBusConfig) {
		this.workspace = config.workspace;
		this.agentId = config.agentId;
		this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.ensureDirs();
	}

	// ─── Setup ────────────────────────────────────────────────────────

	private ensureDirs(): void {
		const dirs = [
			this.workspace,
			join(this.workspace, PAYLOADS_DIR),
			join(this.workspace, SUBSCRIPTIONS_DIR),
		];
		for (const dir of dirs) {
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		}
	}

	// ─── Subscribe ────────────────────────────────────────────────────

	subscribe(topic: string, filter?: (data: unknown) => boolean): string {
		const id = randomUUID();
		this.subscriptions.set(id, {
			id,
			topic,
			lastOffset: 0,
			filter,
		});
		this.saveSubscriptions();
		return id;
	}

	unsubscribe(id: string): void {
		this.subscriptions.delete(id);
		this.saveSubscriptions();
	}

	// ─── Publish ──────────────────────────────────────────────────────

	publish<T>(topic: string, data: T): string {
		const eventId = randomUUID();
		const payload: EventPayload<T> = {
			topic,
			data,
			timestamp: new Date().toISOString(),
			eventId,
			source: this.agentId,
		};

		// Write payload file
		const payloadPath = join(this.workspace, PAYLOADS_DIR, `${eventId}.json`);
		writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

		// Append event reference to log
		const logLine =
			JSON.stringify({ eventId, topic, ts: payload.timestamp }) + "\n";
		appendFileSync(join(this.workspace, "events.jsonl"), logLine);

		return eventId;
	}

	// ─── Poll ────────────────────────────────────────────────────────

	startPolling(
		handler: (payload: EventPayload<unknown>) => void | Promise<void>,
	): void {
		if (this.polling) return;
		this.polling = true;

		// Load last offsets from disk
		this.loadSubscriptions();

		this.pollTimer = setInterval(() => {
			this.pollEvents(handler).catch(logError);
		}, this.pollIntervalMs);
	}

	stopPolling(): void {
		this.polling = false;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	private async pollEvents(
		handler: (payload: EventPayload<unknown>) => void | Promise<void>,
	): Promise<void> {
		const logPath = join(this.workspace, "events.jsonl");
		if (!existsSync(logPath)) return;

		for (const [, sub] of this.subscriptions) {
			const events = this.readNewEvents(sub.lastOffset);
			let newOffset = sub.lastOffset;

			for (const event of events) {
				if (event.topic !== sub.topic) continue;
				if (sub.filter && !sub.filter(event.data)) continue;

				// Load full payload
				const payloadPath = join(
					this.workspace,
					PAYLOADS_DIR,
					`${event.eventId}.json`,
				);
				if (!existsSync(payloadPath)) continue;

				try {
					const payload = JSON.parse(
						readFileSync(payloadPath, "utf-8"),
					) as EventPayload<unknown>;
					// Skip own events
					if (payload.source === this.agentId) continue;
					await handler(payload);
					newOffset = event._byteOffset;
				} catch {
					// skip malformed payload
				}
			}

			// Update offset
			if (newOffset > sub.lastOffset) {
				sub.lastOffset = newOffset;
			}
		}

		this.saveSubscriptions();
	}

	private readNewEvents(fromOffset: number): LogEvent[] {
		const logPath = join(this.workspace, "events.jsonl");
		if (!existsSync(logPath)) return [];

		const content = readFileSync(logPath, "utf-8");
		const lines = content
			.split("\n")
			.filter((line): line is string => line.trim() !== "");
		const events: LogEvent[] = [];

		let offset = 0;
		for (const line of lines) {
			offset += line.length + 1; // +1 for newline
			if (offset <= fromOffset) continue;
			if (events.length >= MAX_EVENTS_PER_POLL) break;

			try {
				const parsed = JSON.parse(line) as Record<string, unknown>;
				events.push(parsed as unknown as LogEvent);
			} catch {
				// skip malformed lines
			}
		}

		return events;
	}

	// ─── Persistence ─────────────────────────────────────────────────

	private subscriptionsPath(): string {
		return join(this.workspace, SUBSCRIPTIONS_DIR, `${this.agentId}.json`);
	}

	private saveSubscriptions(): void {
		const path = this.subscriptionsPath();
		const data = Object.fromEntries(this.subscriptions);
		writeFileSync(path, JSON.stringify(data, null, 2));
	}

	private loadSubscriptions(): void {
		const path = this.subscriptionsPath();
		if (!existsSync(path)) return;

		try {
			const data = JSON.parse(readFileSync(path, "utf-8")) as Record<
				string,
				HerdrSubscription
			>;
			for (const [id, sub] of Object.entries(data)) {
				this.subscriptions.set(id, sub);
			}
		} catch {
			// ignore
		}
	}

	// ─── Query ──────────────────────────────────────────────────────

	getSubscribedTopics(): string[] {
		return [...new Set([...this.subscriptions.values()].map((s) => s.topic))];
	}

	getWorkspace(): string {
		return this.workspace;
	}
}

// ─── Factory ────────────────────────────────────────────────────────────────

const HERDR_WORKSPACE = "/tmp/herdr-workspace";

export function getHerdrWorkspace(): string {
	if (!existsSync(HERDR_WORKSPACE)) {
		mkdirSync(HERDR_WORKSPACE, { recursive: true });
	}
	return HERDR_WORKSPACE;
}

export function createHerdrBus(agentId: string): HerdrEventBus {
	return new HerdrEventBus({
		workspace: getHerdrWorkspace(),
		agentId,
		pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
	});
}

// ─── Workspace Management ────────────────────────────────────────────────────

export interface HerdrWorkspace {
	root: string;
	code: string;
	reviews: string;
	payloads: string;
	subscriptions: string;
}

export function getHerdrWorkspacePaths(): HerdrWorkspace {
	const root = getHerdrWorkspace();
	return {
		root,
		code: join(root, "code"),
		reviews: join(root, "reviews"),
		payloads: join(root, "payloads"),
		subscriptions: join(root, "subscriptions"),
	};
}

export function ensureHerdrWorkspace(): HerdrWorkspace {
	const paths = getHerdrWorkspacePaths();
	const dirs = [
		paths.root,
		paths.code,
		paths.reviews,
		paths.payloads,
		paths.subscriptions,
	];
	for (const dir of dirs) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}
	return paths;
}

export type LoopVerdict = "approved" | "changes_requested" | "blocked";

export interface LoopConfig {
	loopId: string;
	writeCount: number;
	reviewCount: number;
	prompt: string;
	nextReviewAfter: number;
	createdAt: string;
}

export interface CodeTickPayload {
	loopId: string;
	iteration: number;
	prompt: string;
}

export interface CodeWrittenPayload {
	loopId: string;
	iteration: number;
	files: string[];
	summary?: string;
}

export interface ReviewTickPayload {
	loopId: string;
	iteration: number;
	codeFiles: string[];
}

export interface ReviewCompletedPayload {
	loopId: string;
	iteration: number;
	verdict: LoopVerdict;
	message: string;
	reportFile: string;
}

export interface LoopEarlyExitPayload {
	loopId: string;
	reason: LoopVerdict;
	message: string;
}

export interface LoopFinishedPayload {
	loopId: string;
	summary: string;
	iterations: {
		writes: number;
		reviews: number;
		finalVerdict: LoopVerdict;
	};
}

// ─── Loop Event Publishers ────────────────────────────────────────────────────

export function publishLoopStarted(
	bus: HerdrEventBus,
	config: LoopConfig,
): string {
	return bus.publish("loop.started", config);
}

export function publishCodeTick(
	bus: HerdrEventBus,
	loopId: string,
	iteration: number,
	prompt: string,
): string {
	return bus.publish("code.tick", {
		loopId,
		iteration,
		prompt,
	} satisfies CodeTickPayload);
}

export function publishCodeWritten(
	bus: HerdrEventBus,
	loopId: string,
	iteration: number,
	files: string[],
	summary?: string,
): string {
	return bus.publish("code.written", {
		loopId,
		iteration,
		files,
		summary,
	} satisfies CodeWrittenPayload);
}

export function publishReviewTick(
	bus: HerdrEventBus,
	loopId: string,
	iteration: number,
	codeFiles: string[],
): string {
	return bus.publish("review.tick", {
		loopId,
		iteration,
		codeFiles,
	} satisfies ReviewTickPayload);
}

export function publishReviewCompleted(
	bus: HerdrEventBus,
	loopId: string,
	iteration: number,
	verdict: LoopVerdict,
	message: string,
	reportFile: string,
): string {
	return bus.publish("review.completed", {
		loopId,
		iteration,
		verdict,
		message,
		reportFile,
	} satisfies ReviewCompletedPayload);
}

export function publishLoopEarlyExit(
	bus: HerdrEventBus,
	loopId: string,
	reason: LoopVerdict,
	message: string,
): string {
	return bus.publish("loop.early_exit", {
		loopId,
		reason,
		message,
	} satisfies LoopEarlyExitPayload);
}

export function publishLoopFinished(
	bus: HerdrEventBus,
	loopId: string,
	summary: string,
	writes: number,
	reviews: number,
	finalVerdict: LoopVerdict,
): string {
	return bus.publish("loop.finished", {
		loopId,
		summary,
		iterations: { writes, reviews, finalVerdict },
	} satisfies LoopFinishedPayload);
}

// ─── Verdict Parser ──────────────────────────────────────────────────────────

const VERDICT_PATTERNS: Array<{ pattern: RegExp; verdict: LoopVerdict }> = [
	{ pattern: /^##\s*Verdict:\s*APPROVED/im, verdict: "approved" },
	{
		pattern: /^##\s*Verdict:\s*CHANGES_REQUESTED/im,
		verdict: "changes_requested",
	},
	{ pattern: /^##\s*Verdict:\s*CHANGES/i, verdict: "changes_requested" },
	{ pattern: /^##\s*Verdict:\s*BLOCKED/im, verdict: "blocked" },
	{ pattern: /^##\s*Verdict:\s*FAIL/im, verdict: "blocked" },
];

export function parseVerdict(content: string): LoopVerdict | null {
	for (const { pattern, verdict } of VERDICT_PATTERNS) {
		if (pattern.test(content)) return verdict;
	}
	return null;
}

export function parseVerdictMessage(content: string): string {
	// Extract the paragraph after ## Verdict: X
	const match = content.match(/^##\s*Verdict:\s*\w+\s*\n+(.+?)(?=^##|\n+$)/ms);
	return match ? match[1].trim().slice(0, 500) : content.slice(0, 200);
}

// ─── Simple Convenience Publishers (non-loop) ──────────────────────────────

export function publishCodeWrittenSimple(
	bus: HerdrEventBus,
	taskId: string,
	files: string[],
	branch?: string,
): string {
	return bus.publish("code.written", {
		taskId,
		files,
		branch,
	});
}

export function publishReviewRequestedSimple(
	bus: HerdrEventBus,
	taskId: string,
	codeTaskId: string,
): string {
	return bus.publish("review.requested", { taskId, codeTaskId });
}

export function publishReviewCompletedSimple(
	bus: HerdrEventBus,
	taskId: string,
	reportFile: string,
	status: "approved" | "changes_requested" | "failed",
): string {
	return bus.publish("review.completed", { taskId, reportFile, status });
}
