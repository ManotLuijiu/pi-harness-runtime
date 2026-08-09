/**
 * Detection utilities for checking if rpiv-todo is installed
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Check if @juicesharp/rpiv-todo is installed globally via npm
 */
export function isRpivTodoInstalled(): boolean {
	try {
		// Check npm global packages
		const output = execSync(
			"npm list -g @juicesharp/rpiv-todo 2>/dev/null || echo 'NOT_FOUND'",
			{
				encoding: "utf8",
				timeout: 5000,
			},
		);
		return (
			output.includes("@juicesharp/rpiv-todo") && !output.includes("NOT_FOUND")
		);
	} catch {
		return false;
	}
}

/**
 * Check if rpiv-todo is loaded in pi extensions
 * This checks common extension directories
 */
export function isRpivTodoLoaded(): boolean {
	// Check pi-agent extensions directory
	const extensionsDir = join(homedir(), ".pi", "agent", "extensions");

	// Check for rpiv-todo related files
	const possiblePaths = [
		join(extensionsDir, "rpiv-todo"),
		join(extensionsDir, "@juicesharp", "rpiv-todo"),
		join(extensionsDir, "node_modules", "@juicesharp", "rpiv-todo"),
	];

	for (const path of possiblePaths) {
		if (existsSync(path)) {
			return true;
		}
	}

	// Also check if the module can be resolved
	try {
		require.resolve("@juicesharp/rpiv-todo");
		return true;
	} catch {
		// Not found via require
	}

	return false;
}

/**
 * Get the version of rpiv-todo if installed
 */
export function getRpivTodoVersion(): string | null {
	try {
		const output = execSync(
			"npm list -g @juicesharp/rpiv-todo --json 2>/dev/null | grep '\"version\"' | head -1",
			{ encoding: "utf8", timeout: 5000 },
		);
		const match = output.match(/"version":\s*"([^"]+)"/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

/**
 * Check if bd CLI is installed
 */
export function isBdInstalled(): boolean {
	try {
		const output = execSync("which bd 2>/dev/null || echo 'NOT_FOUND'", {
			encoding: "utf8",
			timeout: 5000,
		});
		return output.includes("bd") && !output.includes("NOT_FOUND");
	} catch {
		return false;
	}
}

/**
 * Check if bd is initialized in the current project
 * (i.e., .beads/ directory exists)
 */
export function isBdInitialized(cwd?: string): boolean {
	const projectDir = cwd || process.cwd();
	const beadsDir = join(projectDir, ".beads");
	return existsSync(beadsDir);
}

/**
 * Get the version of bd CLI if installed
 */
export function getBdVersion(): string | null {
	try {
		const output = execSync("bd --version 2>/dev/null || echo 'unknown'", {
			encoding: "utf8",
			timeout: 5000,
		});
		return output.trim().replace("bd version ", "");
	} catch {
		return null;
	}
}

/**
 * Get installation status of both dependencies
 */
/**
 * Get installation status of both dependencies
 */
export interface DependencyStatus {
	rpivTodo: {
		installed: boolean;
		version: string | null;
		loaded: boolean;
	};
	bd: {
		installed: boolean;
		version: string | null;
		initialized: boolean;
		installUrl: string;
	};
}

export function getDependencyStatus(cwd?: string): DependencyStatus {
	const installed = isBdInstalled();
	return {
		rpivTodo: {
			installed: isRpivTodoInstalled(),
			version: getRpivTodoVersion(),
			loaded: isRpivTodoLoaded(),
		},
		bd: {
			installed,
			version: installed ? getBdVersion() : null,
			initialized: installed ? isBdInitialized(cwd) : false,
			installUrl: "https://github.com/beads/bd#installation",
		},
	};
}

/**
 * Log dependency status for debugging
 */
export function logDependencyStatus(): void {
	const status = getDependencyStatus();
	console.log("[DEBUG todo-bd-sync] Dependency check:");
	console.log(
		`  rpiv-todo: installed=${status.rpivTodo.installed}, version=${status.rpivTodo.version}, loaded=${status.rpivTodo.loaded}`,
	);
	console.log(
		`  bd: installed=${status.bd.installed}, version=${status.bd.version}, initialized=${status.bd.initialized}`,
	);
	if (!status.bd.installed) {
		console.log(`  bd install: ${status.bd.installUrl}`);
	}
}
