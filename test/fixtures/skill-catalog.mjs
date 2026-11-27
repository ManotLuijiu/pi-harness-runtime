/**
 * The pilot catalog of the retrieval.
 *
 * The catalog is deterministic and representative: it holds the shapes a real
 * catalog holds - a synonym, a near duplicate, the same name in two
 * namespaces, a changed revision, a revoked skill, a skill without a
 * description, a skill with an invalid hash and a skill that the catalog does
 * not hold any more.
 *
 * The queries carry the skills that are relevant and the skills that must not
 * be selected.
 */

const HASH = (seed) => {
	let hash = 0;
	for (const character of seed) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0").repeat(8);
};

const REV_A = "pub-2026-11-01";
const REV_B = "pub-2026-11-20";

/** The catalog of the pilot: 30 entries with the shapes of a real catalog. */
export const PILOT_CATALOG = [
	{ id: "sk-deploy", name: "deploy", description: "ship a release to production", revision: REV_B, sha256: HASH("sk-deploy") },
	{ id: "sk-release", name: "release", description: "prepare and publish a release of the package", revision: REV_B, sha256: HASH("sk-release") },
	{ id: "sk-ship", name: "ship", description: "send the change to the users", revision: REV_A, sha256: HASH("sk-ship") },
	{ id: "sk-deploy-runbook", name: "deploy runbook", description: "the steps of a deployment, the rollback and the checks", revision: REV_B, sha256: HASH("sk-deploy-runbook") },
	{ id: "sk-release-notes", name: "release notes", description: "write the notes of a release for the users", revision: REV_B, sha256: HASH("sk-release-notes") },
	{ id: "sk-migration", name: "migration", description: "move the data of a schema to another one", revision: REV_A, sha256: HASH("sk-migration") },
	{ id: "sk-backup", name: "backup", description: "copy the data of a site before a risky change", revision: REV_A, sha256: HASH("sk-backup") },
	{ id: "sk-restore", name: "restore", description: "bring the data of a site back from a backup", revision: REV_A, sha256: HASH("sk-backup") },
	{ id: "sk-review", name: "review", description: "read a diff and judge its correctness", revision: REV_B, sha256: HASH("sk-review") },
	{ id: "sk-review-graph", name: "review graph", description: "review the relationships of a knowledge graph", revision: REV_B, sha256: HASH("sk-review-graph") },
	{ id: "sk-test", name: "test", description: "run the tests of a project and read the failures", revision: REV_B, sha256: HASH("sk-test") },
	{ id: "sk-test-e2e", name: "end to end test", description: "drive the whole product like a user does", revision: REV_A, sha256: HASH("sk-test-e2e") },
	{ id: "sk-debug", name: "debug", description: "find the cause of a failure and fix it", revision: REV_B, sha256: HASH("sk-debug") },
	{ id: "sk-profile", name: "profile", description: "measure where the time of a run goes", revision: REV_A, sha256: HASH("sk-profile") },
	{ id: "sk-refactor", name: "refactor", description: "change the shape of the code without changing its behaviour", revision: REV_A, sha256: HASH("sk-refactor") },
	{ id: "sk-document", name: "document", description: "write the documentation of a project", revision: REV_A, sha256: HASH("sk-document") },
	{ id: "sk-changelog", name: "changelog", description: "write the history of the releases of a project", revision: REV_B, sha256: HASH("sk-changelog") },
	{ id: "sk-security", name: "security audit", description: "find the weaknesses of an application", revision: REV_A, sha256: HASH("sk-security") },
	{ id: "sk-dependency", name: "dependency update", description: "update the dependencies of a project", revision: REV_A, sha256: HASH("sk-dependency") },
	{ id: "sk-database", name: "database query", description: "read and change the rows of a database", revision: REV_A, sha256: HASH("sk-database") },
	{ id: "sk-api", name: "api design", description: "design the interfaces of a service", revision: REV_A, sha256: HASH("sk-api") },
	{ id: "sk-frontend", name: "frontend", description: "build the screens of an application", revision: REV_A, sha256: HASH("sk-frontend") },
	{ id: "sk-backend", name: "backend", description: "build the services of an application", revision: REV_A, sha256: HASH("sk-backend") },
	{ id: "sk-observability", name: "observability", description: "read the logs and the traces of a running system", revision: REV_A, sha256: HASH("sk-observability") },
	{ id: "sk-quota", name: "quota", description: "watch the quota of a model and plan the work", revision: REV_A, sha256: HASH("sk-quota") },
	{ id: "sk-review-old", name: "review (old)", description: "the review of the previous publication", revision: REV_A, sha256: HASH("sk-review-old") },
	{ id: "sk-revoked", name: "legacy deploy", description: "the deployment of the previous tool", revision: REV_A, sha256: HASH("sk-revoked"), revoked: true },
	{ id: "sk-broken-hash", name: "broken hash", description: "a skill whose publication hash is not a hash", revision: REV_A, sha256: "not-a-hash" },
	{ id: "sk-no-description", name: "quiet skill", description: "", revision: REV_A, sha256: HASH("sk-no-description") },
];

/**
 * The queries of the pilot.
 *
 * Every query names the skills that are relevant and the skills that must not
 * be selected. The forbidden ones are the revoked skill, the skill with the
 * broken hash and the skills of an unrelated subject.
 */
export const PILOT_QUERIES = [
	{
		query: "deploy",
		expected: ["sk-deploy", "sk-deploy-runbook"],
		forbidden: ["sk-revoked", "sk-broken-hash", "sk-frontend"],
	},
	{
		query: "publish a release of the package",
		expected: ["sk-release"],
		forbidden: ["sk-revoked", "sk-broken-hash"],
	},
	{
		query: "ship the change to the users",
		expected: ["sk-ship", "sk-deploy"],
		forbidden: ["sk-revoked", "sk-broken-hash"],
	},
	{
		query: "find the cause of a failure",
		expected: ["sk-debug"],
		forbidden: ["sk-revoked", "sk-broken-hash", "sk-frontend"],
	},
	{
		query: "audit the weaknesses",
		expected: ["sk-security"],
		forbidden: ["sk-revoked", "sk-broken-hash"],
	},
	{
		query: "write the history of the releases",
		expected: ["sk-changelog", "sk-release-notes"],
		forbidden: ["sk-revoked", "sk-broken-hash"],
	},
	{
		query: "kubernetes",
		expected: [],
		forbidden: ["sk-revoked", "sk-broken-hash", "sk-deploy"],
	},
];

export { HASH as PILOT_HASH, REV_A, REV_B };
