/**
 * CLI Plugin SDK — Types (RFC-0067)
 */

import type { PluginManifest } from "../../framework-plugin-sdk/src/types.js";

export interface PluginCLIConfig {
	cwd?: string;
	globalDir?: string;
	registry?: string;
	npmBin?: string;
}

export interface InstalledPlugin {
	name: string;
	version: string;
	path: string;
	manifest: PluginManifest | null;
}

export interface PluginSearchResult {
	name: string;
	version: string;
	description: string;
	downloads: number;
}

export interface InvokeResult {
	success: boolean;
	result?: unknown;
	error?: string;
}
