/**
 * The skill sync: where the skills come from, and which script performs it.
 *
 * The source tree is installation data, not a constant of the product: the
 * package must not guess a path on the operator's machine, and it must not
 * print one either. The operator names the directory with an environment
 * variable, and every message the package prints uses that name.
 *
 * The script is the other half and it belongs to the package, so it is
 * found relative to the module - it works wherever the package was
 * installed.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The environment variable that names the directory the operator wants to
 * sync skills FROM.
 */
export const SKILLS_SOURCE_ENV = "PI_HARNESS_SKILLS_SOURCE";

/**
 * Expand a leading `~` to the home directory.
 *
 * A shell expands `~`, a program does not, and the operator writes the
 * value the way they would write it on a command line.
 */
export function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/**
 * The directory the operator configured as the skill source, if any.
 */
export function getSkillsSource(): string | undefined {
	const raw = process.env[SKILLS_SOURCE_ENV]?.trim();
	if (!raw) return undefined;
	return expandHome(raw);
}

/**
 * The source the operator asked for on the command line, if any.
 *
 * The `--from` argument wins over the environment variable, because the
 * argument is the more specific statement.
 */
export function getSkillsSourceFromArgs(args: string[]): string | undefined {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--from" || arg === "-f") return args[i + 1];
		if (arg.startsWith("--from=")) return expandHome(arg.slice("--from=".length));
	}
	return getSkillsSource();
}

/**
 * The path of the sync script that ships with this package.
 *
 * The script lives in `scripts/` at the package root, and this module
 * lives in `packages/skills/src/` (or in `packages/skills/dist/` when the
 * package is compiled), so the script is three levels up. Finding it
 * relative to the module works wherever the package was installed - the
 * source of the skills is the operator's business, the script is ours.
 *
 * An installation without the script is a real state: the caller reports
 * it instead of spawning a path that does not exist.
 */
export function syncSkillsScriptPath(
	moduleUrl: string = import.meta.url,
): string | undefined {
	const path = fileURLToPath(
		new URL("../../../scripts/sync-skills.ts", moduleUrl),
	);
	return existsSync(path) ? path : undefined;
}

/**
 * The hint that tells the operator how to sync skills, when it applies.
 *
 * The hint applies when the harness skills directory exists but is empty
 * and the configured source directory holds skills. It returns undefined
 * when there is nothing to suggest.
 */
export function skillsSyncHint(): string | undefined {
	try {
		const harnessDir = join(homedir(), ".pi-harness-runtime", "skills");
		if (!existsSync(harnessDir)) return undefined;

		const entries = readdirSync(harnessDir).filter((n: string) => n !== "harness-runtime");
		if (entries.length > 0) return undefined; // Has user skills, nothing to suggest

		const source = getSkillsSource();
		if (!source) return undefined;
		if (!existsSync(source)) return undefined;

		const skillEntries = readdirSync(source).filter((n: string) =>
			existsSync(join(source, n, "SKILL.md")),
		);
		if (skillEntries.length === 0) return undefined;

		return (
			`[pi-harness] ${skillEntries.length} skill(s) found in ${source}. ` +
			`Sync them: bun scripts/sync-skills.ts --from ${source}`
		);
	} catch {
		// Non-fatal — ignore errors
		return undefined;
	}
}
