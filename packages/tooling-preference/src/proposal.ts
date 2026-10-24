/**
 * The tooling proposal: request IDs, buttons and the wording.
 *
 * The proposal is a decision of its own. It never travels through the
 * task-approval path, because a "No" there pauses the work and a "Yes"
 * there resumes it - neither belongs to a tooling preference.
 */

import { createHash } from "node:crypto";
import type { ToolingContext } from "./detect.js";

/**
 * The callback action of the proposal.
 *
 * The callback data is parsed by splitting on "_", so an action must be a
 * single token: an action that carries an underscore would be read as the
 * action up to that underscore, and the rest as the target.
 */
export const TOOLING_ACTION = "biome";

/** The answer of the user. */
export type ToolingChoice = "yes" | "no";

/** The saved preference of a user in a workspace. */
export type ToolingPreference = "prefer_biome" | "use_project_tools";

export interface ToolingButton {
	/** The label of the button. */
	text: string;
	/** The callback action - always `TOOLING_ACTION`. */
	action: string;
	/** The choice and the request ID, e.g. `yes-biome-<hash>`. */
	targetId: string;
}

export interface ToolingTarget {
	choice: ToolingChoice;
	requestId: string;
}

function shortHash(value: string, length = 16): string {
	return createHash("sha256").update(value).digest("hex").slice(0, length);
}

/**
 * The canonical request ID of one proposal.
 *
 * The request ID is the correlation key: both channels send the same ID,
 * and the first answer wins. It only holds hex characters and dashes so it
 * survives the "_" split of the callback data.
 */
export function buildToolingRequestId(userKey: string, workspaceRoot: string): string {
	return `biome-${shortHash(`${userKey} ${workspaceRoot}`)}`;
}

/**
 * The key of the user the proposal is sent to.
 *
 * The identity is hashed: the store holds the key of a user, never the id
 * of the user.
 */
export function buildToolingUserKey(identity: string): string {
	const trimmed = identity.trim();
	if (!trimmed) return "default";
	return `u-${shortHash(`user:${trimmed}`)}`;
}

/**
 * The two buttons of the proposal.
 */
export function buildToolingButtons(requestId: string): ToolingButton[] {
	return [
		{
			text: "Yes - use Biome.js",
			action: TOOLING_ACTION,
			targetId: `yes-${requestId}`,
		},
		{
			text: "No - keep the current tools",
			action: TOOLING_ACTION,
			targetId: `no-${requestId}`,
		},
	];
}

/**
 * Read the choice and the request ID out of a callback target.
 *
 * A target that does not belong to the proposal returns `null` - a click on
 * a foreign button must never resolve a preference.
 */
export function parseToolingTarget(targetId: string | undefined): ToolingTarget | null {
	if (!targetId) return null;
	const match = /^(yes|no)-(.+)$/.exec(targetId);
	if (!match) return null;
	return { choice: match[1] as ToolingChoice, requestId: match[2] };
}

/**
 * The wording of the proposal.
 */
export function buildToolingProposalMessage(context: ToolingContext): string {
	const frameworks: string[] = [];
	if (context.isNextJs) frameworks.push("Next.js");
	if (context.isReact && !context.isNextJs) frameworks.push("React");

	const tools: string[] = [];
	if (context.usesEslint) tools.push("ESLint");
	if (context.usesPrettier) tools.push("Prettier");

	const lines: string[] = [];
	lines.push(
		frameworks.length > 0
			? `This workspace looks like a ${frameworks.join(" + ")} project that still uses ${tools.join(" and ")}.`
			: `This workspace looks like a JavaScript/TypeScript project that still uses ${tools.join(" and ")}.`,
	);
	lines.push("");
	lines.push("Biome.js can replace both: one tool for linting, formatting and import order.");
	lines.push("");
	lines.push(`Detected: ${tools.join(", ")}${context.packageManager ? ` - ${context.packageManager}` : ""}`);
	lines.push("");
	lines.push(
		"Yes adds Biome and migrates the lint/format setup here. No keeps the current tools. Nothing changes until you answer.",
	);
	return lines.join("\n");
}

/**
 * The instruction the agent receives after a "Yes".
 *
 * The agent does the repository work: the harness only records the
 * decision and starts the implementation.
 */
export function buildToolingImplementationPrompt(
	context: ToolingContext,
	workspaceRoot: string,
): string {
	const frameworks: string[] = [];
	if (context.isNextJs) frameworks.push("Next.js");
	if (context.isReact && !context.isNextJs) frameworks.push("React");

	const manager = context.packageManager;
	let install = "install it as a dev dependency with the package manager of the workspace";
	if (manager === "npm") {
		install = "install it with npm install --save-dev";
	} else if (manager) {
		install = `install it with ${manager} add --save-dev`;
	}

	const lines: string[] = [];
	lines.push(
		`The user chose to use Biome.js in this workspace (${workspaceRoot}). Implement it now.`,
	);
	lines.push("");
	lines.push("1. Add Biome to the dev dependencies: " + install + " @biomejs/biome.");
	lines.push("2. Add a biome.json that fits the project:");
	if (frameworks.length > 0) {
		lines.push(`   - enable the ${frameworks.join(" and ")} rules,`);
	}
	lines.push("   - enable the formatter, the linter and the import organizer,");
	lines.push("   - keep the settings that match the existing code style (indentation, quotes, semicolons).");
	lines.push(
		"3. Replace the lint and format scripts in package.json with the Biome equivalents (biome check, biome format, biome ci).",
	);
	lines.push(
		"4. Migrate the ESLint and Prettier configuration that Biome replaces and remove the files Biome fully replaces.",
	);
	lines.push("5. Keep the type check and the tests as they are - Biome does not replace them.");
	lines.push("6. Run the Biome check, fix what it reports in the files you touched, and report the result.");
	lines.push("");
	lines.push("Do not touch files outside this workspace and do not change the public behaviour of the code.");
	return lines.join("\n");
}
