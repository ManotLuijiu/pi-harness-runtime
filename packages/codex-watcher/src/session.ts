/**
 * Session discovery — reads ~/.codex/session_index.jsonl to find active sessions.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

	return {
		id: latest.id,
		threadName: latest.thread_name,
		updatedAt: latest.updated_at,
		rolloutPath: findRolloutPath(latest.id, codexDir),
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
		.map((e) => ({
			id: e.id,
			threadName: e.thread_name,
			updatedAt: e.updated_at,
			rolloutPath: findRolloutPath(e.id, codexDir),
		}));
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
	try {
		const { readdirSync } = require("node:fs") as typeof import("node:fs");
		for (const dirPath of walkDirs(sessionsDir)) {
			for (const file of readdirSync(dirPath)) {
				if (file.endsWith(`${sessionId}.jsonl`)) {
					return join(dirPath, file);
				}
			}
		}
	} catch {
		// walkSync may not be available on all Node versions; fall back to find
	}
	return findRolloutPathFallback(sessionId, sessionsDir);
}

function findRolloutPathFallback(
	sessionId: string,
	sessionsDir: string,
): string {
	const found = walkForSession(sessionsDir, sessionId);
	return found ?? join(sessionsDir, "unknown", `${sessionId}.jsonl`);
}

/** Recursively walk all subdirectories, yielding each directory path. */
function* walkDirs(dir: string): Generator<string> {
	const { readdirSync, statSync } =
		require("node:fs") as typeof import("node:fs");
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			yield full;
			yield* walkDirs(full);
		}
	}
}

/** Find the rollout file for a given session ID by walking directories. */
function walkForSession(sessionsDir: string, sessionId: string): string | null {
	const { readdirSync } = require("node:fs") as typeof import("node:fs");
	for (const dirPath of walkDirs(sessionsDir)) {
		for (const file of readdirSync(dirPath)) {
			if (file.startsWith("rollout-") && file.endsWith(`${sessionId}.jsonl`)) {
				return join(dirPath, file);
			}
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
