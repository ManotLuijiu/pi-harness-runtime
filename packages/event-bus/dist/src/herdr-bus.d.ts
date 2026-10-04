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
import type { EventPayload } from "./types.js";
export interface HerdrBusConfig {
    workspace: string;
    pollIntervalMs?: number;
    agentId: string;
}
export interface HerdrSubscription {
    id: string;
    topic: string;
    lastOffset: number;
    filter?: (data: unknown) => boolean;
}
export declare class HerdrEventBus {
    private readonly workspace;
    private readonly agentId;
    private readonly pollIntervalMs;
    private readonly subscriptions;
    private polling;
    private pollTimer?;
    constructor(config: HerdrBusConfig);
    private ensureDirs;
    subscribe(topic: string, filter?: (data: unknown) => boolean): string;
    unsubscribe(id: string): void;
    publish<T>(topic: string, data: T): string;
    startPolling(handler: (payload: EventPayload<unknown>) => void | Promise<void>): void;
    stopPolling(): void;
    private pollEvents;
    private readNewEvents;
    private subscriptionsPath;
    private saveSubscriptions;
    private loadSubscriptions;
    getSubscribedTopics(): string[];
    getWorkspace(): string;
}
export declare function getHerdrWorkspace(): string;
export declare function createHerdrBus(agentId: string): HerdrEventBus;
export interface HerdrWorkspace {
    root: string;
    code: string;
    reviews: string;
    payloads: string;
    subscriptions: string;
}
export declare function getHerdrWorkspacePaths(): HerdrWorkspace;
export declare function ensureHerdrWorkspace(): HerdrWorkspace;
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
export declare function publishLoopStarted(bus: HerdrEventBus, config: LoopConfig): string;
export declare function publishCodeTick(bus: HerdrEventBus, loopId: string, iteration: number, prompt: string): string;
export declare function publishCodeWritten(bus: HerdrEventBus, loopId: string, iteration: number, files: string[], summary?: string): string;
export declare function publishReviewTick(bus: HerdrEventBus, loopId: string, iteration: number, codeFiles: string[]): string;
export declare function publishReviewCompleted(bus: HerdrEventBus, loopId: string, iteration: number, verdict: LoopVerdict, message: string, reportFile: string): string;
export declare function publishLoopEarlyExit(bus: HerdrEventBus, loopId: string, reason: LoopVerdict, message: string): string;
export declare function publishLoopFinished(bus: HerdrEventBus, loopId: string, summary: string, writes: number, reviews: number, finalVerdict: LoopVerdict): string;
export declare function parseVerdict(content: string): LoopVerdict | null;
export declare function parseVerdictMessage(content: string): string;
export declare function publishCodeWrittenSimple(bus: HerdrEventBus, taskId: string, files: string[], branch?: string): string;
export declare function publishReviewRequestedSimple(bus: HerdrEventBus, taskId: string, codeTaskId: string): string;
export declare function publishReviewCompletedSimple(bus: HerdrEventBus, taskId: string, reportFile: string, status: "approved" | "changes_requested" | "failed"): string;
//# sourceMappingURL=herdr-bus.d.ts.map