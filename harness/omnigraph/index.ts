/**
 * The OmniGraph source of skills.
 *
 * The modules of this directory are small and each of them has one
 * boundary:
 *
 * - `config` reads the endpoint, the graph and the credential of the
 *   machine, and decides which source holds the skills,
 * - `transport` reads one stored query of a graph over HTTPS,
 * - `source` turns the answers of the graph into skills, and checks the
 *   hash of the instructions,
 * - `cache` holds the catalog, the stubs and the hydrated skills on this
 *   machine,
 * - `resources` reads the manifest of the supporting files of a skill,
 * - `registration` wires all of it into pi.
 */

export {
	defaultOmnigraphCacheDir,
	normalizeOmnigraphUrl,
	OMNIGRAPH_CATALOG_QUERY,
	OMNIGRAPH_DEFAULT_GRAPH,
	OMNIGRAPH_HTTP_API_VERSION,
	OMNIGRAPH_LOOKUP_QUERY,
	readOmnigraphConfig,
	readOmnigraphSourceMode,
	redactOmnigraphSecret,
	type OmnigraphConfig,
	type OmnigraphEnv,
	type OmnigraphSourceMode,
} from "./config.ts";

export {
	columnText,
	columnValue,
	OmnigraphError,
	omnigraphQuery,
	omnigraphQueryUrl,
	parseQueryResult,
	type OmnigraphFailure,
	type OmnigraphQueryResult,
	type OmnigraphRequestOptions,
	type OmnigraphRow,
	type OmnigraphValue,
} from "./transport.ts";

export {
	catalogEntryOf,
	OmnigraphSkillSource,
	omnigraphInstructionsHash,
	skillRecordOf,
	type OmnigraphCatalogEntry,
	type OmnigraphSkillRecord,
} from "./source.ts";

export {
	cacheUsage,
	CachePathError,
	clearCache,
	containedPath,
	readCachedSkill,
	readCatalog,
	safeSegment,
	sha256Of,
	skillRoot,
	skillVersionDir,
	stubRoot,
	stubSkillMarkdown,
	writeCachedResource,
	writeCachedSkill,
	writeCatalog,
	writeFileAtomic,
	writeStub,
	writeStubs,
	type CachedCatalogEntry,
} from "./cache.ts";

export {
	GitCheckoutResourceFetcher,
	OmnigraphResourceError,
	parseResourceManifest,
	type OmnigraphResource,
	type OmnigraphResourceFetcher,
	type OmnigraphResourceManifest,
	type OmnigraphResourceState,
} from "./resources.ts";

export {
	cachedSkillOf,
	omnigraphStatus,
	registerOmnigraphSkills,
	type OmnigraphRegistrationOptions,
	type OmnigraphStatus,
} from "./registration.ts";
