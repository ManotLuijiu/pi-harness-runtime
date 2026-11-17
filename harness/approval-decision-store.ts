/**
 * The decisions that were made about an approval.
 *
 * The decision of a deadline is claimed with an exclusive create: the file
 * exists only when the claim was won. A second caller sees the file and
 * does not get a second decision, and a restart does not hand the same
 * decision out again.
 *
 * The claim is durable on purpose. A decision that was claimed and whose
 * resume was lost in a crash must not be handed out a second time: the
 * work would continue twice.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicCreateFileSync } from "../packages/cookie-sanitizer/dist/index.js";
import type { ApprovalDecision } from "./delegated-approval-types.ts";

/** Make a part of a path safe for the file system. */
function safePart(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-120);
}

/**
 * The decisions of the machine.
 */
export class ApprovalDecisionStore {
	/** The root of the store. */
	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	/** The directory of the decisions. */
	private decisionsDir(): string {
		return join(this.root, "decisions");
	}

	/** The path of the decision of a request. */
	private pathOf(requestId: string): string {
		return join(this.decisionsDir(), `${safePart(requestId)}.json`);
	}

	/**
	 * Claim the decision of a request.
	 *
	 * The result is true for the caller that won the claim and false for
	 * every other one.
	 */
	claim(decision: ApprovalDecision): boolean {
		mkdirSync(this.decisionsDir(), { recursive: true });
		try {
			// The exclusive create is the claim: it fails when the decision
			// of this request was already claimed.
			atomicCreateFileSync(
				this.pathOf(decision.requestId),
				JSON.stringify(decision, null, 2),
			);
			return true;
		} catch {
			return false;
		}
	}

	/** The decision of a request, when there is one. */
	get(requestId: string): ApprovalDecision | undefined {
		const path = this.pathOf(requestId);
		if (!existsSync(path)) return undefined;
		return readJson<ApprovalDecision>(path);
	}

	/** The decisions that were made. */
	list(): ApprovalDecision[] {
		const dir = this.decisionsDir();
		if (!existsSync(dir)) return [];
		const found: ApprovalDecision[] = [];
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			const decision = readJson<ApprovalDecision>(join(dir, name));
			if (decision) found.push(decision);
		}
		return found;
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
