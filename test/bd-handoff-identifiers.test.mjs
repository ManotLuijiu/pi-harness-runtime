/**
 * The identifiers of a handoff, through the whole life of the work.
 *
 * A handoff has three names: the issue of the store, the handoff itself
 * and the correlation of the request. The names have to survive every
 * step, or nobody can tell afterwards which issue a piece of work belongs
 * to.
 *
 * This suite protects the parts of the life of a handoff:
 *
 * - the todo of the work carries the names in its metadata, and the
 *   metadata is written through the real todo tool,
 * - the request scope keeps the metadata without changing the identity of
 *   the request,
 * - the checkpoint of the work carries the names,
 * - the durable lease of a handoff is shared by the path of the store and
 *   the path of the live plan, and it is held while the work runs,
 * - the closure of the work is read before a pending resume runs,
 * - the context of the session knows the handoffs it received, and it
 *   forgets them when the request ends.
 *
 * The tests use a mocked bd and a mocked todo tool: no program of the
 * machine is called, no issue is written, and no model is asked anything.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	BD_CORRELATION_ID_METADATA_KEY,
	BD_HANDOFF_ID_METADATA_KEY,
	BD_ISSUE_ID_METADATA_KEY,
	decideRequestClosure,
	linkOfTodo,
	linksOfTodos,
} from "../harness/bd-handoff-link.ts";
import { BdHandoffContext, bdTodoMetadata } from "../harness/bd-handoff-todo.ts";
import {
	handoffLinkOfRequest,
	handoffWorkGeneration,
	handoffsOfRequest,
	namesIssue,
	openHandoffsOfRequest,
	todoToolOf,
} from "../harness/bd-handoff-request.ts";
import {
	NEUTRALIZED_RESUME_TEXT,
	NEUTRALIZED_STALE_RESUME_TEXT,
	NEUTRALIZED_UNKNOWN_WORK_TEXT,
} from "../harness/auto-resume-marker.ts";
import {
	BD_HANDOFF_TODO_TOOL,
	bdHandoffTodoTool,
	carriesLink,
	recordedTodoId,
	todoErrorOf,
} from "../harness/bd-handoff-todo-tool.ts";
import {
	HandoffLeaseStore,
	handoffLeaseFileName,
	handoffLeaseKeys,
	handoffLeaseOwner,
} from "../harness/handoff-lease.ts";
import {
	captureRequestScope,
	itemsOfRequest,
} from "../harness/jev-request-scope.ts";
import { BdHandoffReader } from "../harness/bd-handoff-reader.ts";
import { BdHandoffStore } from "../harness/bd-handoff-state.ts";
import { BdHandoffRuntime } from "../harness/bd-handoff-runtime.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * The body of a callback: from its head to its closing brace.
 *
 * A check of the whole file cannot show that a line belongs to a
 * callback, and a check of a line cannot show that the callback around it
 * does what it says.
 */
function callbackBody(needle) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	const start = indexSource.indexOf("{", at);
	if (start === -1) return "";
	let depth = 0;
	for (let index = start; index < indexSource.length; index += 1) {
		const character = indexSource[index];
		if (character === "{") depth += 1;
		if (character === "}") {
			depth -= 1;
			if (depth === 0) return indexSource.slice(start, index + 1);
		}
	}
	return "";
}

/**
 * A temporary directory for the state of the tests.
 */
function tempRoot() {
	return mkdtempSync(join(tmpdir(), "bd-handoff-ids-"));
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
	const run = async (_binary, args) => {
		for (const [match, answer] of Object.entries(table)) {
			if ([...args].join(" ").includes(match)) {
				return typeof answer === "function" ? answer([...args]) : answer;
			}
		}
		return {
			stdout: "",
			stderr: `unknown command: ${[...args].join(" ")}`,
			exitCode: 1,
			timedOut: false,
			truncated: false,
		};
	};
	return { run };
}

/**
 * One issue of the store.
 */
function issue(id, metadata, status = "open") {
	return {
		id,
		title: `handoff ${id}`,
		description: "please look at this",
		status,
		priority: 2,
		issue_type: "task",
		created_at: "2026-11-21T10:00:00Z",
		updated_at: "2026-11-21T10:00:00Z",
		metadata,
	};
}

/**
 * The state of a todo list, the way the todo tool reports it.
 */
function todoState(tasks, nextId) {
	return { action: "create", params: {}, tasks, nextId };
}

// ---------------------------------------------------------------------------
// The todo of the work
// ---------------------------------------------------------------------------

test("the tool of the handoff todo has a name of its own", () => {
	assert.equal(BD_HANDOFF_TODO_TOOL, "bd_handoff_todo");
});

test("the todo of a handoff carries the three names of the handoff", () => {
	const metadata = bdTodoMetadata({
		bdIssueId: "bd-1",
		handoffId: "h1",
		correlationId: "c1",
	});
	assert.equal(metadata[BD_ISSUE_ID_METADATA_KEY], "bd-1");
	assert.equal(metadata[BD_HANDOFF_ID_METADATA_KEY], "h1");
	assert.equal(metadata[BD_CORRELATION_ID_METADATA_KEY], "c1");
});

test("a todo without a name carries no metadata", () => {
	assert.deepEqual(bdTodoMetadata({}), {});
});

test("the tool records the work of a handoff through the todo tool", async () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "c1" });
	const calls = [];
	const tool = bdHandoffTodoTool({
		context: () => context,
	});
	const result = await tool.execute(
		"call-1",
		{ issueId: "bd-1", subject: "read the issue" },
		undefined,
		undefined,
		{
			executeTool: async (name, args) => {
				calls.push([name, args]);
				return {
					isError: false,
					result: {
						details: todoState(
							[
								{
									id: 7,
									subject: "read the issue",
									status: "pending",
									metadata: {
										bdIssueId: "bd-1",
										handoffId: "h1",
										correlationId: "c1",
									},
								},
							],
							8,
						),
					},
				};
			},
		},
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0][0], "todo");
	assert.equal(calls[0][1].action, "create");
	assert.equal(calls[0][1].subject, "read the issue");
	assert.equal(calls[0][1].metadata[BD_ISSUE_ID_METADATA_KEY], "bd-1");
	assert.equal(calls[0][1].metadata[BD_HANDOFF_ID_METADATA_KEY], "h1");
	assert.equal(calls[0][1].metadata[BD_CORRELATION_ID_METADATA_KEY], "c1");
	assert.equal(result.details.recorded, true);
	assert.deepEqual(result.details.todoIds, [7]);
});

test("the tool links an existing todo instead of creating one", async () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1" });
	const calls = [];
	const tool = bdHandoffTodoTool({ context: () => context });
	await tool.execute(
		"call-1",
		{ issueId: "bd-1", subject: "read the issue", todoId: 3 },
		undefined,
		undefined,
		{
			executeTool: async (name, args) => {
				calls.push([name, args]);
				return {
					isError: false,
					result: {
						details: todoState(
							[
								{
									id: 3,
									subject: "read the issue",
									status: "pending",
									metadata: { bdIssueId: "bd-1", handoffId: "h1" },
								},
							],
							4,
						),
					},
				};
			},
		},
	);
	assert.equal(calls[0][1].action, "update");
	assert.equal(calls[0][1].id, 3);
	assert.equal(calls[0][1].metadata[BD_ISSUE_ID_METADATA_KEY], "bd-1");
});

test("the tool does not claim a todo the list did not report", async () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1" });
	const tool = bdHandoffTodoTool({ context: () => context });
	const result = await tool.execute(
		"call-1",
		{ issueId: "bd-1", subject: "read the issue" },
		undefined,
		undefined,
		{
			executeTool: async () => ({
				isError: false,
				// The list reports no todo: the tool cannot prove that the
				// todo it asked for is there.
				result: { details: { action: "create", params: {}, tasks: [] } },
			}),
		},
	);
	assert.equal(result.details.recorded, false);
	assert.match(result.details.reason, /did not report the todo/);
});

test("the tool leaves out the description the model did not write", async () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1" });
	const calls = [];
	const tool = bdHandoffTodoTool({ context: () => context });
	await tool.execute(
		"call-1",
		{ issueId: "bd-1", subject: "read the issue" },
		undefined,
		undefined,
		{
			executeTool: async (name, args) => {
				calls.push([name, args]);
				return {
					isError: false,
					result: {
						details: todoState(
							[
								{
									id: 1,
									subject: "read the issue",
									status: "pending",
									metadata: { bdIssueId: "bd-1", handoffId: "h1" },
								},
							],
							2,
						),
					},
				};
			},
		},
	);
	// A key that is there and empty is not the same thing as a key that
	// is not there.
	assert.equal("description" in calls[0][1], false);
});

test("the context remembers the todo of a handoff with its request", () => {
	const context = new BdHandoffContext();
	context.noteTodo(4, { bdIssueId: "bd-1", handoffId: "h1" }, 3);
	context.noteTodo(5, { bdIssueId: "bd-2", handoffId: "h2" }, 4);
	const links = context.linksOfGeneration(3);
	assert.equal(links.length, 1);
	assert.equal(links[0].todoId, 4);
	assert.equal(links[0].bdIssueId, "bd-1");
	// The todo of the request before is not the work of the running
	// request.
	assert.equal(context.linksOfGeneration(4)[0].todoId, 5);
	context.clear();
	assert.equal(context.linksOfGeneration(3).length, 0);
});

test("the tool refuses a handoff that this session did not receive", async () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1" });
	const calls = [];
	const tool = bdHandoffTodoTool({ context: () => context });
	const result = await tool.execute(
		"call-1",
		{ issueId: "bd-99", subject: "read the issue" },
		undefined,
		undefined,
		{
			executeTool: async (name, args) => {
				calls.push([name, args]);
				return { isError: false, result: { details: todoState([], 1) } };
			},
		},
	);
	assert.equal(calls.length, 0);
	assert.equal(result.details.recorded, false);
	assert.match(result.details.reason, /bd-99/);
});

test("the tool says so when the list refuses the call", async () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1" });
	const tool = bdHandoffTodoTool({ context: () => context });
	const result = await tool.execute(
		"call-1",
		{ issueId: "bd-1", subject: "read the issue" },
		undefined,
		undefined,
		{
			executeTool: async () => ({
				isError: false,
				result: {
					details: {
						action: "create",
						params: {},
						tasks: [],
						nextId: 1,
						error: "the subject is not allowed",
					},
				},
			}),
		},
	);
	assert.equal(result.details.recorded, false);
	assert.match(result.details.reason, /the subject is not allowed/);
});

test("the tool reports the todo it wrote and not an older one", () => {
	const details = todoState(
		[
			{
				id: 4,
				status: "pending",
				metadata: { bdIssueId: "bd-1", handoffId: "h1" },
			},
			{
				id: 9,
				status: "pending",
				metadata: { bdIssueId: "bd-1", handoffId: "h1" },
			},
		],
		10,
	);
	// The todo that was just created is the one before the next id of the
	// list: the older todo of the same handoff is not the todo of this
	// call.
	assert.equal(recordedTodoId(details, { handoffId: "h1" }), 9);
	assert.equal(recordedTodoId(details, { handoffId: "h1" }, 4), 4);
	assert.equal(recordedTodoId(details, { handoffId: "h2" }), null);
	assert.equal(carriesLink({ metadata: { handoffId: "h1" } }, { handoffId: "h1" }), true);
	assert.equal(carriesLink({ metadata: { handoffId: "h2" } }, { handoffId: "h1" }), false);
	assert.equal(todoErrorOf({ error: "no" }), "no");
	assert.equal(todoErrorOf({}), null);
});

test("the durable record of the handoff hears about the todo", async () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1" });
	const linked = [];
	const tool = bdHandoffTodoTool({
		context: () => context,
		onLinked: (link, todoIds) => linked.push([link, todoIds]),
	});
	await tool.execute(
		"call-1",
		{ issueId: "bd-1", subject: "read the issue" },
		undefined,
		undefined,
		{
			executeTool: async () => ({
				isError: false,
				result: {
					details: todoState(
						[
							{
								id: 2,
								status: "pending",
								subject: "read the issue",
								metadata: { bdIssueId: "bd-1", handoffId: "h1" },
							},
						],
						3,
					),
				},
			}),
		},
	);
	assert.equal(linked.length, 1);
	assert.equal(linked[0][0].handoffId, "h1");
	assert.deepEqual(linked[0][1], [2]);
});

// ---------------------------------------------------------------------------
// The request scope
// ---------------------------------------------------------------------------

test("the scope of a request keeps the metadata of a todo", () => {
	const items = [
		{
			id: 1,
			subject: "read the issue",
			status: "pending",
			metadata: { bdIssueId: "bd-1", handoffId: "h1" },
		},
	];
	const scope = captureRequestScope(items, 4, { touched: new Set(["id:1"]) });
	const kept = itemsOfRequest(items, scope);
	assert.equal(kept.length, 1);
	assert.equal(kept[0].metadata[BD_HANDOFF_ID_METADATA_KEY], "h1");
	assert.equal(scope.generation, 4);
});

test("the metadata of a todo does not change the identity of a request", () => {
	const before = [{ id: 1, subject: "read the issue", status: "pending" }];
	const after = [
		{
			id: 1,
			subject: "read the issue",
			status: "pending",
			metadata: { bdIssueId: "bd-1", handoffId: "h1" },
		},
	];
	const scope = captureRequestScope(before, 2, { touched: new Set() });
	// The shape of the item is the status and the subject: the metadata
	// that arrived later does not make the item a change of the request.
	assert.equal(itemsOfRequest(after, scope).length, 0);
});

test("the links of the todos of a request name the issues of the store", () => {
	const links = linksOfTodos([
		{
			id: 1,
			status: "pending",
			metadata: { bdIssueId: "bd-1", handoffId: "h1" },
		},
		{ id: 2, status: "pending" },
	]);
	assert.equal(links.length, 1);
	assert.equal(links[0].todoId, 1);
	assert.equal(links[0].bdIssueId, "bd-1");
	assert.equal(linkOfTodo({ id: 3, status: "pending" }), null);
});

// ---------------------------------------------------------------------------
// The context of the session
// ---------------------------------------------------------------------------

test("the context of the session knows the handoff it received", () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "c1" });
	// The same handoff is not added twice.
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "c1" });
	assert.equal(context.size, 1);
	assert.equal(context.linkOfIssue("bd-1").handoffId, "h1");
	assert.equal(context.linkOfHandoff("h1").bdIssueId, "bd-1");
	assert.equal(context.linkOfIssue("bd-99"), null);
});

test("the context of the session forgets the handoffs of the old request", () => {
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1" });
	context.clear();
	assert.equal(context.size, 0);
	assert.equal(context.linkOfIssue("bd-1"), null);
});

// ---------------------------------------------------------------------------
// The shared lease
// ---------------------------------------------------------------------------

test("the lease of a handoff is held by one owner", () => {
	const store = new HandoffLeaseStore(tempRoot());
	const keys = handoffLeaseKeys({ handoffId: "h1", correlationId: "c1" });
	assert.deepEqual(keys, ["handoff:h1", "correlation:c1"]);
	const first = store.claim({ keys, owner: "session-a" });
	assert.equal(first.ok, true);
	const second = store.claim({ keys, owner: "session-b" });
	assert.equal(second.ok, false);
	assert.equal(second.holder, "session-a");
});

test("the lease is given back by its owner", () => {
	const store = new HandoffLeaseStore(tempRoot());
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	store.claim({ keys, owner: "session-a" });
	// A session that lost the lease does not release the lease of
	// somebody else.
	store.release({ keys, owner: "session-b" });
	assert.equal(store.claim({ keys, owner: "session-b" }).ok, false);
	store.release({ keys, owner: "session-a" });
	assert.equal(store.claim({ keys, owner: "session-b" }).ok, true);
});

test("the path of the store and the path of the live plan meet on the correlation", () => {
	const store = new HandoffLeaseStore(tempRoot());
	const storePath = handoffLeaseKeys({
		handoffId: "h1",
		correlationId: "c1",
	});
	const planPath = handoffLeaseKeys({
		correlationId: "c1",
		messageId: "plan-1",
	});
	assert.equal(store.claim({ keys: storePath, owner: "session-a" }).ok, true);
	// The live path leases the same correlation: the work of the handoff
	// runs once.
	const plan = store.claim({ keys: planPath, owner: "session-b" });
	assert.equal(plan.ok, false);
	assert.equal(plan.holder, "session-a");
});

test("a lease that is not taken does not block the other owner", () => {
	const store = new HandoffLeaseStore(tempRoot());
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
});

test("the lease of the owner is extended while the owner works", () => {
	const store = new HandoffLeaseStore(tempRoot());
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	const first = store.claim({ keys, owner: "session-a" });
	assert.equal(first.ok, true);
	const written = store.read("handoff:h1");
	// The name is taken with an exclusive create and it is not written
	// again: two callers cannot both take the name.
	const second = store.claim({ keys, owner: "session-a" });
	assert.equal(second.ok, true);
	const again = store.read("handoff:h1");
	// The moment of the claim does not change: it is the same lease.
	assert.equal(again.claimedAt, written.claimedAt);
	// The lease runs longer: the work of a handoff that runs longer than
	// the bound of the lease keeps the protection of the lease.
	assert.ok(again.expiresAt >= written.expiresAt);
});

test("the lease of the handoffs of the session is renewed while the session works", () => {
	// The work of a handoff can run longer than the bound of a lease. The
	// session extends its leases, so the other path cannot start the same
	// work while this one is running it.
	let clock = 1_000;
	const store = new HandoffLeaseStore(tempRoot(), { now: () => clock });
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	const before = store.read("handoff:h1");
	clock = 100_000;
	assert.equal(store.renew({ keys, owner: "session-a" }), 1);
	const after = store.read("handoff:h1");
	assert.ok(after.expiresAt > before.expiresAt);
	// The lease of another owner is never renewed.
	assert.equal(store.renew({ keys, owner: "session-b" }), 0);
	assert.equal(store.read("handoff:h1").owner, "session-a");
});

test("a lease that ran out is not renewed", () => {
	// A lease that ran out holds nothing: the name is free again, and the
	// owner has to take it again.
	let clock = 1_000;
	const store = new HandoffLeaseStore(tempRoot(), { now: () => clock });
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	const before = store.read("handoff:h1");
	clock = 10_000_000;
	assert.equal(store.renew({ keys, owner: "session-a" }), 0);
	assert.equal(store.read("handoff:h1").expiresAt, before.expiresAt);
});

test("the takeover does not remove the fresh lease of the same owner", () => {
	// The lease of the name ran out, and the same owner took the name
	// again in the gap between the read of the dead lease and the move of
	// the file. The owner is the same, so only the moment of the claim
	// tells the two leases apart: the lease that was moved is put back,
	// and the name is not taken.
	const root = tempRoot();
	const key = "handoff:h1";
	const file = join(root, "handoff-leases", handoffLeaseFileName(key));
	mkdirSync(join(root, "handoff-leases"), { recursive: true });
	let calls = 0;
	let swapped = false;
	const store = new HandoffLeaseStore(root, {
		now: () => {
			calls += 1;
			// The moment of the move of the file is the second reading of
			// the clock: the file is taken aside then.
			if (calls === 2) {
				writeFileSync(
					file,
					JSON.stringify({
						key,
						owner: "session-a",
						claimedAt: 2_000,
						expiresAt: 2_000,
					}),
				);
				swapped = true;
			}
			return 1_000;
		},
	});
	// The dead lease of the owner.
	writeFileSync(
		file,
		JSON.stringify({
			key,
			owner: "session-a",
			claimedAt: 1_000,
			expiresAt: 1_000,
		}),
	);
	const taken = store.take({
		key,
		owner: "session-a",
		claimedAt: 3_000,
		expiresAt: 3_000,
	});
	assert.equal(swapped, true, "the file was replaced in the gap");
	assert.equal(taken, false, "the name is not taken from the fresh lease");
	const lease = JSON.parse(readFileSync(file, "utf8"));
	assert.equal(lease.claimedAt, 2_000, "the fresh lease is still there");
});

test("the repair of an unreadable lease file", () => {
	// A file that cannot be read is kept aside, and the name is treated as
	// held: a lease that is lost would let two sessions execute the same
	// handoff. The name is free again for the caller that comes after it.
	const root = tempRoot();
	const store = new HandoffLeaseStore(root);
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	const file = join(root, "handoff-leases", handoffLeaseFileName("handoff:h1"));
	mkdirSync(join(root, "handoff-leases"), { recursive: true });
	writeFileSync(file, "{ this is not a lease");
	const first = store.claim({ keys, owner: "session-a" });
	assert.equal(first.ok, false);
	// The broken file was kept aside: the name is free again.
	assert.equal(store.claim({ keys, owner: "session-b" }).ok, true);
});

test("the leases of an owner are known", () => {
	// The memory of the session is not the truth: the store is. A lease
	// that this session took before a restart of the extension is not in
	// the map of the session any more, and the store still knows it.
	const store = new HandoffLeaseStore(tempRoot());
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	const leases = store.leasesOf("session-a");
	assert.equal(leases.length, 1);
	assert.equal(leases[0].key, "handoff:h1");
	// The leases of another owner are not the leases of this owner.
	assert.equal(store.leasesOf("session-b").length, 0);
});

test("the cleanup removes the files that are marked as rubbish", () => {
	const root = tempRoot();
	const store = new HandoffLeaseStore(root);
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	const dir = join(root, "handoff-leases");
	// A file that is not a lease and is not marked as rubbish: the
	// cleanup of the leases does not touch it.
	const other = join(dir, "notes.txt");
	writeFileSync(other, "not a lease");
	// The file of the repair of an unreadable lease is rubbish at once:
	// nobody looks at it any more.
	const name = readdirSync(dir).find((entry) => entry.endsWith(".json"));
	const broken = join(dir, `${name}.broken-1`);
	writeFileSync(broken, "{ this is not a lease");
	assert.equal(store.cleanup(), 1);
	assert.equal(existsSync(other), true);
	assert.equal(existsSync(broken), false);
	// The live lease is not rubbish: it is held.
	assert.equal(store.read("handoff:h1").owner, "session-a");
});

test("the lease of a handoff is given back by the owner that took it", () => {
	// The held leases are kept with their owner: the release of one path
	// must not give back the lease of the other path.
	assert.match(indexSource, /function leaseMapKey\(owner: string, key: string\)/);
	assert.match(indexSource, /heldHandoffLeases\.set\(leaseMapKey\(owner, key\), key\)/);
	assert.match(indexSource, /heldHandoffLeases\.get\(leaseMapKey\(owner, key\)\)/);
});

test("the two paths of one session have an owner of their own", () => {
	// The path of the store and the live path of the plan are two ways
	// to the same handoff. One owner for both would let the second path
	// take the lease of the first one, and the work would run twice.
	const store = handoffLeaseOwner("session-1", "store");
	const plan = handoffLeaseOwner("session-1", "plan");
	assert.notEqual(store, plan);
	assert.match(store, /^session-1:store$/);
	assert.match(plan, /^session-1:plan$/);
	// A session without an id still has an owner: an empty owner would
	// make every session of the machine the owner of the same lease.
	assert.match(handoffLeaseOwner("", "store"), /^pi-\d+:store$/);
	// The lease of the path of the store keeps the path of the plan out.
	const leases = new HandoffLeaseStore(tempRoot());
	const keys = handoffLeaseKeys({ handoffId: "h1", correlationId: "c1" });
	assert.equal(leases.claim({ keys, owner: store }).ok, true);
	const other = leases.claim({ keys, owner: plan });
	assert.equal(other.ok, false);
	assert.equal(other.holder, store);
});

test("the lease of another owner is never taken away", () => {
	// The name was taken by another owner between the check and the
	// write: the exclusive create fails, and the lease of the other owner
	// is alive. The name is not free, so the claim is refused.
	const root = tempRoot();
	const store = new HandoffLeaseStore(root);
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-b" }).ok, true);
	// The check of the claim passed before the other owner wrote its
	// lease: the write is the decision, and it is the only decision.
	const taken = store.take({
		key: "handoff:h1",
		owner: "session-a",
		claimedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
	});
	assert.equal(taken, false);
	const held = store.read("handoff:h1");
	assert.equal(held.owner, "session-b");
	// The other path still holds the name: the claim of the first path
	// is refused.
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, false);
});

test("a claim that loses gives back only the names it took", () => {
	// The caller holds one name already and wants two. The second name
	// is taken by somebody else between the check and the write, so the
	// claim fails. The name the caller held already is not given back:
	// the caller still holds it, and giving it back would leave the
	// handoff free for the other path.
	const root = tempRoot();
	const store = new HandoffLeaseStore(root);
	const held = handoffLeaseKeys({ handoffId: "h1" });
	const taken = handoffLeaseKeys({ handoffId: "h2" });
	assert.equal(store.claim({ keys: held, owner: "session-a" }).ok, true);
	// The write of the second name is lost: somebody else took it in the
	// gap between the check of the claim and the write.
	const realTake = store.take.bind(store);
	store.take = (lease) => (lease.key === "handoff:h2" ? false : realTake(lease));
	const claim = store.claim({
		keys: [...held, ...taken],
		owner: "session-a",
	});
	assert.equal(claim.ok, false);
	// The name the caller held before is still held.
	assert.equal(store.read("handoff:h1").owner, "session-a");
});

test("two names that look alike do not share one lease", () => {
	// The readable part of the name is not enough: two different keys
	// have to have two different files.
	assert.notEqual(
		handoffLeaseFileName("handoff:a:b"),
		handoffLeaseFileName("handoff:a_b"),
	);
	const store = new HandoffLeaseStore(tempRoot());
	const first = handoffLeaseKeys({ handoffId: "a:b" });
	const second = handoffLeaseKeys({ handoffId: "a_b" });
	assert.equal(store.claim({ keys: first, owner: "session-a" }).ok, true);
	// The second handoff is not blocked by the first one.
	assert.equal(store.claim({ keys: second, owner: "session-b" }).ok, true);
});

test("the intake names the tool of the handoff whose work was not recorded", () => {
	// The tool of the handoff is named while the work of the handoff is
	// not in the task list: the handoff belongs to the session, so it can
	// arrive between two requests and the request that follows records it.
	// The name is asked for with the message that is captured, so the
	// tool of a handoff is never chosen from the state of the whole
	// session.
	const body = callbackBody("taskIntakeController = new TaskIntakeController({");
	assert.match(body, /todoToolName: \(message: string\) =>/);
	assert.match(body, /openHandoffsOfRunningRequest\(bdHandoffContext, message\)/);
	assert.doesNotMatch(body, /bdHandoffContext\.all\(\)/);
});

test("a lease that ran out is taken again by its owner", () => {
	// The lease of a name is not extended, so a lease that ran out is
	// not a lease any more: the owner takes the name again, and the name
	// is really held afterwards.
	let clock = 1000;
	const store = new HandoffLeaseStore(tempRoot(), { now: () => clock });
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	clock += 10 * 60 * 1000;
	const again = store.claim({ keys, owner: "session-a" });
	assert.equal(again.ok, true);
	const held = store.read("handoff:h1");
	assert.equal(held.owner, "session-a");
	assert.ok(held.expiresAt > clock, "the lease of the name is alive again");
});

// ---------------------------------------------------------------------------
// The closure of the work
// ---------------------------------------------------------------------------

/**
 * A runtime with a mocked store of the issues.
 */
function runtimeOf(issues) {
	const workspace = tempRoot();
	const table = {
		where: ok({
			path: join(workspace, ".beads"),
			database_path: join(workspace, ".beads", "embeddeddolt"),
			prefix: "test",
			schema_version: 1,
		}),
		"list --help": ok("      --has-metadata-key string      Filter issues\n"),
	};
	for (const [id, value] of Object.entries(issues)) {
		table[`show ${id}`] = ok([value]);
	}
	const reader = new BdHandoffReader({ workspace, run: runner(table).run });
	const store = new BdHandoffStore(tempRoot());
	const runtime = new BdHandoffRuntime({
		reader,
		store,
		recipient: "pi",
		deliver: async () => ({ delivered: true }),
		isIdle: () => true,
	});
	return { runtime, reader, store };
}

test("the closure of a closed issue ends the work", async () => {
	const { runtime } = runtimeOf({
		"bd-1": issue("bd-1", {}, "closed"),
	});
	const decision = await runtime.closureOf([
		{ todoId: 1, bdIssueId: "bd-1", handoffId: "h1" },
	]);
	assert.equal(decision.action, "suppress");
});

test("the closure of an open issue lets the work go on", async () => {
	const { runtime } = runtimeOf({
		"bd-1": issue("bd-1", {}, "open"),
	});
	const decision = await runtime.closureOf([
		{ todoId: 1, bdIssueId: "bd-1", handoffId: "h1" },
	]);
	assert.equal(decision.action, "continue");
});

test("the closure of an issue that cannot be read is unresolved", async () => {
	const { runtime } = runtimeOf({});
	const decision = await runtime.closureOf([
		{ todoId: 1, bdIssueId: "bd-1", handoffId: "h1" },
	]);
	assert.equal(decision.action, "unknown");
});

test("the closure of an issue that does not exist ends the work", async () => {
	// An issue that does not exist is not an issue that cannot be read:
	// it will never be read again, and the work of the handoff is not
	// started again either.
	const workspace = tempRoot();
	const table = {
		where: ok({
			path: join(workspace, ".beads"),
			database_path: join(workspace, ".beads", "embeddeddolt"),
			prefix: "test",
			schema_version: 1,
		}),
		"list --help": ok("      --has-metadata-key string      Filter issues\n"),
		"show bd-1": {
			stdout: "",
			stderr: "issue bd-1 not found",
			exitCode: 1,
			timedOut: false,
			truncated: false,
		},
	};
	const reader = new BdHandoffReader({ workspace, run: runner(table).run });
	const runtime = new BdHandoffRuntime({
		reader,
		store: new BdHandoffStore(tempRoot()),
		recipient: "pi",
		deliver: async () => ({ delivered: true }),
		isIdle: () => true,
	});
	const decision = await runtime.closureOf([
		{ todoId: 1, bdIssueId: "bd-1", handoffId: "h1" },
	]);
	assert.equal(decision.action, "suppress");
	assert.match(decision.reason, /does not exist/);
	assert.deepEqual(decision.todoIds, [1]);
});

test("the closure of a request without an issue is no closure", async () => {
	const { runtime } = runtimeOf({});
	const decision = await runtime.closureOf([]);
	assert.equal(decision.action, "continue");
});

// ---------------------------------------------------------------------------
// The wiring in the harness
// ---------------------------------------------------------------------------

test("the watcher leases the handoff before it hands it over", () => {
	const body = callbackBody("deliver: async (delivery: BdHandoffDelivery)");
	assert.match(body, /claimHandoffLease\(delivery\.handoffs\)/);
	// The lease is taken before the message is handed to the session.
	assert.ok(
		body.indexOf("claimHandoffLease") < body.indexOf("controller.dispatchAdvisory(message"),
		"the lease has to be taken before the delivery",
	);
});

test("the session knows the handoffs that arrived", () => {
	const body = callbackBody("deliver: async (delivery: BdHandoffDelivery)");
	assert.match(body, /bdHandoffContext\.add\(/);
	assert.match(body, /handoff\.envelope\.handoffId/);
	assert.match(body, /handoff\.envelope\.correlationId/);
});

test("a delivery that did not happen gives the lease back", () => {
	const body = callbackBody("deliver: async (delivery: BdHandoffDelivery)");
	// The lease is given back by the owner that took it: the owner of
	// the other path is not given back by this one.
	//
	// Only the names that the claim created are given back: a name that
	// this owner held already belongs to a work that runs already.
	assert.match(body, /releaseHandoffLease\(lease\.created, lease\.owner\)/);
	assert.doesNotMatch(body, /releaseHandoffLease\(lease\.keys, lease\.owner\)/);
});

test("a failed delivery gives back only the names that the claim created", () => {
	// The tracker delivers the handoff, and the work starts: the lease of
	// the name is created. The producer raises the revision, and the
	// second delivery finds the name held by the same owner: the claim
	// creates nothing. The second delivery fails, and it gives back only
	// what it created. The lease of the first delivery is still held, so
	// the other path cannot run the same handoff while that work runs.
	const store = new HandoffLeaseStore(tempRoot());
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	const first = store.claim({ keys, owner: "session-a" });
	assert.equal(first.ok, true);
	assert.deepEqual(first.created, keys);
	const second = store.claim({ keys, owner: "session-a" });
	assert.equal(second.ok, true);
	assert.deepEqual(second.created, []);
	// The failed delivery gives back the names it created: none.
	store.release({ keys: second.created, owner: "session-a" });
	const held = store.read("handoff:h1");
	assert.equal(held.owner, "session-a");
});

test("a new request of the human keeps the handoffs of the session", () => {
	const body = callbackBody("function beginHumanRequest(): void {");
	// A handoff arrives between two requests, and the work of it runs in
	// the request that follows: the links of the handoff belong to the
	// session, not to the request that was running when it arrived.
	assert.doesNotMatch(body, /endHandoffSession\(\)/);
	assert.doesNotMatch(body, /bdHandoffContext\.clear\(\)/);
});

test("the end of the session gives the leases back and forgets the links", () => {
	const end = callbackBody("function endHandoffSession(): void {");
	assert.match(end, /releaseHandoffLeases\(\)/);
	assert.match(end, /bdHandoffContext\.clear\(\)/);
	const shutdown = callbackBody("// Clean up controller on session shutdown");
	assert.match(shutdown, /endHandoffSession\(\)/);
});

test("a new session starts without the handoffs of the session before", () => {
	// A handoff that was delivered to the session before is not a handoff
	// of this one, so its todo may not be linked here.
	const body = callbackBody("pi.on(\"session_start\", async (_event, ctx) => {");
	assert.match(body, /endHandoffSession\(\)/);
});

test("the tool of the handoff todo is registered", () => {
	assert.match(indexSource, /registerBdHandoffTodoTool\(pi, \{/);
	assert.match(indexSource, /bdHandoffSession\?\.runtime\?\.linkTodos\(/);
});

test("the checkpoint of the work names the handoff", () => {
	// The checkpoint names the handoff of the running request: the
	// selection is the one of the whole session, so the checkpoint, the
	// intake and the reminder never disagree about the work of a
	// request.
	assert.match(indexSource, /link: async \(\) => \{/);
	assert.match(indexSource, /handoffLinkOfRequest\(/);
	assert.match(indexSource, /await linksOfRunningRequest\(\)/);
	// A request that works on no handoff names none: the identifiers of
	// a checkpoint are evidence.
	assert.doesNotMatch(indexSource, /bdHandoffContext\.pending\(\)/);
});

test("the intake names the tool of the handoff", () => {
	// The plain todo tool knows nothing of the handoff: the todo of the
	// work would name no issue at all.
	const body = callbackBody("taskIntakeController = new TaskIntakeController({");
	// The instruction of the intake names one tool, not two: a message
	// that names the plain tool first leaves the agent to choose, and
	// the plain one writes a todo without the link.
	assert.match(body, /todoToolName: \(message: string\) =>/);
	assert.match(body, /BD_HANDOFF_TODO_TOOL/);
	// The name of the tool is asked for with the message that is
	// captured, and the selection is the one of the running request: the
	// intake and the advisory of a handoff of the same request never name
	// two tools.
	assert.match(
		body,
		/todoToolName: \(message: string\) =>\s*todoToolOf\(\s*openHandoffsOfRunningRequest\(/,
	);
	assert.match(
		body,
		/handoffTodoInstruction\(\s*openHandoffsOfRunningRequest\(/,
	);
});

test("the work of a handoff runs in the request that follows it", () => {
	// The agent answered: the advisory of the handoff starts a turn of
	// its own, and the work of the handoff runs in the request that
	// follows.
	assert.equal(
		handoffWorkGeneration({
			generation: 7,
			requestBegan: true,
			requestAnswered: true,
		}),
		8,
	);
	// The request is running: the advisory continues the work of that
	// request.
	assert.equal(
		handoffWorkGeneration({
			generation: 7,
			requestBegan: true,
			requestAnswered: false,
		}),
		7,
	);
	// No request of the human began yet: the work runs in the request
	// that follows.
	assert.equal(
		handoffWorkGeneration({
			generation: 1,
			requestBegan: false,
			requestAnswered: false,
		}),
		2,
	);
});

test("the selection sees the handoff of the request that follows", () => {
	// The handoff arrived after the agent answered: its work runs in the
	// request that follows, and the selection of a request has to ask for
	// the same generation the delivery used. A selection that asked the
	// generation of the answered request would not see the handoff, and
	// the intake would name the plain tool while the advisory of the same
	// turn names the tool of the handoff.
	const context = new BdHandoffContext();
	const answered = {
		generation: 7,
		requestBegan: true,
		requestAnswered: true,
	};
	const generation = handoffWorkGeneration(answered);
	context.add(
		{ bdIssueId: "bd-67", handoffId: "h1", correlationId: "c1" },
		generation,
	);
	// The selection of the request that follows sees the handoff.
	assert.equal(openHandoffsOfRequest(context, "do the work", generation).length, 1);
	assert.equal(
		handoffLinkOfRequest(context, "do the work", generation)?.bdIssueId,
		"bd-67",
	);
	// The answered request does not work on it.
	assert.equal(openHandoffsOfRequest(context, "do the work", answered.generation).length, 0);
	assert.equal(
		handoffLinkOfRequest(context, "do the work", answered.generation),
		null,
	);
});

test("the wiring asks the generation the delivery used", () => {
	// One generation for the delivery and for the selection: a handoff
	// that arrives between two requests is named by the intake, the
	// reminder and the checkpoint of the request that follows.
	const selection = callbackBody("function openHandoffsOfRunningRequest(");
	assert.match(selection, /handoffGenerationOfRunningRequest\(\)/);
	const checkpoint = callbackBody("link: async () => {");
	assert.match(checkpoint, /handoffGenerationOfRunningRequest\(\)/);
	const delivery = callbackBody("deliver: async (delivery: BdHandoffDelivery)");
	assert.match(delivery, /handoffGenerationOfRunningRequest\(\)/);
});

test("the request works on the handoff it was told about", () => {
	const context = new BdHandoffContext();
	// The handoff arrived between two requests: the work of it runs in
	// the request that follows, so the handoff belongs to that request.
	context.add(
		{ bdIssueId: "bd-67", handoffId: "h1", correlationId: "c1" },
		8,
	);
	const work = handoffsOfRequest(context, "please do the work", 8);
	assert.equal(work.length, 1);
	assert.equal(work[0].bdIssueId, "bd-67");
	// The request before it does not work on that handoff.
	assert.equal(handoffsOfRequest(context, "please do the work", 7).length, 0);
});

test("the request that names the issue works on that handoff", () => {
	const context = new BdHandoffContext();
	context.add(
		{ bdIssueId: "bd-67", handoffId: "h1", correlationId: "c1" },
		3,
	);
	const work = handoffsOfRequest(context, "continue the work of bd-67", 8);
	assert.equal(work.length, 1);
	assert.equal(work[0].handoffId, "h1");
	// A request that names no issue works on no handoff.
	assert.equal(handoffsOfRequest(context, "please do the work", 8).length, 0);
});

test("a handoff of another request is not the work of this one", () => {
	// The work of the handoff was never recorded: the human declined the
	// proposal, or the agent judged it out of scope. The checkpoint of a
	// request that works on something else names no handoff, because the
	// identifiers of a checkpoint are evidence and false evidence
	// survives the compaction.
	const context = new BdHandoffContext();
	context.add(
		{ bdIssueId: "bd-67", handoffId: "h1", correlationId: "c1" },
		3,
	);
	assert.equal(handoffsOfRequest(context, "please do the work", 8).length, 0);
	assert.equal(handoffLinkOfRequest(context, "please do the work", 8), null);
});

test("the todos of the running request are the evidence of its work", () => {
	// The todo of the handoff was linked in an earlier request, and the
	// work continues in this one: the todos of the request say which
	// handoff it works on.
	const context = new BdHandoffContext();
	const link = { bdIssueId: "bd-67", handoffId: "h1", correlationId: "c1" };
	context.add(link, 3);
	context.noteTodo(7, link, 3);
	const found = handoffLinkOfRequest(context, "continue the work", 8, [
		{ ...link, todoId: 7 },
	]);
	assert.equal(found?.bdIssueId, "bd-67");
	assert.equal(found?.handoffId, "h1");
	assert.equal(found?.correlationId, "c1");
});

test("the tool of the handoff is named while its work is open", () => {
	const context = new BdHandoffContext();
	const link = { bdIssueId: "bd-67", handoffId: "h1", correlationId: "c1" };
	context.add(link, 8);
	assert.equal(
		todoToolOf(openHandoffsOfRequest(context, "do the work", 8), "bd_handoff_todo"),
		"bd_handoff_todo",
	);
	// The work of the handoff was recorded: the list holds it, and the
	// plain tool is enough.
	context.noteTodo(7, link, 8);
	assert.equal(
		todoToolOf(openHandoffsOfRequest(context, "do the work", 8), "bd_handoff_todo"),
		"todo",
	);
	// A request that works on no handoff is recorded with the plain tool.
	assert.equal(todoToolOf([], "bd_handoff_todo"), "todo");
});

test("the name of the issue is looked for in the text of the request", () => {
	assert.equal(namesIssue("please do bd-67", "bd-67"), true);
	assert.equal(namesIssue("please do bd-67", " bd-67 "), true);
	assert.equal(namesIssue("please do the work", "bd-67"), false);
	assert.equal(namesIssue("please do the work", undefined), false);
	assert.equal(namesIssue("", "bd-67"), false);
});

test("the unknown closure has a text of its own", () => {
	// The state of the issue could not be read: the work is neither
	// finished nor unfinished. The agent must not be told that the
	// request is complete, and it must not close the todos of the
	// handoff as finished.
	assert.match(NEUTRALIZED_UNKNOWN_WORK_TEXT, /could not be read/i);
	assert.doesNotMatch(NEUTRALIZED_UNKNOWN_WORK_TEXT, /already complete/i);
	assert.doesNotMatch(NEUTRALIZED_UNKNOWN_WORK_TEXT, /no work left/i);
	assert.doesNotMatch(NEUTRALIZED_UNKNOWN_WORK_TEXT, /answer with/i);
	// The text of the other cases is not changed.
	assert.match(NEUTRALIZED_RESUME_TEXT, /already complete/i);
	assert.match(NEUTRALIZED_STALE_RESUME_TEXT, /replaced by a newer request/i);
	// The unknown case of the closure uses its own text.
	const body = callbackBody("if (closure.action === \"unknown\") {");
	assert.match(body, /NEUTRALIZED_UNKNOWN_WORK_TEXT/);
});

test("the path of the store and the path of the live plan meet on the live job", () => {
	// The envelope of the handoff names the live job of the work: the
	// live path knows the same message under its own id. The two paths
	// lease the same name, so the second one waits for the first one.
	const store = new HandoffLeaseStore(tempRoot());
	const storePath = handoffLeaseKeys({
		handoffId: "h1",
		correlationId: "c1",
		messageId: "live-1",
	});
	const planPath = handoffLeaseKeys({
		correlationId: "c2",
		messageId: "live-1",
	});
	assert.equal(store.claim({ keys: storePath, owner: "session-a:store" }).ok, true);
	const plan = store.claim({ keys: planPath, owner: "session-a:plan" });
	assert.equal(plan.ok, false);
	assert.equal(plan.holder, "session-a:store");
});

test("the path of the store leases the live job of the envelope", () => {
	// The name of the message is the name of the live message of the
	// work: the envelope names it as the live job of the handoff.
	assert.match(
		indexSource,
		/messageId: handoff\.envelope\.liveJobId \?\? handoff\.envelope\.handoffId/,
	);
});

test("a handoff that is delivered again is pending again", () => {
	// The todo of the first delivery is in the list, and the handoff is
	// delivered again with a new correlation. The work of the new revision
	// was not recorded yet: the handoff is pending again, and the todo of
	// the new work names the correlation of the new delivery.
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "corr-1" });
	context.noteTodo(
		7,
		{ bdIssueId: "bd-1", handoffId: "h1", correlationId: "corr-1" },
		1,
	);
	assert.equal(context.pending().length, 0);
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "corr-2" });
	const pending = context.pending();
	assert.equal(pending.length, 1);
	assert.equal(pending[0].correlationId, "corr-2");
});

test("the todo of an earlier call is not the todo of this call", () => {
	// The list refused the create without saying so, and the next id
	// still points at the todo of the earlier call. The todo of this call
	// carries its subject, so the tool does not claim the todo of the
	// earlier call.
	const details = {
		nextId: 2,
		tasks: [
			{
				id: 1,
				subject: "an earlier step",
				metadata: { handoffId: "h1", bdIssueId: "bd-1" },
			},
		],
	};
	const link = { handoffId: "h1", bdIssueId: "bd-1" };
	assert.equal(recordedTodoId(details, link), 1);
	assert.equal(
		recordedTodoId(details, link, undefined, { subject: "the step of this call" }),
		null,
	);
	assert.equal(
		recordedTodoId(details, link, undefined, { subject: "an earlier step" }),
		1,
	);
});

test("the session gives back the leases it does not know any more", () => {
	// The memory of the session is not the truth: the store is. A lease
	// that this session took before a restart of the extension is not in
	// the map of the session any more, and it would hold its handoff
	// until it runs out.
	const body = callbackBody("function releaseHandoffLeases(): void {");
	assert.match(body, /handoffLeaseStore\.leasesOf\(owner\)/);
	assert.match(body, /handoffLeaseStore\.release\(\{ keys: \[lease\.key\], owner \}\)/);
});

test("the resume reports the work it did not start", () => {
	const body = callbackBody('pi.on("context", async (event) => {');
	// The state of the issue is unknown: the human is told that the
	// resume did not go out.
	assert.match(body, /closure\.action === "unknown"/);
	const unknown = body.slice(body.indexOf('closure.action === "unknown"'));
	assert.match(unknown, /reportSuppressedResume\(/);
});

test("the closure of the work follows the todos of the running request", () => {
	const body = callbackBody("async function currentHandoffClosure(");
	assert.match(body, /bdHandoffContext\.linksOfGeneration\(/);
});

test("the resume reads the closure of the work before it runs", () => {
	const body = callbackBody('pi.on("context", async (event) => {');
	assert.match(body, /currentHandoffClosure\(\)/);
	assert.ok(
		body.indexOf("currentHandoffClosure()") < body.lastIndexOf("neutralizeAutoResume"),
		"the closure has to be read before the resume is neutralized or kept",
	);
});

test("the plan of the live path leases the handoff too", () => {
	assert.match(indexSource, /lease: \{\s*claim: \(message\) => claimPlanHandoffLease\(message\)/);
});

// ---------------------------------------------------------------------------
// The findings of the fourth review
// ---------------------------------------------------------------------------

test("a request with a missing issue and an open issue still has work", () => {
	// An issue that does not exist any more is finished, but it is not the
	// end of the whole request: the other issues of the request still
	// decide, and an issue that is still open is work that waits.
	const decision = decideRequestClosure({
		links: [{ todoId: 1, bdIssueId: "bd-1" }, { todoId: 2, bdIssueId: "bd-2" }],
		states: new Map([
			["bd-1", { readable: false, missing: true }],
			["bd-2", { readable: true, status: "open" }],
		]),
	});
	assert.equal(decision.action, "continue");
});

test("a request whose issues are all closed or missing is finished", () => {
	const decision = decideRequestClosure({
		links: [{ todoId: 1, bdIssueId: "bd-1" }, { todoId: 2, bdIssueId: "bd-2" }],
		states: new Map([
			["bd-1", { readable: false, missing: true }],
			["bd-2", { readable: true, status: "closed" }],
		]),
	});
	assert.equal(decision.action, "suppress");
	assert.deepEqual(decision.todoIds, [1, 2]);
});

test("a handoff that is delivered again keeps the correlation of the delivery that happened now", () => {
	// The runtime delivers a handoff again when its revision grows: the
	// correlation of the new delivery is the one that counts.
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "corr-1" });
	assert.equal(context.pending().length, 1);
	assert.equal(context.pending()[0].correlationId, "corr-1");
	// The second delivery arrives later, in another request. The handoff
	// belongs to the session, so it is still named.
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "corr-2" });
	const arrived = context.pending();
	assert.equal(arrived.length, 1);
	assert.equal(arrived[0].correlationId, "corr-2");
	// The link of the handoff is the link of the delivery that happened
	// now.
	const link = context.linkOfHandoff("h1");
	assert.equal(link.correlationId, "corr-2");
});

test("the work of a handoff that was recorded is not named any more", () => {
	// The todo of a handoff is the evidence that the work belongs to it.
	// Once the todo is in the list, the plain tool is the right tool for
	// everything that follows.
	const context = new BdHandoffContext();
	context.add({ bdIssueId: "bd-1", handoffId: "h1", correlationId: "corr-1" });
	assert.equal(context.pending().length, 1);
	context.noteTodo(1, { bdIssueId: "bd-1", handoffId: "h1", correlationId: "corr-1" }, 1);
	assert.equal(context.pending().length, 0);
});

test("the leases that ran out do not stay in the directory for ever", () => {
	const root = tempRoot();
	const store = new HandoffLeaseStore(root);
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a", leaseMs: 1 }).ok, true);
	// The lease of another owner that ran out is rubbish too.
	const other = new HandoffLeaseStore(root);
	assert.equal(other.claim({ keys: handoffLeaseKeys({ handoffId: "h2" }), owner: "session-b", leaseMs: 1 }).ok, true);
	// The cleanup removes the leases that ran out.
	const removed = store.cleanup();
	assert.ok(removed >= 2);
	assert.equal(store.read("handoff:h1"), null);
	assert.equal(store.read("handoff:h2"), null);
});

test("the reminder knows the tool of the handoff as a record of the work", () => {
	// The tool of the handoff records the work in the same list, so the
	// reminder must not keep nudging a request whose work was recorded
	// with the tool the harness itself asked for.
	const source = readFileSync(
		new URL("../harness/task-memory-reminder.ts", import.meta.url),
		"utf8",
	);
	const capture = source.slice(source.indexOf("function isCapture("));
	assert.match(capture, /BD_HANDOFF_TODO_TOOL/);
	const records = source.slice(source.indexOf("function recordsWork("));
	assert.match(records, /BD_HANDOFF_TODO_TOOL/);
});

test("a lease that ran out is not taken from the owner that took it in the gap", () => {
	// The lease of the name ran out, and another owner took the name in
	// the gap between the read of the dead lease and the write of the new
	// one. The dead lease is moved aside, and the lease that was moved is
	// the fresh one of the other owner: it is put back, and the name is
	// not free.
	let clock = 1_000;
	const root = tempRoot();
	const store = new HandoffLeaseStore(root, { now: () => clock });
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	clock = 400_000;
	// Another owner took the name in the gap.
	const fresh = new HandoffLeaseStore(root, { now: () => clock });
	assert.equal(fresh.claim({ keys, owner: "session-b" }).ok, true);
	// The claim of the first owner finds the fresh lease of the other
	// owner and does not take it away.
	const late = new HandoffLeaseStore(root, { now: () => clock });
	const claim = late.claim({ keys, owner: "session-a" });
	assert.equal(claim.ok, false);
	assert.equal(late.read("handoff:h1").owner, "session-b");
});

test("the release of an owner does not remove the lease of another owner", () => {
	// The lease of the owner ran out, another owner took the name, and the
	// first owner gives its lease back. The release moves the file aside
	// and looks at it again: the lease that was moved is the fresh one of
	// the other owner, so it is put back.
	let clock = 1_000;
	const root = tempRoot();
	const store = new HandoffLeaseStore(root, { now: () => clock });
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	clock = 400_000;
	const fresh = new HandoffLeaseStore(root, { now: () => clock });
	assert.equal(fresh.claim({ keys, owner: "session-b" }).ok, true);
	// The first owner gives its lease back: the lease of the other owner
	// stays.
	assert.equal(store.release({ keys, owner: "session-a" }), false);
	assert.equal(fresh.read("handoff:h1").owner, "session-b");
});

test("the proof of a todo rejects a link that names nothing", () => {
	// A link without any name proves nothing: a todo with any metadata
	// at all is not a todo of this handoff.
	const task = { id: 1, metadata: { something: "else" } };
	assert.equal(carriesLink(task, {}), false);
	assert.equal(carriesLink(task, { handoffId: undefined }), false);
});

test("the proof of a todo rejects a correlation of another delivery", () => {
	// The correlation is part of the name of the link: a todo of another
	// delivery of the same handoff is not a todo of this delivery.
	const task = {
		id: 1,
		metadata: {
			handoffId: "h1",
			bdIssueId: "bd-1",
			correlationId: "corr-other",
		},
	};
	assert.equal(
		carriesLink(task, { handoffId: "h1", correlationId: "corr-1" }),
		false,
	);
	assert.equal(
		carriesLink(task, { handoffId: "h1", correlationId: "corr-other" }),
		true,
	);
});

test("the id of the todo that was written is the one before the next id", () => {
	// The list hands out the id of the new todo as the one before its
	// next id. The proof of the todo rests on that relation, so it is
	// pinned here: a reducer that changes it makes the tool say that it
	// wrote nothing although it wrote something.
	const details = {
		nextId: 5,
		tasks: [
			{ id: 3, metadata: { handoffId: "h1" } },
			{ id: 4, metadata: { handoffId: "h1" } },
		],
	};
	assert.equal(recordedTodoId(details, { handoffId: "h1" }), 4);
	assert.equal(
		recordedTodoId(details, { handoffId: "h1" }, 3),
		3,
	);
	// A todo of another handoff is not the todo of this call.
	assert.equal(recordedTodoId(details, { handoffId: "h2" }), null);
});

test("the cleanup leaves a file that a takeover is using alone", () => {
	// The takeover of a lease that ran out keeps the file aside for a
	// moment before it looks at it. The cleanup of another session must
	// not take that file away: the release of a live lease would lose the
	// lease of its owner while that owner still believes it holds it.
	const root = tempRoot();
	const store = new HandoffLeaseStore(root);
	const keys = handoffLeaseKeys({ handoffId: "h1" });
	assert.equal(store.claim({ keys, owner: "session-a" }).ok, true);
	const dir = join(root, "handoff-leases");
	const name = readdirSync(dir).find((entry) => entry.endsWith(".json"));
	// The file of the lease, kept aside the way a takeover keeps it.
	const aside = join(dir, `${name}.stale-1-2`);
	renameSync(join(dir, name), aside);
	// The cleanup leaves a file that is younger than the bound of the
	// lease alone.
	assert.equal(store.cleanup(), 0);
	assert.equal(existsSync(aside), true);
	// A file that is old enough is rubbish and is removed.
	utimesSync(aside, new Date(0), new Date(0));
	assert.equal(store.cleanup(), 1);
	assert.equal(existsSync(aside), false);
});
