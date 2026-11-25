/**
 * The startup of the OmniGraph source.
 *
 * The source is optional: a machine without it works exactly as before.
 * A machine with it gets a row in the startup summary, next to the other
 * services (Qdrant, Honcho), and the row names the endpoint of the
 * graph - so the user can see which graph the machine reads from.
 *
 * The row never claims more than it knows: it says "ready" only after the
 * graph answered, and it never prints the credential.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { HarnessStatus } from "../../harness-startup-status.ts";
import {
	readOmnigraphConfig,
	readOmnigraphSourceMode,
	type OmnigraphConfig,
	type OmnigraphEnv,
} from "./config.ts";
import type { OmnigraphResourceFetcher } from "./resources.ts";
import { GitCheckoutResourceFetcher } from "./resources.ts";
import { registerOmnigraphSkills } from "./registration.ts";
import { OmnigraphSkillSource } from "./source.ts";

/** The options of the startup of the source. */
export interface OmnigraphStartupOptions {
	/**
	 * Put the row of the source next to another row.
	 *
	 * The anchor is a row that exists ("Qdrant", "Honcho"). A row that
	 * does not exist yet is not waited for: the row of the source goes to
	 * the end of the summary.
	 */
	insert: (
		anchor: string,
		label: string,
		text: string,
		status: HarnessStatus,
		details?: string[],
	) => void;
	/** The logger of the harness. */
	log: (message: string) => void;
	/** Whether the skill service of the harness is configured. */
	saasConfigured: boolean;
	/** The environment of the process. */
	env?: OmnigraphEnv;
	/** The mechanism that reads the supporting files of a skill. */
	fetcher?: OmnigraphResourceFetcher;
	/** The revision of the publication that is approved. */
	approvedRevision?: string;
	/** The function that performs the request. A test injects one. */
	fetchImpl?: typeof fetch;
}

/**
 * The credential of the reader.
 *
 * The environment wins over the key file: the environment is the explicit
 * override of a session. The key file is the per-user default, beside the
 * other credentials of the machine.
 */
export function loadOmnigraphToken(
	env: OmnigraphEnv = process.env,
): string | undefined {
	const fromEnv = env.OMNIGRAPH_SKILLS_TOKEN?.trim();
	if (fromEnv) return fromEnv;
	const home = env.HOME ?? process.env.HOME;
	if (!home) return undefined;
	const file = join(home, ".pi-harness-runtime", "keys", "omnigraph-skills-token.txt");
	if (!existsSync(file)) return undefined;
	try {
		return readFileSync(file, "utf8").trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Start the source of the graph and report it in the startup summary.
 */
export async function initOmnigraphSkills(
	pi: ExtensionAPI,
	options: OmnigraphStartupOptions,
): Promise<void> {
	const env = options.env ?? process.env;
	const token = loadOmnigraphToken(env);
	const withToken: OmnigraphEnv = { ...env };
	if (token) withToken.OMNIGRAPH_SKILLS_TOKEN = token;

	const mode = readOmnigraphSourceMode(withToken, {
		saasConfigured: options.saasConfigured,
	});
	if (mode === "off") return;

	const config = readOmnigraphConfig(withToken);
	if (!config) {
		options.insert(
			"Qdrant",
			"Omnigraph",
			"the source is on, but the endpoint or the credential is missing",
			"warn",
			[
				"How to fix: set OMNIGRAPH_URL (the address of the graph) and OMNIGRAPH_SKILLS_TOKEN (the credential of the reader), or write the credential into ~/.pi-harness-runtime/keys/omnigraph-skills-token.txt.",
			],
		);
		return;
	}

	if (mode === "saas") {
		// The skill service of the harness keeps the place. The graph is
		// configured next to it, and it does not take the place of the
		// service silently: the row says which source is the one.
		options.insert(
			"Qdrant",
			"Omnigraph",
			`configured (${config.url}), the skill service of the harness is the source`,
			"info",
			[
				"The source of the skills is the skill service of the harness.",
				`How to change it: set OMNIGRAPH_SOURCE_MODE=omnigraph (the graph "${config.graph}" at ${config.url} becomes the source).`,
			],
		);
		return;
	}

	const sourceOptions: {
		config: OmnigraphConfig;
		approvedRevision?: string;
		fetchImpl?: typeof fetch;
	} = { config };
	if (options.approvedRevision) {
		sourceOptions.approvedRevision = options.approvedRevision;
	}
	if (options.fetchImpl) sourceOptions.fetchImpl = options.fetchImpl;
	const source = new OmnigraphSkillSource(sourceOptions);

	const registrationOptions: Parameters<typeof registerOmnigraphSkills>[1] = {
		config,
		source,
		log: options.log,
		onCatalog: (state) => {
			if (state.error) {
				options.insert(
					"Qdrant",
					"Omnigraph",
					`not ready (${config.url})`,
					"warn",
					[
						`The graph "${config.graph}" could not be read: ${state.error}`,
						"How to fix: check that the endpoint is reachable and that the credential of the reader is valid.",
					],
				);
				return;
			}
			options.insert(
				"Qdrant",
				"Omnigraph",
				`ready (${config.url})`,
				"ok",
				[
					`The graph "${config.graph}" holds ${state.count} skill(s).`,
					"The skills of the graph are found with /skill:<name>, read with the tool remote_skill_load, and listed with /remote-skills.",
				],
			);
		},
	};
	if (options.fetcher) registrationOptions.fetcher = options.fetcher;
	else {
		// The checkout of the operator is the approved way to read the
		// files of a skill. Without it, the instructions of a skill are
		// readable and its files are not - and the tool says so.
		const checkout = env.OMNIGRAPH_SKILL_REPO_PATH?.trim();
		if (checkout && existsSync(checkout)) {
			registrationOptions.fetcher = new GitCheckoutResourceFetcher(checkout);
		}
	}
	registerOmnigraphSkills(pi, registrationOptions);
}

/**
 * The row of the source, as a test reads it.
 */
export function omnigraphStartupRow(
	config: OmnigraphConfig,
	count: number,
): { text: string; status: HarnessStatus; details: string[] } {
	return {
		text: `ready (${config.url})`,
		status: "ok",
		details: [`The graph "${config.graph}" holds ${count} skill(s).`],
	};
}
