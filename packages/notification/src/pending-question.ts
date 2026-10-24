/**
 * Pending Question Controller
 * 
 * Manages pending questions that require human response.
 * Supports multiple channels (Telegram, LINE) and Jev evaluation.
 */

import { logWarn } from "./file-logger.js";

/**
 * Question kinds
 */
export type QuestionKind = 
  | "routine"      // "Should I continue?"
  | "approval"      // "Want me to implement X?"
  | "clarification" // "Do you mean X or Y?"
  | "explicit";     // Explicit approval required

/**
 * Question states
 */
export type QuestionState =
  | "pending"      // Waiting for response
  | "evaluating"   // Jev is evaluating
  | "resolved"     // User answered
  | "cancelled"    // Cancelled (e.g., session switch)
  | "expired";     // Timed out

/**
 * The typed outcome of a Jev evaluation.
 *
 * It is deliberately not the same shape as a human answer: an autonomous
 * decision is never reported as a user "yes".
 */
export type JevOutcome =
  | "approve"
  | "reject"
  | "wait"
  | "proceed_with_caution";

/** Who resolved the question. */
export type ResolutionSource = "user" | "jev" | "timeout";

/** The channel a human answer came from. */
export type ResolutionChannel = "telegram" | "line" | "pi";

/**
 * Channel delivery states
 */
export interface ChannelDeliveryState {
  delivered: boolean;
  deliveredAt?: Date;
  error?: string;
}

/**
 * Pending Question
 */
export interface PendingQuestion {
  /** Unique request ID for this question */
  requestId: string;
  /** Session ID */
  sessionId: string;
  /** Workspace path */
  workspacePath: string;
  /** Job ID if associated */
  jobId?: string;
  /** The question text */
  questionText: string;
  /** Question kind */
  kind: QuestionKind;
  /** Does the proposed action need an explicit human authorization? */
  requiresExplicitAuthorization?: boolean;
  /** Can the proposed action destroy or damage something? */
  destructive?: boolean;
  /** Can the proposed action be undone? */
  reversible?: boolean;
  /** Does the proposed action reach the outside world? */
  external?: boolean;
  /** The signals the risk facts were derived from. */
  riskSignals?: string[];
  /** Current state */
  state: QuestionState;
  /** When created */
  createdAt: Date;
  /** When evaluation is due (for Jev) */
  dueAt?: Date;
  /** When resolved */
  resolvedAt?: Date;
  /** Resolution: "yes", "no", "clarification", or undefined */
  resolution?: "yes" | "no" | "clarification";
  /** Who resolved it */
  resolvedBy?: ResolutionSource;
  /** The channel a human answer came from. Unset for a Jev resolution. */
  resolvedChannel?: ResolutionChannel;
  /** The Jev outcome, when the decision was autonomous. */
  jevOutcome?: JevOutcome;
  /** The short reason of the Jev decision. */
  jevReason?: string;
  /** Channel delivery states */
  deliveryState: {
    telegram?: ChannelDeliveryState;
    line?: ChannelDeliveryState;
  };
  /** Whether user was notified */
  userNotified: boolean;
  /** For deduplication: last notified question text */
  lastNotifiedQuestion?: string;
  /** State revision for deduplication */
  revision: number;
}

/**
 * Question detection result
 */
export interface DetectionResult {
  detected: boolean;
  questionText?: string;
  kind?: QuestionKind;
  isRoutine?: boolean;
}

/**
 * Jev evaluation result
 */
export interface JevDecision {
  action: "continue" | "wait" | "clarify" | "stop";
  reason: string;
  eligible: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Pending Question Controller
 */
export class PendingQuestionController {
  private questions: Map<string, PendingQuestion> = new Map();
  private currentQuestion: PendingQuestion | null = null;
  private jevDecisionCallback?: (question: PendingQuestion, decision: JevDecision) => void;
  private userAnswerCallback?: (question: PendingQuestion, answer: string) => void;
  private config: {
    evaluationDelayMs: number;
    jevEnabled: boolean;
  };

  constructor(config?: {
    evaluationDelayMs?: number;
    jevEnabled?: boolean;
  }) {
    this.config = {
      evaluationDelayMs: config?.evaluationDelayMs ?? 5 * 60 * 1000, // 5 minutes
      jevEnabled: config?.jevEnabled ?? true,
    };
  }

  /**
   * Set callback for Jev decisions
   */
  onJevDecision(callback: (question: PendingQuestion, decision: JevDecision) => void): void {
    this.jevDecisionCallback = callback;
  }

  /**
   * Set callback for user answers
   */
  onUserAnswer(callback: (question: PendingQuestion, answer: string) => void): void {
    this.userAnswerCallback = callback;
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
      return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

	/**
	 * Detect if text contains a question requiring response
	 */
	detectQuestion(text: string, _options?: {
		sessionId?: string;
		workspacePath?: string;
		jobId?: string;
	}
	): DetectionResult {
		// Find all question positions and extract each question sentence
		const questionPositions: Array<{ start: number; end: number; sentence: string }> = [];
		let searchFrom = 0;
		
		while (true) {
			const questionIndex = text.indexOf('?', searchFrom);
			if (questionIndex === -1) break;
			
			// Check if this question is inside quotes - if so, skip
			const beforeQuestion = text.substring(0, questionIndex);
			
			// Count unescaped quotes before and after
			const openQuotes = (beforeQuestion.match(/"/g) || []).length;
			const isInsideQuotes = openQuotes % 2 === 1;
			
			if (isInsideQuotes) {
				// This question is inside quotes - skip it
				searchFrom = questionIndex + 1;
				continue;
			}
			
			// Extract sentence for this question
			let sentenceStart = searchFrom;
			
			// Look backwards for sentence start
			for (let i = questionIndex - 1; i >= searchFrom; i--) {
				const char = text[i];
				if (char === '.' || char === '!' || char === '\n') {
					sentenceStart = i + 1;
					break;
				}
			}
			
			const sentence = text.substring(sentenceStart, questionIndex + 1).trim();
			questionPositions.push({ start: sentenceStart, end: questionIndex, sentence });
			searchFrom = questionIndex + 1;
		}
		
		// Check each question for approval/clarification first (priority)
		for (const q of questionPositions) {
			// Skip quoted questions
			if (this.isQuotedOrCode(text, q.sentence)) {
				continue;
			}
			
			const isRoutine = this.isRoutineContinuation(q.sentence);
			const kind = this.determineKind(q.sentence, isRoutine);
			
			// Return first approval or clarification question found
			if (kind === "approval" || kind === "clarification") {
				return {
					detected: true,
					questionText: q.sentence,
					kind,
					isRoutine,
				};
			}
		}
		
		// If no approval/clarification found, return first non-quoted routine question
		for (const q of questionPositions) {
			if (this.isQuotedOrCode(text, q.sentence)) {
				continue;
			}
			
			const isRoutine = this.isRoutineContinuation(q.sentence);
			
			return {
				detected: true,
				questionText: q.sentence,
				kind: "routine",
				isRoutine,
			};
		}
		
		// No question found - check for approval patterns without ?
		const approvalResult = this.checkApprovalPatterns(text);
		if (approvalResult) return approvalResult;
		
		return { detected: false };
	}
	
	/**
	 * Check for approval patterns in text without question mark
	 * Only triggers if the text is short and looks like a question (no example: prefix)
	 */
	private checkApprovalPatterns(text: string): DetectionResult | null {
		// Don't trigger on example/quotation text or code
		const lower = text.toLowerCase();
		if (/\b(example|such as|like this|for instance)\b/.test(lower)) {
			return null;
		}
		
		// Don't trigger on code blocks
		if (/```/.test(text)) {
			return null;
		}
		
		// Only trigger if text is reasonably short (likely a real question, not a paragraph)
		if (text.length > 200) {
			return null;
		}
		
		const approvalPatterns = [
			/\bwant me to\b/i,
			/\bwould you like me to\b/i,
			/\bshall i\b/i,
			/\bshould i add\b/i,
			/\bshould i implement\b/i,
			/\bshould we add\b/i,
			/\bshould we implement\b/i,
			/\bdo you want me to\b/i,
			/\bcan i (start|proceed|continue)\b/i,
		];
		
		for (const pattern of approvalPatterns) {
			if (pattern.test(text)) {
				return {
					detected: true,
					questionText: text.trim(),
					kind: "approval",
					isRoutine: false,
				};
			}
		}
		
		return null;
	}

  /**
   * Check if question is quoted or in code block
   */
  private isQuotedOrCode(fullText: string, question: string): boolean {
    // Normalize question for comparison - remove surrounding quotes if present
    let normalizedQuestion = question.trim();
		
    // Check if the question itself starts with a quote
    const startsWithQuote = normalizedQuestion.startsWith('"') || normalizedQuestion.startsWith("'");
    if (startsWithQuote) {
      return true;
    }
		
    // Check if question appears inside code block
    const codeBlockPattern = /```[\s\S]*?```/g;
    const codeBlocks = fullText.match(codeBlockPattern) || [];
    for (const block of codeBlocks) {
      // Check if the normalized question is inside this code block
      if (block.includes(normalizedQuestion)) {
        return true;
      }
    }
		
    // Check if the question text appears inside quotes in the original full text
    // This catches cases like: Here's an example: "Want me to implement this?"
    // where the extracted sentence is "Here's an example: "Want me to implement this?"
    // but we need to check if the CORE question is inside quotes
    const questionWithoutQ = normalizedQuestion.replace(/\?$/, '');
		
    // Look for the question text inside double quotes in the original text
    // Pattern: find "...question...?" or "...question..."
    const escapedQuestion = questionWithoutQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quotedQuestionPattern = new RegExp(`"[^"]*${escapedQuestion}[^"]*"`, 'i');
    if (quotedQuestionPattern.test(fullText)) {
      return true;
    }
		
    // Also check single quotes
    const singleQuotedPattern = new RegExp(`'[^']*${escapedQuestion}[^']*'`, 'i');
    if (singleQuotedPattern.test(fullText)) {
      return true;
    }
		
    return false;
  }

  /**
   * Determine question kind
   */
  private determineKind(question: string, isRoutine: boolean): QuestionKind {
    if (isRoutine) return "routine";
		
    const lower = question.toLowerCase();
		
    // Clarification patterns (check first - more specific)
    const clarifyPatterns = [
      /\bdo you mean\b/i,
      /\bwhich (one|option|approach)\b/i,
      /\bshould i use\b/i,
      /\bprefers?\b/i,
      /\bwhich (one|option)\b/i,
    ];
		
    for (const pattern of clarifyPatterns) {
      if (pattern.test(lower)) {
        return "clarification";
      }
    }
		
    // Explicit approval patterns (want me to, would you like me to, etc.)
    const approvalPatterns = [
      /\bwant me to\b/i,
      /\bwould you like me to\b/i,
      /\bshall i\b/i,
      /\bshould i add\b/i,
      /\bshould i implement\b/i,
      /\bshould we add\b/i,
      /\bshould we implement\b/i,
      /\bdo you want me to\b/i,
      /\bcan i (start|proceed|add|implement)\b/i,
    ];
		
    for (const pattern of approvalPatterns) {
      if (pattern.test(lower)) {
        return "approval";
      }
    }
		
    return "routine";
  }

  /**
   * Check if it's a routine continuation question
   */
  private isRoutineContinuation(question: string): boolean {
    const lower = question.toLowerCase();
		
    // Be specific - these patterns mean "continue with next task"
    // Don't match approval patterns like "Would you like me to add X next?"
    const routinePatterns = [
      /\bshould i continue/i,
      /\bshould we continue/i,
      /\bcan i continue/i,
      /\bcan we continue/i,
      /\bmay i continue/i,
      /\bshall i proceed/i,
      /\bshould i proceed/i,
      /^continue\?$/i,
      /^proceed\?$/i,
      /^next\?$/i,
      /\bshall we (proceed|continue)/i,
      /\bmay we (proceed|continue)/i,
      /\bcan i proceed/i,
      /\bshould i continue with/i,
      /\bcan i proceed with/i,
    ];
		
    for (const pattern of routinePatterns) {
      if (pattern.test(lower)) {
        return true;
      }
    }
		
    return false;
  }

  /**
   * Create a new pending question
   */
  createQuestion(params: {
    text: string;
    sessionId: string;
    workspacePath: string;
    jobId?: string;
    kind: QuestionKind;
    /** The deterministic risk facts of the proposed action. */
    risk?: {
      requiresExplicitAuthorization?: boolean;
      destructive?: boolean;
      reversible?: boolean;
      external?: boolean;
      signals?: string[];
    };
  }): PendingQuestion {
    const requestId = this.generateRequestId();
    
    const question: PendingQuestion = {
      requestId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      jobId: params.jobId,
      questionText: params.text,
      kind: params.kind,
      requiresExplicitAuthorization: params.risk?.requiresExplicitAuthorization,
      destructive: params.risk?.destructive,
      reversible: params.risk?.reversible,
      external: params.risk?.external,
      riskSignals: params.risk?.signals,
      state: "pending",
      createdAt: new Date(),
      dueAt: new Date(Date.now() + this.config.evaluationDelayMs),
      deliveryState: {},
      userNotified: false,
      revision: 1,
    };
    
    this.questions.set(requestId, question);
    this.currentQuestion = question;
    
    logWarn("[PendingQuestion]", `Created question ${requestId}: ${params.text.slice(0, 50)}...`);
    
    return question;
  }

  /**
   * Get current pending question
   */
  getCurrentQuestion(): PendingQuestion | null {
    return this.currentQuestion;
  }

  /**
   * Check if there's a pending question
   */
  hasPendingQuestion(): boolean {
    return this.currentQuestion !== null && 
           this.currentQuestion.state === "pending";
  }

  /**
   * Update delivery state for a channel
   */
  updateDeliveryState(
    channel: "telegram" | "line",
    delivered: boolean,
    error?: string
  ): void {
    if (!this.currentQuestion) return;
    
    this.currentQuestion.deliveryState[channel] = {
      delivered,
      deliveredAt: delivered ? new Date() : undefined,
      error,
    };
    
    if (delivered) {
      this.currentQuestion.userNotified = true;
    }
  }

  /**
   * Resolve the current question
   * @param params Resolution parameters including optional requestId to validate
   * @returns true if resolved, false if rejected (no question or ID mismatch)
   */
  resolve(params: {
    resolution: "yes" | "no" | "clarification";
    by: ResolutionSource;
    /** Optional requestId to validate (first-answer-wins) */
    requestId?: string;
    /** The channel a human answer came from. */
    channel?: ResolutionChannel;
  }): boolean {
    if (!this.currentQuestion) {
      logWarn("[PendingQuestion]", "No question to resolve - no pending question");
      return false;
    }

    // Validate requestId if provided (first-answer-wins enforcement)
    if (params.requestId !== undefined && params.requestId !== this.currentQuestion.requestId) {
      logWarn("[PendingQuestion]",
        `Request ID mismatch: callback=${params.requestId} current=${this.currentQuestion.requestId} - stale button ignored`);
      return false;
    }

    // Check if already resolved (prevent duplicate resolution)
    if (this.currentQuestion.state === "resolved") {
      logWarn("[PendingQuestion]",
        `Question already resolved as ${this.currentQuestion.resolution} - duplicate callback ignored`);
      return false;
    }

    this.currentQuestion.state = "resolved";
    this.currentQuestion.resolution = params.resolution;
    this.currentQuestion.resolvedBy = params.by;
    this.currentQuestion.resolvedAt = new Date();
    if (params.by === "user" && params.channel) {
      this.currentQuestion.resolvedChannel = params.channel;
    }

    logWarn("[PendingQuestion]", `Resolved question ${this.currentQuestion.requestId}: ${params.resolution} by ${params.by}`);

    // Notify callback. A Jev resolution is NOT a user answer: it must never
    // be dispatched as a synthetic "yes" into the conversation.
    if (params.by === "jev") {
      if (this.jevDecisionCallback) {
        this.jevDecisionCallback(this.currentQuestion, {
          action: "continue",
          reason: "resolved by jev",
          eligible: true,
        });
      }
    } else if (this.userAnswerCallback) {
      this.userAnswerCallback(this.currentQuestion, params.resolution);
    }

    return true;
  }

  /**
   * Resolve a question with an autonomous Jev decision.
   *
   * The question is closed with `resolvedBy: "jev"`, the outcome is recorded
   * and the Jev callback is notified. No user answer is dispatched: nobody
   * clicked anything.
   *
   * @returns true if the question was closed, false when it was stale or
   *   already answered by a human.
   */
  resolveByJev(
    requestId: string,
    outcome: JevOutcome,
    reason?: string,
  ): boolean {
    if (!this.currentQuestion) {
      logWarn("[PendingQuestion]", "No question to resolve - no pending question");
      return false;
    }

    if (this.currentQuestion.requestId !== requestId) {
      logWarn("[PendingQuestion]",
        `Jev resolution for an unknown request: ${requestId} (current=${this.currentQuestion.requestId})`);
      return false;
    }

    if (this.currentQuestion.state === "resolved") {
      logWarn("[PendingQuestion]",
        `Question already resolved as ${this.currentQuestion.resolution} - jev decision ignored`);
      return false;
    }

    this.currentQuestion.state = "resolved";
    this.currentQuestion.resolvedBy = "jev";
    this.currentQuestion.jevOutcome = outcome;
    this.currentQuestion.jevReason = reason;
    this.currentQuestion.resolvedAt = new Date();

    logWarn("[PendingQuestion]",
      `Closed question ${this.currentQuestion.requestId} with jev outcome ${outcome}`);

    if (this.jevDecisionCallback) {
      this.jevDecisionCallback(this.currentQuestion, {
        action: outcome === "reject" ? "stop" : outcome === "wait" ? "wait" : "continue",
        reason: reason ?? `jev:${outcome}`,
        eligible: true,
        metadata: { outcome },
      });
    }

    return true;
  }

  /**
   * Apply an approval action from a channel to the current question.
   *
   * The action names are the shared callback actions, so Telegram and LINE
   * use the same values and the same resolver. A stale request ID, a
   * duplicate click or a wrong session leaves the running wait untouched.
   */
  applyApproval(
    action: string,
    requestId: string,
    channel: ResolutionChannel,
  ): { applied: boolean; resolution?: "yes" | "no"; reason?: string } {
    if (action !== "approve" && action !== "reject") {
      return { applied: false, reason: `unknown action '${action}'` };
    }

    const resolution = action === "approve" ? "yes" : "no";
    const applied = this.resolve({ resolution, by: "user", requestId, channel });

    return applied
      ? { applied: true, resolution }
      : { applied: false, resolution, reason: "stale or duplicate request ID" };
  }

  /**
   * Is the request ID still actionable?
   *
   * A button of a closed question is stale: it must not resolve another
   * question and it must not clear a running wait.
   */
  isActionable(requestId: string): boolean {
    if (!this.currentQuestion) return false;
    return (
      this.currentQuestion.requestId === requestId &&
      (this.currentQuestion.state === "pending" || this.currentQuestion.state === "evaluating")
    );
  }

  /**
   * Cancel the current question (e.g., on session switch)
   */
  cancel(reason: string = "cancelled"): void {
    if (!this.currentQuestion) return;
    
    this.currentQuestion.state = "cancelled";
    logWarn("[PendingQuestion]", `Cancelled question ${this.currentQuestion.requestId}: ${reason}`);
    
    this.currentQuestion = null;
  }

  /**
   * Start Jev evaluation
   */
  startEvaluation(): void {
    if (!this.currentQuestion) return;
    
    if (this.currentQuestion.state !== "pending") {
      logWarn("[PendingQuestion]", `Cannot start evaluation: state is ${this.currentQuestion.state}`);
      return;
    }
    
    this.currentQuestion.state = "evaluating";
    logWarn("[PendingQuestion]", `Started evaluation for question ${this.currentQuestion.requestId}`);
  }

  /**
   * Get pending question by request ID
   */
  getQuestion(requestId: string): PendingQuestion | undefined {
    return this.questions.get(requestId);
  }

  /**
   * Get all questions
   */
  getAllQuestions(): PendingQuestion[] {
    return Array.from(this.questions.values());
  }

  /**
   * Clean up old resolved questions
   */
  cleanup(maxAgeMs: number = 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, q] of this.questions.entries()) {
      if (q.resolvedAt && (now - q.resolvedAt.getTime()) > maxAgeMs) {
        this.questions.delete(id);
      }
    }
  }

  /**
   * Check if question is answered
   */
  isResolved(): boolean {
    return this.currentQuestion?.state === "resolved";
  }

  /**
   * Get resolution
   */
  getResolution(): PendingQuestion["resolution"] | undefined {
    return this.currentQuestion?.resolution;
  }

  /**
   * Check if should suppress completion
   */
  shouldSuppressCompletion(): boolean {
    return this.hasPendingQuestion();
  }
}

/** Singleton instance */
let instance: PendingQuestionController | null = null;

export function getPendingQuestionController(): PendingQuestionController {
  if (!instance) {
    instance = new PendingQuestionController();
  }
  return instance;
}

export function createPendingQuestionController(config?: {
  evaluationDelayMs?: number;
  jevEnabled?: boolean;
}): PendingQuestionController {
  instance = new PendingQuestionController(config);
  return instance;
}
