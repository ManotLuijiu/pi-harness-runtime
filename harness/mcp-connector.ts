/**
 * The fallback connector for the MCP servers that extensions register.
 *
 * Pi's built-in MCP extension connects the registered servers. While it is
 * active, it does that job and this connector stays out of the way: it only
 * connects a server that nobody else connected. The evidence of another
 * connector is the tools of the server in the session - the same evidence
 * the startup report of Honcho uses.
 *
 * The connector never claims a readiness it did not reach: a server it could
 * not connect is reported with its reason, and its tools stay absent.
 *
 * The connector handles the change of the registered servers because Pi
 * expects the extension that handles it to be the one that connects them.
 * Handling the event is therefore a promise, and this module keeps it: a
 * registered server is connected here unless another connector got there
 * first.
 */

import { createHash } from "node:crypto";

/** A server registered by an extension. */
export interface RegisteredMcpServerLike {
	name: string;
	config: McpServerConfigLike;
}

/** The configuration of a registered server. */
export interface McpServerConfigLike {
	/** The url of a streamable HTTP server. */
	url?: string;
	/** The headers of the request, for example the credential. */
	headers?: Record<string, string>;
	/** The command of a stdio server. */
	command?: string;
	/** The arguments of the command. */
	args?: string[];
	/** The environment of the command. */
	env?: Record<string, string>;
	/** The working directory of the command. */
	cwd?: string;
	/** How the model reaches the tools. Default: `codemode`. */
	exposure?: string;
	/** What the server offers, in a sentence. */
	description?: string;
	/** A server that is not enabled is kept without connecting. */
	enabled?: boolean;
	/** The timeout of a request, in seconds. */
	timeout?: number;
}

/** A transport of Pi's MCP library. */
export interface McpTransportLike {
	start?(): Promise<void>;
	send?(message: unknown): Promise<void>;
	close?(): Promise<void>;
}

/** The part of Pi's client the connector uses. */
export interface McpClientLike {
	connect(transport: unknown): Promise<unknown>;
	listTools(): Promise<McpToolLike[]>;
	callTool(
		name: string,
		args?: Record<string, unknown>,
		options?: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<unknown>;
	close(): Promise<void>;
}

/** A tool of an MCP server. */
export interface McpToolLike {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

/** The transports and the client of Pi's MCP library. */
export interface McpClientLibrary {
	McpClient: new (options: {
		name: string;
		version: string;
		requestTimeoutMs?: number;
	}) => McpClientLike;
	StreamableHttpTransport: new (options: {
		url: string;
		headers?: Record<string, string>;
	}) => McpTransportLike;
	StdioTransport: new (options: {
		command: string;
		args?: readonly string[];
		env?: Record<string, string>;
		cwd?: string;
	}) => McpTransportLike;
}

/** The result of a tool call, in the shape Pi expects. */
export interface McpToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

/** The tool the connector registers. */
export interface McpToolDefinition {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	exposure: string;
	namespace: { name: string; aliases?: string[] };
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<McpToolResult>;
}

/** The API of Pi that the connector needs. */
export interface McpConnectorApi {
	/** The servers registered by the extensions. */
	getMcpServers?: () => RegisteredMcpServerLike[];
	/** The tools of the session. */
	getAllTools?: () => Array<{ name?: unknown }>;
	/** Registers a tool of the session. */
	registerTool?: (tool: McpToolDefinition) => void;
}

/** The options of the connector. */
export interface McpConnectorOptions {
	/**
	 * How long the connector waits before it connects a server.
	 *
	 * Another connector may be at work: the built-in extension of Pi
	 * connects the registered servers in the background. The wait gives it
	 * the time, and the evidence of its work is the tools of the server.
	 */
	graceMs?: number;
	/** The library of Pi that carries the client and the transports. */
	loadLibrary: () => Promise<McpClientLibrary>;
	/** The log of the connector. */
	log?: (message: string) => void;
	/** The wait, replaced by the tests. */
	delay?: (ms: number) => Promise<void>;
}

/** What the connector knows about a server. */
export interface McpServerStatus {
	/**
	 * - "connected": the connector connected the server and registered its
	 *   tools.
	 * - "skipped": another connector connected the server.
	 * - "failed": the connector could not connect the server, and the
	 *   reason says why.
	 * - "ended": the session ended before the connection was made. The
	 *   server was not refused; there was no session left to connect it to.
	 */
	state: "connected" | "skipped" | "failed" | "ended";
	/** The names of the tools of the server. */
	tools: string[];
	/** The reason of a failure, of a skip or of an end. */
	reason?: string;
}

/** The connector of the session. */
export interface McpConnector {
	/** Connect the servers that nobody else connected. */
	connectPending(): Promise<void>;
	/** What the connector knows about every server it saw. */
	readonly statuses: Map<string, McpServerStatus>;
	/** Close the connections of the connector. */
	close(): Promise<void>;
	/**
	 * Stop the connector: the session is over, so nothing that is still
	 * pending may touch the runtime any more.
	 */
	stop(): Promise<void>;
}

/** The default wait before the connector connects a server. */
const DEFAULT_GRACE_MS = 1_500;

/** The longest name a tool may have, the same limit Pi uses. */
const MAX_TOOL_NAME_LENGTH = 64;

/** The timeout of a request of the connector, in milliseconds. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * The name of a tool of an MCP server.
 *
 * The name follows the convention of Pi, so the tools of the connector and
 * the tools of the built-in extension are the same tools and not two of
 * them: the session keeps one entry per name. A name that is too long or
 * that another tool already took gets the same hash suffix as in Pi, so the
 * names of the two connectors agree.
 *
 * @param server The name of the server
 * @param tool The name of the tool in the server
 * @param isTaken Whether a name is already in use
 * @returns The name of the tool in the session
 */
export function mcpToolName(
	server: string,
	tool: string,
	isTaken: (candidate: string) => boolean = () => false,
): string {
	const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
	if (name.length <= MAX_TOOL_NAME_LENGTH && !isTaken(name)) return name;
	const hash = createHash("sha256")
		.update(`${server}\0${tool}`)
		.digest("hex")
		.slice(0, 8);
	return `${name.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

/**
 * The namespace of the tools of a server.
 *
 * The namespace replaces a dash with an underscore, so a server and a
 * namespace never collide.
 */
export function mcpNamespace(server: string): string {
	return `mcp__${server.replace(/-/g, "_")}`;
}

/**
 * The tools of a server that the session has.
 *
 * The tools are the evidence of a connection: a server that nobody connected
 * has none.
 *
 * @param api The API of Pi
 * @param server The name of the server
 * @returns The names of the tools of the server
 */
export function serverToolNames(
	api: McpConnectorApi,
	server: string,
): string[] {
	if (typeof api.getAllTools !== "function") return [];
	let tools: Array<{ name?: unknown }>;
	try {
		tools = api.getAllTools();
	} catch {
		return [];
	}
	if (!Array.isArray(tools)) return [];
	const prefix = `${mcpNamespace(server)}__`;
	const names: string[] = [];
	for (const tool of tools) {
		const name = typeof tool?.name === "string" ? tool.name : "";
		if (name.startsWith(prefix) && !names.includes(name)) names.push(name);
	}
	return names;
}

/**
 * The parameter schema of a tool of a server.
 *
 * A tool of an MCP server describes its input with a JSON schema. The schema
 * of a tool has to be an object, and some servers leave the type out.
 */
export function toParameters(
	schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const value = schema ?? {};
	return {
		...value,
		type: typeof value.type === "string" ? value.type : "object",
		...(value.properties === undefined ? { properties: {} } : {}),
	};
}

/**
 * The result of a tool call of a server, in the shape Pi expects.
 *
 * The blocks that are not text become text, so the model always gets
 * something it can read.
 */
export function toToolResult(result: unknown): McpToolResult {
	const value = (result ?? {}) as {
		content?: unknown;
		structuredContent?: unknown;
		isError?: boolean;
	};
	const blocks = Array.isArray(value.content) ? value.content : [];
	const content = blocks.map((block) => {
		const item = (block ?? {}) as { type?: string; text?: unknown };
		if (item.type === "text" && typeof item.text === "string") {
			return { type: "text" as const, text: item.text };
		}
		return { type: "text" as const, text: JSON.stringify(block) };
	});
	if (content.length === 0 && value.structuredContent !== undefined) {
		content.push({ type: "text", text: JSON.stringify(value.structuredContent) });
	}
	return {
		content,
		...(value.isError === true ? { isError: true } : {}),
	};
}

/**
 * The transport of a registered server.
 *
 * A server is a streamable HTTP server or a stdio server. A server with
 * neither cannot be connected, and the connector says so instead of guessing.
 */
export function createTransport(
	library: McpClientLibrary,
	config: McpServerConfigLike,
): McpTransportLike {
	if (typeof config.url === "string" && config.url !== "") {
		return new library.StreamableHttpTransport({
			url: config.url,
			...(config.headers ? { headers: config.headers } : {}),
		});
	}
	if (typeof config.command === "string" && config.command !== "") {
		return new library.StdioTransport({
			command: config.command,
			...(config.args ? { args: config.args } : {}),
			...(config.env ? { env: config.env } : {}),
			...(config.cwd ? { cwd: config.cwd } : {}),
		});
	}
	throw new Error(
		"the server has neither a url nor a command, so it cannot be connected",
	);
}

/**
 * The tool of a server, in the shape Pi expects.
 *
 * The tool calls the server through the connection of the connector, and the
 * result of the server becomes the result of the tool.
 */
export function createToolDefinition(
	server: RegisteredMcpServerLike,
	tool: McpToolLike,
	getClient: () => McpClientLike,
	isTaken: (candidate: string) => boolean = () => false,
): McpToolDefinition {
	const name = mcpToolName(server.name, tool.name, isTaken);
	return {
		name,
		label: `${server.name}/${tool.name}`,
		description:
			tool.description?.trim() ||
			`MCP tool ${tool.name} from server ${server.name}`,
		parameters: toParameters(tool.inputSchema),
		exposure: server.config?.exposure ?? "codemode",
		namespace: { name: mcpNamespace(server.name), aliases: [server.name] },
		async execute(
			_toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
		): Promise<McpToolResult> {
			const client = getClient();
			const result = await client.callTool(tool.name, params ?? {}, {
				...(signal ? { signal } : {}),
				...(server.config?.timeout
					? { timeoutMs: server.config.timeout * 1000 }
					: {}),
			});
			return toToolResult(result);
		},
	};
}

/**
 * The secrets of a configuration, removed from a text.
 *
 * The credential of a server travels in the headers of the request, and a
 * server that quotes its own configuration in an error must not put the
 * credential into the log of the harness.
 *
 * @param text The text that may hold a secret
 * @param config The configuration of the server
 * @returns The text without the secrets
 */
export function redactConfigSecrets(
	text: string,
	config: McpServerConfigLike | undefined,
): string {
	let result = text;
	const values = [
		...Object.values(config?.headers ?? {}),
		...Object.values(config?.env ?? {}),
	];
	for (const value of values) {
		if (typeof value !== "string" || value.length < 8) continue;
		result = result.split(value).join("[REDACTED]");
	}
	return result;
}

/**
 * The connector of the session.
 *
 * The connector connects the servers that no other connector connected, and
 * it closes its own connections when the session ends.
 *
 * @param api The API of Pi
 * @param options The options of the connector
 * @returns The connector
 */
export function createMcpConnector(
	api: McpConnectorApi,
	options: McpConnectorOptions,
): McpConnector {
	const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
	const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const log = options.log ?? ((): void => {});
	const statuses = new Map<string, McpServerStatus>();
	const clients = new Map<string, McpClientLike>();
	/** Whether the session is over. A stopped connector touches nothing. */
	let stopped = false;
	/** The attempts that are running, so a server is connected only once. */
	const inFlight = new Map<string, Promise<McpServerStatus>>();

	/**
	 * Whether the error says that the session the connector works in is
	 * gone.
	 *
	 * The runtime refuses every call through a session that was replaced or
	 * reloaded. The refusal is not a broken server: the connector was talking
	 * to a session that no longer exists, and the truth is that the session
	 * ended before the server was connected.
	 *
	 * @param message The message of the error
	 * @returns Whether the error names a session that is gone
	 */
	function isStaleSessionError(message: string): boolean {
		return message.includes("ctx is stale") || message.includes("session replacement");
	}

	async function connectServer(
		server: RegisteredMcpServerLike,
	): Promise<McpServerStatus> {
		let client: McpClientLike | null = null;
		try {
			if (typeof api.registerTool !== "function") {
				throw new Error(
					"the runtime cannot register tools, so the tools of the server would stay invisible",
				);
			}
			const library = await options.loadLibrary();
			const transport = createTransport(library, server.config ?? {});
			client = new library.McpClient({
				name: "pi-harness-runtime",
				version: "1.0.0",
				requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
			});
			await client.connect(transport);
			const tools = await client.listTools();
			const names: string[] = [];
			const taken = new Set<string>();
			for (const tool of tools ?? []) {
				if (!tool || typeof tool.name !== "string") continue;
				const definition = createToolDefinition(
					server,
					tool,
					() => client as McpClientLike,
					(candidate) => taken.has(candidate),
				);
				taken.add(definition.name);
				api.registerTool?.(definition);
				names.push(definition.name);
			}
			clients.set(server.name, client);
			log(`MCP server "${server.name}" connected by the harness (${names.length} tools)`);
			return { state: "connected", tools: names };
		} catch (error) {
			const reason = redactConfigSecrets(
				error instanceof Error ? error.message : String(error),
				server.config,
			);
			try {
				await client?.close();
			} catch {
				// The connection is already broken: the reason is the error.
			}
			if (stopped || isStaleSessionError(reason)) {
				// The session is over. The server was not refused, and there
				// was no session left to connect it to.
				log(
					`the session ended before the MCP server "${server.name}" was connected`,
				);
				return {
					state: "ended",
					tools: [],
					reason: "the session ended before the connection was made",
				};
			}
			log(`MCP server "${server.name}" could not be connected: ${reason}`);
			return { state: "failed", tools: [], reason };
		}
	}

	/**
	 * Close the connections of the connector.
	 *
	 * Only the connections the connector owns are closed. A connection of
	 * another connector is not in the map and stays untouched.
	 */
	async function closeClients(): Promise<void> {
		for (const [name, client] of clients) {
			try {
				await client.close();
			} catch {
				// A broken connection needs no closing.
			}
			clients.delete(name);
		}
	}

	return {
		statuses,

		async connectPending(): Promise<void> {
			if (stopped) return;
			let servers: RegisteredMcpServerLike[] = [];
			try {
				servers = api.getMcpServers?.() ?? [];
			} catch (error) {
				// The runtime cannot list the servers yet. The connector has
				// nothing to work with, and it says so instead of failing
				// with an error the caller cannot act on.
				log(
					`the registered MCP servers are not readable: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}
			const wanted = servers.filter(
				(server) => server?.name && server.config?.enabled !== false,
			);
			if (wanted.length === 0) return;
			// Another connector may be at work. The wait gives it the time,
			// and its work is visible in the tools of the session.
			await delay(graceMs);
			// The session may have ended during the wait. A connector that
			// works on a session that is gone reports a failure that never
			// happened, so the work stops here.
			if (stopped) return;
			for (const server of wanted) {
				const known = statuses.get(server.name);
				// A server that was connected is done, and a server that
				// another connector connected belongs to it. A server that
				// failed may be tried again.
				if (known && known.state !== "failed") continue;
				const foreign = serverToolNames(api, server.name);
				if (foreign.length > 0) {
					statuses.set(server.name, {
						state: "skipped",
						tools: foreign,
						reason: "another connector connected the server",
					});
					log(
						`MCP server "${server.name}" was connected by another connector (${foreign.length} tools)`,
					);
					continue;
				}
				// Two calls may be at work (the start of the session and a
				// change of the servers). The server is connected once: the
				// second call waits for the attempt of the first one.
				const running = inFlight.get(server.name);
				if (running) {
					statuses.set(server.name, await running);
					continue;
				}
				const attempt = connectServer(server);
				inFlight.set(server.name, attempt);
				try {
					statuses.set(server.name, await attempt);
				} finally {
					inFlight.delete(server.name);
				}
			}
		},

		async close(): Promise<void> {
			await closeClients();
		},

		async stop(): Promise<void> {
			// The session is over. Nothing that is still pending may touch
			// the runtime: the runtime refuses those calls, and the refusal
			// would be read as a broken server.
			stopped = true;
			for (const [name, status] of statuses) {
				if (status.state === "connected" || status.state === "skipped") {
					continue;
				}
				statuses.set(name, {
					state: "ended",
					tools: [],
					reason: "the session ended before the connection was made",
				});
			}
			await closeClients();
		},
	};
}
