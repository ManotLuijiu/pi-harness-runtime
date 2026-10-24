/**
 * The saved tooling preference of a user in a workspace.
 *
 * The store is a plain JSON file under the harness runtime directory: it
 * works in every runtime (a SQLite file would not - `node:sqlite` is
 * missing in some of them) and it stays readable for the user.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolingPreference } from "./proposal.js";

export interface ToolingPreferenceRecord {
	/** The saved decision, when the user answered. */
	decision?: ToolingPreference;
	/** When the proposal was sent. */
	askedAt?: string;
	/** When the user answered. */
	decidedAt?: string;
	/** The request ID of the proposal that was sent. */
	requestId?: string;
	/** The workspace the record belongs to. */
	workspaceRoot?: string;
	/** The channel the answer came from. */
	channel?: string;
}

type StoreFile = Record<string, ToolingPreferenceRecord>;

function shortHash(value: string, length = 16): string {
	return createHash("sha256").update(value).digest("hex").slice(0, length);
}

/**
 * The key of one record: the user and the workspace.
 */
export function toolingPreferenceKey(userKey: string, workspaceRoot: string): string {
	return `${userKey}::${shortHash(workspaceRoot)}`;
}

/**
 * The runtime directory of the harness.
 */
export function harnessRuntimeDir(): string {
	const configured = process.env.PI_HARNESS_HOME?.trim();
	if (configured) return configured;
	return join(homedir(), ".pi-harness-runtime");
}

export class ToolingPreferenceStore {
	constructor(private readonly filePath: string) {}

	/**
	 * The default store: `~/.pi-harness-runtime/tooling-preference.json`.
	 */
	static defaultFilePath(): string {
		return join(harnessRuntimeDir(), "tooling-preference.json");
	}

	/**
	 * The record of one user in one workspace.
	 */
	read(userKey: string, workspaceRoot: string): ToolingPreferenceRecord | undefined {
		const data = this.load();
		return data[toolingPreferenceKey(userKey, workspaceRoot)];
	}

	/**
	 * Remember that the proposal was sent.
	 */
	markAsked(
		userKey: string,
		workspaceRoot: string,
		requestId: string,
		now: Date = new Date(),
	): void {
		const key = toolingPreferenceKey(userKey, workspaceRoot);
		const data = this.load();
		const existing = data[key] ?? {};
		data[key] = {
			...existing,
			askedAt: now.toISOString(),
			requestId,
			workspaceRoot,
		};
		this.save(data);
	}

	/**
	 * Save the answer of the user.
	 */
	recordDecision(
		userKey: string,
		workspaceRoot: string,
		decision: ToolingPreference,
		requestId: string,
		channel?: string,
		now: Date = new Date(),
	): void {
		const key = toolingPreferenceKey(userKey, workspaceRoot);
		const data = this.load();
		const existing = data[key] ?? {};
		data[key] = {
			...existing,
			decision,
			decidedAt: now.toISOString(),
			askedAt: existing.askedAt ?? now.toISOString(),
			requestId,
			workspaceRoot,
			...(channel ? { channel } : {}),
		};
		this.save(data);
	}

	private load(): StoreFile {
		if (!existsSync(this.filePath)) return {};
		try {
			const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
			return parsed as StoreFile;
		} catch {
			// A broken store must not stop the harness: the proposal is
			// simply asked again.
			return {};
		}
	}

	private save(data: StoreFile): void {
		try {
			mkdirSync(dirname(this.filePath), { recursive: true });
			const temporary = `${this.filePath}.tmp`;
			writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
			// The rename keeps a half written file from being read.
			renameSync(temporary, this.filePath);
		} catch {
			// A store that cannot be written is a lost preference, not a
			// broken harness.
		}
	}
}

/**
 * May the proposal be sent again?
 *
 * A workspace that was asked and never answered is asked again after the
 * cooldown - the user may have missed it. A workspace with a decision is
 * never asked again.
 */
export function shouldAskAgain(
	record: ToolingPreferenceRecord | undefined,
	cooldownMs: number,
	now: Date = new Date(),
): boolean {
	if (!record) return true;
	if (record.decision) return false;
	if (!record.askedAt) return true;
	const askedAt = Date.parse(record.askedAt);
	if (Number.isNaN(askedAt)) return true;
	return now.getTime() - askedAt >= cooldownMs;
}
