/**
 * React/Vite Analyzer (RFC-0063)
 *
 * Deep analysis of React/Vite workspaces via filesystem inspection.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactViteAnalysis, ConfigFile } from "./types.js";

// ─── Detection ───────────────────────────────────────────────────────────────

function isReactViteWorkspace(root: string): boolean {
	return (
		existsSync(join(root, "vite.config.ts")) ||
		existsSync(join(root, "vite.config.js")) ||
		existsSync(join(root, "vite.config.mjs")) ||
		(existsSync(join(root, "package.json")) && existsSync(join(root, "src")))
	);
}

// ─── Version & Dependencies ─────────────────────────────────────────────────

async function detectVersionAndDeps(
	root: string,
): Promise<{
	version?: string;
	plugins: string[];
	hasRouter: boolean;
	routerType?: string;
}> {
	try {
		const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
		const deps = {
			...(pkg.dependencies ?? {}),
			...(pkg.devDependencies ?? {}),
		};

		const version = deps.react
			? deps.react.replace(/[\^~>=<]/, "")
			: (deps["react-native"]?.replace(/[\^~>=<]/, "") ?? undefined);

		const plugins: string[] = [];
		if (deps["@vitejs/plugin-react"]) plugins.push("@vitejs/plugin-react");
		if (deps["@vitejs/plugin-vue"]) plugins.push("@vitejs/plugin-vue");
		if (deps.vite) plugins.push("vite");

		let hasRouter = false;
		let routerType: string | undefined;
		if (deps["react-router-dom"] || deps["react-router"]) {
			hasRouter = true;
			routerType = "react-router";
		} else if (deps["@tanstack/react-router"]) {
			hasRouter = true;
			routerType = "tanstack-router";
		}

		return { version, plugins, hasRouter, routerType };
	} catch {
		return { plugins: [], hasRouter: false };
	}
}

// ─── Config Files ────────────────────────────────────────────────────────────

async function findConfigFiles(root: string): Promise<ConfigFile[]> {
	const candidates = [
		join(root, "vite.config.ts"),
		join(root, "vite.config.js"),
		join(root, "vite.config.mjs"),
		join(root, "tsconfig.json"),
		join(root, "jsconfig.json"),
	];
	const configs: ConfigFile[] = [];
	for (const p of candidates) {
		if (existsSync(p)) {
			configs.push({ name: p.split("/").pop()!, path: p });
		}
	}
	return configs;
}

// ─── Alias Parsing ───────────────────────────────────────────────────────────

async function parseAliases(root: string): Promise<Record<string, string>> {
	const aliases: Record<string, string> = {};

	// Parse vite.config.ts/js for path aliases
	for (const cfgName of [
		"vite.config.ts",
		"vite.config.js",
		"vite.config.mjs",
	]) {
		const cfgPath = join(root, cfgName);
		if (!existsSync(cfgPath)) continue;
		try {
			const content = await readFile(cfgPath, "utf-8");
			// Match: alias: { find: '~', replacement: ... } or ['@', 'src']
			const aliasMatches = content.matchAll(
				/(?:resolve\.alias|alias)\s*[:=]\s*\{([^}]+)\}/g,
			);
			for (const match of aliasMatches) {
				const block = match[1];
				const findMatches = block.matchAll(
					/(?:find|match)\s*:\s*["']([^"']+)["'][^}]*(?:replacement|replace)\s*:\s*["']([^"']+)["']/g,
				);
				for (const f of findMatches) {
					aliases[f[1]] = f[2];
				}
				// Simple array alias: ['@', 'src']
				const simple = block.matchAll(
					/["']([^"']+)["']\s*,\s*["']([^"']+)["']/g,
				);
				for (const s of simple) {
					if (s[1] !== "find" && s[1] !== "replacement") {
						aliases[s[1]] = s[2];
					}
				}
			}
		} catch {
			// ignore
		}
	}

	// Parse tsconfig.json for path mappings
	const tsconfigPath = join(root, "tsconfig.json");
	if (existsSync(tsconfigPath)) {
		try {
			const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf-8"));
			const paths = tsconfig.compilerOptions?.paths;
			if (paths) {
				for (const [k, v] of Object.entries(paths)) {
					const resolved = (v as string[])[0];
					if (resolved) {
						// Keys like "@/*" → "@", "components/*" → "components"
						const key = k.replace(/\/\*$/, "").replace(/\/+$/, "");
						// Values like "./src/*" → "./src"
						const val = resolved.replace(/\/\*$/, "").replace(/\/+$/, "");
						aliases[key] = val;
					}
				}
			}
		} catch {
			// ignore
		}
	}

	return aliases;
}

// ─── Component Scanner ───────────────────────────────────────────────────────

async function walkComponents(
	dir: string,
	exts: string[] = [".tsx", ".jsx", ".ts", ".js"],
): Promise<string[]> {
	const components: string[] = [];
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				components.push(...(await walkComponents(full, exts)));
			} else {
				const ext = entry.name.match(/\.[^.]+$/)?.[0];
				if (ext && exts.includes(ext)) {
					components.push(full);
				}
			}
		}
	} catch {
		// ignore
	}
	return components;
}

// ─── Pages Scanner ───────────────────────────────────────────────────────────

async function findPages(root: string): Promise<string[]> {
	for (const d of [
		join(root, "src", "pages"),
		join(root, "src", "views"),
		join(root, "pages"),
		join(root, "views"),
	]) {
		if (existsSync(d)) {
			return walkComponents(d);
		}
	}
	return [];
}

// ─── Main Analyzer ─────────────────────────────────────────────────────────

export async function analyzeReactVite(
	root: string,
): Promise<ReactViteAnalysis | null> {
	if (!isReactViteWorkspace(root)) return null;

	const [versionInfo, configs, aliases, pages] = await Promise.all([
		detectVersionAndDeps(root),
		findConfigFiles(root),
		parseAliases(root),
		findPages(root),
	]);

	const srcDir = join(root, "src");
	const components = existsSync(srcDir) ? await walkComponents(srcDir) : [];

	return {
		framework: {
			id: "react-vite",
			name: "React + Vite",
			category: "frontend",
			description: "React SPA with Vite build tool",
			tags: ["react", "vite", "frontend", "typescript"],
		},
		...versionInfo,
		components,
		pages,
		configs,
		aliases,
	};
}
