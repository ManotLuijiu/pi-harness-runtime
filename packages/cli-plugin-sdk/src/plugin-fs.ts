/**
 * CLI Plugin SDK — Filesystem Operations (RFC-0067)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { InstalledPlugin, PluginCLIConfig } from "./types.js";

/**
 * Resolve plugin directory from config
 */
export function resolvePluginDir(config: PluginCLIConfig): string {
	return config.globalDir ?? join(config.cwd ?? process.cwd(), "node_modules");
}

/**
 * Check if a plugin is installed
 */
export function isInstalled(name: string, config: PluginCLIConfig): boolean {
	const dir = join(resolvePluginDir(config), name);
	return existsSync(dir);
}

/**
 * Get installed plugin info
 */
export function getInstalledPlugin(
	name: string,
	config: PluginCLIConfig,
): InstalledPlugin | null {
	const dir = join(resolvePluginDir(config), name);
	if (!existsSync(dir)) return null;

	let manifest: InstalledPlugin["manifest"] = null;
	const pkgPath = join(dir, "package.json");
	if (existsSync(pkgPath)) {
		try {
			manifest = JSON.parse(
				readFileSync(pkgPath, "utf-8"),
			) as InstalledPlugin["manifest"];
		} catch {
			// ignore parse errors
		}
	}

	return {
		name,
		version: manifest?.version ?? "unknown",
		path: dir,
		manifest,
	};
}

/**
 * List all installed pi-* plugins
 */
export function listInstalledPlugins(
	config: PluginCLIConfig,
): InstalledPlugin[] {
	const pluginDir = resolvePluginDir(config);
	if (!existsSync(pluginDir)) return [];

	const plugins: InstalledPlugin[] = [];
	try {
		const entries = readdirSync(pluginDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const name = entry.name;
			const fullPath = join(pluginDir, name);
			try {
				const pkgPath = join(fullPath, "package.json");
				if (!existsSync(pkgPath)) continue;
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
					version?: string;
					pi?: { sdkVersion?: string };
					name?: string;
				};
				if (!pkg.pi && !pkg.name?.startsWith("@pi/")) continue;
				plugins.push({
					name: pkg.name ?? name,
					version: pkg.version ?? "unknown",
					path: fullPath,
					manifest: pkg as InstalledPlugin["manifest"],
				});
			} catch {}
		}
	} catch {
		// dir doesn't exist
	}
	return plugins;
}
