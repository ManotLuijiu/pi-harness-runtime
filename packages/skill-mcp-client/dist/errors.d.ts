/**
 * Skill API Error Classes (RFC-0106)
 */
/**
 * Error thrown when Skills API request fails
 */
export declare class SkillAPIError extends Error {
    readonly code: number;
    readonly method?: string | undefined;
    readonly data?: unknown;
    constructor(message: string, code: number, method?: string | undefined, data?: unknown);
    /**
     * Check if this is an auth error
     */
    isAuthError(): boolean;
    /**
     * Check if this is a tier restriction error
     */
    isTierRestricted(): boolean;
    /**
     * Check if this is a rate limit error
     */
    isRateLimited(): boolean;
    /**
     * Check if this is a not found error
     */
    isNotFound(): boolean;
}
/**
 * Error thrown when cache operations fail
 */
export declare class SkillCacheError extends Error {
    readonly cause?: Error | undefined;
    constructor(message: string, cause?: Error | undefined);
}
/**
 * Error thrown when skill validation fails
 */
export declare class SkillValidationError extends Error {
    readonly skillId?: string | undefined;
    readonly issues?: string[] | undefined;
    constructor(message: string, skillId?: string | undefined, issues?: string[] | undefined);
}
//# sourceMappingURL=errors.d.ts.map