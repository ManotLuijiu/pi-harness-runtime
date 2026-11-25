/**
 * The reverse bridge between a worker of another vendor and a Pi session.
 *
 * The rules that must hold:
 *
 * - a message names the instance it is for: the agent id, the session id,
 *   the generation and the workspace,
 * - an instance that is not live any more never receives a message,
 * - an instance of another workspace never receives a message,
 * - the globally newest session never decides: with several live
 *   instances the caller has to name one,
 * - a message is accepted, not completed: the answer of the session comes
 *   later, as a reply of the exchange,
 * - a busy instance defers the message,
 * - the cancel of a message that was delivered already is refused.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RegistrationStore, Mailbox, ReplyStore } from "../packages/plan-handoff/dist/index.js";
import {
	BRIDGE_TOOLS,
	callBridgeTool,
	cancelMessage,
	handleBridgeRequest,
	listAgents,
	readLines,
	readResult,
	sendToAgent,
} from "../packages/agent-bridge/dist/index.js";

/**
 * A temporary directory that goes away with the test.
 */
function temporary() {
	const dir = mkdtempSync(join(tmpdir(), "agent-bridge-"));
	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/**
 * The state of the bridge in a temporary directory.
 */
function bridgeState() {
	const home = temporary();
	const registryDir = join(home.dir, "agents");
	const mailboxDir = join(home.dir, "mailboxes");
	const replyDir = join(home.dir, "replies");
	const workspace = join(home.dir, "workspace");
	return {
		home,
		registryDir,
		mailboxDir,
		replyDir,
		workspace,
		cleanup: home.cleanup,
	};
}

/**
 * A live instance of the bridge.
 */
function register(state, options = {}) {
	const registration = {
		agentId: options.agentId ?? "agent-one",
		sessionId: options.sessionId ?? "session-one",
		generation: options.generation ?? 1,
		workspace: options.workspace ?? state.workspace,
		host: options.host ?? "the-host",
		pid: 4242,
		busy: options.busy ?? false,
		paused: false,
		startedAt: 1,
		heartbeatAt: Date.now(),
	};
	new RegistrationStore(state.registryDir).upsert(registration);
	return registration;
}

/**
 * The options of the bridge in the state.
 */
function options(state, over = {}) {
	return {
		registryDir: state.registryDir,
		mailboxDir: state.mailboxDir,
		replyDir: state.replyDir,
		workspace: state.workspace,
		host: "the-host",
		sender: { agentId: "codex", sessionId: "codex-session" },
		...over,
	};
}

test("the bridge lists the live instances", () => {
	const state = bridgeState();
	try {
		register(state);
		const agents = listAgents(options(state));
		assert.equal(agents.length, 1);
		assert.equal(agents[0].agentId, "agent-one");
		assert.equal(agents[0].sessionId, "session-one");
		assert.equal(agents[0].generation, 1);
		assert.equal(agents[0].busy, false);
	} finally {
		state.cleanup();
	}
});

test("a message reaches the instance it names", () => {
	const state = bridgeState();
	try {
		register(state);
		const result = sendToAgent(options(state), {
			agentId: "agent-one",
			action: "inform",
			summary: "the plan is ready",
			payload: "the plan",
		});
		assert.equal(result.status, "accepted");
		assert.ok(result.messageId);
		const mailbox = new Mailbox(join(state.mailboxDir, "agent-one"));
		const entries = mailbox.entries();
		assert.equal(entries.length, 1);
		assert.equal(entries[0].message.plan.summary, "the plan is ready");
		assert.equal(entries[0].message.recipient.generation, 1);
		assert.equal(entries[0].message.recipient.sessionId, "session-one");
	} finally {
		state.cleanup();
	}
});

test("a message for an instance that is not live any more is refused", () => {
	const state = bridgeState();
	try {
		const result = sendToAgent(options(state), {
			agentId: "agent-gone",
			action: "inform",
			summary: "hello",
		});
		assert.equal(result.status, "refused");
		assert.match(result.reason, /not running any more/);
	} finally {
		state.cleanup();
	}
});

test("a message for another session or another generation is refused", () => {
	const state = bridgeState();
	try {
		register(state);
		const otherSession = sendToAgent(options(state), {
			agentId: "agent-one",
			sessionId: "session-other",
			action: "inform",
			summary: "hello",
		});
		assert.equal(otherSession.status, "refused");
		assert.match(otherSession.reason, /another session/);
		const otherGeneration = sendToAgent(options(state), {
			agentId: "agent-one",
			generation: 7,
			action: "inform",
			summary: "hello",
		});
		assert.equal(otherGeneration.status, "refused");
		assert.match(otherGeneration.reason, /another generation/);
	} finally {
		state.cleanup();
	}
});

test("a message for an instance of another workspace is refused", () => {
	const state = bridgeState();
	try {
		register(state, { workspace: join(state.home.dir, "other-project") });
		const result = sendToAgent(options(state), {
			agentId: "agent-one",
			action: "inform",
			summary: "hello",
		});
		assert.equal(result.status, "refused");
		assert.match(result.reason, /another workspace/);
	} finally {
		state.cleanup();
	}
});

test("several live instances never decide by the newest one", () => {
	const state = bridgeState();
	try {
		register(state, { agentId: "agent-old", sessionId: "session-old" });
		register(state, { agentId: "agent-new", sessionId: "session-new" });
		const result = sendToAgent(options(state), {
			action: "inform",
			summary: "hello",
		});
		assert.equal(result.status, "refused");
		assert.match(result.reason, /has to name one of them/);
		assert.match(result.reason, /agent-old/);
		assert.match(result.reason, /agent-new/);
	} finally {
		state.cleanup();
	}
});

test("a busy instance defers the message", () => {
	const state = bridgeState();
	try {
		register(state, { busy: true });
		const result = sendToAgent(options(state), {
			agentId: "agent-one",
			action: "inform",
			summary: "hello",
		});
		assert.equal(result.status, "deferred");
		// The message waits in the mailbox: it is not lost.
		const mailbox = new Mailbox(join(state.mailboxDir, "agent-one"));
		assert.equal(mailbox.pending().length, 1);
	} finally {
		state.cleanup();
	}
});

test("the result of an exchange tells accepted from completed", () => {
	const state = bridgeState();
	try {
		const replies = new ReplyStore(state.replyDir);
		const pending = readResult(options(state), "exchange-1");
		assert.equal(pending.status, "pending");
		replies.write({
			id: "reply-1",
			correlationId: "exchange-1",
			event: "received",
			createdAt: 1,
		});
		const accepted = readResult(options(state), "exchange-1");
		assert.equal(accepted.status, "accepted");
		replies.write({
			id: "reply-2",
			correlationId: "exchange-1",
			event: "completed",
			createdAt: 2,
			detail: "the plan is done",
		});
		const completed = readResult(options(state), "exchange-1");
		assert.equal(completed.status, "completed");
		assert.equal(completed.replies.length, 2);
		assert.equal(completed.replies[1].detail, "the plan is done");
	} finally {
		state.cleanup();
	}
});

test("the result of an exchange never reads outside the store of the replies", () => {
	const state = bridgeState();
	try {
		// A folder that is a sibling of the store, with a reply in it.
		mkdirSync(join(state.home.dir, "outside"), { recursive: true });
		writeFileSync(
			join(state.home.dir, "outside", "reply-1.json"),
			JSON.stringify({
				id: "reply-1",
				correlationId: "../outside",
				event: "completed",
				createdAt: 1,
			}),
			"utf8",
		);
		// The id of an exchange is a name, never a path: the store of the
		// replies is never read outside of itself.
		const result = readResult(options(state), "../outside");
		assert.equal(result.replies.length, 0);
		assert.equal(result.status, "unknown");
	} finally {
		state.cleanup();
	}
});

test("a reply of another exchange is not the answer of this one", () => {
	const state = bridgeState();
	try {
		// A reply that lies about the exchange it belongs to.
		mkdirSync(join(state.replyDir, "exchange-1"), { recursive: true });
		writeFileSync(
			join(state.replyDir, "exchange-1", "reply-1.json"),
			JSON.stringify({
				id: "reply-1",
				correlationId: "exchange-2",
				event: "completed",
				createdAt: 1,
				detail: "the answer of another exchange",
			}),
			"utf8",
		);
		const result = readResult(options(state), "exchange-1");
		assert.equal(result.replies.length, 0);
		assert.equal(result.status, "pending");
	} finally {
		state.cleanup();
	}
});

test("a message with an id that is not a name never reaches a mailbox", () => {
	const state = bridgeState();
	try {
		register(state);
		const sent = sendToAgent(options(state), {
			agentId: "agent-one",
			action: "inform",
			summary: "the plan",
			correlationId: "../outside",
		});
		assert.equal(sent.status, "refused");
		// The mailbox of the instance holds no message of that id.
		const mailbox = new Mailbox(join(state.mailboxDir, "agent-one"));
		assert.equal(mailbox.entries().length, 0);
	} finally {
		state.cleanup();
	}
});

test("the cancel of a message never reads outside the mailboxes", () => {
	const state = bridgeState();
	try {
		// A folder that is a sibling of the mailboxes, with a file in it.
		mkdirSync(join(state.home.dir, "outside"), { recursive: true });
		writeFileSync(
			join(state.home.dir, "outside", "secret.json"),
			JSON.stringify({ state: "pending", publishedAt: 1, message: { id: "m1" } }),
			"utf8",
		);
		// The id of an instance is a name, never a path.
		const cancelled = cancelMessage(options(state), {
			agentId: "../outside",
			messageId: "secret",
		});
		assert.equal(cancelled.status, "refused");
		// The message of the folder outside was never touched.
		assert.equal(readFileSync(join(state.home.dir, "outside", "secret.json"), "utf8").includes("pending"), true);
	} finally {
		state.cleanup();
	}
});

test("a request that never ends does not grow the buffer of the server", () => {
	// A worker that writes a line without an end does not make the server
	// hold it without a bound.
	const first = readLines("", "x".repeat(500_000));
	assert.equal(first.overflow, false);
	const second = readLines(first.buffer, "x".repeat(600_000));
	assert.equal(second.overflow, true);
	assert.equal(second.buffer, "");
});

test("a message that was not delivered yet may be cancelled", () => {
	const state = bridgeState();
	try {
		register(state);
		const sent = sendToAgent(options(state), {
			agentId: "agent-one",
			action: "inform",
			summary: "hello",
		});
		const cancelled = cancelMessage(options(state), {
			agentId: "agent-one",
			messageId: sent.messageId,
		});
		assert.equal(cancelled.status, "cancelled");
		const mailbox = new Mailbox(join(state.mailboxDir, "agent-one"));
		assert.equal(mailbox.pending().length, 0);
	} finally {
		state.cleanup();
	}
});

test("a message that was delivered already is not cancelled", () => {
	const state = bridgeState();
	try {
		register(state);
		const sent = sendToAgent(options(state), {
			agentId: "agent-one",
			action: "inform",
			summary: "hello",
		});
		const mailbox = new Mailbox(join(state.mailboxDir, "agent-one"));
		mailbox.claim(sent.messageId);
		mailbox.acknowledge(sent.messageId);
		const cancelled = cancelMessage(options(state), {
			agentId: "agent-one",
			messageId: sent.messageId,
		});
		assert.equal(cancelled.status, "refused");
		assert.match(cancelled.reason, /delivered already/);
	} finally {
		state.cleanup();
	}
});

test("the bridge speaks MCP over stdio", () => {
	const state = bridgeState();
	try {
		register(state);
		const initialize = handleBridgeRequest(options(state), {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
		});
		assert.ok(initialize?.result);
		const listed = handleBridgeRequest(options(state), {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
		});
		const tools = listed.result.tools;
		assert.deepEqual(
			tools.map((tool) => tool.name).sort(),
			["agent_cancel", "agent_list", "agent_result", "agent_send"],
		);
		const called = handleBridgeRequest(options(state), {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "agent_list", arguments: {} },
		});
		const content = called.result.content;
		const parsed = JSON.parse(content[0].text);
		assert.equal(parsed.agents.length, 1);
		const unknown = handleBridgeRequest(options(state), {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "agent_nothing" },
		});
		assert.ok(unknown?.result);
	} finally {
		state.cleanup();
	}
});

test("the tools of the bridge are the four ways to talk to a session", () => {
	assert.deepEqual(
		BRIDGE_TOOLS.map((tool) => tool.name).sort(),
		["agent_cancel", "agent_list", "agent_result", "agent_send"],
	);
	const send = callBridgeTool(options({}), "agent_send", {});
	assert.ok(send.isError);
});
