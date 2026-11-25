/**
 * The configuration of the OmniGraph source of skills.
 *
 * The endpoint and the credential are operator-local: the endpoint comes
 * from the environment (or from a key file), the credential from the
 * secret store of the machine. Nothing of it is written into the
 * repository, and a message that leaves the process never carries the
 * credential.
 *
 * The address of the deployment is NOT a constant of this file. The
 * endpoint is configuration, because a hard-coded address would travel
 * with every published copy of the package.
 */

/** The version of the HTTP contract of the server. */
export const OMNIGRAPH_HTTP_API_VERSION = "0.14";

/** The graph that holds the skills. */
export const OMNIGRAPH_DEFAULT_GRAPH = "skills";

/** The stored query that lists the catalog. */
export const OMNIGRAPH_CATALOG_QUERY = "skill_catalog";

/** The stored query that reads one skill. */
export const OMNIGRAPH_LOOKUP_QUERY = "skill_by_id";

/** Which source holds the server-held skills. */
export type OmnigraphSourceMode =
	/** The OmniGraph graph holds the skills. */
	| "omnigraph"
	/** The skill service of the harness holds the skills. */
	| "saas"
	/** No remote source holds the skills. */
	| "off";

/** The configuration of the OmniGraph source. */
export interface OmnigraphConfig {
	/** The base address of the server, without a trailing slash. */
	url: string;
	/** The graph that holds the skills. */
	graph: string;
	/** The bearer credential of the reader. */
	token: string;
	/** The version of the HTTP contract of the server. */
	apiVersion: string;
	/** How long a read may take, in milliseconds. */
	timeoutMs: number;
	/** How long the catalog read of the startup may take, in milliseconds. */
	catalogTimeoutMs: number;
	/** The directory of the local cache. */
	cacheDir: string;
	/** The total size the cache may reach, in bytes. */
	cacheBudgetBytes: number;
	/** How many catalog stubs are advertised, at most. */
	maxAdvertisedSkills: number;
}

/** The environment the configuration is read from. */
export type OmnigraphEnv = Record<string, string | undefined>;

/**
 * The default directory of the cache.
 *
 * The cache belongs to the installation of the harness, so it lives
 * beside the other local state. The path is never the path of the
 * machine that built the package.
 */
export function defaultOmnigraphCacheDir(
	home: string = process.env.HOME ?? "/tmp",
): string {
	return `${home}/.pi-harness-runtime/omnigraph`;
}

/**
 * A URL without a trailing slash.
 *
 * A trailing slash would produce a path with two slashes, and the server
 * answers that with a 404 that looks like a missing route.
 */
export function normalizeOmnigraphUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

/**
 * Read the configuration of the source.
 *
 * The configuration is only complete when the endpoint AND the credential
 * are there: a client without a credential cannot read the graph, and a
 * client without an endpoint has nowhere to read from.
 *
 * @param env The environment of the process.
 * @param options The overrides of the caller (a test, a different cache).
 */
export function readOmnigraphConfig(
	env: OmnigraphEnv = process.env,
	options: {
		cacheDir?: string;
		timeoutMs?: number;
		catalogTimeoutMs?: number;
		cacheBudgetBytes?: number;
		maxAdvertisedSkills?: number;
	} = {},
): OmnigraphConfig | undefined {
	const url = env.OMNIGRAPH_URL?.trim();
	const token = env.OMNIGRAPH_SKILLS_TOKEN?.trim();
	if (!url || !token) return undefined;
	const home = env.HOME ?? "/tmp";
	return {
		url: normalizeOmnigraphUrl(url),
		graph: env.OMNIGRAPH_GRAPH?.trim() || OMNIGRAPH_DEFAULT_GRAPH,
		token,
		apiVersion: OMNIGRAPH_HTTP_API_VERSION,
		timeoutMs: options.timeoutMs ?? numberOf(env.OMNIGRAPH_TIMEOUT_MS, 15_000),
		catalogTimeoutMs:
			options.catalogTimeoutMs ??
			numberOf(env.OMNIGRAPH_CATALOG_TIMEOUT_MS, 5_000),
		cacheDir:
			options.cacheDir ??
			env.OMNIGRAPH_CACHE_DIR?.trim() ??
			defaultOmnigraphCacheDir(home),
		cacheBudgetBytes:
			options.cacheBudgetBytes ??
			numberOf(env.OMNIGRAPH_CACHE_BUDGET_BYTES, 64 * 1024 * 1024),
		maxAdvertisedSkills:
			options.maxAdvertisedSkills ??
			numberOf(env.OMNIGRAPH_MAX_ADVERTISED_SKILLS, 500),
	};
}

/**
 * The mode of the source.
 *
 * The mode is a decision, so it is written down instead of guessed. An
 * explicit mode wins. Without one, the skill service of the harness keeps
 * the priority: it is the source that the machine already uses, and a
 * graph that is configured next to it does not silently take the place
 * of the service.
 */
export function readOmnigraphSourceMode(
	env: OmnigraphEnv = process.env,
	options: { saasConfigured?: boolean } = {},
): OmnigraphSourceMode {
	const explicit = env.OMNIGRAPH_SOURCE_MODE?.trim().toLowerCase();
	if (explicit === "omnigraph" || explicit === "saas" || explicit === "off") {
		return explicit;
	}
	const omnigraphConfigured = Boolean(
		env.OMNIGRAPH_URL?.trim() && env.OMNIGRAPH_SKILLS_TOKEN?.trim(),
	);
	if (!omnigraphConfigured) return "off";
	if (options.saasConfigured) return "saas";
	return "omnigraph";
}

/**
 * A number of the environment, or the default.
 *
 * A value that is not a number is ignored: a typo in the configuration
 * must not turn into a timeout of zero.
 */
function numberOf(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

/**
 * A message that never carries the credential.
 *
 * The credential is removed from every message that leaves the process,
 * even when the server echoed it back.
 */
export function redactOmnigraphSecret(message: string, token?: string): string {
	let safe = message.replace(/bearer\s+\S+/gi, "bearer <redacted>");
	if (token && token.length >= 8) {
		safe = safe.split(token).join("<redacted>");
	}
	safe = safe.replace(/\s+/g, " ").trim();
	return safe.slice(0, 200);
}
