#!/usr/bin/env bun
/**
 * The isolated pilot of the todo of a handoff.
 *
 * The unit tests of the todo of a handoff use a stand-in for the todo
 * tool. They prove the harness, not the program: a stand-in cannot show
 * that the list of the machine accepts the metadata of a handoff and
 * keeps it after the list is written down.
 *
 * This pilot runs against the real todo extension of the machine:
 *
 * - it reads the schema and the reducer of the installed todo tool,
 * - it builds the call that the tool of the handoff sends,
 * - it applies the call and reads the state that the list would write,
 * - it writes that state down as JSON and reads it again, because the
 *   list survives a restart of the session only when the metadata
 *   survives the writing.
 *
 * The pilot reads the program of the machine and writes nothing outside
 * of its own memory.
 *
 * ```bash
 * bun scripts/bd-handoff-todo-pilot.ts [--package <path>]
 * ```
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { bdTodoMetadata } from "../harness/bd-handoff-todo.ts";
import {
	BD_CORRELATION_ID_METADATA_KEY,
	BD_HANDOFF_ID_METADATA_KEY,
	BD_ISSUE_ID_METADATA_KEY,
} from "../harness/bd-handoff-link.ts";

/**
 * The package of the todo extension of this machine.
 *
 * The path may be given as the only argument or behind the flag
 * `--package`, so the invocation that the header of the file names works.
 */
function packageOf(argument?: string): string {
	if (argument) return argument;
	return join(
		homedir(),
		".pi",
		"agent",
		"npm",
		"node_modules",
		"@juicesharp",
		"rpiv-todo",
	);
}

/**
 * The package the arguments name.
 */
function packageFromArguments(argv: readonly string[]): string {
	if (argv.length === 0) return packageOf();
	const first = argv[0];
	if (!first.startsWith("--")) return packageOf(first);
	const flag = argv.indexOf("--package");
	if (flag === -1) return packageOf();
	const value = argv[flag + 1];
	if (!value || value.startsWith("--")) return packageOf();
	return packageOf(value);
}

const packagePath = packageFromArguments(process.argv.slice(2));

if (!existsSync(join(packagePath, "tool", "types.ts"))) {
	console.error(`the todo extension is not installed at ${packagePath}`);
	process.exit(2);
}

const { TodoParamsSchema } = await import(
	join(packagePath, "tool", "types.ts")
);
const { applyTaskMutation } = await import(
	join(packagePath, "state", "state-reducer.ts")
);
const { Check } = await import("typebox/value");

/**
 * The identity of the handoff of the pilot.
 */
const LINK = {
	bdIssueId: "bdtest-8wk",
	handoffId: "h1",
	correlationId: "c1",
};

/**
 * The state of an empty list.
 */
function emptyState() {
	return { tasks: [], nextId: 1 };
}

/**
 * The call that the tool of the handoff sends for a new todo.
 */
function createCall() {
	return {
		action: "create",
		subject: "read the issue of the handoff",
		description: "the work of the handoff",
		metadata: bdTodoMetadata(LINK),
	};
}

/**
 * The call that the tool of the handoff sends for a todo that exists.
 */
function updateCall(id: number) {
	return {
		action: "update",
		id,
		subject: "read the issue of the handoff",
		metadata: bdTodoMetadata(LINK),
	};
}

/**
 * The call that the tool of the handoff sends when the model wrote no
 * description.
 *
 * The key of the description is left out then: a key that is there and
 * empty is not the same thing as a key that is not there.
 */
function createCallWithoutDescription() {
	return {
		action: "create",
		subject: "read the issue of the handoff",
		metadata: bdTodoMetadata(LINK),
	};
}

const created = applyTaskMutation(emptyState(), "create", createCall());
const withoutDescription = applyTaskMutation(
	emptyState(),
	"create",
	createCallWithoutDescription(),
);
const task = created.state.tasks[0];
const details = {
	action: "create",
	params: {},
	tasks: created.state.tasks,
	nextId: created.state.nextId,
};
const writtenText = JSON.stringify(details);
const written = JSON.parse(writtenText) as typeof details;
const updated = applyTaskMutation(created.state, "update", updateCall(task.id));

const checks: Array<{ name: string; ok: boolean; detail: string }> = [
	{
		name: "the schema of the list accepts the call of the handoff",
		ok: Check(TodoParamsSchema, createCall()),
		detail: "create with metadata",
	},
	{
		name: "the schema of the list accepts the update of the handoff",
		ok: Check(TodoParamsSchema, updateCall(1)),
		detail: "update with metadata",
	},
	{
		name: "the list writes the todo of the handoff",
		ok: created.state.tasks.length === 1,
		detail: `${created.state.tasks.length} todo(s)`,
	},
	{
		name: "the todo of the handoff carries the issue of the store",
		ok: task?.metadata?.[BD_ISSUE_ID_METADATA_KEY] === LINK.bdIssueId,
		detail: String(task?.metadata?.[BD_ISSUE_ID_METADATA_KEY] ?? "none"),
	},
	{
		name: "the todo of the handoff carries the handoff",
		ok: task?.metadata?.[BD_HANDOFF_ID_METADATA_KEY] === LINK.handoffId,
		detail: String(task?.metadata?.[BD_HANDOFF_ID_METADATA_KEY] ?? "none"),
	},
	{
		name: "the todo of the handoff carries the correlation of the request",
		ok: task?.metadata?.[BD_CORRELATION_ID_METADATA_KEY] === LINK.correlationId,
		detail: String(task?.metadata?.[BD_CORRELATION_ID_METADATA_KEY] ?? "none"),
	},
	{
		name: "the metadata of the todo survives the writing of the list",
		ok:
			written.tasks?.[0]?.metadata?.[BD_ISSUE_ID_METADATA_KEY] ===
			LINK.bdIssueId,
		detail: String(
			written.tasks?.[0]?.metadata?.[BD_ISSUE_ID_METADATA_KEY] ?? "none",
		),
	},
	{
		name: "the list keeps the metadata when the todo is changed",
		ok:
			updated.state.tasks[0]?.metadata?.[BD_HANDOFF_ID_METADATA_KEY] ===
			LINK.handoffId,
		detail: String(
			updated.state.tasks[0]?.metadata?.[BD_HANDOFF_ID_METADATA_KEY] ?? "none",
		),
	},
	{
		name: "the id of the todo is the one of the list",
		ok: typeof task?.id === "number" && task.id > 0,
		detail: String(task?.id ?? "none"),
	},
	{
		// The tool of the handoff reads the id of the todo it wrote from
		// the next id of the list. The relation is pinned here, so a change
		// of the reducer is caught by the pilot and not by a call that
		// reports a todo that was never written.
		name: "the id of the todo is the one before the next id of the list",
		ok: created.state.nextId - 1 === task?.id,
		detail: `next ${String(created.state.nextId)} task ${String(task?.id)}`,
	},
	{
		name: "the list accepts the call without a description",
		ok: Check(TodoParamsSchema, createCallWithoutDescription()),
		detail: "create with metadata and without a description",
	},
	{
		name: "the todo without a description keeps the metadata",
		ok:
			withoutDescription.state.tasks[0]?.metadata?.[BD_ISSUE_ID_METADATA_KEY] ===
			LINK.bdIssueId,
		detail: String(
			withoutDescription.state.tasks[0]?.metadata?.[BD_ISSUE_ID_METADATA_KEY] ??
				"none",
		),
	},
];

let failed = 0;
for (const check of checks) {
	if (!check.ok) failed += 1;
	console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name} (${check.detail})`);
}
console.log(`${checks.length - failed}/${checks.length} checks passed`);
console.log("todo extension:", packagePath);

process.exit(failed === 0 ? 0 : 1);
