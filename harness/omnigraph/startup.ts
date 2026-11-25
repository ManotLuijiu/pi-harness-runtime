/**
 * The startup of the OmniGraph source.
 *
 * The source is optional: a machine without it works exactly as before.
 * Every machine gets a row in the startup summary, next to the other
 * services (Qdrant, Honcho): the row names the endpoint of the graph
 * when the graph is read, and it names the way to configure the graph
 * when it is not - so the user sees both which graph the machine reads
 * from and how the graph is turned on.
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
	type OmnigraphConfig,
	type OmnigraphEnv,
	readOmnigraphConfig,
	readOmnigraphSourceMode,
} from "./config.ts";
import {
	type OmnigraphCatalogReport,
	registerOmnigraphSkills,
} from "./registration.ts";
import {
	GitCheckoutResourceFetcher,
	type OmnigraphResourceFetcher,
} from "./resources.ts";
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
	if (mode === "off") {
		// The graph is not the source of this machine. The row is there
		// anyway: the user has to be able to see that the graph exists
		// and how it is configured, next to the other services (Qdrant,
		// Honcho).
		return staticRow(options, offRow(withToken, options.saasConfigured));
	}

	const config = readOmnigraphConfig(withToken);
	if (!config) {
		// The mode decides what a missing configuration means. When the
		// graph is the source on purpose, the row is a warning: the
		// operator asked for the graph and it cannot be read. When the
		// skill service of the harness is the source, the graph is
		// optional and the row is an information.
		if (mode === "saas") {
			return staticRow(options, {
				text: "not configured; the skill service of the harness is the source",
				status: "info",
				details: [
					"The skill service of the harness holds the skills",
					"The shared skill graph is not configured on this machine",
					"How to configure it: set OMNIGRAPH_URL to the address of the graph and OMNIGRAPH_SKILLS_TOKEN to the credential of the reader",
					"Or write the credential into ~/.pi-harness-runtime/keys/omnigraph-skills-token.txt",
					"The graph does not take the place of the service: set OMNIGRAPH_SOURCE_MODE=omnigraph, with the endpoint and the credential of the reader, to read the graph instead",
				],
			});
		}
		return staticRow(options, {
			text: "on, but the endpoint or the credential is missing",
			status: "warn",
			details: [
				"How to fix: set OMNIGRAPH_URL to the address of the graph and OMNIGRAPH_SKILLS_TOKEN to the credential of the reader",
				"Or write the credential into ~/.pi-harness-runtime/keys/omnigraph-skills-token.txt",
				"Then reload Pi so the graph is read",
			],
		});
	}

	if (mode === "saas") {
		// The skill service of the harness keeps the place. The graph is
		// configured next to it, and it does not take the place of the
		// service silently: the row says which source is the one.
		return staticRow(options, {
			text: "configured; the skill service of the harness is the source",
			status: "info",
			details: [
				`The graph is configured at ${config.url}`,
				"The source of the skills is the skill service of the harness",
				`How to change it: set OMNIGRAPH_SOURCE_MODE=omnigraph so the graph "${config.graph}" becomes the source`,
			],
		});
	}

	// The approval of the operator is resolved once, here: the option of
	// the caller wins over the environment, and the value that is found
	// is given to every path of the source. A configured approval that
	// is not passed on would only change the name of the cache, and the
	// skills of another revision would still load.
	const approvedRevision =
		options.approvedRevision?.trim() || config.approvedRevision;

	const sourceOptions: {
		config: OmnigraphConfig;
		approvedRevision?: string;
		fetchImpl?: typeof fetch;
	} = { config };
	if (approvedRevision) {
		sourceOptions.approvedRevision = approvedRevision;
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
	if (approvedRevision) {
		registrationOptions.approvedRevision = approvedRevision;
	}
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
 * A row that does not change.
 *
 * The row is placed next to the anchor of the services (Qdrant), and it
 * is placed there again when the anchor appears: a row that was written
 * before the row of Qdrant existed would otherwise stay at the end of
 * the summary, away from the services it belongs to.
 */
function staticRow(
	options: OmnigraphStartupOptions,
	row: { text: string; status: HarnessStatus; details?: string[] },
): OmnigraphStartup {
	const placeRow = (anchor = "Qdrant"): void => {
		options.insert(anchor, "Omnigraph", row.text, row.status, row.details);
	};
	placeRow();
	return {
		placeRow,
		ready: Promise.resolve({ state: "unknown", count: 0 }),
	};
}

/**
 * The row of a machine that does not read the graph.
 *
 * The row is an information, not a warning: the graph is optional, and a
 * machine without it works exactly as before. The row says what the
 * graph is and how it is configured, because the user who wants it must
 * not have to read the source of the harness to find out.
 */
function offRow(
	env: OmnigraphEnv,
	saasConfigured: boolean,
): { text: string; status: HarnessStatus; details: string[] } {
	const explicit = env.OMNIGRAPH_SOURCE_MODE?.trim().toLowerCase();
	const url = env.OMNIGRAPH_URL?.trim();
	const token = env.OMNIGRAPH_SKILLS_TOKEN?.trim();
	if (explicit === "off") {
		// The user turned the source off on purpose. The row says so, and
		// it names the way back - without asking for a value that is
		// already set.
		return {
			text: "disabled; the shared skill graph is not read",
			status: "info",
			details: [
				"The OmniGraph source is turned off in the configuration",
				url
					? `The endpoint of the graph is set at ${url}`
					: "How to configure it: set OMNIGRAPH_URL to the address of the graph",
				token
					? "The credential of the reader is set"
					: "How to configure it: set OMNIGRAPH_SKILLS_TOKEN to the credential of the reader",
				"How to turn it on again: remove OMNIGRAPH_SOURCE_MODE=off",
				"Then reload Pi so the graph is read",
			],
		};
	}
	const details = [
		"The OmniGraph is a shared graph of skills that every machine of the team can read.",
		"The graph is not configured on this machine, so it is not read and its tools are not registered.",
	];
	// The row names the part that is missing: a machine that has the
	// endpoint must not be told to set it again.
	if (url) {
		details.push(`The endpoint of the graph is set at ${url}`);
	} else {
		details.push(
			"How to configure it: set OMNIGRAPH_URL to the address of the graph",
		);
	}
	if (!token) {
		details.push(
			"How to configure it: set OMNIGRAPH_SKILLS_TOKEN to the credential of the reader",
			"Or write the credential into ~/.pi-harness-runtime/keys/omnigraph-skills-token.txt",
		);
	}
	if (saasConfigured) {
		details.push("The skill service of the harness holds the skills meanwhile");
		details.push(
			url && token
				? "How to make the graph the source: set OMNIGRAPH_SOURCE_MODE=omnigraph"
				: "How to make the graph the source: set OMNIGRAPH_SOURCE_MODE=omnigraph, with the endpoint and the credential of the reader",
		);
	}
	details.push("Then reload Pi so the graph is read");
	// The usage of the graph belongs to the row of a machine that reads
	// it: on this machine the tools of the graph are not registered, so
	// the row must not promise them.
	details.push(
		"When the graph is read: a skill of it is found with the command /skill:<name>, read with the tool remote_skill_load, and listed with the command /remote-skills",
	);
	return {
		text: "not configured; the shared skill graph is optional",
		status: "info",
		details,
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
			details: [`The graph "${config.graph}" holds no skill`],
		};
	}
	return {
		text: `ready (${config.url})`,
		status: "ok",
		details: [
			`The graph "${config.graph}" holds ${report.count} skill(s)`,
			"A skill of the graph is found with the command /skill:<name>",
			"A skill of the graph is read with the tool remote_skill_load",
			"The skills of the graph are listed with the command /remote-skills",
		],
	};
}
