/**
 * Prompt Compiler - Compiler
 *
 * Main entry point for prompt compilation.
 * Orchestrates: normalize → build → redact → deduplicate → compact → validate → render → hash → persist.
 */
import { PROVIDER_PROFILES, PromptCompileError } from "./types.js";
import { compactToBudget, estimateTokens } from "./budget.js";
import { deduplicateSections } from "./deduplicate.js";
import { normalizeRequest } from "./normalize.js";
import { renderForProvider } from "./render.js";
import { buildSections } from "./section-builder.js";
import { validateSections, validateTokenBudget } from "./validate.js";
/**
 * Default in-memory redactor (identity function).
 * Production should inject a real redaction implementation.
 */
export function createIdentityRedactor() {
    return {
        redact: (content) => content,
    };
}
/**
 * Default identity hasher (SHA-256 via Web Crypto or Node crypto).
 */
export function createHasher() {
    return {
        async sha256(content) {
            // Use Web Crypto API (available in Node 18+ and browsers)
            const encoder = new TextEncoder();
            const data = encoder.encode(content);
            const hashBuffer = await crypto.subtle.digest("SHA-256", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        },
    };
}
/**
 * Synchronous SHA-256 for testing (simple string-based).
 */
export function createSyncHasher() {
    let sha256Impl = null;
    return {
        sha256(content) {
            if (!sha256Impl) {
                // Lazy import for Node environment
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const crypto = require("node:crypto");
                    sha256Impl = (text) => crypto.createHash("sha256").update(text).digest("hex");
                }
                catch {
                    // Fallback: simple hash for testing
                    sha256Impl = (text) => {
                        let hash = 0;
                        for (let i = 0; i < text.length; i++) {
                            const char = text.charCodeAt(i);
                            hash = (hash << 5) - hash + char;
                            hash |= 0;
                        }
                        return Math.abs(hash).toString(16).padStart(8, "0");
                    };
                }
            }
            return sha256Impl?.(content);
        },
    };
}
/**
 * Compile a prompt from a normalized request.
 *
 * Reference algorithm from RFC-0041:
 * 1. normalize input
 * 2. select provider profile
 * 3. assemble ordered sections
 * 4. remove duplicate context
 * 5. enforce policy constraints
 * 6. estimate token size
 * 7. compact optional sections
 * 8. validate output contract
 * 9. calculate content hash
 * 10. persist PromptPackage
 */
export async function compilePrompt(request, deps) {
    // 1. Normalize input
    const normalized = normalizeRequest(request);
    // 2. Select provider profile
    const profile = PROVIDER_PROFILES[request.provider];
    if (!profile) {
        throw new PromptCompileError("INVALID_TASK", `Unknown provider: ${request.provider}`);
    }
    // 3. Assemble sections
    let sections = buildSections(normalized, deps.projectRules);
    // 4. Redact secrets (before persistence)
    sections = sections.map((section) => ({
        ...section,
        content: deps.redactor.redact(section.content),
    }));
    // 5. Deduplicate
    sections = deduplicateSections(sections);
    // 6 & 7. Estimate tokens and compact to budget
    const availableTokens = profile.maximumInputTokens - profile.reservedOutputTokens;
    const estimateSectionTokens = (content) => estimateTokens(content);
    const budgeted = compactToBudget(sections, availableTokens, estimateSectionTokens);
    sections = budgeted.sections;
    // 8. Validate
    validateSections(sections, normalized, { provider: profile });
    validateTokenBudget(budgeted.estimatedTokens, profile);
    // 9. Render for provider
    const rendered = renderForProvider(sections, profile);
    // 10. Calculate content hash
    const hashContent = `${rendered.system}\n${rendered.user}`;
    const hash = deps.hasher.sha256(hashContent);
    const pkg = {
        version: "1",
        taskId: normalized.taskId,
        provider: request.provider,
        system: rendered.system,
        user: rendered.user,
        sections,
        estimatedInputTokens: budgeted.estimatedTokens,
        sourceRefs: sections.flatMap((s) => s.sourceRefs),
        hash,
        createdAt: deps.clock.now().toISOString(),
    };
    // 11. Persist (optional)
    if (deps.persister) {
        await deps.persister.persist(pkg);
    }
    return pkg;
}
//# sourceMappingURL=compiler.js.map