/**
 * Requirement Compiler - Ambiguity Detector
 *
 * Detects ambiguities, contradictions, and missing information.
 */
/**
 * Vague terms that indicate ambiguity.
 */
const VAGUE_TERMS = [
    "well",
    "fast",
    "good",
    "nice",
    "modern",
    "robust",
    "efficient",
    "scalable",
    "secure",
    "reliable",
    "appropriate",
    "reasonable",
    "some",
    "few",
    "many",
    "several",
    "lots of",
    "a bit",
    "as needed",
    "when necessary",
    "properly",
];
/**
 * Questions that signal missing actors.
 */
const ACTOR_QUESTIONS = [
    "who should",
    "who will",
    "who can",
    "who is responsible",
    "which user",
    "what role",
];
function detectVagueTerms(statements) {
    const ambiguities = [];
    let ambiguityIndex = 0;
    for (const stmt of statements) {
        const lower = stmt.normalizedText;
        for (const term of VAGUE_TERMS) {
            if (lower.includes(term)) {
                ambiguities.push({
                    id: `ambig-${ambiguityIndex++}`,
                    question: `The term "${term}" is vague. What does "${stmt.originalText.slice(0, 50)}" specifically require?`,
                    blocking: false,
                    affectedGoals: [],
                    evidence: [stmt.sourceRef],
                    category: "vague_term",
                });
                break;
            }
        }
    }
    return ambiguities;
}
function detectMissingActors(statements) {
    const ambiguities = [];
    let ambiguityIndex = 0;
    for (const stmt of statements) {
        const lower = stmt.normalizedText;
        for (const q of ACTOR_QUESTIONS) {
            if (lower.includes(q)) {
                ambiguities.push({
                    id: `ambig-${ambiguityIndex++}`,
                    question: `Actor not specified: ${stmt.originalText}`,
                    blocking: true,
                    affectedGoals: [],
                    evidence: [stmt.sourceRef],
                    category: "missing_actor",
                });
                break;
            }
        }
    }
    return ambiguities;
}
function detectContradictions(goals, constraints) {
    const ambiguities = [];
    let ambiguityIndex = 0;
    // Normalize for contradiction comparison:
    // Strips both modal verbs ("must", "shall") AND negation words ("not", "don't", "do not", etc.)
    // Then collapses whitespace and lowercases.
    // This lets "allow X" vs "must/do not allow X" both normalize to "allow x".
    function normalizeForContradiction(text) {
        // Normalize for comparison: remove negation phrases and modal verbs,
        // leaving only the core action. This lets "allow X" vs "must/do not allow X"
        // both normalize to "allow x".
        let result = text;
        // Remove negation phrases — "do not", "does not", "must not", "shall not"
        // These appear with or without leading whitespace (start of sentence)
        result = result.replace(/(?:^|\s)do(?:\s+not|\s+NOT)\s+/gi, " ");
        result = result.replace(/(?:^|\s)does(?:\s+not|\s+NOT)\s+/gi, " ");
        result = result.replace(/(?:^|\s)must\s+not\s+/gi, " ");
        result = result.replace(/(?:^|\s)shall\s+not\s+/gi, " ");
        result = result.replace(/(?:^|\s)should\s+not\s+/gi, " ");
        result = result.replace(/(?:^|\s)will\s+not\s+/gi, " ");
        // Remove standalone negation words (never, no, don't, cannot)
        // surrounded by spaces — does NOT match "not" inside "anonymous"
        result = result.replace(/\s+(?:never|no|don.t|doesn.t|can.t|cannot)\s+/gi, " ");
        result = result.replace(/\s+not\s+/gi, " ");
        // Remove modal verbs
        result = result.replace(/\s+(?:must|shall|should|will|can|may|might)\s*/gi, " ");
        result = result.replace(/\s+/g, " ").trim().toLowerCase();
        return result;
    }
    // Check goal vs constraint pairs
    for (const c of constraints) {
        const normalizedConstr = normalizeForContradiction(c.normalizedText);
        for (const g of goals) {
            const normalizedGoal = normalizeForContradiction(g.normalizedText);
            // Check if goal and constraint oppose each other after normalization
            if (normalizedGoal === normalizedConstr && normalizedGoal.length > 3) {
                ambiguities.push({
                    id: `ambig-${ambiguityIndex++}`,
                    question: `Contradiction detected: "${g.originalText}" contradicts "${c.originalText}". Which takes precedence?`,
                    blocking: true,
                    affectedGoals: [],
                    evidence: [g.sourceRef, c.sourceRef],
                    category: "contradiction",
                });
            }
            // Check quantity contradictions
            const qtyMatch = c.normalizedText.match(/\d+/);
            const goalQtyMatch = g.normalizedText.match(/\d+/);
            if (qtyMatch &&
                goalQtyMatch &&
                qtyMatch[0] !== goalQtyMatch[0] &&
                c.normalizedText.includes("not")) {
                ambiguities.push({
                    id: `ambig-${ambiguityIndex++}`,
                    question: `Quantity conflict: constraint says "${c.originalText}" but goal says "${g.originalText}". Clarify the correct value.`,
                    blocking: true,
                    affectedGoals: [],
                    evidence: [g.sourceRef, c.sourceRef],
                    category: "contradiction",
                });
            }
        }
    }
    // Also check goal vs goal pairs (when both have negation)
    for (let i = 0; i < goals.length; i++) {
        for (let j = i + 1; j < goals.length; j++) {
            const ga = goals[i];
            const gb = goals[j];
            const normA = normalizeForContradiction(ga.normalizedText);
            const normB = normalizeForContradiction(gb.normalizedText);
            if (normA === normB && normA.length > 3) {
                // Check that one has negation and the other doesn't
                const hasNegA = /\bnot\b|don.t|cannot/i.test(ga.normalizedText);
                const hasNegB = /\bnot\b|don.t|cannot/i.test(gb.normalizedText);
                if (hasNegA !== hasNegB) {
                    ambiguities.push({
                        id: `ambig-${ambiguityIndex++}`,
                        question: `Contradiction detected: "${ga.originalText}" contradicts "${gb.originalText}". Which takes precedence?`,
                        blocking: true,
                        affectedGoals: [],
                        evidence: [ga.sourceRef, gb.sourceRef],
                        category: "contradiction",
                    });
                }
            }
        }
    }
    return ambiguities;
}
function detectScopeUncertainty(statements) {
    const ambiguities = [];
    let ambiguityIndex = 0;
    const scopeKeywords = [
        "maybe",
        "possibly",
        "or not",
        "if possible",
        "if needed",
        "optional",
        "as appropriate",
    ];
    for (const stmt of statements) {
        const lower = stmt.normalizedText;
        for (const kw of scopeKeywords) {
            if (lower.includes(kw)) {
                ambiguities.push({
                    id: `ambig-${ambiguityIndex++}`,
                    question: `Scope unclear: "${stmt.originalText}" uses "${kw}". Is this required or optional?`,
                    blocking: false,
                    affectedGoals: [],
                    evidence: [stmt.sourceRef],
                    category: "scope_unclear",
                });
                break;
            }
        }
    }
    return ambiguities;
}
/**
 * Detect ambiguities in classified statements.
 */
export function detectAmbiguities(classification, _config) {
    const allStatements = [
        ...classification.goals,
        ...classification.constraints,
        ...classification.preferences,
        ...classification.unknown,
    ];
    const ambiguities = [
        ...detectVagueTerms(allStatements),
        // Check all meaningful statements for missing actors, not just goals
        // (preferences and unknown statements like "Who should..." may also lack actors)
        ...detectMissingActors([
            ...classification.goals,
            ...classification.preferences,
            ...classification.unknown,
        ]),
        ...detectContradictions(classification.goals, classification.constraints),
        ...detectScopeUncertainty(allStatements),
    ];
    // De-duplicate by evidence text
    const seen = new Set();
    return ambiguities.filter((a) => {
        const key = a.question;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=ambiguity-detector.js.map