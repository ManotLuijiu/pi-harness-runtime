/**
 * Pending Question Controller
 *
 * Manages pending questions that require human response.
 * Supports multiple channels (Telegram, LINE) and Jev evaluation.
 */
import { logWarn } from "./file-logger.js";
/**
 * The wording that asks for an explicit human authorization.
 *
 * The agent states the requirement itself ("I need your OK before ..."). It
 * is part of the context of the question, not of the question sentence, so
 * it is detected on the whole message.
 */
const EXPLICIT_AUTHORIZATION_PATTERNS = [
    /\b(?:need|needs|needing|require|requires|requiring|want|wants|waiting for|wait for)\s+(?:your|the)\s+(?:explicit\s+)?(?:ok|okay|approval|approbation|authorization|authorisation|permission|consent|confirmation|green light|sign[- ]?off|go[- ]?ahead)\b/i,
    /\bexplicit\s+(?:approval|authorization|authorisation|permission)\b/i,
    /\b(?:authorize|authorise)\s+me\b/i,
    /\bonly\s+(?:with|after)\s+your\b/i,
];
/**
 * Does the message ask for an explicit human authorization?
 *
 * An ask of this kind is never decided autonomously: only the human may
 * authorize it.
 */
export function hasExplicitAuthorizationWording(text) {
    return EXPLICIT_AUTHORIZATION_PATTERNS.some((pattern) => pattern.test(text));
}
/**
 * The typed ask of a question kind.
 */
export function askTypeForKind(kind) {
    switch (kind) {
        case "approval":
            return "approval";
        case "choice":
            return "choice";
        case "clarification":
            return "clarification";
        case "explicit":
            return "explicit_authorization";
        case "routine":
            return "routine";
        default:
            // An unknown kind is a clarification: the harness does not know
            // what the agent is waiting for, so it waits for a human.
            return "clarification";
    }
}
/**
 * The typed ask of a detected question.
 *
 * A choice keeps its type: the agent offers concrete alternatives, and a
 * decision may pick one of them. Every other ask that the message
 * explicitly reserves for the human is an explicit authorization.
 */
export function computeAskType(kind, explicitAuthorization) {
    if (kind === "choice")
        return "choice";
    if (explicitAuthorization)
        return "explicit_authorization";
    return askTypeForKind(kind);
}
/**
 * The stem of a question: the part that carries no alternative.
 */
const QUESTION_STEM = /^(?:do you want(?: me to)?|do you prefer|would you like me to|should i|should we|shall i|shall we|may i|can i|could i|is it|are you|which|what|do)\s+/i;
/** The auxiliary verb of the second alternative. */
const ALTERNATIVE_AUXILIARY = /^(?:is|are|was|were|should|would|do|does|did|can|could|shall|will|to)\s+/i;
/** The intent tail of an alternative ("... is intended"). */
const ALTERNATIVE_INTENT = /\s+(intended|expected|needed|required|desired|meant|correct|right|preferred)$/i;
/**
 * The longest question text that is parsed.
 *
 * A question is a sentence. The cap keeps the work of the parser
 * bounded: the alternatives of a question are not longer than a line,
 * and a bounded input cannot make a slow pattern slow.
 */
const MAX_QUESTION_LENGTH = 500;
/** Is the character whitespace? */
function isSpace(character) {
    return typeof character === "string" && /\s/.test(character);
}
/** Is the character the end of a sentence? */
function isSentenceEnd(character) {
    return character === "?" || character === "!" || character === ".";
}
/**
 * The question without the punctuation that ends the sentence.
 *
 * The punctuation is removed by a scan and not by a pattern: a pattern
 * with two unbounded repetitions next to each other takes quadratic time
 * on a long run of the same character.
 */
function withoutSentenceEnd(text) {
    let end = text.length;
    while (end > 0 && isSentenceEnd(text[end - 1]))
        end -= 1;
    return text.slice(0, end).trimEnd();
}
/**
 * The index where the "or" of two alternatives starts.
 *
 * The separator is the word "or" with whitespace around it. A comma in
 * front of it belongs to the separator. The search is a scan over the
 * string: a pattern with two unbounded repetitions can take quadratic
 * time, and a question is not a fixed length.
 *
 * @returns the boundaries of the separator, or null when there is none.
 */
function findOrSeparator(text) {
    const lower = text.toLowerCase();
    for (let index = 0; index + 1 < text.length; index += 1) {
        if (lower[index] !== "o" || lower[index + 1] !== "r")
            continue;
        if (!isSpace(text[index - 1]) || !isSpace(text[index + 2]))
            continue;
        // The whitespace in front of the word, and the comma that may
        // come with it.
        let start = index;
        while (start > 0 && isSpace(text[start - 1]))
            start -= 1;
        const leftEnd = text[start - 1] === "," ? start - 1 : start;
        return { leftEnd, orIndex: index };
    }
    return null;
}
/**
 * Extract the alternatives of a choice question.
 *
 * The result is what the decision has to choose between, so it must be
 * concrete: "the current staging state is intended" is an alternative,
 * "is the current staging state intended?" is not. An empty or unusable
 * half means the question is not a choice after all.
 */
export function extractAlternatives(question) {
    const text = withoutSentenceEnd(question.trim().slice(0, MAX_QUESTION_LENGTH));
    const separator = findOrSeparator(text);
    if (!separator)
        return [];
    // The left half ends before the separator, the right half after the
    // word "or".
    const left = text
        .slice(0, separator.leftEnd)
        .replace(QUESTION_STEM, "")
        .replace(/[\s,]+$/, "")
        .trim();
    const rightRaw = text.slice(separator.orIndex + 2).trim();
    const right = rightRaw.replace(ALTERNATIVE_AUXILIARY, "").trim();
    if (!left || !right)
        return [];
    // "the current staging state intended" -> "the current staging state is intended"
    const intent = right.match(ALTERNATIVE_INTENT);
    const normalizedRight = intent
        ? `${right.slice(0, intent.index).trimEnd()} is ${intent[1]}`
        : right;
    return [left, normalizedRight];
}
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
     *
     * The complete assistant message is kept as the context of the question:
     * the sentence that carries the question often leaves out what the agent
     * is really waiting for ("I need your OK before ..."). The risk facts and
     * the decision are derived from the whole message, not from the sentence
     * alone.
     */
    detectQuestion(text, options) {
        const contextText = options?.contextText ?? text;
        // The message decides whether the agent reserves the decision for the
        // human: "I need your OK before ..." is part of the context and not
        // of the question sentence.
        const explicitAuthorization = hasExplicitAuthorizationWording(contextText);
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
            // Return first approval, choice or clarification question found
            if (kind === "approval" || kind === "choice" || kind === "clarification") {
                return {
                    detected: true,
                    questionText: q.sentence,
                    kind,
                    isRoutine,
                    askType: computeAskType(kind, explicitAuthorization),
                    alternatives: kind === "choice" ? extractAlternatives(q.sentence) : undefined,
                    contextText,
                };
            }
        }
        // If no approval/choice/clarification was found, return the first
        // non-quoted question. An unrecognized question is a clarification:
        // the harness does not know what the agent is waiting for.
        for (const q of questionPositions) {
            if (this.isQuotedOrCode(text, q.sentence)) {
                continue;
            }
            const isRoutine = this.isRoutineContinuation(q.sentence);
            const kind = this.determineKind(q.sentence, isRoutine);
            return {
                detected: true,
                questionText: q.sentence,
                kind,
                isRoutine,
                askType: computeAskType(kind, explicitAuthorization),
                alternatives: kind === "choice" ? extractAlternatives(q.sentence) : undefined,
                contextText,
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
                    askType: computeAskType("approval", hasExplicitAuthorizationWording(text)),
                    contextText: text,
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
            /\bshould i\b/i,
            /\bshould we\b/i,
            /\bdo you want me to\b/i,
            /\bcan i (start|proceed|add|implement)\b/i,
        ];
        for (const pattern of approvalPatterns) {
            if (pattern.test(lower)) {
                return "approval";
            }
        }
        // A choice names concrete alternatives: "do you want X, or is Y
        // intended?". The decision may pick one of them, but only when it
        // names the picked option.
        const choicePatterns = [
            /,\s*or\s+(?:is|are|was|were|should|would|do|does|did|can|could|shall|will|to)\b/i,
            /\beither\b[^?]*\bor\b/i,
            /\b(?:do you want|do you prefer|would you like|should i|shall i|can i|could i|which)\b[^?]*\bor\b/i,
        ];
        for (const pattern of choicePatterns) {
            if (pattern.test(lower)) {
                return "choice";
            }
        }
        // An unrecognized question is not a routine continuation: the harness
        // does not know what the agent is waiting for, so it asks a human
        // instead of continuing on a guess.
        return "clarification";
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
            askType: params.askType ?? askTypeForKind(params.kind),
            alternatives: params.alternatives,
            contextText: params.contextText,
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
        // A question that was expired or cancelled is closed: a late click
        // must not resurrect it and must not report an answer that never
        // happened.
        if (this.currentQuestion.state === "expired" ||
            this.currentQuestion.state === "cancelled") {
            logWarn("[PendingQuestion]", `Question is ${this.currentQuestion.state} (${this.currentQuestion.closedReason ?? "no reason"}) - late callback ignored`);
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
    resolveByJev(requestId, outcome, reason, resolution) {
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
        if (this.currentQuestion.state === "expired" ||
            this.currentQuestion.state === "cancelled") {
            logWarn("[PendingQuestion]", `Question is ${this.currentQuestion.state} - jev decision ignored`);
            return false;
        }
        this.currentQuestion.state = "resolved";
        this.currentQuestion.resolvedBy = "jev";
        this.currentQuestion.jevOutcome = outcome;
        this.currentQuestion.jevReason = reason;
        this.currentQuestion.resolvedAt = new Date();
        // The resolution is the answer to the question: the selected option and
        // the scope travel with the request, so the agent can be told which
        // option was chosen.
        if (resolution?.selectedOption) {
            this.currentQuestion.selectedOption = resolution.selectedOption;
        }
        if (resolution?.scope) {
            this.currentQuestion.scope = resolution.scope;
        }
        logWarn("[PendingQuestion]", `Closed question ${this.currentQuestion.requestId} with jev outcome ${outcome}`);
        if (this.jevDecisionCallback) {
            const metadata = { outcome };
            if (resolution?.selectedOption) {
                metadata["selectedOption"] = resolution.selectedOption;
            }
            if (resolution?.scope) {
                metadata["scope"] = resolution.scope;
            }
            this.jevDecisionCallback(this.currentQuestion, {
                action: outcome === "reject" ? "stop" : outcome === "wait" ? "wait" : "continue",
                reason: reason ?? `jev:${outcome}`,
                eligible: true,
                metadata,
            });
        }
        return true;
    }
    /**
     * Expire the pending question when the decision deadline is reached.
     *
     * The deadline is a terminal path: the question is closed with the safe
     * reason code, the buttons of that request become stale, and the wait
     * state is cleared. A question that is left open here looks like a
     * request that is still waiting - forever.
     *
     * @returns true if the question was expired, false when it was already
     *   answered by a human or closed by a decision.
     */
    expireByTimeout(requestId, reason = "deadline-expired") {
        if (!this.currentQuestion) {
            logWarn("[PendingQuestion]", "No question to expire - no pending question");
            return false;
        }
        if (this.currentQuestion.requestId !== requestId) {
            logWarn("[PendingQuestion]", `Expiry for an unknown request: ${requestId} (current=${this.currentQuestion.requestId})`);
            return false;
        }
        if (this.currentQuestion.state !== "pending" && this.currentQuestion.state !== "evaluating") {
            logWarn("[PendingQuestion]", `Question is ${this.currentQuestion.state} - expiry ignored`);
            return false;
        }
        this.currentQuestion.state = "expired";
        this.currentQuestion.resolvedBy = "timeout";
        this.currentQuestion.resolvedAt = new Date();
        this.currentQuestion.closedReason = reason;
        logWarn("[PendingQuestion]", `Expired question ${this.currentQuestion.requestId}: ${reason}`);
        if (this.jevDecisionCallback) {
            this.jevDecisionCallback(this.currentQuestion, {
                action: "stop",
                reason,
                eligible: false,
                metadata: { outcome: "expired" },
            });
        }
        return true;
    }
    /**
     * The state of the current question.
     */
    getState() {
        return this.currentQuestion?.state;
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