/**
 * Requirement Compiler - Main Compiler
 *
 * Compiles raw requirements into validated CompiledRequirement.
 */
import { detectAmbiguities } from "./ambiguity-detector.js";
import { classifyStatements } from "./classifier.js";
import { extractStatements } from "./extractor.js";
import { normalizeAcceptanceCriteria } from "./normalizer.js";
import { detectRisks } from "./risk-detector.js";
import { DEFAULT_COMPILER_CONFIG, RequirementCompileError, RequirementCompileErrorCodes, } from "./types.js";
/**
 * Compile a raw requirement into a validated CompiledRequirement.
 */
export async function compileRequirement(raw, deps) {
    const config = {
        ...DEFAULT_COMPILER_CONFIG,
        ...deps,
    };
    const clock = deps?.clock ?? (() => new Date());
    // ─── Pre-flight validation ────────────────────────────────────────────────
    if (!raw.text.trim() && !raw.title?.trim()) {
        throw new RequirementCompileError(RequirementCompileErrorCodes.EMPTY_REQUIREMENT, `Requirement ${raw.id} has no text or title.`, { requirementId: raw.id });
    }
    // ─── Step 1: Extract statements ─────────────────────────────────────────
    const extractor = deps?.extractor ?? { extract: extractStatements };
    const extractionResult = extractor.extract(raw);
    // ─── Step 2: Classify statements ──────────────────────────────────────
    const classifier = deps?.classifier ?? { classify: classifyStatements };
    const classification = classifier.classify(extractionResult.statements, config);
    // ─── Step 3: Build goals ─────────────────────────────────────────────────
    const goals = classification.goals.map((stmt, i) => ({
        id: `goal-${i + 1}`,
        description: stmt.originalText,
        sourceRefs: [stmt.sourceRef],
        priority: undefined,
    }));
    // ─── Step 4: Build constraints ────────────────────────────────────────────
    const constraints = classification.constraints.map((stmt, i) => ({
        id: `constraint-${i + 1}`,
        description: stmt.originalText,
        kind: "mandatory",
        sourceRefs: [stmt.sourceRef],
        blocking: true,
    }));
    // ─── Step 5: Build preferences ───────────────────────────────────────────
    const preferenceConstraints = classification.preferences.map((stmt, i) => ({
        id: `pref-constraint-${i + 1}`,
        description: stmt.originalText,
        kind: "preferable",
        sourceRefs: [stmt.sourceRef],
        blocking: false,
    }));
    // ─── Step 6: Detect ambiguities ───────────────────────────────────────────
    const ambiguityDetector = deps?.ambiguityDetector ?? {
        detect: detectAmbiguities,
    };
    const ambiguities = ambiguityDetector.detect(classification, config);
    // ─── Step 7: Normalize acceptance criteria ────────────────────────────────
    const acceptanceNormalizer = deps?.acceptanceNormalizer ?? {
        normalize: normalizeAcceptanceCriteria,
    };
    const acceptanceCriteria = acceptanceNormalizer.normalize(classification.acceptanceCriterionStatements);
    // If no explicit acceptance criteria, generate from goals
    let finalAcceptanceCriteria = acceptanceCriteria;
    if (acceptanceCriteria.length === 0 && goals.length > 0) {
        finalAcceptanceCriteria = goals.map((goal, i) => ({
            id: `AC-${String(i + 1).padStart(3, "0")}`,
            given: "prerequisites are met",
            when: "the implementation is complete",
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            outcome: [`The goal "${goal.description}" is achieved.`],
            sourceRefs: goal.sourceRefs,
            automatable: false,
        }));
    }
    // ─── Step 8: Detect risks ─────────────────────────────────────────────────
    const riskDetector = deps?.riskDetector ?? { detect: detectRisks };
    const riskTags = riskDetector.detect(classification);
    // ─── Step 9: Extract terminology ──────────────────────────────────────────
    const terminology = classification.terminologyMentions.map((stmt) => ({
        term: stmt.originalText,
        definition: stmt.normalizedText,
        language: /[ก-๙]/.test(stmt.originalText) ? "th" : "en",
        sourceRef: stmt.sourceRef,
    }));
    // ─── Step 10: Identify actors ──────────────────────────────────────────────
    const actors = [];
    const actorNames = new Set();
    // Scan all meaningful statements for actor mentions
    const allStmts = [
        ...classification.goals,
        ...classification.constraints,
        ...classification.unknown,
    ];
    for (const stmt of allStmts) {
        // Pattern 1: "The [role] can/must/should/is" — catches "The admin", "The user"
        const pattern1 = stmt.originalText.match(/(?:the|an?|my)\s+([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*)?)\s+(?:can|must|should|is|are|has|have|will|does)/gi);
        if (pattern1) {
            for (const match of pattern1) {
                const name = match
                    .replace(/^(?:the|an?|my)\s+/i, "")
                    .replace(/\s+(?:can|must|should|is|are|has|have|will|does)$/i, "")
                    .trim();
                // Filter out generic words
                if (name.length > 1 &&
                    name.length < 30 &&
                    !/^(?:admin|user|system|app|user account|account|any|all|some|each|the)$/i.test(name)) {
                    const key = name.toLowerCase();
                    if (!actorNames.has(key)) {
                        actorNames.add(key);
                        actors.push({
                            id: `actor-${actors.length + 1}`,
                            name: name.charAt(0).toUpperCase() + name.slice(1),
                            role: name.toLowerCase(),
                            sourceRefs: [stmt.sourceRef],
                        });
                    }
                }
            }
        }
        // Pattern 2: "[role] can" — captures "admin" from "The admin can delete"
        const pattern2 = stmt.originalText.match(/(?:^|\s)([a-z][a-z0-9]{1,20})\s+can\s+(?:delete|edit|access|view|create|update|remove|manage)/gi);
        if (pattern2) {
            for (const match of pattern2) {
                const name = match
                    .replace(/\s+can\s+(?:delete|edit|access|view|create|update|remove|manage)$/i, "")
                    .trim();
                if (name.length > 1 &&
                    name.length < 30 &&
                    !/^(?:it|this|that|the|a|an|any|all|some|each|their|their own|own)$/i.test(name)) {
                    const key = name.toLowerCase();
                    if (!actorNames.has(key)) {
                        actorNames.add(key);
                        actors.push({
                            id: `actor-${actors.length + 1}`,
                            name: name.charAt(0).toUpperCase() + name.slice(1),
                            role: name.toLowerCase(),
                            sourceRefs: [stmt.sourceRef],
                        });
                    }
                }
            }
        }
    }
    // ─── Step 11: Identify non-goals ──────────────────────────────────────────
    const nonGoals = [];
    for (const stmt of classification.constraints) {
        // Explicit "will not" or "should not" statements in non-goal context
        if (/strip|will not|should not/i.test(stmt.originalText) &&
            !/stripping|removing/.test(stmt.originalText.toLowerCase())) {
            nonGoals.push(stmt.originalText);
        }
    }
    // ─── Step 12: Build workflows ─────────────────────────────────────────────
    const workflows = [];
    // Group consecutive statements into workflows heuristically
    const goalStatements = [
        ...classification.goals,
        ...classification.implementationSuggestions,
    ];
    if (goalStatements.length >= 2) {
        workflows.push({
            id: "workflow-1",
            name: "Main workflow",
            steps: goalStatements.map((s) => s.originalText),
            actors: actors.map((a) => a.name),
            preconditions: [],
            outcomes: goals.map((g) => g.description),
            sourceRefs: goalStatements.flatMap((s) => [s.sourceRef]),
        });
    }
    // ─── Step 13: Determine status ────────────────────────────────────────────
    let status = "ready";
    const blockingAmbiguities = ambiguities.filter((a) => a.blocking);
    if (blockingAmbiguities.length > 0 &&
        config.allowReversibleAssumptions !== false) {
        status = "needs_human";
    }
    else if (blockingAmbiguities.length > 0) {
        status = "needs_human";
    }
    // Check for impossible requirements (contradictions)
    const contradictions = ambiguities.filter((a) => a.category === "contradiction");
    if (contradictions.length > 0) {
        throw new RequirementCompileError(RequirementCompileErrorCodes.UNRESOLVABLE_CONTRADICTION, `Requirement ${raw.id} contains unresolvable contradictions.`, { contradictions: contradictions.map((c) => c.question) });
    }
    // Check for empty/vague requirement after processing
    // A requirement is "empty" if it has no goals, constraints, nonGoals,
    // AND the text is either blank OR contains only vague/uncertain language
    const vaguePatterns = /^(maybe|perhaps|possibly|maybe perhaps|perhaps possibly|not sure|not certain|i think|we think|not sure if|uncertain|ambiguous|maybe $|possibly $|\?+$)/i;
    const isVague = vaguePatterns.test(raw.text.trim());
    if (goals.length === 0 &&
        constraints.length === 0 &&
        nonGoals.length === 0 &&
        (!raw.text.trim() || isVague)) {
        throw new RequirementCompileError(RequirementCompileErrorCodes.EMPTY_REQUIREMENT, `Requirement ${raw.id} contains no identifiable goals or constraints.`, { requirementId: raw.id });
    }
    // ─── Step 14: Build source references ────────────────────────────────────
    const sourceRefs = extractionResult.statements.map((s) => s.sourceRef);
    // ─── Step 15: Assemble problem statement ─────────────────────────────────
    const problemStatement = goals.length > 0
        ? goals.map((g) => g.description).join("; ")
        : (raw.title ?? raw.text.slice(0, 200));
    // ─── Step 16: Build final compiled requirement ────────────────────────────
    const compiled = {
        id: raw.id,
        title: raw.title ?? problemStatement.slice(0, 80),
        problemStatement,
        goals,
        nonGoals,
        constraints: [...constraints, ...preferenceConstraints],
        actors,
        workflows,
        acceptanceCriteria: finalAcceptanceCriteria,
        assumptions: classification.assumptions.map((stmt, i) => ({
            id: `assumption-${i + 1}`,
            description: stmt.originalText,
            sourceRefs: [stmt.sourceRef],
            reversible: config.allowReversibleAssumptions !== false,
        })),
        ambiguities,
        terminology,
        riskTags,
        sourceRefs,
        status,
        compiledAt: clock().toISOString(),
    };
    return compiled;
}
//# sourceMappingURL=compiler.js.map