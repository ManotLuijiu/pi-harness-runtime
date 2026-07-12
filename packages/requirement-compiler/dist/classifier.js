/**
 * Requirement Compiler - Statement Classifier
 *
 * Classifies extracted statements into goals, constraints, preferences, etc.
 */
/**
 * Classify a single statement based on its text content and keywords.
 */
function classifyStatement(stmt, config) {
    const lower = stmt.normalizedText;
    // Terminology patterns — Thai-only or bilingual short phrases
    // MUST check FIRST so Thai text doesn't get captured by keyword patterns
    if (/[ก-๙]/.test(stmt.originalText) && stmt.originalText.length < 80) {
        return { ...stmt, kind: "terminology" };
    }
    const mandKw = config.mandatoryKeywords ?? [];
    const prefKw = config.preferenceKeywords ?? [];
    // Constraint patterns — negation ANYWHERE in statement
    // MUST check BEFORE mandatory/preference keyword checks so "must not allow"
    // -> constraint (not behavior or preference)
    const hasNegation = /not\s/.test(lower) ||
        /don.t/.test(lower) ||
        /\bnever\s/.test(lower) ||
        /\bavoid\s/.test(lower) ||
        /cannot\b/.test(lower);
    if (hasNegation) {
        return { ...stmt, kind: "constraint" };
    }
    // Check explicit mandatory markers
    const isMandatory = mandKw.some((kw) => lower.includes(kw.toLowerCase()));
    // Check explicit preference markers
    const isPreference = prefKw.some((kw) => lower.includes(kw.toLowerCase()));
    // Override kind based on explicit markers
    if (isMandatory && !isPreference) {
        return { ...stmt, kind: "explicit_behavior" };
    }
    if (isPreference && !isMandatory) {
        return { ...stmt, kind: "preference" };
    }
    // Pattern-based classification
    if (lower.startsWith("we will") ||
        lower.startsWith("the system should") ||
        lower.startsWith("the app should") ||
        lower.startsWith("the user should")) {
        return { ...stmt, kind: "explicit_behavior" };
    }
    // Goal patterns — action verbs at start of statement
    const goalPattern = /^(?:the\s+(?:system|app|user)\s+)?(allow|enable|provide|show|display|create|add|support|let|implement|build|use|send|receive|save|load|calculate|process)\b/i;
    if (goalPattern.test(lower)) {
        return { ...stmt, kind: "goal" };
    }
    // Assumption patterns
    if (/^assume\s/.test(lower) ||
        lower.includes("assuming that") ||
        lower.includes("we assume")) {
        return { ...stmt, kind: "assumption" };
    }
    // Acceptance criterion patterns (Given/When/Then) — check BEFORE tech suggestions
    // so "Given...use..." doesn't get classified as implementation_suggestion
    if (/(?:^|[\s,])given\s/i.test(stmt.originalText) ||
        /(?:^|[\s,])when\s/i.test(stmt.originalText) ||
        /(?:^|[\s,])then\s/i.test(stmt.originalText)) {
        return { ...stmt, kind: "acceptance_criterion" };
    }
    // Technology suggestion patterns — use word boundary for "use"
    if (/\buse\b/.test(lower) ||
        lower.includes("implement with") ||
        lower.includes("write in") ||
        lower.includes("build with")) {
        return { ...stmt, kind: "implementation_suggestion" };
    }
    return stmt;
}
/**
 * Classify all extracted statements.
 */
export function classifyStatements(statements, config) {
    const classified = statements.map((s) => classifyStatement(s, config));
    const goals = classified.filter((s) => s.kind === "goal" || s.kind === "explicit_behavior");
    const constraints = classified.filter((s) => s.kind === "constraint");
    const preferences = classified.filter((s) => s.kind === "preference");
    const implSuggestions = classified.filter((s) => s.kind === "implementation_suggestion");
    const terminology = classified.filter((s) => s.kind === "terminology");
    const actors = classified.filter((s) => s.kind === "actor_mention");
    const acceptance = classified.filter((s) => s.kind === "acceptance_criterion");
    const assumptions = classified.filter((s) => s.kind === "assumption");
    const unknown = classified.filter((s) => s.kind === "unknown" && s.id !== "stmt-title");
    return {
        statements: classified,
        goals,
        constraints,
        preferences,
        implementationSuggestions: implSuggestions,
        terminologyMentions: terminology,
        actorMentions: actors,
        acceptanceCriterionStatements: acceptance,
        assumptions,
        unknown,
    };
}
//# sourceMappingURL=classifier.js.map