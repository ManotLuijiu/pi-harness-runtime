import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "./helpers/strip-types.mjs";

const source = readFileSync(
	new URL("../harness/mcp-connector.ts", import.meta.url),
	"utf8",
);
const outputText =
	stripTypeScriptTypes(source, { mode: "transform" })
		.replace(
			/import\s+\{([^}]+)\}\s+from\s+"([^"]+)";/g,
			(_, names, id) => `const {${names}} = require(${JSON.stringify(id)});`,
		)
		.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/g, "")
		.replace(/\bexport\s*\{[^}]*\};?/g, "") +
	"\nObject.assign(exports, { createMcpConnector, mcpToolName, mcpNamespace,"
	+ " serverToolNames, toParameters, toToolResult, createTransport,"
	+ " createToolDefinition, redactConfigSecrets });";

/** The module under test, loaded the way the other tests load it. */
function loadConnector() {
	const module = { exports: {} };
	const require = (id) => {
		if (id === "node:crypto") return { createHash };
		throw new Error(`unexpected import ${id}`);
	};
	const fn = new Function("module", "exports", "require", outputText);
	fn(module, module.exports, require);
	return module.exports;
}

/**
 * A fake of Pi's MCP library.
 *
 * The fake records what the connector did, so a test can tell a connection
 * from the claim of one.
 */
function fakeLibrary(tools = [], options = {}) {
	const calls = { transports: [], calls: [], closed: 0 };
	class McpClient {
		constructor(clientOptions) {
			this.options = clientOptions;
		}
		async connect(transport) {
			calls.transports.push(transport);
			if (options.failConnect) throw new Error(options.failConnect);
		}
		async listTools() {
			if (options.failList) throw new Error(options.failList);
			return tools;
		}
		async callTool(name, args, callOptions) {
			calls.calls.push({ name, args, options: callOptions });
			return options.result ?? { content: [{ type: "text", text: "ok" }] };
		}
		async close() {
			calls.closed += 1;
		}
	}
	class StreamableHttpTransport {
		constructor(transportOptions) {
			this.options = transportOptions;
		}
	}
	class StdioTransport {
		constructor(transportOptions) {
			this.options = transportOptions;
		}
	}
	return { library: { McpClient, StreamableHttpTransport, StdioTransport }, calls };
}

/** A registered server with a streamable HTTP configuration. */
function httpServer(name = "honcho", extra = {}) {
	return {
		name,
		config: {
			url: "https://mcp.example.com/honcho",
			headers: { Authorization: "Bearer test-key" },
			...extra,
		},
	};
}

test("the name of a tool follows the convention of Pi", () => {
	const { mcpToolName } = loadConnector();

	assert.equal(mcpToolName("honcho", "search"), "mcp__honcho__search");
	assert.equal(
		mcpToolName("my-server", "read file"),
		"mcp__my_server__read_file",
		"a dash and a space are not part of a tool name",
	);
});

test("a long name and a name that is taken get a hash, like in Pi", () => {
	const { mcpToolName } = loadConnector();

	const long = mcpToolName("honcho", "x".repeat(80));
	assert.ok(long.length <= 64, `the name stays short: ${long.length}`);
	assert.match(long, /_[0-9a-f]{8}$/, "the name ends with the hash");

	const taken = mcpToolName("honcho", "search", (candidate) => candidate === "mcp__honcho__search");
	assert.notEqual(taken, "mcp__honcho__search", "a name that is taken gets another name");
	assert.match(taken, /_[0-9a-f]{8}$/, "the name ends with the hash");
});

test("the namespace of a server replaces a dash with an underscore", () => {	const { mcpNamespace } = loadConnector();

	assert.equal(mcpNamespace("honcho"), "mcp__honcho");
	assert.equal(mcpNamespace("my-server"), "mcp__my_server");
});

test("the tools of a server are the evidence of a connection", () => {
	const { serverToolNames } = loadConnector();

	const names = serverToolNames(
		{
			getAllTools: () => [
				{ name: "mcp__honcho__search" },
				{ name: "mcp__honcho__chat" },
				{ name: "mcp__other__search" },
				{ name: "read_file" },
			],
		},
		"honcho",
	);
	assert.deepEqual(
		names,
		["mcp__honcho__search", "mcp__honcho__chat"],
		"only the tools of the server belong to it",
	);

	assert.deepEqual(
		serverToolNames({ getAllTools: () => [] }, "honcho"),
		[],
		"a server without tools is not connected",
	);
	assert.deepEqual(
		serverToolNames({}, "honcho"),
		[],
		"a runtime that cannot report its tools reports no connection",
	);
});

test("the schema of a tool is an object", () => {
	const { toParameters } = loadConnector();

	assert.deepEqual(toParameters(undefined), { type: "object", properties: {} });
	assert.deepEqual(
		toParameters({ type: "object", properties: { query: { type: "string" } } }),
		{ type: "object", properties: { query: { type: "string" } } },
		"the schema of the server is kept",
	);
});

test("the result of a tool call becomes the result of the tool", () => {
	const { toToolResult } = loadConnector();

	const text = toToolResult({ content: [{ type: "text", text: "the answer" }] });
	assert.deepEqual(text.content, [{ type: "text", text: "the answer" }]);
	assert.equal(text.isError, undefined);

	const structured = toToolResult({ structuredContent: { total: 2 } });
	assert.deepEqual(structured.content, [
		{ type: "text", text: '{"total":2}' },
	]);

	const failed = toToolResult({
		content: [{ type: "text", text: "no" }],
		isError: true,
	});
	assert.equal(failed.isError, true, "the error of the server stays an error");
});

test("the connector connects a server that nobody else connected", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([
		{ name: "search", description: "Search the memory", inputSchema: { type: "object", properties: {} } },
	]);
	const registered = [];
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
			registerTool: (tool) => registered.push(tool),
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	assert.equal(calls.transports.length, 1, "the server is connected once");
	assert.equal(
		calls.transports[0].options.url,
		"https://mcp.example.com/honcho",
		"the transport uses the url of the registration",
	);
	assert.equal(
		calls.transports[0].options.headers.Authorization,
		"Bearer test-key",
		"the credential of the registration travels with the request",
	);
	assert.equal(registered.length, 1, "the tool of the server is registered");
	assert.equal(registered[0].name, "mcp__honcho__search");
	assert.equal(registered[0].exposure, "codemode", "the exposure of the server is used");
	assert.equal(registered[0].namespace.name, "mcp__honcho");
	assert.equal(
		connector.statuses.get("honcho").state,
		"connected",
		"the connector reports the connection",
	);
});

test("a tool of the connector calls the server", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([{ name: "search" }]);
	const registered = [];
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
			registerTool: (tool) => registered.push(tool),
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();
	const result = await registered[0].execute("call-1", { query: "the memory" });

	assert.equal(calls.calls.length, 1, "the server is called");
	assert.equal(calls.calls[0].name, "search", "the tool of the server is called");
	assert.deepEqual(calls.calls[0].args, { query: "the memory" });
	assert.deepEqual(
		result.content,
		[{ type: "text", text: "ok" }],
		"the answer of the server becomes the answer of the tool",
	);
});

test("a server that another connector connected is left alone", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([{ name: "search" }]);
	const registered = [];
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			// The tools of the server are in the session: another connector
			// did the work.
			getAllTools: () => [{ name: "mcp__honcho__search" }],
			registerTool: (tool) => registered.push(tool),
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	assert.equal(calls.transports.length, 0, "the server is not connected twice");
	assert.equal(registered.length, 0, "the tools are not registered twice");
	assert.equal(
		connector.statuses.get("honcho").state,
		"skipped",
		"the connector says that the server belongs to another connector",
	);
});

test("the connector waits before it connects a server", async () => {
	const { createMcpConnector } = loadConnector();
	const { library } = fakeLibrary([{ name: "search" }]);
	const waits = [];
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
		},
		{
			loadLibrary: async () => library,
			delay: async (ms) => {
				waits.push(ms);
			},
		},
	);

	await connector.connectPending();

	assert.equal(waits.length, 1, "the connector waits once");
	assert.ok(waits[0] > 0, "the wait gives another connector the time");
});

test("a server that cannot be connected is reported with its reason", async () => {	const { createMcpConnector } = loadConnector();
	const { library } = fakeLibrary([], { failConnect: "the credential was refused" });
	const registered = [];
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
			registerTool: (tool) => registered.push(tool),
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	const status = connector.statuses.get("honcho");
	assert.equal(status.state, "failed", "the failure is not a connection");
	assert.match(status.reason, /credential was refused/, "the reason says why");
	assert.equal(registered.length, 0, "no tool of a server that is not connected");
});

test("the credential of a server stays out of the reason of a failure", async () => {
	const { createMcpConnector } = loadConnector();
	const { library } = fakeLibrary([], {
		failConnect:
			'the server said: the credential "Bearer test-key" was refused',
	});
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
			registerTool: () => {},
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	const status = connector.statuses.get("honcho");
	assert.ok(
		!status.reason.includes("test-key"),
		`the credential stays out of the reason: ${status.reason}`,
	);
	assert.match(status.reason, /\[REDACTED\]/, "the credential is masked");
});

test("a server without a url and without a command cannot be connected", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([]);
	const connector = createMcpConnector(
		{
			getMcpServers: () => [{ name: "broken", config: {} }],
			getAllTools: () => [],
			registerTool: () => {},
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	const status = connector.statuses.get("broken");
	assert.equal(status.state, "failed");
	assert.match(status.reason, /neither a url nor a command/, "the reason names the cause");
	assert.equal(calls.transports.length, 0, "nothing was connected");
});

test("a server that is not enabled is left alone", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([]);
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer("honcho", { enabled: false })],
			getAllTools: () => [],
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	assert.equal(calls.transports.length, 0, "a server that is not enabled is not connected");
	assert.equal(connector.statuses.has("honcho"), false, "the server is not reported");
});

test("a stdio server is connected with its command", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([{ name: "search" }]);
	const connector = createMcpConnector(
		{
			getMcpServers: () => [
				{
					name: "local",
					config: { command: "node", args: ["server.js"], cwd: "/tmp" },
				},
			],
			getAllTools: () => [],
			registerTool: () => {},
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	assert.equal(calls.transports.length, 1, "the server is connected");
	assert.equal(calls.transports[0].options.command, "node");
	assert.deepEqual(calls.transports[0].options.args, ["server.js"]);
	assert.equal(calls.transports[0].options.cwd, "/tmp");
});

test("the connections of the connector are closed", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([{ name: "search" }]);
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
			registerTool: () => {},
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();
	await connector.close();

	assert.equal(calls.closed, 1, "the connection is closed once");
});

test("the connector connects a server only once", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([{ name: "search" }]);
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
			registerTool: () => {},
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();
	await connector.connectPending();

	assert.equal(calls.transports.length, 1, "the server is not connected twice");
});

test("the extension handles the change of the registered servers", () => {
  // Pi marks the extension that handles the event as the one that connects
  // the registered servers, and it warns about every registered server that
  // no extension connects. The extension has to handle the event, and the
  // connector has to keep the promise.
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(
    indexSource,
    /on\("mcp_servers_change"/,
    "the extension handles the change of the registered servers",
  );
  assert.match(
    indexSource,
    /createMcpConnector\(/,
    "the extension connects the servers with the fallback connector",
  );
});

test("a server that failed is tried again", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([{ name: "search" }]);
	let attempt = 0;
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
			registerTool: () => {},
		},
		{
			loadLibrary: async () => {
				attempt += 1;
				if (attempt === 1) {
					throw new Error("the library is not there yet");
				}
				return library;
			},
			delay: async () => {},
		},
	);

	await connector.connectPending();
	assert.equal(
		connector.statuses.get("honcho").state,
		"failed",
		"the first attempt failed",
	);

	await connector.connectPending();
	assert.equal(
		connector.statuses.get("honcho").state,
		"connected",
		"the second attempt connected the server",
	);
	assert.equal(calls.transports.length, 1, "the server is connected once");
});

test("a runtime that cannot register tools connects nothing", async () => {
	const { createMcpConnector } = loadConnector();
	const { library, calls } = fakeLibrary([{ name: "search" }]);
	const connector = createMcpConnector(
		{
			getMcpServers: () => [httpServer()],
			getAllTools: () => [],
		},
		{ loadLibrary: async () => library, delay: async () => {} },
	);

	await connector.connectPending();

	const status = connector.statuses.get("honcho");
	assert.equal(status.state, "failed", "tools that cannot be registered are no tools");
	assert.match(status.reason, /cannot register tools/, "the reason names the cause");
	assert.equal(calls.transports.length, 0, "the server was not connected");
});
