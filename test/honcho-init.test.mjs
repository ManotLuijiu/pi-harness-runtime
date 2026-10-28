import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "./helpers/strip-types.mjs";

const source = readFileSync(new URL("../harness/honcho-init.ts", import.meta.url), "utf8");
const outputText = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)";/g,
    (_, names, id) => `const {${names}} = require(${JSON.stringify(id)});`)
  .replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/g, "")
  .replace(/\bexport\s*\{[^}]*\};?/g, "")
  + "\nObject.assign(exports, { honchoPayload, initHoncho, ensureHonchoIdentity,"
  + " ingestUserMessage, ingestAssistantMessage, retrieveHonchoContext, getHonchoIdentity,"
  + " honchoToolCall, honchoMcpServerConfig, registerHonchoMcpServer, getHonchoInitResult,"
  + " shutdownHoncho, redactHonchoKey, loadHonchoApiKey, registerHonchoLifecycle });";

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
 *
 * The server owns the ids: it answers with its own id, not with the one it
 * was asked for. A fake that echoes the request would let an implementation
 * that ignores the answer pass the test.
 */
function answerFor(tool, args) {
  switch (tool) {
    case "inspect_workspace":
      return json({ id: "ws-1" });
    case "set_metadata":
      return text("Metadata set");
    case "create_peer":
      return json({ peer_id: `srv-${args.peer_id}` });
    case "list_peers":
      return json({ peers: [], total: 0, page: 1, pages: 1 });
    case "create_session":
      return json({ session_id: `srv-${args.session_id}` });
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
 * A native MCP client that answers like the Honcho server.
 *
 * The harness talks to the server through Pi's native MCP client, and the
 * client is the seam of the tests: no server and no network are involved.
 */
function makeClient({ calls, fail, errorResult, closeCalls, listToolsFails, neverAnswers, resultWith } = {}) {
  return {
    connectionState: "connected",
    async listTools() {
      if (listToolsFails) {
        throw new Error("the server listed no tools");
      }
      return [{ name: "create_peer" }, { name: "search" }];
    },
    async callTool(tool, args, options) {
      calls.push({ tool, args, options });
      if (neverAnswers) {
        // A server that never answers: the request stays pending until the
        // probe aborts it.
        return new Promise(() => {});
      }
      if (fail && fail.tool === tool) {
        throw fail.error ?? new Error(fail.message);
      }
      if (errorResult && errorResult.tool === tool) {
        return { isError: true, content: [{ type: "text", text: errorResult.text }] };
      }
      if (resultWith) {
        return resultWith;
      }
      return answerFor(tool, args);
    },
    async close() {
      if (closeCalls) closeCalls.push(Date.now());
    },
  };
}

/**
 * The native MCP client library of Pi, as a fake module.
 *
 * The module of the harness imports the library by name, so the tests can
 * hand it a fake that records how it was built: the option names of the
 * real library are part of the contract.
 */
function makeNativeModule({ listToolsFails } = {}) {
  const state = {
    clientOptions: null,
    transportOptions: null,
    connected: 0,
    listToolsCalls: 0,
  };

  class McpClient {
    constructor(options) {
      state.clientOptions = options;
    }
    async connect(transport) {
      state.connected += 1;
      state.transport = transport;
    }
    async listTools() {
      state.listToolsCalls += 1;
      if (listToolsFails) throw new Error("the server listed no tools");
      return [{ name: "search" }];
    }
    async callTool() {
      return json({});
    }
    async close() {}
  }

  class StreamableHttpTransport {
    constructor(options) {
      state.transportOptions = options;
    }
  }

  return { module: { McpClient, StreamableHttpTransport }, state };
}

/**
 * Load the module with an injected native MCP client and an injected file
 * system. Nothing outside the sandbox is touched.
 */
function loadHoncho({
  key = "test-key",
  hasKey = true,
  fail,
  errorResult,
  connect,
  listToolsFails,
  neverAnswers,
  resultWith,
} = {}) {
  const calls = [];
  const logs = [];
  const files = new Map();
  const closeCalls = [];
  const factoryKeys = [];
  const client = makeClient({ calls, fail, errorResult, closeCalls, listToolsFails, neverAnswers, resultWith });
  const native = makeNativeModule({ listToolsFails });

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
  const context = {
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
          loadHonchoApiKey: () => (hasKey ? key : undefined),
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
    AbortController,
  };

  runInNewContext(outputText, context);

  const honcho = exports;
  const createClient = async (apiKey) => {
    factoryKeys.push(apiKey);
    if (connect) {
      throw connect;
    }
    return client;
  };

  return { honcho, calls, logs, client, createClient, closeCalls, factoryKeys, native: native.state, nativeModule: native.module };
}

test("the identity setup uses the peer API of the current server", async () => {
  const { honcho, calls, createClient } = loadHoncho();

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });
  assert.equal(result.status, "ready", "the initialization has to succeed");
  assert.ok(result.memory, "a ready result carries the memory instance");
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

test("the peer, the session and their membership use the ids of the server", async () => {
  const { honcho, calls, createClient } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", createClient });
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

  // The server owns the ids: the membership carries the id the server
  // answered with, not the one the harness asked for.
  const peersCall = calls.find((call) => call.tool === "add_peers_to_session");
  assert.ok(peersCall, "the peers join the session with their own call");
  assert.equal(peersCall.args.session_id, `srv-${sessionCall.args.session_id}`);
  assert.equal(peersCall.args.peers.length, 2);
  assert.deepEqual(
    [...peersCall.args.peers],
    peerCalls.map((call) => `srv-${call.args.peer_id}`)
  );
});

test("the workspace id is read from the answer of the server", async () => {
  const { honcho, calls, createClient } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", createClient });
  await honcho.ensureHonchoIdentity();

  const inspect = calls.find((call) => call.tool === "inspect_workspace");
  assert.ok(inspect, "the workspace is validated");
  // The id of the workspace comes from the JSON of the answer, not from the
  // envelope - reading the envelope would fall back to the workspace name.
  const peer = calls.find((call) => call.tool === "create_peer");
  assert.equal(peer.args.workspace_id, "ws-1");
});

test("the workspace id of the server is read from workspace_id", async () => {
  const { honcho, calls } = loadHoncho();

  const client = {
    async listTools() {
      return [{ name: "create_peer" }];
    },
    async callTool(tool, args) {
      calls.push({ tool, args });
      if (tool === "inspect_workspace") {
        return json({ workspace_id: "ws-2", metadata: { purpose: "pi-harness runtime memory" } });
      }
      return answerFor(tool, args);
    },
    async close() {},
  };

  await honcho.initHoncho({
    apiKey: "test-key",
    createClient: async () => client,
  });
  await honcho.ensureHonchoIdentity();

  const peer = calls.find((call) => call.tool === "create_peer");
  assert.equal(peer.args.workspace_id, "ws-2", "the id of the server is used");
});

test("a message is added with the peer as its author", async () => {
  const { honcho, calls, createClient } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", createClient });
  await honcho.ensureHonchoIdentity();

  const ingested = await honcho.ingestUserMessage("hello there");
  assert.equal(ingested.success, true);

  const messageCall = calls.find((call) => call.tool === "add_messages_to_session");
  assert.ok(messageCall, "the message goes to the session");
  assert.equal(messageCall.args.messages.length, 1);
  assert.equal(messageCall.args.messages[0].content, "hello there");
  // The author is the peer of the server, not the name the harness uses.
  assert.equal(messageCall.args.messages[0].peer_id, "srv-pi-user");
  assert.equal(messageCall.args.messages[0].metadata.role, "user");
  assert.equal(typeof messageCall.args.session_id, "string");
});

test("an assistant message is added with the assistant peer as its author", async () => {
  const { honcho, calls, createClient } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", createClient });
  await honcho.ensureHonchoIdentity();

  const ingested = await honcho.ingestAssistantMessage("the answer of the assistant");
  assert.equal(ingested.success, true);

  const messageCall = calls.find((call) => call.tool === "add_messages_to_session");
  assert.ok(messageCall, "the message goes to the session");
  assert.equal(messageCall.args.messages[0].peer_id, "srv-pi-agent");
  assert.equal(messageCall.args.messages[0].metadata.role, "assistant");
  assert.equal(messageCall.args.messages[0].content, "the answer of the assistant");
});

test("the recall searches and returns the messages it finds", async () => {
  const { honcho, calls, createClient } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", createClient });
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
  const { honcho, logs, createClient } = loadHoncho({ fail: { tool: "create_peer", message: "peer limit reached" } });

  await honcho.initHoncho({ apiKey: "test-key", createClient });
  const ok = await honcho.ensureHonchoIdentity();
  assert.equal(ok, false, "the identity setup fails when a peer cannot be created");

  // The message of the server has to survive: serializing the Error itself
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

test("an error result of the server is a failed call", async () => {
  const { honcho, createClient } = loadHoncho({
    errorResult: { tool: "search", text: "Failed to list workspaces: Invalid API key." },
  });

  await honcho.initHoncho({ apiKey: "test-key", createClient });
  await honcho.ensureHonchoIdentity();

  const call = await honcho.honchoToolCall("search", { query: "x" });
  assert.equal(call.success, false, "an error result is a failure");
  assert.match(call.error, /Invalid API key/, "the text of the server survives");
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

test("a missing key is reported as missing_key", async () => {
  const { honcho, createClient } = loadHoncho({ hasKey: false });

  const result = await honcho.initHoncho({ createClient });
  assert.equal(result.status, "missing_key", "the status names the cause");
  assert.equal(result.memory, null, "there is no memory without a key");
  assert.ok(result.reason, "the reason is named");
  assert.ok(result.hint, "the hint is actionable");
});

test("a refused credential is reported as registration_rejected", async () => {
  const authError = new Error("Unauthorized");
  authError.status = 401;
  const { honcho, createClient } = loadHoncho({ connect: authError });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });
  assert.equal(result.status, "registration_rejected", "the status names the cause");
  assert.equal(result.httpStatus, 401, "the status of the answer is named");
  assert.ok(result.reason, "the reason is named");
  assert.ok(!result.reason.includes("test-key"), "the credential stays out of the reason");
  assert.ok(!result.hint.includes("test-key"), "the credential stays out of the hint");
});

test("a credential the server rejects in the first call is refused", async () => {
  // The server does not check the credential during the handshake: the
  // verdict arrives with the first tool call.
  const { honcho, createClient } = loadHoncho({
    errorResult: {
      tool: "inspect_workspace",
      text: "Failed to list workspaces: Invalid API key. This operation is only possible with an admin API key.",
    },
  });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });
  assert.equal(result.status, "registration_rejected", "the status names the cause");
  assert.ok(result.reason, "the reason is named");
  assert.ok(!result.reason.includes("test-key"), "the credential stays out of the reason");
});

test("a server that quotes the credential does not put it into the report or the log", async () => {
  // The server can echo the credential in its answer. The reason, the hint
  // and the log have to mask it.
  const { honcho, logs, createClient } = loadHoncho({
    errorResult: {
      tool: "inspect_workspace",
      text: "Invalid API key: test-key",
    },
  });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });
  assert.equal(result.status, "registration_rejected", "the status names the cause");
  assert.ok(!result.reason.includes("test-key"), "the credential stays out of the reason");
  assert.ok(!String(result.hint ?? "").includes("test-key"), "the credential stays out of the hint");
  assert.ok(
    !JSON.stringify(logs).includes("test-key"),
    `the credential stays out of the log: ${JSON.stringify(logs)}`,
  );
});

test("a probe that fails for another reason keeps the credential accepted", async () => {
  // The workspace of the harness may not exist yet: that is a problem of
  // the identity step, not a verdict about the credential.
  const { honcho, createClient } = loadHoncho({
    errorResult: { tool: "inspect_workspace", text: "Workspace not found" },
  });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });
  assert.equal(result.status, "ready", "the credential was accepted");
});

test("a probe that the server does not answer is reported as unavailable", async () => {
  // An exception is a transport failure, never a proof that the credential
  // is good: the server did not answer at all.
  const { honcho, createClient } = loadHoncho({
    fail: { tool: "inspect_workspace", message: "fetch failed" },
  });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });
  assert.equal(result.status, "mcp_unavailable", "the status names the cause");
  assert.match(result.reason, /fetch failed/, "the reason names the cause");
});

test("a server that cannot be reached is reported as mcp_unavailable", async () => {
  const { honcho, createClient } = loadHoncho({ connect: new Error("connect ECONNREFUSED") });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });
  assert.equal(result.status, "mcp_unavailable", "the status names the cause");
  assert.match(result.reason, /ECONNREFUSED/, "the reason names the cause");
  assert.ok(result.hint, "the hint is actionable");
});

test("the MCP server is registered with Pi", async () => {
  const registered = [];
  const pi = {
    registerMcpServer(name, config) {
      registered.push({ name, config });
    },
  };
  const { honcho, createClient } = loadHoncho();

  const result = await honcho.initHoncho({ apiKey: "test-key", pi, createClient });

  assert.equal(result.mcpRegistered, true, "the result names the registration");
  assert.equal(registered.length, 1, "the server is registered once");
  assert.equal(registered[0].name, "honcho", "the name of the server");
  assert.equal(registered[0].config.url, "https://mcp.honcho.dev", "the url of the server");
  assert.equal(registered[0].config.exposure, "codemode", "the exposure of the server");
  assert.match(registered[0].config.headers.Authorization, /^Bearer /, "the credential travels in the header");
});

test("a registration that Pi refuses does not throw and is reported", async () => {
  let calls = 0;
  const pi = {
    registerMcpServer() {
      calls += 1;
      // Pi can echo the configuration in its error, and the configuration
      // carries the credential.
      throw new Error("MCP server \"honcho\" is invalid (test-key)");
    },
  };
  const { honcho, logs, createClient } = loadHoncho();

  const result = await honcho.initHoncho({ apiKey: "test-key", pi, createClient });
  assert.equal(calls, 1, "the registration is attempted once");
  assert.equal(result.status, "ready", "the client works without the registration");
  assert.equal(result.mcpRegistered, false, "the result names the refused registration");
  assert.equal(honcho.getHonchoInitResult().status, "ready", "the result is kept for the diagnostics");

  const failures = logs.filter((entry) => entry.operation === "mcp_register" && entry.phase === "failed");
  assert.ok(failures.length > 0, "the refused registration is logged");
  assert.ok(
    failures.some((entry) => String(entry.reason ?? "").includes("[REDACTED]")),
    "the credential is masked in the log",
  );
  assert.ok(
    !JSON.stringify(logs).includes("test-key"),
    `the credential stays out of the log: ${JSON.stringify(logs)}`,
  );
});

test("the configuration of the server carries the credential in the header", () => {
  const { honcho } = loadHoncho();

  const config = honcho.honchoMcpServerConfig("test-key");
  assert.equal(config.url, "https://mcp.honcho.dev");
  assert.equal(config.headers.Authorization, "Bearer test-key");
  assert.equal(config.exposure, "codemode");
  assert.ok(config.description.length > 0, "the server is described");
});

test("the native MCP client library is used with its own option names", async () => {
  // The client is built by the library of Pi: the option names are part of
  // the contract, so the construction is observed here.
  const { honcho, native, nativeModule } = loadHoncho();

  const result = await honcho.initHoncho({
    apiKey: "test-key",
    loadMcpLibrary: async () => nativeModule,
  });

  assert.equal(result.status, "ready", "the native client connects");
  assert.ok(native.clientOptions, "the client is built");
  assert.equal(typeof native.clientOptions.name, "string", "the client names itself");
  assert.equal(typeof native.clientOptions.version, "string", "the client names its version");
  assert.equal(native.transportOptions.url, "https://mcp.honcho.dev", "the transport knows the endpoint");
  assert.equal(
    native.transportOptions.headers.Authorization,
    "Bearer test-key",
    "the credential travels in the header of the transport",
  );
  assert.equal(native.connected, 1, "the client is connected");
  assert.ok(native.listToolsCalls >= 1, "the tools of the server are listed");
});

test("a missing native MCP client library is reported as mcp_unavailable", async () => {
  const { honcho } = loadHoncho();

  const result = await honcho.initHoncho({
    apiKey: "test-key",
    loadMcpLibrary: async () => {
      throw new Error("Cannot find module '@earendil-works/pi-mcp'");
    },
  });
  assert.equal(result.status, "mcp_unavailable", "the status names the cause");
  assert.match(result.reason, /native MCP client library is not installed/, "the reason names the cause");
});

test("a server that lists no tools is reported as mcp_unavailable", async () => {
  const { honcho, nativeModule } = loadHoncho({ listToolsFails: true });

  const result = await honcho.initHoncho({
    apiKey: "test-key",
    loadMcpLibrary: async () => nativeModule,
  });
  assert.equal(result.status, "mcp_unavailable", "the status names the cause");
  assert.match(result.reason, /did not list its tools/, "the reason names the cause");
});

test("the shutdown closes the client and stops the calls", async () => {
  const { honcho, closeCalls, createClient } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", createClient });
  await honcho.shutdownHoncho();

  assert.equal(closeCalls.length, 1, "the client is closed once");

  const call = await honcho.honchoToolCall("search", { query: "x" });
  assert.equal(call.success, false, "a call after the shutdown fails");
  assert.match(call.error, /disposed/i, "the call names the shutdown");
});

test("the shutdown unregisters the MCP server again", async () => {
  // A reload registers the server again: without the unregistration the old
  // registration would keep the old credential alive.
  const { honcho, closeCalls, createClient } = loadHoncho();

  const unregistered = [];
  const handlers = {};
  const pi = {
    on(event, handler) {
      handlers[event] = handler;
    },
    registerMcpServer() {},
    unregisterMcpServer(name) {
      unregistered.push(name);
    },
  };

  await honcho.initHoncho({ apiKey: "test-key", pi, createClient });
  honcho.registerHonchoLifecycle(pi);

  assert.ok(handlers.session_shutdown, "the shutdown handler is registered");

  await handlers.session_shutdown();

  assert.deepEqual(unregistered, ["honcho"], "the MCP server is unregistered again");
  assert.equal(closeCalls.length, 1, "the client is closed once");
});

test("the shutdown unregisters the server even without the lifecycle hooks", async () => {
  // The registration happens in the init: the module has to remember the
  // extension API there, or a caller that never registers the lifecycle
  // leaves the server registered with the old credential.
  const { honcho, createClient } = loadHoncho();

  const unregistered = [];
  const pi = {
    registerMcpServer() {},
    unregisterMcpServer(name) {
      unregistered.push(name);
    },
  };

  await honcho.initHoncho({ apiKey: "test-key", pi, createClient });
  await honcho.shutdownHoncho();

  assert.deepEqual(unregistered, ["honcho"], "the MCP server is unregistered again");
});

test("a successful answer does not put its content into the log", async () => {
  // A successful answer can carry the credential (a server that echoes it)
  // and what the user wrote. The log keeps the shape of the answer, not its
  // content.
  const { honcho, logs, createClient } = loadHoncho({
    resultWith: json({ note: "the key is test-key" }),
  });

  await honcho.initHoncho({ apiKey: "test-key", createClient });

  assert.ok(logs.length > 0, "the call is logged");
  assert.ok(
    !JSON.stringify(logs).includes("test-key"),
    `the credential stays out of the log: ${JSON.stringify(logs)}`,
  );
  assert.ok(
    !JSON.stringify(logs).includes("the key is"),
    `the content of the answer stays out of the log: ${JSON.stringify(logs)}`,
  );
});

test("a failed initialization closes the client", async () => {
  // An initialization that fails must not leave a connection open.
  const { honcho, closeCalls, createClient } = loadHoncho({ listToolsFails: true });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });

  assert.equal(result.status, "mcp_unavailable", "the status names the cause");
  assert.equal(closeCalls.length, 1, "the client is closed");
});

test("a refused credential closes the client", async () => {
  const { honcho, closeCalls, createClient } = loadHoncho({
    errorResult: { tool: "inspect_workspace", text: "Invalid API key" },
  });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient });

  assert.equal(result.status, "registration_rejected", "the status names the cause");
  assert.equal(closeCalls.length, 1, "the client is closed");
});

test("a probe that is not answered is aborted and the client is closed", async () => {
  // The request of the probe must not stay pending on a connection that
  // the failed initialization closes.
  const { honcho, calls, closeCalls, createClient } = loadHoncho({ neverAnswers: true });

  const result = await honcho.initHoncho({ apiKey: "test-key", createClient, probeTimeoutMs: 50 });

  assert.equal(result.status, "mcp_unavailable", "the status names the cause");
  assert.match(result.reason, /within 50ms/, "the reason names the timeout");
  assert.equal(closeCalls.length, 1, "the client is closed");
  const probe = calls.find((call) => call.tool === "inspect_workspace");
  assert.ok(probe, "the probe was sent");
  assert.ok(probe.options?.signal, "the probe carries an abort signal");
  assert.equal(probe.options.signal.aborted, true, "the pending probe is aborted");
});

test("the reason of a refused registration is carried into the result", async () => {
  // The startup must show why the registration failed, not always advise
  // the Pi version.
  const { honcho, createClient } = loadHoncho();
  const pi = {
    registerMcpServer() {
      throw new Error("the name honcho is already taken");
    },
    unregisterMcpServer() {},
  };

  const result = await honcho.initHoncho({ apiKey: "test-key", pi, createClient });

  assert.equal(result.status, "ready", "the memory works without the registration");
  assert.equal(result.mcpRegistered, false, "the server is not registered");
  assert.match(result.mcpRegistrationReason ?? "", /already taken/, "the cause is named");
  assert.ok(
    !(result.mcpRegistrationReason ?? "").includes("test-key"),
    "the credential stays out of the reason",
  );
});

test("the startup does not name a version floor for the registration", async () => {
  // The registration is feature-detected: the runtime either provides
  // registerMcpServer or it does not. A version floor that nobody verified
  // sends the user after the wrong thing.
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    indexSource,
    /Check the Pi version/,
    "the startup does not advise a Pi version for a feature-detected registration",
  );
  assert.match(
    indexSource,
    /registerMcpServer/,
    "the startup names the capability that is missing",
  );
});

test("the services command does not report a success while the native tools are missing", async () => {
  // The memory can work while the model sees no Honcho tools: the check has
  // to say which of the two it found.
  const source = readFileSync(new URL("../harness/service-commands.ts", import.meta.url), "utf8");

  const start = source.indexOf("nativeTools === false");
  assert.ok(start > 0, "the branch of the missing native tools is found");
  const end = source.indexOf("} else {", start);
  const branch = source.slice(start, end > 0 ? end : start + 800);

  assert.ok(
    !branch.includes("completed successfully"),
    "the branch of the missing native tools reports no success",
  );
  assert.match(
    branch,
    /registration failed/,
    "the branch names the failure of the registration",
  );
  assert.match(
    source,
    /Honcho memory test completed successfully/,
    "the branch of the unknown state reports only the memory connection",
  );
});

test("the shutdown does not unregister a server that another extension owns", async () => {
  // The registration can be refused because another extension owns the
  // name: that registration belongs to its owner, not to this extension.
  const { honcho, createClient } = loadHoncho();
  const unregistered = [];
  const pi = {
    registerMcpServer() {
      throw new Error("the name honcho is already taken");
    },
    unregisterMcpServer(name) {
      unregistered.push(name);
    },
  };

  await honcho.initHoncho({ apiKey: "test-key", pi, createClient });
  await honcho.shutdownHoncho();

  assert.deepEqual(unregistered, [], "the registration of the other extension stays");
});

test("the startup advice follows the cause of the registration", async () => {
  // The advice may only blame a runtime without registerMcpServer when
  // that is the cause.
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(
    indexSource,
    /cause\.includes\("registerMcpServer"\)/,
    "the advice is conditional on the cause of the registration",
  );
  assert.match(
    indexSource,
    /\? "This runtime does not provide registerMcpServer: /,
    "the capability is named for a runtime without registerMcpServer",
  );
  assert.match(
    indexSource,
    /: "The Honcho memory works, but the model sees no Honcho tools\."/,
    "every other cause names only the consequence",
  );
});

test("the credential reaches the client factory", async () => {
  const { honcho, factoryKeys, createClient } = loadHoncho();

  await honcho.initHoncho({ apiKey: "test-key", createClient });

  assert.deepEqual(factoryKeys, ["test-key"], "the factory gets the credential");
});

test("every status of the integration is handled by the startup", async () => {
  // The contract of the statuses lives in the module, and the startup of
  // Pi reports every one of them. A status that the startup does not know
  // would be swallowed, so the two are checked against each other.
  const moduleSource = readFileSync(new URL("../harness/honcho-init.ts", import.meta.url), "utf8");
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  const union = /export type HonchoInitStatus\s*=\s*((?:\|\s*"[a-z_]+"\s*)+);/.exec(moduleSource);
  assert.ok(union, "the status union of the integration is found");
  const statuses = [...union[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(statuses.length >= 4, `the contract has its statuses: ${statuses.join(", ")}`);

  for (const status of statuses) {
    assert.ok(
      indexSource.includes(`case "${status}":`),
      `index.ts handles the status "${status}"`,
    );
  }
});
