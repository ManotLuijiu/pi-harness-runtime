/**
 * The registration of the consultations.
 *
 * The harness may consult a worker of another vendor. The registration
 * builds the runtime of the consultations, keeps the identity of the
 * session and gives the tools of the agent.
 *
 * The registration is off by default. A user who wants the consultation
 * switches it on with `PI_AGENT_COMMUNICATION=1`: the tools reach a CLI of
 * the machine and the answer of that CLI comes back into the session, and
 * a session that does not ask for that does not get it.
 */

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentCommunicationRuntime } from "./runtime.ts";
import type { ConsultJobEvent } from "./runtime.ts";
import { JobStore } from "./store.ts";
import type { AgentCommunicationToolOptions } from "./tools.ts";
import type { ConsultSender } from "./types.ts";

/**
 * The switch of the consultation.
 */
export const AGENT_COMMUNICATION_ENV = "PI_AGENT_COMMUNICATION";

/**
 * The options of the registration.
 */
export interface AgentCommunicationRegistrationOptions {
	/** The canonical absolute path of the workspace of the session. */
	workspace: () => string;
	/** The id of the session, when the session has one. */
	sessionId: () => string | undefined;
	/** The log of the harness. */
	log?: (message: string) => void;
	/** The root of the store of the jobs. */
	root?: string;
	/** The runtime, for the tests. */
	runtime?: AgentCommunicationRuntime;
	/**
	 * The owner of the row of a job.
	 *
	 * The owner shows the row while the worker answers and removes it when
	 * the job is over. A row that outlives its job is a lie.
	 */
	onJobStart?: (job: ConsultJobEvent) => void;
	onJobEnd?: (job: ConsultJobEvent) => void;
}

/**
 * The registration of the consultations.
 */
export interface AgentCommunicationRegistration {
	/** The runtime of the consultations. */
	runtime: AgentCommunicationRuntime;
	/** The options of the tools of the agent. */
	tools: AgentCommunicationToolOptions;
	/**
	 * Who the session is.
	 *
	 * The write lane asks the worker with the same sender as the tools.
	 */
	sender: () => ConsultSender;
	/** Stop every worker of the session. */
	stop: () => Promise<void>;
}

/**
 * Is the consultation switched on?
 */
export function agentCommunicationEnabled(
	env: Record<string, string | undefined> = process.env,
): boolean {
	const value = env[AGENT_COMMUNICATION_ENV];
	return value === "1" || value === "true";
}

/**
 * The canonical path of a workspace.
 *
 * The path of the session is canonical, so the worker of another vendor
 * looks at the same directory as the harness and not at a link to it.
 */
export function canonicalWorkspace(path: string): string {
	const value = (path ?? "").trim();
	if (value.length === 0) return process.cwd();
	try {
		return realpathSync(value);
	} catch {
		return value;
	}
}

/**
 * Register the consultations of the session.
 *
 * The registration is nothing when the consultation is switched off: no
 * runtime, no tools, no worker.
 */
export function registerAgentCommunication(
	options: AgentCommunicationRegistrationOptions,
): AgentCommunicationRegistration | undefined {
	if (!agentCommunicationEnabled()) return undefined;
	const root = options.root ?? join(homedir(), ".pi-harness-runtime");
	const agentId = randomUUID();
	const runtime =
		options.runtime ??
		new AgentCommunicationRuntime({
			store: new JobStore(root),
			log: options.log,
			onJobStart: options.onJobStart,
			onJobEnd: options.onJobEnd,
		});
	const sender = (): ConsultSender => ({
		agentId,
		sessionId: options.sessionId() ?? "unknown-session",
		generation: 1,
	});
	const tools: AgentCommunicationToolOptions = {
		runtime,
		sender,
		workspace: () => canonicalWorkspace(options.workspace()),
	};
	return {
		runtime,
		tools,
		sender,
		stop: async () => {
			await runtime.stop();
		},
	};
}
