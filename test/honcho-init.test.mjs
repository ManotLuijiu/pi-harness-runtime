import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "./helpers/strip-types.mjs";

const REGISTER_EVENT = "pi-mcp-adapter:runtime-register:v1";
const TOOL_CALL_EVENT = "pi-mcp-adapter:runtime-tool-call:v1";

const source = readFileSync(new URL("../harness/honcho-init.ts", import.meta.url), "utf8");
const outputText = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)";/g,
    (_, names, id) => `const {${names}} = require(${JSON.stringify(id)});`)
  .replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/g, "")
  .replace(/\bexport\s*\{[^}]*\};?/g, "")
  + "\nObject.assign(exports, { honchoPayload, initHoncho, ensureHonchoIdentity,"
  + " ingestUserMessage, ingestAssistantMessage, retrieveHonchoContext, getHonchoIdentity });";

/** The MCP envelope: the JSON sits in the text of the first content block. */
function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** A tool that only confirms something answers with plain text. */
function text(value) {
  return { content: [{ type: "text", text: value }] };
}

/**
 * The answers of the current Honcho MCP Server 3.2.0.
 * The shape follows the live input schemas of the server.
 */
function answerFor(tool, args) {
  switch (tool) {
    case "inspect_workspace":
      return json({ id: "ws-1" });
    case "set_metadata":
      return text("Metadata set");
    case "create_peer":
      return json({ peer_id: args.peer_id });
    case "list_peers":
      return json({ peers: [], total: 0, page: 1, pages: 1 });
    case "create_session":
      return json({ session_id: args.session_id });
    case "list_sessions":
      return json({ sessions: [], total: 0, page: 1, pages: 1 });
    case "add_peers_to_session":
      return text("Peers added to session successfully");
    case "add_messages_to_session":
      return text("Messages added to session successfully");
    case "search":
      return json({ messages: [{ content: "the remembered answer" }], conclusions: [] });
    default:
      return text("ok");
  }
}

/**
 * Load the module with an injected adapter and an injected file system.
 * Nothing outside the sandbox is touched.
 */
function loadHoncho({ fail } = {}) {
  const calls = [];
  const logs = [];
  const files = new Map();

  const bus = {
    on() {},
    emit(event, request) {
      if (event === REGISTER_EVENT) {
        request.result = { ok: true, registration: { dispose: async () => {} } };
        return;
      }
      if (event === TOOL_CALL_EVENT) {
        calls.push({ tool: request.tool, args: request.args });
        if (fail && fail.tool === request.tool) {
          request.result = Promise.resolve({ ok: false, error: new Error(fail.message) });
          return;
        }
        request.result = Promise.resolve({ ok: true, result: answerFor(request.tool, request.args) });
      }
    },
  };

  class HonchoMemory {
    constructor(options) {
      this.options = options;
      this.peers = {};
    }
    setConnected() {}
    setToolsDiscovered() {}
    setWorkspace() {}
    setSession() {}
    setPeers(userPeerId, assistantPeerId) {
      this.peers = { userPeerId, assistantPeerId };
    }
    async dispose() {}
  }

  const exports = {};
  runInNewContext(outputText, {
    exports,
    require(id) {
      if (id === "./service-diagnostics.js") {
        return {
          logServiceEvent: (event) => logs.push(event),
          honchoStatus: {
            recordFailure() {},
            recordSuccess() {},
            setConfigured() {},
            setConnected() {},
            setStatus() {},
            setDetail() {},
          },
        };
      }
      if (id === "./honcho-memory.js") {
        return {
          HonchoMemory,
          loadHonchoApiKey: () => "test-key",
          ensureMcpConfigDirectory: () => {},
          writeHonchoMcpConfig: () => {},
        };
      }
      if (id === "node:fs") {
        return {
          existsSync: (path) => files.has(String(path)),
          readFileSync: (path) => {
            const key = String(path);
            if (files.has(key)) return files.get(key);
            const error = new Error(`ENOENT: ${key}`);
            error.code = "ENOENT";
            throw error;
          },
          writeFileSync: (path, data) => {
            files.set(String(path), String(data));
          },
          mkdirSync: () => {},
        };
      }
      if (id === "node:path") {
        return { join: (...parts) => parts.join("/") };
      }
      if (id === "node:os") {
        return { homedir: () => "/test-home" };
      }
      throw new Error(`unexpected import ${id}`);
    },
    console,
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
  });

  return { honcho: exports, calls, logs, bus };
}

test("the identity setup uses the peer API of the current server", async () => {
  const { honcho, calls, bus } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", piEvents: bus });
  const ok = await honcho.ensureHonchoIdentity();
  assert.equal(ok, true, "the identity setup has to succeed");

  const tools = calls.map((call) => call.tool);
  for (const wanted of ["create_peer", "create_session", "add_peers_to_session"]) {
    assert.ok(tools.includes(wanted), `the harness has to call ${wanted}`);
  }

  // The tools of the retired API must not come back: the server does not
  // know them any more, and every call with them fails.
  for (const gone of [
    "create_user",
    "get_or_create_user",
    "create_assistant",
    "get_or_create_session",
    "add_message",
    "get_context",
  ]) {
    assert.ok(!tools.includes(gone), `the harness must not call ${gone} any more`);
  }
});

test("the peer, the session and their membership use the current arguments", async () => {
  const { honcho, calls, bus } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", piEvents: bus });
  await honcho.ensureHonchoIdentity();

  const peerCalls = calls.filter((call) => call.tool === "create_peer");
  assert.equal(peerCalls.length, 2, "the user and the assistant are two peers");
  for (const call of peerCalls) {
    assert.equal(typeof call.args.peer_id, "string");
    assert.notEqual(call.args.peer_id, "");
  }

  const sessionCall = calls.find((call) => call.tool === "create_session");
  assert.ok(sessionCall, "the session is created");
  assert.match(sessionCall.args.session_id, /^pi-session-/);
  assert.equal(typeof sessionCall.args.workspace_id, "string");

  const peersCall = calls.find((call) => call.tool === "add_peers_to_session");
  assert.ok(peersCall, "the peers join the session with their own call");
  assert.equal(peersCall.args.session_id, sessionCall.args.session_id);
  assert.equal(peersCall.args.peers.length, 2);
  assert.deepEqual(
    [...peersCall.args.peers],
    peerCalls.map((call) => call.args.peer_id)
  );
});

test("the workspace id is read from the answer of the server", async () => {
  const { honcho, calls, bus } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", piEvents: bus });
  await honcho.ensureHonchoIdentity();

  const inspect = calls.find((call) => call.tool === "inspect_workspace");
  assert.ok(inspect, "the workspace is validated");
  // The id of the workspace comes from the JSON of the answer, not from the
  // envelope - reading the envelope would fall back to the workspace name.
  const peer = calls.find((call) => call.tool === "create_peer");
  assert.equal(peer.args.workspace_id, "ws-1");
});

test("a message is added with the peer as its author", async () => {
  const { honcho, calls, bus } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", piEvents: bus });
  await honcho.ensureHonchoIdentity();

  const ingested = await honcho.ingestUserMessage("hello there");
  assert.equal(ingested.success, true);

  const messageCall = calls.find((call) => call.tool === "add_messages_to_session");
  assert.ok(messageCall, "the message goes to the session");
  assert.equal(messageCall.args.messages.length, 1);
  assert.equal(messageCall.args.messages[0].content, "hello there");
  assert.equal(messageCall.args.messages[0].peer_id, "pi-user");
  assert.equal(messageCall.args.messages[0].metadata.role, "user");
  assert.equal(typeof messageCall.args.session_id, "string");
});

test("the recall searches and returns the messages it finds", async () => {
  const { honcho, calls, bus } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", piEvents: bus });
  await honcho.ensureHonchoIdentity();

  const recalled = await honcho.retrieveHonchoContext("what do you know", 3);
  assert.equal(recalled.success, true);
  assert.match(recalled.context, /the remembered answer/);

  const searchCall = calls.find((call) => call.tool === "search");
  assert.ok(searchCall, "the recall is a search");
  assert.equal(searchCall.args.query, "what do you know");
  assert.equal(searchCall.args.message_limit, 3);
});

test("a failing call keeps the real error message", async () => {
  const { honcho, logs, bus } = loadHoncho({ fail: { tool: "create_peer", message: "peer limit reached" } });

  await honcho.initHoncho({ apiKey: "test-key", piEvents: bus });
  const ok = await honcho.ensureHonchoIdentity();
  assert.equal(ok, false, "the identity setup fails when a peer cannot be created");

  // The message of the adapter has to survive: serializing the Error itself
  // would leave an empty object and the log would name nothing.
  const failures = logs.filter((entry) => entry.phase === "failed");
  assert.ok(failures.length > 0, "the failure is logged");
  assert.ok(
    failures.some((entry) => String(entry.error ?? "").includes("peer limit reached")),
    "the log names the real reason"
  );
  assert.ok(
    !failures.some((entry) => entry.error === "Unknown error"),
    "the log must not fall back to an unnamed error"
  );
});

test("the payload of an answer is unwrapped from the content block", async () => {
  const { honcho } = loadHoncho();

  const parsed = honcho.honchoPayload(json({ peer_id: "peer-1" }));
  assert.deepEqual(parsed.data, { peer_id: "peer-1" });
  assert.equal(parsed.text, '{"peer_id":"peer-1"}');

  const plain = honcho.honchoPayload(text("Peers added to session successfully"));
  assert.equal(plain.data, null);
  assert.equal(plain.parsed, null);
  assert.equal(plain.text, "Peers added to session successfully");

  assert.equal(honcho.honchoPayload(undefined).data, null);
});
