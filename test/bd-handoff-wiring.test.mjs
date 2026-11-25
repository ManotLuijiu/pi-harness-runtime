/**
 * The session that owns the watcher of the handoffs, and the wiring of
 * that session in the harness.
 *
 * The reader, the store, the runtime and the registration have their own
 * suite. This one protects the two seams that are left:
 *
 * - the session that owns the watcher: it starts it, replaces it, stops it
 *   with the session, and gives every proposal of a handoff a generation
 *   of its own,
 * - the wiring in the harness: the watcher starts with the session, stops
 *   with it, delivers through the advisory of the continuation controller,
 *   proposes a scope through the runtime of the scope expansion, and
 *   publishes a passive row in the footer.
 *
 * The tests use a mocked bd: no program of the machine is called, no
 * issue is written, and no model is asked anything.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import {
	BD_HANDOFF_FIRST_GENERATION,
	BdHandoffSession,
	formatBdHandoffStatus,
} from "../harness/bd-handoff-session.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * A region of the source of the harness around a needle.
 *
 * A check of the whole file cannot show that a line belongs to a
 * callback, and a check of a line cannot show that the callback around
 * it does what it says. The region is the piece of the file that holds
 * the callback.
 */
function around(needle, before = 0, after = 1600) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

/**
 * The body of a callback: from its head to its closing brace.
 *
 * A window of characters breaks when the body grows: the line the
 * check is about leaves the window and the check fails for a reason
 * that has nothing to do with the behaviour. The body of the callback
 * ends where the callback ends.
 */
function callbackBody(needle) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	const lineStart = indexSource.lastIndexOf("\n", at) + 1;
	const indent = /^\t*/.exec(indexSource.slice(lineStart))[0].length;
	const lines = indexSource.slice(at).split("\n");
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		const lineIndent = /^\t*/.exec(line)[0].length;
		if (lineIndent === indent && line.trim() === "},") {
			return lines.slice(0, i + 1).join("\n");
		}
	}
	return lines.join("\n");
}

/**
 * A temporary directory for the state of the tests.
 */
function tempRoot() {
	return mkdtempSync(join(tmpdir(), "bd-handoff-session-test-"));
}

/**
 * A workspace with a store in it.
 */
function workspaceWithStore() {
	const root = mkdtempSync(join(tmpdir(), "bd-handoff-session-ws-"));
	mkdirSync(join(root, ".beads"), { recursive: true });
	return root;
}

/**
 * The answer of a mocked bd.
 */
function ok(stdout) {
	return {
		stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
		stderr: "",
		exitCode: 0,
		timedOut: false,
		truncated: false,
	};
}

/**
 * A runner that answers from a table of commands.
 */
function runner(table) {
	const calls = [];
	const run = async (binary, args) => {
		calls.push([binary, ...args].join(" "));
		for (const [match, answer] of Object.entries(table)) {
			if ([...args].join(" ").includes(match)) {
				return typeof answer === "function" ? answer([...args]) : answer;
			}
		}
		return {
			stdout: "",
			stderr: `unknown command: ${[binary, ...args].join(" ")}`,
			exitCode: 1,
			timedOut: false,
			truncated: false,
		};
	};
	return { run, calls };
}

/**
 * The answer of `bd where --json` for a workspace.
 */
function whereOf(workspace) {
	return ok({
		path: join(workspace, ".beads"),
		database_path: join(workspace, ".beads", "embeddeddolt"),
		prefix: "test",
		schema_version: 1,
	});
}

/**
 * The list of the capabilities of the mocked bd.
 */
const CAPABILITIES = ok(
	"      --has-metadata-key string      Filter issues that have this metadata key set\n",
);

/**
 * One issue of the store that carries a handoff.
 */
function handoffIssue(id = "bd-1", handoffId = "h1") {
	return {
		issue: {
			id,
			title: `handoff ${id}`,
			description: "please look at this",
			status: "open",
			issue_type: "task",
			metadata: {
				agentHandoff: { version: 1, handoffId, revision: 1, recipient: "pi" },
			},
		},
		envelope: {
			version: 1,
			handoffId,
			revision: 1,
			recipient: "pi",
			summary: "the work of the issue",
		},
	};
}

/**
 * A session of the watcher with a mocked bd.
 */
function sessionOf(options = {}) {
	const workspace = workspaceWithStore();
	const entry = handoffIssue();
	const { run } = runner({
		where: whereOf(workspace),
		"list --help": CAPABILITIES,
		list: ok([entry.issue]),
		show: ok(entry.issue),
	});
	const delivered = [];
	const proposals = [];
	const statuses = [];
	const session = new BdHandoffSession();
	session.start({
		workspace: () => workspace,
		sessionId: () => "session-a",
		deliver: async (message) => {
			delivered.push(message);
			return { delivered: true };
		},
		isIdle: () => true,
		isPaused: () => false,
		hasOpenQuestion: () => false,
		proposeScope: async (handoff, generation) => {
			proposals.push({ handoff, generation });
			return options.proposed !== false;
		},
		onStatus: (status) => statuses.push(status),
		log: (message) => options.log?.(message),
		root: tempRoot(),
		run,
		now: () => Date.now(),
		env: { PI_BD_HANDOFF: "1", PI_BD_HANDOFF_RECIPIENT: "pi" },
	});
	return { session, delivered, proposals, statuses, workspace, entry };
}

// ---------------------------------------------------------------------------
// The session that owns the watcher
// ---------------------------------------------------------------------------

test("the watcher belongs to the session and starts with it", async () => {
	const { session, delivered } = sessionOf();
	assert.equal(session.active, true);
	await session.check();
	assert.equal(delivered.length, 1);
});

test("the watcher stops with the session", async () => {
	const { session, delivered } = sessionOf();
	session.stop();
	assert.equal(session.active, false);
	// A watcher that stopped has no registration, so a check of it is
	// nothing at all.
	assert.equal(await session.check(), undefined);
	assert.equal(delivered.length, 0);
});

test("a session that starts again replaces the watcher", () => {
	const { session } = sessionOf();
	const first = session.start({
		workspace: () => "/tmp",
		sessionId: () => "session-b",
		deliver: async () => ({ delivered: true }),
		root: tempRoot(),
		run: async () => ok(""),
		env: { PI_BD_HANDOFF: "1" },
	});
	const second = session.start({
		workspace: () => "/tmp",
		sessionId: () => "session-c",
		deliver: async () => ({ delivered: true }),
		root: tempRoot(),
		run: async () => ok(""),
		env: { PI_BD_HANDOFF: "1" },
	});
	assert.notEqual(first, second);
	// The session knows one watcher: the one that is running.
	assert.equal(session.runtime, second?.runtime);
});

test("a proposal that reaches nobody leaves the handoff unacknowledged", async () => {
	const { session } = sessionOf({ proposed: false });
	const proposed = await session.propose(handoffIssue());
	// The handoff is not acknowledged: nobody was asked, so the handoff
	// waits for a boundary that can ask.
	assert.equal(proposed, false);
	const record = session.runtime?.record("h1");
	assert.equal(record?.acknowledgedRevision, undefined);
});

test("the wiring answers the proposal with what the runtime answered", () => {
	// The runtime of the scope expansion answers with the proposal it
	// made, or with null when the proposal reached nobody. The wiring
	// must not answer with a promise that was made: a handoff that
	// nobody was asked about stays in the queue.
	const region = callbackBody("proposeScope: async (handoff, generation) => {");
	assert.ok(region, "the wiring proposes the scope of the handoff");
	assert.match(region, /return proposal !== null;/, "the wiring answers with the result of the proposal");
	assert.doesNotMatch(region, /return true;/, "the wiring never answers with a promise that was made");
});

test("the wiring owns the claim of a handoff under a name", () => {
	// An empty id would make every session of the machine the owner of
	// the same claim, and the claim would hold nobody.
	const region = around(
		"sessionId: () => activeSessionId || `pi-${process.pid}`",
		0,
		300,
	);
	assert.ok(region, "the wiring names the owner of the claim");
	assert.match(
		region,
		/sessionId: \(\) => activeSessionId \|\| `pi-\$\{process\.pid\}`,/,
		"the owner of the claim is never empty",
	);
});

test("the generation of a handoff is far above the generations of the requests", async () => {
	assert.equal(BD_HANDOFF_FIRST_GENERATION, 1_000_000);
	const { session, proposals: recorded } = sessionOf();
	await session.propose(handoffIssue());
	await session.propose(handoffIssue("bd-2", "h2"));
	assert.equal(recorded.length, 2);
	// The generation of a handoff never answers the question of a request:
	// the generations of the requests are small numbers.
	assert.ok(recorded[0].generation >= BD_HANDOFF_FIRST_GENERATION);
	assert.ok(recorded[1].generation > recorded[0].generation);
	assert.equal(recorded[0].handoff.issueId, "bd-1");
	assert.equal(recorded[0].handoff.title, "handoff bd-1");
	assert.equal(recorded[0].handoff.summary, "the work of the issue");
});

test("the row of the watcher names every state of the watcher", () => {
	assert.equal(formatBdHandoffStatus({ state: "idle", count: 0 }), "idle");
	assert.equal(
		formatBdHandoffStatus({ state: "queued", count: 2, detail: "the session is busy" }),
		"2 waiting | the session is busy",
	);
	assert.equal(
		formatBdHandoffStatus({ state: "delivered", count: 0 }),
		"delivered 0",
	);
	assert.equal(formatBdHandoffStatus({ state: "suppressed" }), "suppressed");
	assert.equal(
		formatBdHandoffStatus({ state: "unavailable", detail: "bd is missing" }),
		"unavailable | bd is missing",
	);
});

// ---------------------------------------------------------------------------
// The wiring in the harness
// ---------------------------------------------------------------------------

/**
 * The handlers of the extension, split by their event.
 */
function handlersOf(event) {
	return indexSource
		.split('pi.on("')
		.slice(1)
		.filter((block) => block.startsWith(`${event}"`));
}

test("the harness owns the watcher of the handoffs", () => {
	assert.ok(
		indexSource.includes('from "./harness/bd-handoff-session.ts"'),
		"the harness imports the session of the watcher",
	);
	assert.ok(
		indexSource.includes("new BdHandoffSession()"),
		"the harness creates the watcher of the session",
	);
});

test("the watcher starts with the session and stops with it", () => {
	const starts = handlersOf("session_start").filter((block) =>
		block.includes("bdHandoffSession.start("),
	);
	assert.equal(starts.length > 0, true, "the watcher starts with the session");
	const stops = handlersOf("session_shutdown").filter((block) =>
		block.includes("bdHandoffSession?.stop()"),
	);
	assert.equal(stops.length > 0, true, "the watcher stops with the session");
});

test("a session that is replaced leaves no watcher behind", () => {
	// The session that starts stops the watcher of the session that is
	// gone before it creates its own.
	assert.ok(
		indexSource.includes("bdHandoffSession?.stop();"),
		"the watcher of the replaced session is stopped",
	);
});

test("the watcher looks at the store at a safe boundary", () => {
	const settled = handlersOf("agent_settled").filter((block) =>
		block.includes("runBdHandoffCheck()"),
	);
	assert.equal(
		settled.length > 0,
		true,
		"the watcher checks the store when the agent settled",
	);
	// The check of the watcher never waits for the store: a store that
	// reads slowly must not delay the work of the request.
	assert.ok(
		indexSource.includes("void session"),
		"the check of the watcher runs in the background",
	);
});

test("a handoff arrives as an advisory of the continuation controller", () => {
	assert.ok(
		indexSource.includes("dispatchAdvisory(message"),
		"the handoff is delivered through the advisory of the controller",
	);
	assert.ok(
		indexSource.includes("source: ADVISORY_SOURCE_BD_HANDOFF"),
		"the advisory names the source of the traffic",
	);
	// The reason of the advisory is the source of the traffic: one
	// constant names both, so the metadata cannot drift.
	assert.ok(
		indexSource.includes("reason: ADVISORY_SOURCE_BD_HANDOFF"),
		"the reason of the advisory comes from the same constant",
	);
	assert.ok(
		indexSource.includes("requestGeneration: String(requestScopeTracker.generation)"),
		"the advisory carries the generation of the request that is running",
	);
});

test("the gates of the delivery are the gates of the session", () => {
	assert.ok(
		indexSource.includes("activeExtensionContext?.isIdle?.()"),
		"a busy session keeps the handoff",
	);
	assert.ok(
		indexSource.includes("todoContinuationHandle?.isExplicitlyPaused()"),
		"a paused session keeps the handoff",
	);
	assert.ok(
		indexSource.includes("hasOpenQuestion: () => hasOpenQuestion()"),
		"an open question of the human keeps the handoff",
	);
});

test("a handoff outside the scope is proposed to the human", () => {
	assert.ok(
		indexSource.includes("runtime.propose({"),
		"the proposal goes through the runtime of the scope expansion",
	);
	assert.ok(
		indexSource.includes("proposedIds: [handoff.issueId]"),
		"the proposal names the exact issue",
	);
	assert.ok(
		indexSource.includes("candidates: [{ id: handoff.issueId, title: handoff.title }]"),
		"the candidate of the proposal is the issue of the handoff",
	);
});

test("the row of the watcher is passive and belongs to the session", () => {
	assert.ok(
		indexSource.includes("HARNESS_BD_HANDOFF_STATUS_KEY"),
		"the row of the watcher has its own key",
	);
	assert.ok(
		indexSource.includes("formatBdHandoffStatus(status)"),
		"the text of the row comes from the watcher",
	);
	assert.ok(
		indexSource.includes("const setter = bdHandoffStatusSetter;"),
		"the row is published with the setter of the current session",
	);
	// The setter of the session that is ending is dropped with it.
	assert.ok(
		indexSource.includes("bdHandoffStatusSetter = null;"),
		"the setter of an ended session is dropped",
	);
});
