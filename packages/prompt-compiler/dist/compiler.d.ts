/**
 * Prompt Compiler - Compiler
 *
 * Main entry point for prompt compilation.
 * Orchestrates: normalize → build → redact → deduplicate → compact → validate → render → hash → persist.
 */
import type { PromptCompileRequest } from "./types.js";
import type { PromptPackage } from "./types.js";
/**
 * Dependencies required by the compiler.
 * All I/O (filesystem, clock, hashing) is injected here.
 */
export interface PromptCompilerDependencies {
    /** SHA-256 hash function */
    hasher: {
        sha256: (content: string) => string;
    };
    /** System clock */
    clock: {
        now: () => Date;
    };
    /** Redaction interface for security-sensitive content */
    redactor: {
        redact: (content: string) => string;
    };
    /** Persist the compiled prompt package */
    persister?: {
        persist: (pkg: PromptPackage) => Promise<void>;
    };
    /** Project rules (injected from project profile or policy engine) */
    projectRules: string[];
}
/**
 * Default in-memory redactor (identity function).
 * Production should inject a real redaction implementation.
 */
export declare function createIdentityRedactor(): {
    redact: (content: string) => string;
};
/**
 * Default identity hasher (SHA-256 via Web Crypto or Node crypto).
 */
export declare function createHasher(): {
    sha256(content: string): Promise<string>;
};
/**
 * Synchronous SHA-256 for testing (simple string-based).
 */
export declare function createSyncHasher(): {
    sha256(content: string): string;
};
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
export declare function compilePrompt(request: PromptCompileRequest, deps: PromptCompilerDependencies): Promise<PromptPackage>;
//# sourceMappingURL=compiler.d.ts.map