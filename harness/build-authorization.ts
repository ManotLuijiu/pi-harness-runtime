/**
 * The coverage of a build operation.
 *
 * A delegation for a build covers the build of the workspace it was
 * recorded in: the build of the bench, or the build script of the project.
 *
 * The check is deliberately narrow. A package script is executable project
 * code that may do more than compile, so a script that the project does
 * not have is not a build of the project. A build command beside another
 * operation names no build here: a delegation for a build may not cover an
 * operation the user never delegated.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildFormOf } from "./delegated-approval-types.ts";

/**
 * The build that a proposal covers, when the proposal covers one.
 *
 * The result is the form of the build, not the command: the runner of a
 * package script is not part of it, because the script of the project is
 * the same for every runner.
 */
export function coveredBuildForm(
	text: string | undefined,
	workspace: string,
): string | undefined {
	const form = buildFormOf(text);
	if (!form) return undefined;
	if (form === "bench build") {
		return isBench(workspace) ? form : undefined;
	}
	if (form === "package build") {
		return hasBuildScript(workspace) ? form : undefined;
	}
	return undefined;
}

/**
 * Is the workspace a bench?
 *
 * The build of a bench needs a bench: the command of another project is
 * not a build of this one.
 */
function isBench(workspace: string): boolean {
	try {
		return statSync(join(workspace, "sites")).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Does the project have a build script?
 */
function hasBuildScript(workspace: string): boolean {
	try {
		const manifest: unknown = JSON.parse(
			readFileSync(join(workspace, "package.json"), "utf8"),
		);
		if (!isRecord(manifest)) return false;
		const scripts = manifest.scripts;
		if (!isRecord(scripts)) return false;
		const script = scripts.build;
		return typeof script === "string" && script.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Is the value a record of its own?
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
