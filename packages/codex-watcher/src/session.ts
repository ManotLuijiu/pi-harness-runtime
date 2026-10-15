/**
 * Session discovery — reads ~/.codex/session_index.jsonl to find active sessions.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { CodexSession } from "./types.js";

/** Find the most recently active Codex session. */
export function getLatestSession(codexDir?: string): CodexSession | null {
	const indexPath = getSessionIndexPath(codexDir);
	if (!existsSync(indexPath)) return null;

	let latest: SessionIndexEntry | null = null;

	for (const line of readLines(indexPath)) {
		const entry = parseSessionIndexLine(line);
		if (!entry) continue;
		if (!latest || entry.updated_at > latest.updated_at) {
			latest = entry;
		}
	}

	if (!latest) return null;

	const rolloutPath = findRolloutPath(latest.id, codexDir);
	const projectRoot = getProjectRootFromRollout(rolloutPath);

	return {
		id: latest.id,
		threadName: latest.thread_name,
		updatedAt: latest.updated_at,
		rolloutPath,
		projectRoot,
	};
}

/** Get all sessions sorted by most recent first. */
export function getAllSessions(codexDir?: string): CodexSession[] {
	const indexPath = getSessionIndexPath(codexDir);
	if (!existsSync(indexPath)) return [];

	const sessions: SessionIndexEntry[] = [];
	for (const line of readLines(indexPath)) {
		const entry = parseSessionIndexLine(line);
		if (entry) sessions.push(entry);
	}

	return sessions
		.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
		.map((e) => {
			const rolloutPath = findRolloutPath(e.id, codexDir);
			const projectRoot = getProjectRootFromRollout(rolloutPath);
			return {
				id: e.id,
				threadName: e.thread_name,
				updatedAt: e.updated_at,
				rolloutPath,
				projectRoot,
			};
		});
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getSessionIndexPath(codexDir?: string): string {
	const home = codexDir ?? join(homedir(), ".codex");
	return join(home, "session_index.jsonl");
}

function findRolloutPath(sessionId: string, codexDir?: string): string {
	const home = codexDir ?? join(homedir(), ".codex");
	const sessionsDir = join(home, "sessions");

	// The rollout path follows: sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<sessionId>.jsonl
	// We need to find the file whose name ends with <sessionId>.jsonl
	// Since there can be multiple sessions per day, iterate all files.
	const found = walkForSession(sessionsDir, sessionId);
	if (found) return found;
	return join(sessionsDir, "unknown", `${sessionId}.jsonl`);
}

/** Recursively walk all subdirectories, yielding each directory path. */
function* walkDirs(dir: string): Generator<string> {
	try {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const stat = statSync(full);
			if (stat.isDirectory()) {
				yield full;
				yield* walkDirs(full);
			}
		}
	} catch {
		// Directory may not exist or be readable
	}
}

/** Find the rollout file for a given session ID by walking directories. */
function walkForSession(sessionsDir: string, sessionId: string): string | null {
	for (const dirPath of walkDirs(sessionsDir)) {
		try {
			for (const file of readdirSync(dirPath)) {
				if (file.startsWith("rollout-") && file.endsWith(`${sessionId}.jsonl`)) {
					return join(dirPath, file);
				}
			}
		} catch {
			// Skip unreadable directories
		}
	}
	return null;
}

interface SessionIndexEntry {
	id: string;
	thread_name: string;
	updated_at: string;
}

function parseSessionIndexLine(line: string): SessionIndexEntry | null {
	try {
		const obj = JSON.parse(line) as Record<string, unknown>;
		if (typeof obj.id !== "string" || typeof obj.thread_name !== "string") {
			return null;
		}
		return {
			id: obj.id as string,
			thread_name: obj.thread_name as string,
			updated_at: String(obj.updated_at ?? ""),
		};
	} catch {
		return null;
	}
}

function readLines(filePath: string): string[] {
	try {
		const content = readFileSync(filePath, "utf8");
		return content.split("\n").filter((l) => l.trim().length > 0);
	} catch {
		return [];
	}
}

/**
 * Parse rollout file for project working directory.
 * Looks for session_meta JSONL records containing the working directory.
 * Returns canonical absolute path or empty string if not found.
 */
function getProjectRootFromRollout(rolloutPath: string): string {
	try {
		if (!existsSync(rolloutPath)) return "";
		
		const lines = readLines(rolloutPath);
		
		// Look for session_meta records with working directory
		for (const line of lines) {
			try {
				const obj = JSON.parse(line) as Record<string, unknown>;
				if (obj.type === "session_meta" || obj.type === "session_start") {
					const data = obj.data as Record<string, unknown> | undefined;
					if (data && typeof data.working_directory === "string") {
						const cwd = data.working_directory as string;
						if (cwd && cwd.startsWith("/")) {
							// Canonicalize the path
							try {
								return realpathSync(cwd);
							} catch {
								return resolve(cwd);
							}
						}
					}
				}
			} catch {
				// Skip malformed JSON lines
			}
		}
	} catch {
		// File read error
	}
	return "";
}
