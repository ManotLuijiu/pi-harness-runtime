/**
 * The wiring of the pause of a request.
 *
 * The pause of a request has to be visible and liftable: the reason in the
 * row of the footer, a notice once, and a command that lifts the pause
 * without resetting the request. The wiring is what proves that the
 * production path reads the stalled state, that the recovery does not
 * bypass the guards of the session, and that the progress of the request
 * reaches the lifecycle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(source, needle, before = 0, after = 1600) {
	const at = source.indexOf(needle);
	if (at === -1) return "";
	return source.slice(Math.max(0, at - before), at + after);
}

test("the pause of a request reaches the row of the footer", () => {
	const region = around(indexSource, "const requestStallHost = new RequestStallHost(");
	assert.ok(region, "the host of the pause of a request is registered");
	assert.match(
		region,
		/stalled: requestLifecycle\?\.stalled \?\? false/,
		"the host reads the stalled state of the lifecycle",
	);
	assert.match(
		region,
		/reason: requestLifecycle\?\.stalledReason/,
		"the host reads the reason of the pause",
	);
	assert.match(
		region,
		/setRequestStallStatus\?\.\(text\)/,
		"the host writes the row of the footer",
	);
	assert.match(
		region,
		/notifyRequestStall\?\.\(message, level\)/,
		"the host shows the notice of the pause",
	);
});

test("the row of the pause is bound to the interface of the session", () => {
	const region = around(indexSource, "setRequestStallStatus = ctx.ui.setStatus.bind(");
	assert.ok(region, "the row of the pause is bound");
	assert.match(
		region,
		/ctx\.ui\.setStatus\.bind\(\s*ctx\.ui,\s*REQUEST_STALL_STATUS_KEY,?\s*\)/,
		"the row of the pause has its own key in the footer",
	);
	assert.match(
		region,
		/notifyRequestStall = ctx\.ui\.notify\.bind\(ctx\.ui\)/,
		"the notice of the pause uses the interface of the session",
	);
});

test("the decision about the continuation shows the pause", () => {
	const region = around(indexSource, "async function continueRequestWork(");
	assert.ok(region, "the continuation of the request is registered");
	assert.match(
		region,
		/requestStallHost\.sync\(\)/,
		"the row of the footer follows the state of the request",
	);
	assert.match(
		region,
		/return false;/,
		"the answer tells the caller that the request did not continue",
	);
});

test("the recovery of a paused request does not reset the request", () => {
	const region = around(indexSource, "const requestStallHost = new RequestStallHost(");
	assert.ok(region, "the host of the pause of a request is registered");
	assert.match(
		region,
		/resume: \(\) => requestLifecycle\?\.resumeStalled\(\) \?\? false/,
		"the recovery lifts the pause of the request that is running",
	);
	assert.doesNotMatch(
		region,
		/beginRequest\(/,
		"the recovery does not start a new request",
	);
	assert.match(
		region,
		/continue: \(\) => continueRequestWork\(\)/,
		"the continuation of the recovery goes through the guarded path",
	);
});

test("the command that continues a paused request is registered", () => {
	const region = around(indexSource, "pi.registerCommand(REQUEST_RECOVERY_COMMAND_NAME,");
	assert.ok(region, "the command of the recovery is registered");
	assert.match(
		region,
		/requestStallHost\.recover\(\)/,
		"the command recovers the request through the host",
	);
	assert.match(
		region,
		/ctx\.ui\.notify\(result\.message/,
		"the command tells the human what happened",
	);
});

test("the progress of the request reaches the lifecycle", () => {
	const region = around(indexSource, "requestLifecycle = new RequestLifecycleController({");
	assert.ok(region, "the lifecycle of the request is registered");
	assert.match(
		region,
		/progress: \(\) => requestProgress\.token\(\)/,
		"the lifecycle knows the progress of the request",
	);
});

test("a call that changed a file is the progress of the request", () => {
	const call = around(indexSource, 'pi.on("tool_call"');
	assert.ok(call, "the calls of the agent are observed");
	assert.match(
		call,
		/changesFiles\(/,
		"the call is classified by whether it changes a file",
	);
	const end = around(indexSource, 'pi.on("tool_execution_end"');
	assert.ok(end, "the end of a call is observed");
	assert.match(
		end,
		/requestProgress\.noteChange\(\)/,
		"a call that ended without an error counts as progress",
	);
});
