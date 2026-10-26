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
/**
 * The environment variable that names the directory the operator wants to
 * sync skills FROM.
 */
export declare const SKILLS_SOURCE_ENV = "PI_HARNESS_SKILLS_SOURCE";
/**
 * Expand a leading `~` to the home directory.
 *
 * A shell expands `~`, a program does not, and the operator writes the
 * value the way they would write it on a command line.
 */
export declare function expandHome(path: string): string;
/**
 * The directory the operator configured as the skill source, if any.
 */
export declare function getSkillsSource(): string | undefined;
/**
 * The source the operator asked for on the command line, if any.
 *
 * The `--from` argument wins over the environment variable, because the
 * argument is the more specific statement.
 */
export declare function getSkillsSourceFromArgs(args: string[]): string | undefined;
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
export declare function syncSkillsScriptPath(moduleUrl?: string): string | undefined;
/**
 * The hint that tells the operator how to sync skills, when it applies.
 *
 * The hint applies when the harness skills directory exists but is empty
 * and the configured source directory holds skills. It returns undefined
 * when there is nothing to suggest.
 */
export declare function skillsSyncHint(): string | undefined;
//# sourceMappingURL=sync-source.d.ts.map