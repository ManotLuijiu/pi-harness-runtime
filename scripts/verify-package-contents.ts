#!/usr/bin/env bun
/**
 * Verify that the published `pi-harness-runtime` package is a SINGLE, self
 * contained app.
 *
 * The user installs one package:
 *
 *     npm install pi-harness-runtime
 *
 * and must get every internal app with it. The internal packages are not
 * published on their own, so the runtime reaches them through relative paths
 * into `packages/<name>/...`. That only works when:
 *
 *   1. every internal package was built (its `dist` exists), and
 *   2. every VALUE import of the shipped runtime resolves to a file that the
 *      build produces, and
 *   3. the tarball that npm publishes actually contains those files.
 *
 * A type-only import is erased at runtime, so it may keep pointing at the
 * source. A value import may not: `packages/<pkg>/src/<file>.js` only exists
 * when somebody compiled the package in place, and a clean build emits into
 * `dist/`. The published app would then fail to import it.
 *
 * Usage:
 *   bun scripts/verify-package-contents.ts            # file checks
 *   bun scripts/verify-package-contents.ts --pack     # also inspect the tarball
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifyTarball = process.argv.includes("--pack");

interface Problem {
	kind: "missing-dist" | "missing-import" | "missing-tarball" | "missing-package";
	detail: string;
}

const problems: Problem[] = [];
/** Every runtime import that must resolve: "file -> specifier". */
const runtimeImports = new Map<string, { file: string; specifier: string; target: string }>();

/** Every directory whose sources are part of the published tarball. */
const SHIPPED_SOURCE_DIRS = ["harness", "scripts", "packages"];

const SHIPPED_ROOT_FILES = [
	"index.ts",
	"status-parsers.ts",
	"tracker.ts",
	"windows.ts",
];

function listFiles(dir: string, filter: (file: string) => boolean): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		let isDir = false;
		try {
			isDir = statSync(full).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			// node_modules and the build output of a package are not sources.
			if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
			out.push(...listFiles(full, filter));
		} else if (filter(full)) {
			out.push(full);
		}
	}
	return out;
}

function isSourceFile(file: string): boolean {
	return /\.(ts|mts|cts|mjs|js)$/.test(file) && !file.endsWith(".d.ts");
}

/** Every source file that ends up in the published package. */
function shippedSourceFiles(): string[] {
	const files: string[] = [];
	for (const name of SHIPPED_ROOT_FILES) {
		const full = join(ROOT, name);
		if (existsSync(full)) files.push(full);
	}
	for (const dir of SHIPPED_SOURCE_DIRS) {
		files.push(...listFiles(join(ROOT, dir), isSourceFile));
	}
	return files;
}

// A value import: a static import without the `type` keyword, a dynamic
// import or a side effect import.
const STATIC_IMPORT = /import\s+(type\s+)?[^;]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function checkImports(): void {
	for (const file of shippedSourceFiles()) {
		const content = readFileSync(file, "utf8");
		const consider = (specifier: string) => {
			if (!specifier.startsWith(".")) return;
			if (!specifier.includes("packages/")) return;
			const target = resolve(dirname(file), specifier);
			const key = `${file} -> ${specifier}`;
			runtimeImports.set(key, { file, specifier, target });
			if (!existsSync(target)) {
				problems.push({
					kind: "missing-import",
					detail: `${relative(ROOT, file)} imports ${specifier} but ${
						relative(ROOT, target)
					} does not exist`,
				});
			}
		};

		for (const match of content.matchAll(STATIC_IMPORT)) {
			if (match[1]) continue; // type-only import: erased at runtime
			consider(match[2]);
		}
		for (const match of content.matchAll(DYNAMIC_IMPORT)) consider(match[1]);
		for (const match of content.matchAll(SIDE_EFFECT_IMPORT)) consider(match[1]);
	}
}

/** Collect every file path a package manifest promises to publish. */
function manifestEntries(manifest: {
	main?: string;
	exports?: unknown;
	bin?: unknown;
}): string[] {
	const entries: string[] = [];
	if (typeof manifest.main === "string") entries.push(manifest.main);
	if (typeof manifest.bin === "string") entries.push(manifest.bin);
	else if (manifest.bin && typeof manifest.bin === "object") {
		for (const value of Object.values(manifest.bin as Record<string, string>)) {
			if (typeof value === "string") entries.push(value);
		}
	}

	const walk = (node: unknown): void => {
		if (typeof node === "string") {
			if (node.startsWith("./")) entries.push(node);
			return;
		}
		if (node && typeof node === "object") {
			for (const value of Object.values(node as Record<string, unknown>)) walk(value);
		}
	};
	walk(manifest.exports);

	return [...new Set(entries)];
}

/** Is the file tracked by git? A clean checkout only has tracked files. */
function isTracked(file: string): boolean {
	const run = spawnSync("git", ["ls-files", "--error-unmatch", "--", file], {
		cwd: ROOT,
		encoding: "utf8",
	});
	return run.status === 0;
}

/**
 * Every workspace package must have its published entry points built.
 *
 * An entry that points into `src/` is a defect: the build emits into
 * `dist/`, so a `src/*.js` entry only exists when somebody compiled the
 * package in place and would be missing from a clean checkout.
 */
function checkPackageEntries(): void {
	const packagesDir = join(ROOT, "packages");
	if (!existsSync(packagesDir)) return;

	for (const entry of readdirSync(packagesDir)) {
		const dir = join(packagesDir, entry);
		if (!statSync(dir).isDirectory()) continue;
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) continue;

		let manifest: { main?: string; exports?: unknown; bin?: unknown };
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		} catch {
			continue;
		}

		for (const target of manifestEntries(manifest)) {
			const full = join(dir, target);
			if (!existsSync(full)) {
				problems.push({
					kind: "missing-package",
					detail: `packages/${entry} publishes ${target} but the file is not built`,
				});
				continue;
			}
			if (target.startsWith("./src/") && target.endsWith(".js")) {
				// A package without any TypeScript source is vendored as
				// compiled JavaScript (the telegram app). Its entry point
				// stays in src/ - but the file must be tracked, otherwise a
				// clean checkout publishes a package without its entry point.
				const hasTypeScript = listFiles(join(dir, "src"), (file) =>
					file.endsWith(".ts") && !file.endsWith(".d.ts"),
				).length > 0;
				const tracked = isTracked(join(dir, target));
				if (hasTypeScript) {
					problems.push({
						kind: "missing-package",
						detail: `packages/${entry} publishes ${target} from src/ - point it at the built dist/ file`,
					});
				} else if (!tracked) {
					problems.push({
						kind: "missing-package",
						detail: `packages/${entry} publishes ${target} from src/ but the file is not tracked by git`,
					});
				}
			}
		}
	}
}

/**
 * A built output that is older than its source is stale.
 *
 * The release publishes the compiled `dist/`, so a dist that is older than the
 * source it was compiled from ships yesterday's code. The build clears the
 * incremental state before it compiles, so a fresh build is never stale.
 */
function checkStaleOutputs(): void {
	const packagesDir = join(ROOT, "packages");
	if (!existsSync(packagesDir)) return;

	for (const entry of readdirSync(packagesDir)) {
		const dir = join(packagesDir, entry);
		if (!statSync(dir).isDirectory()) continue;
		if (!existsSync(join(dir, "tsconfig.json"))) continue;
		if (!existsSync(join(dir, "dist"))) continue;

		const sources = listFiles(dir, (file) => {
			if (!file.endsWith(".ts") || file.endsWith(".d.ts")) return false;
			const rel = relative(dir, file).split("\\").join("/");
			if (rel.startsWith("dist/") || rel.startsWith("node_modules/")) return false;
			// Test sources are not part of the published build.
			return !/^(test|tests|__tests__)\//.test(rel);
		});
		const outputs = listFiles(join(dir, "dist"), (file) => file.endsWith(".js"));
		if (sources.length === 0 || outputs.length === 0) continue;

		const newestSource = Math.max(...sources.map((file) => statSync(file).mtimeMs));
		const oldestOutput = Math.min(...outputs.map((file) => statSync(file).mtimeMs));
		if (newestSource > oldestOutput + 1_000) {
			const newest = sources
				.map((file) => ({ file, mtime: statSync(file).mtimeMs }))
				.sort((a, b) => b.mtime - a.mtime)[0];
			problems.push({
				kind: "missing-dist",
				detail: `packages/${entry} has a stale build - ${relative(
					ROOT,
					newest.file,
				)} is newer than the compiled output. Run "bun run build".`,
			});
		}
	}
}

/** The tarball npm would publish must contain the built output. */
async function inspectTarball(): Promise<void> {
	const stdout = await new Promise<string>((resolveText, rejectText) => {
		execFile(
			"npm",
			["pack", "--dry-run", "--json", "--ignore-scripts"],
			{ cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
			(error, out, err) => {
				if (error) {
					rejectText(new Error(`${error.message}: ${String(err).slice(0, 400)}`));
					return;
				}
				resolveText(out);
			},
		);
	});

	let files: string[] = [];
	try {
		// `npm pack --json` returns an array with one entry per packed tarball.
		const parsed = JSON.parse(stdout) as
			| { files?: { path: string }[] }[]
			| { files?: { path: string }[] };
		const entries = Array.isArray(parsed) ? parsed : [parsed];
		files = entries.flatMap((entry) => entry?.files ?? []).map((file) => file.path);
		if (files.length === 0) {
			problems.push({
				kind: "missing-tarball",
				detail: "npm pack --dry-run did not return a file list",
			});
			return;
		}
	} catch {
		problems.push({
			kind: "missing-tarball",
			detail: "npm pack --dry-run did not return a file list",
		});
		return;
	}

	const inTarball = new Set(files);
	for (const { file, specifier, target } of runtimeImports.values()) {
		const relativeTarget = relative(ROOT, target).split("\\").join("/");
		if (!inTarball.has(relativeTarget)) {
			problems.push({
				kind: "missing-tarball",
				detail: `${relativeTarget} (imported by ${relative(
					ROOT,
					file,
				)} as ${specifier}) is not in the tarball`,
			});
		}
	}
}

checkImports();
checkPackageEntries();
checkStaleOutputs();
if (verifyTarball) await inspectTarball();

if (problems.length > 0) {
	console.error(`[verify-package-contents] FAILED with ${problems.length} problem(s):`);
	for (const problem of problems) {
		console.error(`  - [${problem.kind}] ${problem.detail}`);
	}
	console.error(
		"",
		"Every internal package must ship inside pi-harness-runtime. Run `bun run build` and check the tsc output before publishing.",
	);
	process.exit(1);
}

console.log(
	`[verify-package-contents] OK - ${runtimeImports.size} runtime import(s) resolved${
		verifyTarball ? ", tarball verified" : ""
	}`,
);
