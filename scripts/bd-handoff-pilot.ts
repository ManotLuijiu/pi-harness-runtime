#!/usr/bin/env bun
/**
 * The isolated pilot of the watcher of the handoffs.
 *
 * The unit tests of the watcher use stand-ins for bd. They prove the
 * harness, not the program: a stand-in cannot show that the watcher reads
 * the store of a real bd, and that a handoff that a real producer wrote
 * arrives in a session.
 *
 * This pilot runs the watcher against the real bd of the machine:
 *
 * - it builds an isolated store when the workspace has none,
 * - it writes one issue that carries a handoff for this agent,
 * - it starts the watcher, checks the store and reads the delivery,
 * - it reads the durable cursor, which may only move after the delivery.
 *
 * The durable state of the pilot lives in a temporary directory, so the
 * pilot never touches the state of the real harness and can run again.
 *
 * ```bash
 * bun scripts/bd-handoff-pilot.ts [--store <path>] [--recipient <name>] [--binary <path>] [--keep]
 * ```
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	BdHandoffSession,
	formatBdHandoffStatus,
} from "../harness/bd-handoff-session.ts";
import { BdHandoffStore } from "../harness/bd-handoff-state.ts";
import type { BdHandoffDelivery } from "../harness/bd-handoff-runtime.ts";

/**
 * What the pilot runs against.
 */
interface PilotOptions {
	/** The workspace of the store of the pilot. */
	store: string;
	/** The name of this agent in the handoff. */
	recipient: string;
	/** The binary of bd. */
	binary: string;
	/** Keep the workspace of the pilot afterwards. */
	keep: boolean;
}

/**
 * The revision of the handoff of the pilot.
 *
 * The revision is above one on purpose: a handoff that a producer repeats
 * with a new revision is a new handoff.
 */
const REVISION = 2;

/**
 * The id of the handoff of the pilot.
 */
const HANDOFF_ID = "h1";

/**
 * The usage of the pilot.
 */
const USAGE = `Usage: bun scripts/bd-handoff-pilot.ts [--store <path>] [--recipient <name>] [--binary <path>] [--keep]`;

/**
 * The options of the pilot.
 */
function parseArgs(argv: string[]): PilotOptions {
	const options: PilotOptions = {
		store: "",
		recipient: "pi",
		binary: "bd",
		keep: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = (): string => {
			const next = argv[index + 1];
			if (next === undefined) {
				console.error(USAGE);
				process.exit(2);
			}
			index += 1;
			return next;
		};
		switch (arg) {
			case "--store":
				options.store = value();
				break;
			case "--recipient":
				options.recipient = value();
				break;
			case "--binary":
				options.binary = value();
				break;
			case "--keep":
				options.keep = true;
				break;
			default:
				console.error(USAGE);
				process.exit(2);
		}
	}
	return options;
}

/**
 * Run bd in a workspace.
 *
 * The binary and its arguments are passed as they are: no shell, and no
 * interpretation of a path by a shell.
 */
function bd(binary: string, args: string[], cwd: string): string {
	try {
		return execFileSync(binary, args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		// The message of bd is the reason of the failure: without it the
		// pilot reports only that a program exited with a code.
		const failure = error as { stderr?: string; message?: string };
		const reason = (failure.stderr ?? "").trim() || failure.message || "bd failed";
		throw new Error(`bd ${args.join(" ")} failed in ${cwd}: ${reason}`);
	}
}

/**
 * The issues of a store that are open for work.
 */
function openIssues(binary: string, store: string): Array<{
	id: string;
	title: string;
	metadata?: Record<string, unknown>;
}> {
	const output = bd(
		binary,
		[
			"--readonly",
			"list",
			"--json",
			"--status",
			"open,in_progress,blocked,deferred",
			"--limit",
			"0",
		],
		store,
	);
	const parsed = JSON.parse(output) as unknown;
	if (!Array.isArray(parsed)) return [];
	return parsed as Array<{
		id: string;
		title: string;
		metadata?: Record<string, unknown>;
	}>;
}

/**
 * The handoff that an issue carries, when it carries one.
 */
function handoffOf(
	issue: { metadata?: Record<string, unknown> },
	recipient: string,
): { handoffId: string; revision: number } | null {
	const raw = issue.metadata?.agentHandoff;
	if (!raw || typeof raw !== "object") return null;
	const envelope = raw as Record<string, unknown>;
	if (envelope.recipient !== recipient) return null;
	const handoffId = typeof envelope.handoffId === "string" ? envelope.handoffId : "";
	const revision = typeof envelope.revision === "number" ? envelope.revision : 0;
	if (handoffId.length === 0 || revision < 1) return null;
	return { handoffId, revision };
}

/**
 * The store of the pilot.
 *
 * A workspace without a store gets one: the pilot never writes into the
 * store of the user.
 */
function ensureStore(binary: string, store: string, prefix: string): void {
	if (!existsSync(join(store, ".beads"))) {
		bd(binary, ["init", "--prefix", prefix], store);
	}
}

/**
 * The issue that carries the handoff of the pilot.
 *
 * An issue that already carries a handoff for this agent is used as it
 * is: the pilot proves the delivery of a handoff that a producer wrote.
 */
function ensureHandoffIssue(
	binary: string,
	store: string,
	recipient: string,
): { id: string; handoffId: string; revision: number } {
	for (const issue of openIssues(binary, store)) {
		const handoff = handoffOf(issue, recipient);
		if (handoff) {
			return { id: issue.id, ...handoff };
		}
	}
	const metadata = JSON.stringify({
		agentHandoff: {
			version: 1,
			handoffId: HANDOFF_ID,
			recipient,
			revision: REVISION,
		},
	});
	const created = bd(
		binary,
		[
			"create",
			"--title",
			"Handoff one",
			"--description",
			"please review this",
			"--metadata",
			metadata,
			"--silent",
		],
		store,
	).trim();
	const id = created.split("\n").filter(Boolean).pop() ?? created;
	if (!id) {
		throw new Error("the pilot could not create the issue of the handoff");
	}
	return { id, handoffId: HANDOFF_ID, revision: REVISION };
}

/**
 * The durable record of a handoff.
 *
 * The record is read through the store of the harness, so the pilot never
 * repeats the knowledge of the layout of the files.
 */
function readRecord(
	root: string,
	recipient: string,
	handoffId: string,
): {
	state?: string;
	deliveredRevision?: number;
	seenRevision?: number;
} | null {
	return new BdHandoffStore(root).read(recipient, handoffId);
}

const options = parseArgs(process.argv.slice(2));
const store = options.store || mkdtempSync(join(tmpdir(), "bd-pilot-store-"));
const prefix = (store.split("/").filter(Boolean).pop() ?? "bdpilot")
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, "")
	.slice(0, 12) || "bdpilot";

console.log("pilot store:", store);
console.log("recipient:", options.recipient);
ensureStore(options.binary, store, prefix);
const issue = ensureHandoffIssue(options.binary, store, options.recipient);
console.log("handoff issue:", issue.id, `(handoff ${issue.handoffId}, revision ${issue.revision})`);

const root = mkdtempSync(join(tmpdir(), "bd-pilot-durable-"));
const delivered: string[] = [];
const statuses: string[] = [];

const session = new BdHandoffSession();
const registration = session.start({
	workspace: () => store,
	sessionId: () => "bd-handoff-pilot",
	deliver: async (delivery: BdHandoffDelivery) => {
		delivered.push(delivery.message);
		return { delivered: true };
	},
	isIdle: () => true,
	isPaused: () => false,
	hasOpenQuestion: () => false,
	onStatus: (status) => statuses.push(formatBdHandoffStatus(status)),
	log: (message: string) => console.log("[watcher]", message),
	root,
	env: { PI_BD_HANDOFF: "1", PI_BD_HANDOFF_RECIPIENT: options.recipient },
	binary: options.binary,
});
const activeAfterStart = session.active;

const first = await session.check();
const second = await session.check();
const third = await session.check();
session.stop();
const record = readRecord(root, options.recipient, issue.handoffId);
const message = delivered[0] ?? "";

const checks: Array<{ name: string; ok: boolean; detail: string }> = [
	{
		name: "the watcher is registered",
		ok: registration !== undefined,
		detail: registration ? "on" : "off",
	},
	{
		name: "the watcher runs with the session",
		ok: activeAfterStart,
		detail: activeAfterStart ? "active" : "stopped",
	},
	{
		name: "the first check delivers the handoff",
		ok: first?.state === "delivered",
		detail: first?.state ?? "none",
	},
	{
		name: "the delivery happens once",
		ok: delivered.length === 1,
		detail: `${delivered.length}`,
	},
	{
		name: "the message names the exact issue",
		ok: message.includes(issue.id),
		detail: issue.id,
	},
	{
		name: "the message names the revision",
		ok: message.includes(`revision ${issue.revision}`),
		detail: `revision ${issue.revision}`,
	},
	{
		name: "the second check finds nothing",
		ok: second?.state === "idle",
		detail: second?.state ?? "none",
	},
	{
		name: "the third check finds nothing",
		ok: third?.state === "idle",
		detail: third?.state ?? "none",
	},
	{
		name: "the handoff is not delivered twice",
		ok: delivered.length === 1,
		detail: `${delivered.length}`,
	},
	{
		name: "the durable record exists",
		ok: record !== null,
		detail: record ? "found" : "missing",
	},
	{
		name: "the cursor moved after the delivery",
		ok:
			record !== null &&
			record.deliveredRevision === issue.revision &&
			record.state === "received",
		detail: record
			? `deliveredRevision ${record.deliveredRevision ?? 0}, state ${record.state}`
			: "missing",
	},
	{
		name: "the watcher stops with the session",
		ok: !session.active,
		detail: session.active ? "active" : "stopped",
	},
];

console.log("--- the delivery ---");
console.log(message || "(no message)");
console.log("--- end of the delivery ---");
console.log("statuses:", statuses.join(" | "));

let failed = 0;
for (const check of checks) {
	if (!check.ok) failed += 1;
	console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name} (${check.detail})`);
}
console.log(`${checks.length - failed}/${checks.length} checks passed`);

rmSync(root, { recursive: true, force: true });
if (!options.keep && !options.store) {
	rmSync(store, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
