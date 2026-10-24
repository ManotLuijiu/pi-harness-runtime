/**
 * Skill API Error Classes (RFC-0106)
 */
import { ErrorCodes } from "./types.js";
/**
 * Error thrown when Skills API request fails
 */
export class SkillAPIError extends Error {
    code;
    method;
    data;
    constructor(message, code, method, data) {
        super(message);
        this.code = code;
        this.method = method;
        this.data = data;
        this.name = "SkillAPIError";
    }
    /**
     * Check if this is an auth error
     */
    isAuthError() {
        return this.code === ErrorCodes.UNAUTHORIZED;
    }
    /**
     * Check if this is a tier restriction error
     */
    isTierRestricted() {
        return this.code === ErrorCodes.TIER_RESTRICTED;
    }
    /**
     * Check if this is a rate limit error
     */
    isRateLimited() {
        return this.code === ErrorCodes.RATE_LIMITED;
    }
    /**
     * Check if this is a not found error
     */
    isNotFound() {
        return this.code === ErrorCodes.NOT_FOUND;
    }
}
/**
 * Error thrown when cache operations fail
 */
export class SkillCacheError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "SkillCacheError";
    }
}
/**
 * Error thrown when skill validation fails
 */
export class SkillValidationError extends Error {
    skillId;
    issues;
    constructor(message, skillId, issues) {
        super(message);
        this.skillId = skillId;
        this.issues = issues;
        this.name = "SkillValidationError";
    }
}
//# sourceMappingURL=errors.js.map