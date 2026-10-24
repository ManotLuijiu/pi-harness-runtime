/**
 * Pending Question Controller
 *
 * Manages pending questions that require human response.
 * Supports multiple channels (Telegram, LINE) and Jev evaluation.
 */
import { logWarn } from "./file-logger.js";
/**
 * Pending Question Controller
 */
export class PendingQuestionController {
    questions = new Map();
    currentQuestion = null;
    jevDecisionCallback;
    userAnswerCallback;
    config;
    constructor(config) {
        this.config = {
            evaluationDelayMs: config?.evaluationDelayMs ?? 5 * 60 * 1000, // 5 minutes
            jevEnabled: config?.jevEnabled ?? true,
        };
    }
    /**
     * Set callback for Jev decisions
     */
    onJevDecision(callback) {
        this.jevDecisionCallback = callback;
    }
    /**
     * Set callback for user answers
     */
    onUserAnswer(callback) {
        this.userAnswerCallback = callback;
    }
    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    /**
     * Detect if text contains a question requiring response
     */
    detectQuestion(text, _options) {
        // Find all question positions and extract each question sentence
        const questionPositions = [];
        let searchFrom = 0;
        while (true) {
            const questionIndex = text.indexOf('?', searchFrom);
            if (questionIndex === -1)
                break;
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
        if (approvalResult)
            return approvalResult;
        return { detected: false };
    }
    /**
     * Check for approval patterns in text without question mark
     * Only triggers if the text is short and looks like a question (no example: prefix)
     */
    checkApprovalPatterns(text) {
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
    isQuotedOrCode(fullText, question) {
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
    determineKind(question, isRoutine) {
        if (isRoutine)
            return "routine";
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
    isRoutineContinuation(question) {
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
    createQuestion(params) {
        const requestId = this.generateRequestId();
        const question = {
            requestId,
            sessionId: params.sessionId,
            workspacePath: params.workspacePath,
            jobId: params.jobId,
            questionText: params.text,
            kind: params.kind,
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
    getCurrentQuestion() {
        return this.currentQuestion;
    }
    /**
     * Check if there's a pending question
     */
    hasPendingQuestion() {
        return this.currentQuestion !== null &&
            this.currentQuestion.state === "pending";
    }
    /**
     * Update delivery state for a channel
     */
    updateDeliveryState(channel, delivered, error) {
        if (!this.currentQuestion)
            return;
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
    resolve(params) {
        if (!this.currentQuestion) {
            logWarn("[PendingQuestion]", "No question to resolve - no pending question");
            return false;
        }
        // Validate requestId if provided (first-answer-wins enforcement)
        if (params.requestId !== undefined && params.requestId !== this.currentQuestion.requestId) {
            logWarn("[PendingQuestion]", `Request ID mismatch: callback=${params.requestId} current=${this.currentQuestion.requestId} - stale button ignored`);
            return false;
        }
        // Check if already resolved (prevent duplicate resolution)
        if (this.currentQuestion.state === "resolved") {
            logWarn("[PendingQuestion]", `Question already resolved as ${this.currentQuestion.resolution} - duplicate callback ignored`);
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
        }
        else if (this.userAnswerCallback) {
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
    resolveByJev(requestId, outcome, reason) {
        if (!this.currentQuestion) {
            logWarn("[PendingQuestion]", "No question to resolve - no pending question");
            return false;
        }
        if (this.currentQuestion.requestId !== requestId) {
            logWarn("[PendingQuestion]", `Jev resolution for an unknown request: ${requestId} (current=${this.currentQuestion.requestId})`);
            return false;
        }
        if (this.currentQuestion.state === "resolved") {
            logWarn("[PendingQuestion]", `Question already resolved as ${this.currentQuestion.resolution} - jev decision ignored`);
            return false;
        }
        this.currentQuestion.state = "resolved";
        this.currentQuestion.resolvedBy = "jev";
        this.currentQuestion.jevOutcome = outcome;
        this.currentQuestion.jevReason = reason;
        this.currentQuestion.resolvedAt = new Date();
        logWarn("[PendingQuestion]", `Closed question ${this.currentQuestion.requestId} with jev outcome ${outcome}`);
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
    applyApproval(action, requestId, channel) {
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
    isActionable(requestId) {
        if (!this.currentQuestion)
            return false;
        return (this.currentQuestion.requestId === requestId &&
            (this.currentQuestion.state === "pending" || this.currentQuestion.state === "evaluating"));
    }
    /**
     * Cancel the current question (e.g., on session switch)
     */
    cancel(reason = "cancelled") {
        if (!this.currentQuestion)
            return;
        this.currentQuestion.state = "cancelled";
        logWarn("[PendingQuestion]", `Cancelled question ${this.currentQuestion.requestId}: ${reason}`);
        this.currentQuestion = null;
    }
    /**
     * Start Jev evaluation
     */
    startEvaluation() {
        if (!this.currentQuestion)
            return;
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
    getQuestion(requestId) {
        return this.questions.get(requestId);
    }
    /**
     * Get all questions
     */
    getAllQuestions() {
        return Array.from(this.questions.values());
    }
    /**
     * Clean up old resolved questions
     */
    cleanup(maxAgeMs = 60 * 60 * 1000) {
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
    isResolved() {
        return this.currentQuestion?.state === "resolved";
    }
    /**
     * Get resolution
     */
    getResolution() {
        return this.currentQuestion?.resolution;
    }
    /**
     * Check if should suppress completion
     */
    shouldSuppressCompletion() {
        return this.hasPendingQuestion();
    }
}
/** Singleton instance */
let instance = null;
export function getPendingQuestionController() {
    if (!instance) {
        instance = new PendingQuestionController();
    }
    return instance;
}
export function createPendingQuestionController(config) {
    instance = new PendingQuestionController(config);
    return instance;
}
//# sourceMappingURL=pending-question.js.map