#!/usr/bin/env node
/**
 * The entry point of the reverse bridge.
 *
 * The worker of another vendor starts this program as its MCP server. The
 * program reads the state of the user from the files of the plan handoff
 * and speaks MCP over stdio.
 *
 * The workspace of the sender is told to the program: the worker runs in
 * a copy of the workspace, and the copy is not the workspace of the user.
 */

import { hostname } from "node:os";

import { runBridgeServer } from "./server.js";
import type { BridgeOptions } from "./bridge.js";

/**
 * The options of the bridge, read from the environment.
 */
export function bridgeOptionsFromEnv(
	env: Record<string, string | undefined> = process.env,
): BridgeOptions {
	const workspace = env.PI_AGENT_BRIDGE_WORKSPACE ?? process.cwd();
	const options: BridgeOptions = {
		workspace,
		host: env.PI_AGENT_BRIDGE_HOST ?? hostname(),
		sender: {
			agentId: env.PI_AGENT_BRIDGE_AGENT_ID ?? "external-worker",
			sessionId: env.PI_AGENT_BRIDGE_SESSION_ID ?? "external-worker",
			label: env.PI_AGENT_BRIDGE_LABEL,
		},
	};
	if (env.PI_AGENT_BRIDGE_REGISTRY_DIR) {
		options.registryDir = env.PI_AGENT_BRIDGE_REGISTRY_DIR;
	}
	if (env.PI_AGENT_BRIDGE_MAILBOX_DIR) {
		options.mailboxDir = env.PI_AGENT_BRIDGE_MAILBOX_DIR;
	}
	if (env.PI_AGENT_BRIDGE_REPLY_DIR) {
		options.replyDir = env.PI_AGENT_BRIDGE_REPLY_DIR;
	}
	return options;
}

runBridgeServer(bridgeOptionsFromEnv());
