/**
 * The command line tools the harness uses outside of Pi.
 *
 * The harness leans on a few tools: bd (beads) keeps the issues of the
 * session, and the notices of the startup tell the user when one of them is
 * missing and how to install it.
 *
 * The lookup reads the path instead of running the command: a tool that
 * hangs would hang the startup, and the startup is the first thing the user
 * sees.
 */

import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";

/**
 * The default check: is the candidate a file that can be run?
 */
function defaultExists(candidate: string): boolean {
	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * The extensions a command can have on Windows.
 */
function windowsExtensions(pathext: string | undefined): string[] {
	const extensions = (pathext ?? ".COM;.EXE;.BAT;.CMD")
		.split(";")
		.map((extension) => extension.trim())
		.filter((extension) => extension.length > 0);
	return extensions.length > 0 ? extensions : [""];
}

/**
 * The path of a command, or null when it is not installed.
 *
 * The search follows the PATH of the environment. A directory that does not
 * exist is skipped, and a command that is not runnable is not a command.
 */
export function findOnPath(
	command: string,
	options: {
		/** The PATH to search. */
		path?: string | undefined;
		/** The platform the lookup runs on. */
		platform?: string | undefined;
		/** The PATHEXT of the environment (Windows). */
		pathext?: string | undefined;
		/** Is the candidate runnable? The default checks the file system. */
		exists?: (candidate: string) => boolean;
	} = {},
): string | null {
	const pathValue = options.path ?? "";
	const platform = options.platform ?? process.platform;
	const exists = options.exists ?? defaultExists;
	const separator = pathValue.includes(";") ? ";" : ":";
	const extensions =
		platform === "win32" ? windowsExtensions(options.pathext) : [""];
	for (const directory of pathValue.split(separator)) {
		if (!directory) continue;
		for (const extension of extensions) {
			const candidate = join(directory, `${command}${extension}`);
			if (exists(candidate)) return candidate;
		}
	}
	return null;
}

/**
 * The version a tool reports, or undefined when it does not report one.
 *
 * The tool is run with a timeout: a tool that hangs must not hang the
 * startup. A tool that fails is not an error of the startup - the version is
 * a convenience, not a fact the session depends on.
 */
export async function readToolVersion(
	command: string,
	options: {
		/** How long the tool may take. */
		timeoutMs?: number | undefined;
	} = {},
): Promise<string | undefined> {
	try {
		const output = await new Promise<string>((resolve, reject) => {
			execFile(
				command,
				["--version"],
				{
					timeout: options.timeoutMs ?? 2000,
					windowsHide: true,
					encoding: "utf8",
				},
				(error, stdout) => {
					if (error) reject(error);
					else resolve(String(stdout ?? ""));
				},
			);
		});
		const line = output
			.split("\n")
			.map((part) => part.trim())
			.find((part) => part.length > 0);
		return line && line.length > 0 ? line : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The version number of a version line.
 *
 * The tools report their version in their own words ("bd version 1.1.2
 * (20e493e56)"). The number is what the user compares with the release
 * notes, so the rest of the line is dropped.
 */
export function versionNumber(line: string | undefined): string | undefined {
	if (!line) return undefined;
	const match = line.match(/\d+\.\d+\.\d+[^\s]*/);
	return match ? match[0] : undefined;
}
