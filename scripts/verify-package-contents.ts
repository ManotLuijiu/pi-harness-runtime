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
import { builtinModules } from "node:module";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	extractBareImports,
	extractRelativeValueImports,
	extractStaticBareImports,
	findRequireCalls,
	hasLocalRequire,
	packageNameOf,
	resolveRelativeImport,
} from "./lib/runtime-imports.js";
import {
	readTermsFile,
	redactTerms,
	scanText,
	termsFromEnv,
} from "./check-sensitive-terms.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifyTarball = process.argv.includes("--pack");

interface Problem {
	kind:
		| "missing-dist"
		| "missing-import"
		| "broken-import"
		| "missing-tarball"
		| "missing-package"
		| "forbidden-path"
		| "missing-plugin"
		| "sensitive-content"
		| "undeclared-dependency"
		| "esm-require";
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

/**
 * Paths that must never reach the published package.
 *
 * `.pi/` holds per-machine extension state and the user's private skills.
 * `.pi-lens/` holds a local tool policy directory. The skill payload
 * directories hold skill content: skills live in the user's own Qdrant
 * collection and in the installation-local skill store, never in the
 * published repository.
 *
 * `packages/skills/` is NOT in this list: that package is the runtime
 * implementation that loads, queries and indexes skills.
 */
const FORBIDDEN_PACKAGE_PREFIXES = [
	".pi/",
	".pi-lens/",
	".agents/skills/",
	".claude/skills/",
];

/**
 * The one skill directory the package owns and publishes.
 *
 * `skills/harness-runtime/` is the skill of the package itself: it tells an
 * installed agent what the harness is. It is public content, written for
 * every user of the package, so it ships.
 *
 * Every other directory under `skills/` belongs to a user. Such a skill
 * lives in that user's own Qdrant collection and in their installation-local
 * skill store, and it must never reach the published tarball.
 */
const PACKAGE_SKILL_DIR = "skills/harness-runtime/";

/** The files the published skill directory must contain. */
const REQUIRED_SKILL_FILES = ["skills/harness-runtime/SKILL.md"];

/**
 * Whether a path is a skill payload that the package must not publish.
 *
 * A path under `skills/` is forbidden unless it belongs to the package's
 * own skill directory.
 */
function isForbiddenSkillPath(path: string): boolean {
	if (!path.startsWith("skills/")) return false;
	return !path.startsWith(PACKAGE_SKILL_DIR);
}

/** The plugin directory that ships with the package. */
const PLUGIN_DIR = "plugins";

/** The files a shipped herdr plugin must contain. */
const REQUIRED_PLUGIN_FILES = [
	"plugins/herdr-clipboard/herdr-plugin.toml",
	"plugins/herdr-clipboard/paste.sh",
	"plugins/herdr-clipboard/start-bridge.sh",
	"plugins/herdr-clipboard/tmux-watch.sh",
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

/**
 * The published package must not carry a skill payload or a local state
 * directory, and it must carry the plugin that the postinstall copies.
 *
 * The check runs on the git index, because that is what the release commits
 * and what npm packs from.
 */
function checkPackageLayout(): void {
	const tracked = spawnSync("git", ["ls-files"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const files =
		tracked.status === 0 ? tracked.stdout.split("\n").filter(Boolean) : [];

	for (const file of files) {
		const posix = file.split("\\").join("/");
		for (const prefix of FORBIDDEN_PACKAGE_PREFIXES) {
			if (posix.startsWith(prefix)) {
				problems.push({
					kind: "forbidden-path",
					detail: `${posix} is tracked - ${prefix} must not be committed`,
				});
				break;
			}
		}
		if (isForbiddenSkillPath(posix)) {
			problems.push({
				kind: "forbidden-path",
				detail: `${posix} is tracked - only ${PACKAGE_SKILL_DIR} may be committed`,
			});
		}
	}

	for (const required of REQUIRED_PLUGIN_FILES) {
		if (!files.includes(required)) {
			problems.push({
				kind: "missing-plugin",
				detail: `${required} is not tracked - the plugin would not ship`,
			});
		}
	}

	for (const required of REQUIRED_SKILL_FILES) {
		if (!files.includes(required)) {
			problems.push({
				kind: "missing-plugin",
				detail: `${required} is not tracked - the package would ship no skill`,
			});
		}
	}
}

/**
 * The terms of the list, and where they came from.
 *
 * The list is the repository secret, or the local file. A run without a
 * list scans nothing - and says so, because "no name was found" and
 * "nothing was looked at" are not the same statement.
 */
function sensitiveTerms(): { terms: string[]; source: string } {
	const fromEnv = termsFromEnv(process.env);
	if (fromEnv.length > 0) return { terms: fromEnv, source: "the environment" };
	const file = process.env.PI_SENSITIVE_TERMS_FILE;
	if (file) {
		const terms = readTermsFile(file);
		if (terms.length > 0) return { terms, source: file };
	}
	return { terms: [], source: "none" };
}

/**
 * The published files must not hold a client name.
 *
 * The other checks look at the paths of the published files. This one
 * looks at what is inside them: a name in a comment, in a doc or in a
 * string is published like any other byte, and npm keeps a published
 * version for a long time - long enough that the removal of one becomes
 * a support ticket.
 *
 * The report names the file and the line and never the term, and the
 * path is printed with the terms hidden because a path is often the
 * place the term is in.
 */
function checkSensitiveContent(files: string[]): void {
	const { terms, source } = sensitiveTerms();
	if (terms.length === 0) {
		// Nothing was checked. The release workflow runs this check on
		// its own, with the secret, and it fails closed.
		console.log(
			"[verify-package-contents] the sensitive content scan was skipped: no term list is configured",
		);
		return;
	}
	// A file that cannot be read is a file that was not checked. The
	// check fails closed for the same reason it fails closed on a
	// missing term list: "nothing was found" must not mean "nothing
	// was looked at".
	let unreadable = 0;
	for (const file of files) {
		let content: string;
		try {
			content = readFileSync(join(ROOT, file), "utf8");
		} catch {
			unreadable++;
			continue;
		}
		for (const found of scanText(content, file, terms)) {
			problems.push({
				kind: "sensitive-content",
				detail: `${redactTerms(found.path, terms)}:${found.line} holds a term from the sensitive list`,
			});
		}
	}
	console.log(
		`[verify-package-contents] the sensitive content scan looked at ${files.length - unreadable} published file(s) with the list of ${source}`,
	);
	if (unreadable > 0) {
		problems.push({
			kind: "sensitive-content",
			detail: `${unreadable} published file(s) could not be read, so the sensitive content scan did not cover them`,
		});
	}
}

/**
 * The postinstall copies the plugin from the package root.
 *
 * When the source directory moved to `plugins/` the copy script kept its
 * old path, and the plugin silently stopped being installed.
 */
function checkPluginCopySource(): void {
	const script = join(ROOT, "scripts", "copy-plugins.js");
	if (!existsSync(script)) {
		problems.push({
			kind: "missing-plugin",
			detail: "scripts/copy-plugins.js is missing - the plugin would not be installed",
		});
		return;
	}
	const source = readFileSync(script, "utf8");
	if (!source.includes(`"${PLUGIN_DIR}"`)) {
		problems.push({
			kind: "missing-plugin",
			detail: `scripts/copy-plugins.js does not read from the ${PLUGIN_DIR}/ directory`,
		});
	}
}

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

/**
 * The files npm would publish.
 *
 * The list comes from npm itself, so a check sees exactly what a consumer
 * gets - not what the repository happens to contain.
 */
async function packFileList(): Promise<string[]> {
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

	try {
		// `npm pack --json` returns an array with one entry per packed tarball.
		const parsed = JSON.parse(stdout) as
			| { files?: { path: string }[] }[]
			| { files?: { path: string }[] };
		const entries = Array.isArray(parsed) ? parsed : [parsed];
		return entries.flatMap((entry) => entry?.files ?? []).map((file) => file.path);
	} catch {
		return [];
	}
}

/**
 * The names of the workspace packages.
 *
 * The workspace packages ship inside this one tarball and are never
 * installed as separate packages, so a bare import that names one of them
 * cannot resolve at runtime - not in a consumer's installation, and not in
 * the repository either, because the workspace is never linked into
 * `node_modules` under its own name.
 */
function workspacePackageNames(): Set<string> {
	const names = new Set<string>();
	const packagesDir = join(ROOT, "packages");
	if (!existsSync(packagesDir)) return names;
	for (const name of readdirSync(packagesDir)) {
		const manifestPath = join(packagesDir, name, "package.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
				name?: string;
			};
			if (manifest.name) names.add(manifest.name);
		} catch {
			// A manifest that cannot be read names no package.
		}
	}
	return names;
}

/**
 * Every relative import of a published file must resolve.
 *
 * The published app reaches its internal packages through relative paths,
 * so an import that does not resolve is a module graph that breaks when it
 * runs. A published `.js` file has to reach a published file: a consumer
 * never sees the repository. A published `.ts` file is resolved by the
 * compiler, so it may reach a source file in the repository.
 *
 * The earlier import check only followed specifiers that contained
 * "packages/" and never looked at the compiled output, so an import inside
 * a package was never verified. That is how a package whose entry point
 * could not be imported reached the registry.
 */
function checkRelativeImports(files: string[]): void {
	const published = new Set(files);
	const workspaceNames = workspacePackageNames();

	for (const path of files) {
		if (!/\.(ts|mts|cts|mjs|js|cjs)$/.test(path)) continue;
		if (path.endsWith(".d.ts") || path.endsWith(".d.mts")) continue;
		const full = join(ROOT, path);
		if (!existsSync(full)) continue;
		const content = readFileSync(full, "utf8");
		for (const specifier of extractRelativeValueImports(content)) {
			const result = resolveRelativeImport({
				importer: full,
				specifier,
				exists: existsSync,
				isPublished: (candidate) =>
					published.has(relative(ROOT, candidate).split("\\").join("/")),
			});
			if (result.ok) continue;
			problems.push({
				kind: "broken-import",
				detail: `${path} imports ${specifier} but ${result.reason}`,
			});
		}
		// A bare import that names a workspace package names something that
		// is never installed: the workspace packages are inside this one
		// tarball. Such an import has to point at the built artifact.
		for (const specifier of extractBareImports(content)) {
			const name = packageNameOf(specifier);
			if (!workspaceNames.has(name)) continue;
			problems.push({
				kind: "broken-import",
				detail: `${path} imports ${specifier} but ${name} is a workspace package: it ships inside this tarball and is never installed, so the name cannot resolve`,
			});
		}
	}
}

/**
 * Every package that the published package declares.
 *
 * The consumer installs one package, so that one package has to carry the
 * dependencies of every module it ships. A module that imports a package
 * the manifest does not name cannot be imported by the consumer: the
 * dependency is missing from the install.
 *
 * A dynamic import is a different case: it is resolved when the code
 * reaches it, so a module that loads one at run time may treat it as an
 * optional dependency. Only a static import is checked here.
 */
function declaredDependencyNames(): Set<string> {
	const names = new Set<string>();
	let manifest: {
		dependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	};
	try {
		manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	} catch {
		return names;
	}
	for (const group of [
		manifest.dependencies,
		manifest.optionalDependencies,
		manifest.peerDependencies,
	]) {
		for (const name of Object.keys(group ?? {})) names.add(name);
	}
	return names;
}

/**
 * The names that a published module may import without a declaration.
 *
 * A Node builtin is always there. A test runner is only there when the
 * tests run, and a published module never imports one at run time.
 */
const ALWAYS_AVAILABLE_NAMES = new Set([
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
	"bun:test",
	"node:test",
]);

/**
 * Every static import of a published file must name a declared package.
 *
 * The check runs on the file list that npm itself produced, so it covers
 * exactly what a consumer receives - the compiled output included.
 */
function checkDeclaredDependencies(files: string[]): void {
	const declared = declaredDependencyNames();
	const workspaces = workspacePackageNames();
	for (const path of files) {
		if (!/\.(ts|mts|cts|mjs|js|cjs)$/.test(path)) continue;
		if (path.endsWith(".d.ts") || path.endsWith(".d.mts")) continue;
		const full = join(ROOT, path);
		if (!existsSync(full)) continue;
		const content = readFileSync(full, "utf8");
		for (const specifier of extractStaticBareImports(content)) {
			const name = packageNameOf(specifier);
			if (!name) continue;
			if (ALWAYS_AVAILABLE_NAMES.has(name)) continue;
			if (declared.has(name) || workspaces.has(name)) continue;
			problems.push({
				kind: "undeclared-dependency",
				detail: `${path} imports ${name}, which the published package does not declare - a consumer cannot import this module`,
			});
		}
	}
}

/**
 * A published module must not call `require` when it is loaded.
 *
 * The published package is an ES module (`"type": "module"`), and Node
 * has no `require` there: a call at the top level of a module throws the
 * moment the module is imported. A `require` inside a function is only a
 * problem when that function runs, so only the module scope is checked.
 */
/**
 * The module system of a published file.
 *
 * A file that belongs to a CommonJS package may call `require`. A file
 * that belongs to an ES module may not: Node has no `require` there.
 */
function moduleTypeOf(path: string): "module" | "commonjs" {
	let dir = dirname(resolve(ROOT, path));
	for (;;) {
		const manifestPath = join(dir, "package.json");
		if (existsSync(manifestPath)) {
			try {
				const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
					type?: string;
				};
				return manifest.type === "commonjs" ? "commonjs" : "module";
			} catch {
				return "module";
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return "module";
		dir = parent;
	}
}

/**
 * A published module must not call the global `require`.
 *
 * The published package is an ES module, and Node has no `require` there:
 * a call at the top level of a module throws the moment the module is
 * imported, and a call inside a function throws when that function runs.
 *
 * A module that builds its own `require` with `createRequire` owns a
 * working `require` and is not affected.
 */
function checkModuleScopeRequires(files: string[]): void {
	for (const path of files) {
		if (!path.endsWith(".js")) continue;
		if (moduleTypeOf(path) !== "module") continue;
		const full = join(ROOT, path);
		if (!existsSync(full)) continue;
		const content = readFileSync(full, "utf8");
		if (hasLocalRequire(content)) continue;
		for (const call of findRequireCalls(content)) {
			problems.push({
				kind: "esm-require",
				detail: call.moduleScope
					? `${path} calls require(${call.specifier}) when the module is loaded, but the published package is an ES module`
					: `${path} calls require(${call.specifier}), but the published package is an ES module and has no require`,
			});
		}
	}
}

/** The tarball npm would publish must contain the built output. */
function inspectTarball(files: string[]): void {
	for (const file of files) {
		const posix = file.split("\\").join("/");
		for (const prefix of FORBIDDEN_PACKAGE_PREFIXES) {
			if (posix.startsWith(prefix)) {
				problems.push({
					kind: "forbidden-path",
					detail: `${posix} is in the tarball - ${prefix} must not be published`,
				});
				break;
			}
		}
		if (isForbiddenSkillPath(posix)) {
			problems.push({
				kind: "forbidden-path",
				detail: `${posix} is in the tarball - only ${PACKAGE_SKILL_DIR} may be published`,
			});
		}
	}

	for (const required of REQUIRED_PLUGIN_FILES) {
		if (!files.includes(required)) {
			problems.push({
				kind: "missing-plugin",
				detail: `${required} is not in the tarball`,
			});
		}
	}

	for (const required of REQUIRED_SKILL_FILES) {
		if (!files.includes(required)) {
			problems.push({
				kind: "missing-plugin",
				detail: `${required} is not in the tarball`,
			});
		}
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

checkPackageLayout();
checkPluginCopySource();
checkImports();
checkPackageEntries();
checkStaleOutputs();

// The published file list drives both the import check and the tarball
// check: it is what a consumer receives.
const publishedFiles = await packFileList();
if (publishedFiles.length === 0) {
	problems.push({
		kind: "missing-tarball",
		detail: "npm pack --dry-run did not return a file list",
	});
} else {
	checkRelativeImports(publishedFiles);
	checkDeclaredDependencies(publishedFiles);
	checkModuleScopeRequires(publishedFiles);
	checkSensitiveContent(publishedFiles);
	if (verifyTarball) inspectTarball(publishedFiles);
}

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
	`[verify-package-contents] OK - ${runtimeImports.size} runtime import(s) resolved, ${
		publishedFiles.length
	} published file(s) checked${verifyTarball ? ", tarball verified" : ""}`,
);
