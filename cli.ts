/**
 * Pure helper functions — testable without pi context.
 * Imported by tracker.ts, mirror.ts, windows.ts, renderer.ts.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** Resolve the ~/.pi/usage-status/ directory. Override with PI_USAGE_DIR env var (testing). */
export function getUsageDir(): string {
	const override = process.env.PI_USAGE_DIR;
	if (override) return override;
	return join(homedir(), ".pi", "usage-status");
}

/** Resolve the JSONL usage log path. */
export function getUsageLogPath(): string {
	return join(getUsageDir(), "usage.jsonl");
}

/** Resolve the mirror JSON path. */
export function getMirrorPath(): string {
	return join(getUsageDir(), "mirror.json");
}

/** Ensure the directory exists. Idempotent. */
export function ensureUsageDir(): void {
	const dir = getUsageDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/** Read the JSONL usage log as an array of UsageRecord. Returns [] if missing. */
export function readJsonl<T>(path: string): T[] {
	if (!existsSync(path)) return [];
	const text = readFileSync(path, "utf-8");
	const out: T[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			out.push(JSON.parse(trimmed) as T);
		} catch {
			// skip corrupted line
		}
	}
	return out;
}

/** Append a single JSON line to a JSONL file. */
export function appendJsonl(path: string, record: unknown): void {
	ensureUsageDir();
	const line = JSON.stringify(record) + "\n";
	appendFileSync(path, line, "utf-8");
}

/** Read JSON file safely. Returns null if missing or corrupted. */
export function readJson(path: string): unknown | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

/** Write JSON file (creates parent dir if needed). */
export function writeJson(path: string, data: unknown): void {
	ensureUsageDir();
	if (!existsSync(dirname(path))) {
		mkdirSync(dirname(path), { recursive: true });
	}
	writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** Format milliseconds as "Xh Ym" or "Xd Yh" or "Xm" or "Xs". */
export function formatDuration(ms: number): string {
	const abs = Math.max(0, Math.floor(ms / 1000));
	const sec = abs % 60;
	const min = Math.floor(abs / 60) % 60;
	const hr = Math.floor(abs / 3600) % 24;
	const day = Math.floor(abs / 86400);
	if (day > 0) return `${day}d ${hr}h`;
	if (hr > 0) return `${hr}h ${min}m`;
	if (min > 0) return `${min}m`;
	return `${sec}s`;
}

/** Format a timestamp as relative time "X min ago". */
export function formatRelative(fromIso: string, nowMs: number): string {
	const fromMs = Date.parse(fromIso);
	if (isNaN(fromMs)) return "unknown";
	const deltaMs = nowMs - fromMs;
	return formatDuration(deltaMs) + " ago";
}

/** Format a token count with k/M suffix. */
export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Format USD cost with 2-4 decimals depending on size. */
export function formatUsd(n: number): string {
	if (n < 0.01) return `$${n.toFixed(4)}`;
	if (n < 100) return `$${n.toFixed(2)}`;
	return `$${n.toFixed(0)}`;
}