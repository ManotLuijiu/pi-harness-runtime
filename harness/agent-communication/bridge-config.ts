/**
 * The configuration of the reverse bridge for a worker.
 *
 * The bridge is a MCP server that a worker of another vendor starts: it
 * may then address a live Pi session. The bridge is not a part of every
 * consultation: the human asks for it by name, with
 * `PI_AGENT_COMMUNICATION_BRIDGE=1`.
 *
 * The worker runs in a copy of the workspace, so the copy is not the
 * workspace of the user. The bridge is told the workspace of the user, so
 * the routing of a message looks for the sessions of the right project.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The configuration of the bridge for one worker.
 */
export interface BridgeConfig {
	/** The program that starts the server. */
	command: string;
	/** The arguments of the program. */
	args: string[];
	/** The environment of the server. */
	env: Record<string, string>;
}

/**
 * Has the human asked for the bridge?
 */
export function bridgeRequested(
	env: Record<string, string | undefined> = process.env,
): boolean {
	const raw = env.PI_AGENT_COMMUNICATION_BRIDGE ?? "";
	return raw.trim() === "1" || raw.trim().toLowerCase() === "true";
}

/**
 * The path of the server of the bridge.
 *
 * The server is the compiled program of the package: a worker starts it
 * with node, and the program speaks MCP over stdio.
 */
export function bridgeServerPath(): string {
	const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
	return join(root, "packages", "agent-bridge", "dist", "cli.js");
}

/**
 * The configuration of the bridge for a worker of a workspace.
 */
export function bridgeConfig(
	workspace: string,
	options: {
		command?: string;
		serverPath?: string;
		env?: Record<string, string | undefined>;
	} = {},
): BridgeConfig {
	const env: Record<string, string> = {
		PI_AGENT_BRIDGE_WORKSPACE: workspace,
	};
	for (const [name, value] of Object.entries(options.env ?? {})) {
		if (typeof value === "string") env[name] = value;
	}
	return {
		command: options.command ?? process.execPath,
		args: [options.serverPath ?? bridgeServerPath()],
		env,
	};
}

/**
 * The arguments of Codex that add the bridge.
 *
 * The MCP servers of the worker are switched off by the other arguments,
 * and the bridge is the one server that is switched on.
 */
export function codexBridgeArgs(config: BridgeConfig): string[] {
	const args = ["-c", "mcp_servers.pi_bridge"];
	args.push(
		"-c",
		`mcp_servers.pi_bridge.command=${JSON.stringify(config.command)}`,
	);
	args.push(
		"-c",
		`mcp_servers.pi_bridge.args=${JSON.stringify(config.args)}`,
	);
	args.push(
		"-c",
		`mcp_servers.pi_bridge.env=${JSON.stringify(config.env)}`,
	);
	return args;
}

/**
 * The arguments of Claude Code that add the bridge.
 *
 * Claude Code reads its MCP servers from a JSON configuration, and the
 * bridge is the only one that is there.
 */
export function claudeBridgeArgs(config: BridgeConfig): string[] {
	const servers = {
		pi_bridge: {
			command: config.command,
			args: config.args,
			env: config.env,
		},
	};
	return ["--mcp-config", JSON.stringify({ mcpServers: servers })];
}
