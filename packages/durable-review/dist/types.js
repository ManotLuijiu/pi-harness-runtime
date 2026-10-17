/**
 * Durable Review Types
 *
 * Public request/status/result types and validators.
 */
import { Type } from "typebox";
/**
 * TypeBox schemas for validation
 */
export const ReviewRequestSchema = Type.Object({
    requestId: Type.String({ minLength: 1 }),
    input: Type.Object({
        workspacePath: Type.String({ minLength: 1 }),
        diff: Type.Optional(Type.String()),
        stagedChanges: Type.Optional(Type.String()),
        unstagedChanges: Type.Optional(Type.String()),
        selectedFiles: Type.Optional(Type.Array(Type.String())),
        baseCommit: Type.Optional(Type.String()),
        prompt: Type.Optional(Type.String()),
    }),
    provider: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    maxPasses: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
    maxToolCalls: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
});
/**
 * Validate a review request
 */
export function validateReviewRequest(input) {
    try {
        // Simple validation without TypeBox runtime for now
        const req = input;
        if (!req.requestId || typeof req.requestId !== "string") {
            return { valid: false, error: "requestId is required" };
        }
        if (!req.input || typeof req.input !== "object") {
            return { valid: false, error: "input is required" };
        }
        if (!req.input.workspacePath || typeof req.input.workspacePath !== "string") {
            return { valid: false, error: "workspacePath is required" };
        }
        return {
            valid: true,
            request: {
                requestId: req.requestId,
                input: req.input,
                provider: req.provider,
                model: req.model,
                maxPasses: req.maxPasses ?? 5,
                maxToolCalls: req.maxToolCalls ?? 100,
            },
        };
    }
    catch (e) {
        return { valid: false, error: String(e) };
    }
}
//# sourceMappingURL=types.js.map