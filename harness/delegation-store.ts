/**
 * The delegations the user recorded in advance.
 *
 * A delegation says: "if I do not answer within the window, continue with
 * a commit". It is durable, and it belongs to a workspace.
 *
 * The delegations live in one directory per workspace, and every
 * delegation is one file. Two Pi instances therefore never overwrite each
 * other, and a delegation that is recorded twice replaces only itself.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../packages/cookie-sanitizer/dist/index.js";
import type { DelegatedOperationKind, Delegation } from "./delegated-approval-types.ts";
import { isDelegatedOperationKind } from "./delegated-approval-types.ts";

/** Make a part of a path safe for the file system. */
function safePart(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-120);
}

/**
 * The delegations of the machine.
 */
export class DelegationStore {
	/** The root of the store. */
	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	/** The directory of the delegations of a workspace. */
	private workspaceDir(workspace: string): string {
		return join(this.root, "delegations", safePart(workspace));
	}

	/**
	 * Record a delegation.
	 *
	 * The write is atomic: the file is renamed over its target, so a
	 * reader never sees a delegation without its kinds.
	 */
	record(delegation: Delegation): void {
		const dir = this.workspaceDir(delegation.workspace);
		mkdirSync(dir, { recursive: true });
		atomicWriteFileSync(
			join(dir, `${safePart(delegation.id)}.json`),
			JSON.stringify(delegation, null, 2),
		);
	}

	/**
	 * The delegations of a workspace.
	 *
	 * A delegation that cannot be read is skipped: a broken record never
	 * authorizes anything.
	 */
	list(workspace: string): Delegation[] {
		const dir = this.workspaceDir(workspace);
		if (!existsSync(dir)) return [];
		const found: Delegation[] = [];
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			const delegation = readJson<Delegation>(join(dir, name));
			if (!delegation) continue;
			if (delegation.workspace !== workspace) continue;
			if (!Array.isArray(delegation.kinds)) continue;
			if (!delegation.kinds.every(isDelegatedOperationKind)) continue;
			found.push({
				...delegation,
				kinds: delegation.kinds as DelegatedOperationKind[],
			});
		}
		return found;
	}

	/**
	 * Remove a delegation.
	 *
	 * The result is true when a delegation was removed.
	 */
	remove(id: string): boolean {
		const dir = join(this.root, "delegations");
		if (!existsSync(dir)) return false;
		for (const workspace of readdirSync(dir)) {
			const path = join(dir, workspace, `${safePart(id)}.json`);
			if (!existsSync(path)) continue;
			try {
				unlinkSync(path);
				return true;
			} catch {
				return false;
			}
		}
		return false;
	}
}

/** Read a JSON file, or nothing when it cannot be read. */
function readJson<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}
