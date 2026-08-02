/**
 * Write-Review Loop Types
 *
 * State machine for two-agent write-review coordination.
 */

/**
 * Review phases
 */
export type ReviewPhase =
  | "idle"
  | "writing"
  | "pending_review"
  | "reviewing"
  | "approved"
  | "blocked"
  | "changes_requested";

/**
 * Review verdict
 */
export type Verdict = "approved" | "changes_requested" | "blocked";

/**
 * Blackboard status record
 */
export interface WriteReviewStatus {
  projectPath: string;
  phase: ReviewPhase;
  writerDone: boolean;
  writerMessage?: string;
  iteration: number;
  verdict?: Verdict;
  verdictMessage?: string;
  reviewerStarted?: string;  // ISO timestamp
  codeFiles?: string[];     // Files written
  changesRequested?: string[];  // Changes needed
  approvedAt?: string;     // ISO timestamp
  blockedAt?: string;      // ISO timestamp
  updatedAt: string;
  createdAt: string;
}

/**
 * Review trigger context
 */
export interface ReviewTriggerContext {
  projectPath: string;
  promptFile: string;
  promptContent: string;
  triggerType: "wiki_read" | "manual" | "code_written";
}

/**
 * Extension config
 */
export interface WriteReviewConfig {
  debug?: boolean;
  blackboardDir?: string;  // Default: "{project}/.write-review"
  wikiDir?: string;        // Default: "{project}/wiki"
  enabled?: boolean;
}

/**
 * Agent roles
 */
export const AGENT_ROLES = {
  WRITER: "writer",      // Minimax - reads wiki, writes code
  REVIEWER: "reviewer",  // Uses pi-subagents review-loop
  HELPER: "helper",     // worker - notes tasks to todo
} as const;

export type AgentRole = typeof AGENT_ROLES[keyof typeof AGENT_ROLES];

/**
 * State transition helpers
 */
export function isTerminalPhase(phase: ReviewPhase): boolean {
  return phase === "approved" || phase === "blocked";
}

export function needsReview(phase: ReviewPhase): boolean {
  return phase === "pending_review" || phase === "reviewing";
}

export function canWrite(phase: ReviewPhase): boolean {
  return phase === "idle" || phase === "writing" || phase === "changes_requested";
}
