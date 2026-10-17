/**
 * Durable Review Extension
 *
 * Small Pi command adapter for /harness-review, /harness-review-status, /harness-review-cancel.
 */
/**
 * Handle /harness-review command
 */
export declare function handleHarnessReview(args: {
    request: string;
    workspacePath?: string;
}): Promise<string>;
/**
 * Handle /harness-review-status command
 */
export declare function handleHarnessReviewStatus(args: {
    jobId: string;
    workspacePath?: string;
}): Promise<string>;
/**
 * Handle /harness-review-cancel command
 */
export declare function handleHarnessReviewCancel(args: {
    jobId: string;
    workspacePath?: string;
}): Promise<string>;
/**
 * Check for command collisions before registration
 */
export declare function checkCommandCollisions(commands: string[]): string[];
//# sourceMappingURL=extension.d.ts.map