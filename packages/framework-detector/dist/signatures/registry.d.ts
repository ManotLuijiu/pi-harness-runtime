/**
 * Framework Detector - Signature Registry
 *
 * Registry of framework detection signatures.
 */
import type { FrameworkSignature } from "../types.js";
/**
 * Get all default framework signatures
 */
export declare function getDefaultSignatures(): FrameworkSignature[];
export declare class SignatureRegistry {
    private signatures;
    private categoryIndex;
    private tagIndex;
    constructor();
    /**
     * Load default signatures
     */
    private loadDefaults;
    /**
     * Register a signature
     */
    register(signature: FrameworkSignature): void;
    /**
     * Get signature by ID
     */
    get(id: string): FrameworkSignature | undefined;
    /**
     * Get all signatures
     */
    list(): FrameworkSignature[];
    /**
     * Get signatures by category
     */
    byCategory(category: string): FrameworkSignature[];
    /**
     * Get signatures by tag
     */
    byTag(tag: string): FrameworkSignature[];
    /**
     * Search signatures
     */
    search(query: string): FrameworkSignature[];
}
//# sourceMappingURL=registry.d.ts.map