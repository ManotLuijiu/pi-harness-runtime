/**
 * The startup of the OmniGraph source.
 *
 * The source is optional: a machine without it works exactly as before.
 * A machine with it gets a row in the startup summary, next to the other
 * services (Qdrant, Honcho), and the row names the endpoint of the
 * graph - so the user can see which graph the machine reads from.
 *
 * The registration is synchronous and does not wait for the network: the
 * discovery of the skills of the graph must not depend on the state of
 * another service. The row is placed later, next to the row of Qdrant,
 * so the two stay together in the panel.
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
import {
	GitCheckoutResourceFetcher,
	type OmnigraphResourceFetcher,
} from "./resources.ts";
import {
	registerOmnigraphSkills,
	type OmnigraphCatalogReport,
} from "./registration.ts";
import { OmnigraphSkillSource } from "./source.ts";

/** The options of the startup of the source. */
export interface OmnigraphStartupOptions {
	/**
	 * Put the row of the source next to another row.
	 *
	 * The anchor is a row that exists ("Qdrant", "Honcho"). A row that
	 * does not exist yet is not waited for: the row of the source goes to
	 * the end of the summary, and it is moved next to the anchor as soon
	 * as the anchor is there.
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
 * The startup of the source.
 *
 * The handle is what the caller keeps: it places the row of the graph
 * next to the row of another service, and it holds the first read of
 * the catalog.
 */
export interface OmnigraphStartup {
	/** Put (or move) the row of the graph next to the row of a service. */
	placeRow: (anchor?: string) => void;
	/** The first read of the catalog of the graph. */
	ready: Promise<OmnigraphCatalogReport>;
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
	const file = join(
		home,
		".pi-harness-runtime",
		"keys",
		"omnigraph-skills-token.txt",
	);
	if (!existsSync(file)) return undefined;
	try {
		return readFileSync(file, "utf8").trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Start the source of the graph and report it in the startup summary.
 *
 * The function does not wait for the network: the tools and the discovery
 * of the graph are registered before it returns.
 */
export function initOmnigraphSkills(
	pi: ExtensionAPI,
	options: OmnigraphStartupOptions,
): OmnigraphStartup {
	const env = options.env ?? process.env;
	const token = loadOmnigraphToken(env);
	const withToken: OmnigraphEnv = { ...env };
	if (token) withToken.OMNIGRAPH_SKILLS_TOKEN = token;

	const mode = readOmnigraphSourceMode(withToken, {
		saasConfigured: options.saasConfigured,
	});
	if (mode === "off") return inactive();

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
		return inactive();
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
		return inactive();
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

	/** The last known state of the source. */
	let report: OmnigraphCatalogReport | undefined;

	/**
	 * The row of the graph.
	 *
	 * The row is placed next to the row of Qdrant, and it is moved there
	 * again when the state of the source changes.
	 */
	const placeRow = (anchor = "Qdrant"): void => {
		const row = rowOf(report, config);
		options.insert(anchor, "Omnigraph", row.text, row.status, row.details);
	};

	const registrationOptions: Parameters<typeof registerOmnigraphSkills>[1] = {
		config,
		source,
		log: options.log,
		onCatalog: (state) => {
			report = state;
			placeRow();
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
	const registration = registerOmnigraphSkills(pi, registrationOptions);

	return { placeRow, ready: registration.ready };
}

/**
 * The row of a source that is not there.
 */
function inactive(): OmnigraphStartup {
	return {
		placeRow: () => {},
		ready: Promise.resolve({ state: "unknown", count: 0 }),
	};
}

/**
 * The row of the source, in the state it is in.
 */
export function rowOf(
	report: OmnigraphCatalogReport | undefined,
	config: OmnigraphConfig,
): { text: string; status: HarnessStatus; details: string[] } {
	if (!report || report.state === "unknown") {
		return {
			text: `connecting (${config.url})`,
			status: "wait",
			details: [`The graph "${config.graph}" is read for the first time.`],
		};
	}
	if (report.state === "denied") {
		return {
			text: `not ready (${config.url})`,
			status: "warn",
			details: [
				`The graph "${config.graph}" refused the read: ${report.error ?? "the credential was refused"}.`,
				"How to fix: check that the credential of the reader is valid for this graph.",
			],
		};
	}
	if (report.state === "unavailable") {
		return {
			text: `not ready (${config.url})`,
			status: "warn",
			details: [
				`The graph "${config.graph}" could not be reached: ${report.error ?? "unknown reason"}.`,
				report.count
					? `The catalog of the last verified read is used (${report.count} skill(s)).`
					: "There is no verified catalog on this machine yet.",
				"How to fix: check that the endpoint is reachable, then reload Pi.",
			],
		};
	}
	if (report.state === "empty") {
		return {
			text: `ready (${config.url})`,
			status: "ok",
			details: [`The graph "${config.graph}" holds no skill.`],
		};
	}
	return {
		text: `ready (${config.url})`,
		status: "ok",
		details: [
			`The graph "${config.graph}" holds ${report.count} skill(s).`,
			"The skills of the graph are found with /skill:<name>, read with the tool remote_skill_load, and listed with /remote-skills.",
		],
	};
}
