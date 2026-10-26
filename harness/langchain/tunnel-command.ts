/**
 * The tunnel command of the daemon.
 *
 * "auto" is a request to find the tunnel script, not a command to run: the
 * literal word "auto" would be handed to bash, which is not a tunnel. The
 * search looks in the project the daemon runs for and in the package root.
 * A project without a tunnel script gets no tunnel monitor - the daemon
 * says so instead of failing later.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The name of the tunnel script the daemon looks for. */
export const TUNNEL_SCRIPT_NAME = "tailscale-tunnel.sh";

/**
 * The root of this package, three levels above `harness/langchain/`.
 */
const PACKAGE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Resolve the tunnel command to a script that exists.
 *
 * An explicit command is returned unchanged - the operator asked for it.
 * "auto" is resolved to the tunnel script of the project or of the package,
 * and to nothing when neither has one.
 */
export function resolveTunnelCommand(
	command: string,
	cwd: string = process.cwd(),
): string | undefined {
	if (command !== "auto") return command;
	const candidates = [
		join(cwd, "scripts", TUNNEL_SCRIPT_NAME),
		join(PACKAGE_ROOT, "scripts", TUNNEL_SCRIPT_NAME),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}
