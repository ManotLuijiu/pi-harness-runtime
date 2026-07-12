/**
 * Prompt Compiler - Validation
 *
 * Validates compiled sections against the request.
 * Fails fast on hard requirements.
 */

import type { NormalizedRequest } from "./normalize.js";
import type {
	PromptCompileErrorCode,
	PromptSection,
	ProviderPromptProfile,
} from "./types.js";
import { PromptCompileError } from "./types.js";

/**
 * Validation options.
 */
export interface ValidateOptions {
	provider: ProviderPromptProfile;
	maxRetries?: number;
}

/**
 * Validate compiled sections.
 *
 * Throws PromptCompileError for:
 * - Empty task ID
 * - Empty objective
 * - No expected outputs defined
 * - Token budget exceeded
 * - Required source unresolved
 */
export function validateSections(
	sections: PromptSection[],
	request: NormalizedRequest,
	_options: ValidateOptions,
): void {
	const errors: Array<{ code: PromptCompileErrorCode; message: string }> = [];

	// 1. Task ID must not be empty
	if (!request.taskId.trim()) {
		errors.push({
			code: "INVALID_TASK",
			message: "Task ID is empty",
		});
	}

	// 2. Objective must not be empty
	if (!request.objective.trim()) {
		errors.push({
			code: "MISSING_OBJECTIVE",
			message: "Objective is empty",
		});
	}

	// 3. At least one expected output required
	if (request.expectedOutputs.length === 0) {
		errors.push({
			code: "MISSING_OUTPUT_CONTRACT",
			message: "No expected outputs defined for task",
		});
	}

	// 4. Check required sections exist
	const requiredKinds = new Set(
		sections.filter((s) => s.required).map((s) => s.kind),
	);

	if (!requiredKinds.has("objective")) {
		errors.push({
			code: "MISSING_OBJECTIVE",
			message: "No objective section produced",
		});
	}

	// 5. Check for unresolved required sources
	for (const section of sections) {
		if (section.required) {
			for (const ref of section.sourceRefs) {
				if (!ref.text.trim()) {
					errors.push({
						code: "UNRESOLVED_REQUIRED_SOURCE",
						message: `Required source "${ref.source}" has no content`,
					});
				}
			}
		}
	}

	// 6. Check tool permissions don't conflict with policy
	for (const perm of request.toolPermissions) {
		if (isProhibitedTool(perm)) {
			errors.push({
				code: "POLICY_CONFLICT",
				message: `Tool permission "${perm}" is prohibited by policy`,
			});
		}
	}

	if (errors.length > 0) {
		throw new PromptCompileError(errors[0]?.code, errors[0]?.message, {
			errors,
		});
	}
}

/**
 * Validate that the token budget is not exceeded.
 */
export function validateTokenBudget(
	estimatedTokens: number,
	profile: ProviderPromptProfile,
): void {
	const available = profile.maximumInputTokens - profile.reservedOutputTokens;
	if (estimatedTokens > available) {
		throw new PromptCompileError(
			"TOKEN_BUDGET_EXCEEDED",
			`Estimated ${estimatedTokens} tokens exceeds available budget ${available}`,
			{
				estimatedTokens,
				availableTokens: available,
				maximumTokens: profile.maximumInputTokens,
				reservedOutput: profile.reservedOutputTokens,
			},
		);
	}
}

/**
 * List of tools/commands prohibited by default policy.
 * These are never permitted without explicit override.
 */
const PROHIBITED_TOOLS = new Set([
	"rm -rf /",
	"DROP DATABASE",
	"DELETE FROM",
	"TRUNCATE",
	"sudo rm",
	"git push --force",
	"bench --force",
	"yarn build",
	"npm run build",
	"pnpm build",
]);

function isProhibitedTool(permission: string): boolean {
	const normalized = permission.toLowerCase().trim();
	for (const prohibited of PROHIBITED_TOOLS) {
		if (normalized.includes(prohibited.toLowerCase())) {
			return true;
		}
	}
	return false;
}
