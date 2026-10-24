/**
 * Tooling detection for a workspace.
 *
 * The proposal ("use Biome.js instead of ESLint + Prettier") is only made
 * for a JavaScript/TypeScript workspace that still uses ESLint or Prettier
 * and does not use Biome yet. The detection reads the workspace itself -
 * it never guesses from the harness.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const ESLINT_CONFIGS = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.mjs",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
];
const PRETTIER_CONFIGS = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
    "prettier.config.ts",
];
const BIOME_CONFIGS = ["biome.json", "biome.jsonc", "biome.json5"];
const NEXT_CONFIGS = [
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRECTORIES = new Set([
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    "vendor",
    ".git",
    ".next",
    ".turbo",
    ".cache",
]);
function readPackageJson(root) {
    const path = join(root, "package.json");
    if (!existsSync(path))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (!parsed || typeof parsed !== "object")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function allDependencies(pkg) {
    if (!pkg)
        return {};
    return {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
    };
}
function anyExists(root, names) {
    return names.some((name) => existsSync(join(root, name)));
}
/**
 * Is there a JavaScript/TypeScript source file in the workspace?
 *
 * The scan is shallow on purpose: it only answers "does this workspace hold
 * JS/TS code at all", so it stops at the first source file and never walks
 * a build or dependency directory.
 */
function hasSourceFile(root, maxDepth = 2) {
    const queue = [{ dir: root, depth: 0 }];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current)
            break;
        let entries;
        try {
            entries = readdirSync(current.dir);
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.startsWith("."))
                continue;
            const full = join(current.dir, entry);
            let isDirectory = false;
            try {
                isDirectory = statSync(full).isDirectory();
            }
            catch {
                continue;
            }
            if (isDirectory) {
                if (current.depth < maxDepth && !IGNORED_DIRECTORIES.has(entry)) {
                    queue.push({ dir: full, depth: current.depth + 1 });
                }
                continue;
            }
            if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Which package manager does the workspace use?
 *
 * The `packageManager` field wins; a lockfile decides otherwise.
 */
export function detectPackageManager(root, pkg) {
    const declared = pkg?.packageManager?.split("@")[0]?.trim();
    if (declared)
        return declared;
    if (existsSync(join(root, "pnpm-lock.yaml")))
        return "pnpm";
    if (existsSync(join(root, "yarn.lock")))
        return "yarn";
    if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb")))
        return "bun";
    if (existsSync(join(root, "package-lock.json")))
        return "npm";
    return null;
}
/**
 * Read the tooling facts of a workspace.
 */
export function detectToolingContext(root) {
    const pkg = readPackageJson(root);
    const deps = allDependencies(pkg);
    const hasPackageJson = pkg !== null;
    const hasTsConfig = existsSync(join(root, "tsconfig.json"));
    const isNextJs = Boolean(deps.next) || anyExists(root, NEXT_CONFIGS);
    const isReact = Boolean(deps.react || deps["react-dom"]) || isNextJs;
    const isTypeScript = hasTsConfig || Boolean(deps.typescript) || hasSourceFile(root);
    return {
        root,
        hasPackageJson,
        isJavaScriptTypeScript: hasPackageJson && isTypeScript,
        isNextJs,
        isReact,
        usesBiome: anyExists(root, BIOME_CONFIGS) || Boolean(deps["@biomejs/biome"]),
        usesEslint: anyExists(root, ESLINT_CONFIGS) || Boolean(deps.eslint),
        usesPrettier: anyExists(root, PRETTIER_CONFIGS) || Boolean(deps.prettier),
        packageManager: detectPackageManager(root, pkg),
        frameworks: [
            ...(isNextJs ? ["next"] : []),
            ...(isReact && !isNextJs ? ["react"] : []),
        ],
    };
}
/**
 * May the Biome proposal be sent for this workspace?
 *
 * A workspace that already uses Biome is never asked about Biome, and a
 * workspace without ESLint and Prettier has nothing to replace.
 */
export function evaluateBiomeProposalEligibility(context) {
    if (!context.hasPackageJson) {
        return {
            eligible: false,
            reason: "the workspace has no package.json",
        };
    }
    if (!context.isJavaScriptTypeScript) {
        return {
            eligible: false,
            reason: "the workspace is not a JavaScript/TypeScript project",
        };
    }
    if (context.usesBiome) {
        return {
            eligible: false,
            reason: "Biome is already configured in this workspace",
        };
    }
    if (!context.usesEslint && !context.usesPrettier) {
        return {
            eligible: false,
            reason: "the workspace uses neither ESLint nor Prettier",
        };
    }
    return {
        eligible: true,
        reason: "the workspace uses ESLint and/or Prettier and no Biome",
    };
}
//# sourceMappingURL=detect.js.map