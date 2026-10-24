/**
 * Tooling detection for a workspace.
 *
 * The proposal ("use Biome.js instead of ESLint + Prettier") is only made
 * for a JavaScript/TypeScript workspace that still uses ESLint or Prettier
 * and does not use Biome yet. The detection reads the workspace itself -
 * it never guesses from the harness.
 */
export interface ToolingContext {
    /** Absolute workspace root. */
    root: string;
    /** The workspace has a package.json. */
    hasPackageJson: boolean;
    /** The workspace is a JavaScript/TypeScript project. */
    isJavaScriptTypeScript: boolean;
    /** Next.js is in use. */
    isNextJs: boolean;
    /** React is in use. */
    isReact: boolean;
    /** Biome is configured or installed. */
    usesBiome: boolean;
    /** ESLint is configured or installed. */
    usesEslint: boolean;
    /** Prettier is configured or installed. */
    usesPrettier: boolean;
    /** The package manager the workspace uses, if it can be told. */
    packageManager: string | null;
    /** The frameworks that were detected. */
    frameworks: string[];
}
interface PackageJson {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    packageManager?: string;
}
/**
 * Which package manager does the workspace use?
 *
 * The `packageManager` field wins; a lockfile decides otherwise.
 */
export declare function detectPackageManager(root: string, pkg: PackageJson | null): string | null;
/**
 * Read the tooling facts of a workspace.
 */
export declare function detectToolingContext(root: string): ToolingContext;
export interface ProposalEligibility {
    /** May the proposal be sent? */
    eligible: boolean;
    /** Why the proposal is (not) sent - a human wording. */
    reason: string;
}
/**
 * May the Biome proposal be sent for this workspace?
 *
 * A workspace that already uses Biome is never asked about Biome, and a
 * workspace without ESLint and Prettier has nothing to replace.
 */
export declare function evaluateBiomeProposalEligibility(context: ToolingContext): ProposalEligibility;
export {};
//# sourceMappingURL=detect.d.ts.map