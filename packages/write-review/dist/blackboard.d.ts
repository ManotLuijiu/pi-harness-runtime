/**
 * Write-Review Blackboard
 *
 * File-based coordination between writer and reviewer agents.
 * Location: {project}/.write-review/status.json
 */
import type { WriteReviewStatus, ReviewPhase, Verdict, PingPongDecisionSnapshot } from "./types.js";
export declare class WriteReviewBlackboard {
    private readonly projectPath;
    private readonly dir;
    private status;
    constructor(projectPath: string, dir?: string);
    /**
     * Initialize a new write-review session
     */
    init(): void;
    /**
     * Load status from disk
     */
    load(): WriteReviewStatus | null;
    /**
     * Save status to disk
     */
    save(): void;
    /**
     * Get current status
     */
    getStatus(): WriteReviewStatus | null;
    /**
     * Record the automatic decision that selected or skipped PING-PONG.
     * This is the durable middleware state shared by separate agent terminals.
     */
    recordPingPongDecision(snapshot: PingPongDecisionSnapshot): void;
    /**
     * Start a new write session
     */
    startWriting(): void;
    /**
     * Mark writer as done
     */
    writerDone(message?: string): void;
    /**
     * Start reviewing
     */
    startReview(): void;
    /**
     * Record verdict
     */
    setVerdict(verdict: Verdict, message?: string): void;
    /**
     * Record code files written
     */
    setCodeFiles(files: string[]): void;
    /**
     * Record requested changes
     */
    setChangesRequested(changes: string[]): void;
    /**
     * Get current phase
     */
    getPhase(): ReviewPhase;
    /**
     * Get iteration number
     */
    getIteration(): number;
    /**
     * Check if build is allowed
     */
    canBuild(): boolean;
    /**
     * Get blackboard directory path
     */
    getPath(): string;
    /**
     * Reset to idle
     */
    reset(): void;
    /**
     * Check if a review session exists for this project
     */
    exists(): boolean;
    /**
     * Export status as markdown for display.
     * Injected into every agent prompt so each agent sees the shared scoreboard.
     * Matches the pi-lens pattern: persistent artifact encountered naturally.
     */
    toMarkdown(): string;
    /**
     * Extract file paths from a fenced code block string.
     * Looks for common patterns: ```path/to/file
     */
    extractFilePaths(code: string): string[];
}
/**
 * Create or get blackboard for project
 */
export declare function createBlackboard(projectPath: string, dir?: string): WriteReviewBlackboard;
//# sourceMappingURL=blackboard.d.ts.map