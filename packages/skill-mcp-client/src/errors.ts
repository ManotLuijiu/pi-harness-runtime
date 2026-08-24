/**
 * Skill API Error Classes (RFC-0106)
 */

import { ErrorCodes } from "./types.js";

/**
 * Error thrown when Skills API request fails
 */
export class SkillAPIError extends Error {
 constructor(
  message: string,
  public readonly code: number,
  public readonly method?: string,
  public readonly data?: unknown,
 ) {
  super(message);
  this.name = "SkillAPIError";
 }

 /**
  * Check if this is an auth error
  */
 isAuthError(): boolean {
  return this.code === ErrorCodes.UNAUTHORIZED;
 }

 /**
  * Check if this is a tier restriction error
  */
 isTierRestricted(): boolean {
  return this.code === ErrorCodes.TIER_RESTRICTED;
 }

 /**
  * Check if this is a rate limit error
  */
 isRateLimited(): boolean {
  return this.code === ErrorCodes.RATE_LIMITED;
 }

 /**
  * Check if this is a not found error
  */
 isNotFound(): boolean {
  return this.code === ErrorCodes.NOT_FOUND;
 }
}

/**
 * Error thrown when cache operations fail
 */
export class SkillCacheError extends Error {
 constructor(
  message: string,
  public readonly cause?: Error,
 ) {
  super(message);
  this.name = "SkillCacheError";
 }
}

/**
 * Error thrown when skill validation fails
 */
export class SkillValidationError extends Error {
 constructor(
  message: string,
  public readonly skillId?: string,
  public readonly issues?: string[],
 ) {
  super(message);
  this.name = "SkillValidationError";
 }
}
