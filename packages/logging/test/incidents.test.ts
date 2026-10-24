/**
 * The versioned incident schema, the durable incident store and the Qdrant
 * writer.
 *
 * The three properties that matter:
 *   - the fingerprint is stable across volatile parts of a message,
 *   - the tenant is server derived, so a caller can never see another
 *     tenant's incidents,
 *   - the schema version is explicit on every incident.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	INCIDENT_COLLECTION,
	INCIDENT_SCHEMA_VERSION,
	extractIncidents,
	incidentFingerprint,
	isKnownIncidentSchema,
	mergeIncident,
	normalizeForFingerprint,
} from "../src/incidents/schema.js";
import {
	IncidentStore,
	type IncidentQueryParams,
} from "../src/server/incident-store.js";
import {
	IncidentQdrantWriter,
	incidentPointId,
	tenantFilter,
	type IncidentPoint,
	type IncidentPayload,
} from "../src/server/incident-qdrant.js";
import {
	LogCredentialStore,
	LogIngestService,
	LogIndexStore,
	LogOutbox,
	hashToken,
} from "../src/server/index.js";

const created: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-incidents-"));
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

const TOKEN = "install-token-1";

describe("the incident fingerprint", () => {
	test("is stable when only volatile parts change", () => {
		const a = incidentFingerprint({
			source: "harness",
			event: "run.failed",
			errorKind: "TypeError",
			message: "cannot read property id of undefined at 12:00:01 in /tmp/run-1234.ts",
		});
		const b = incidentFingerprint({
			source: "harness",
			event: "run.failed",
			errorKind: "TypeError",
			message: "cannot read property id of undefined at 13:45:59 in /tmp/run-9876.ts",
		});
		expect(a).toBe(b);
	});

	test("differs when the failure itself differs", () => {
		const a = incidentFingerprint({
			source: "harness",
			event: "run.failed",
			errorKind: "TypeError",
			message: "cannot read property id of undefined",
		});
		const b = incidentFingerprint({
			source: "harness",
			event: "run.failed",
			errorKind: "RangeError",
			message: "cannot read property id of undefined",
		});
		expect(a).not.toBe(b);
	});

	test("normalizes ids, paths and numbers", () => {
		expect(normalizeForFingerprint("id 550e8400-e29b-41d4-a716-446655440000")).toContain(
			"<uuid>",
		);
		expect(normalizeForFingerprint("failed after 42 retries")).toContain("<n>");
		expect(normalizeForFingerprint("read /var/lib/app/config.json")).toContain("<path>");
	});
});

describe("the incident extraction", () => {
	const record = (over: Partial<Parameters<typeof extractIncidents>[0][number]> = {}) => ({
		ts: "2026-10-24T09:00:00.000Z",
		level: "error",
		source: "harness",
		event: "run.failed",
		error: { name: "TypeError", message: "boom" },
		...over,
	});

	test("groups the same failure into one incident with a count", () => {
		const incidents = extractIncidents(
			[record(), record({ ts: "2026-10-24T09:05:00.000Z" })],
			"tenant-a",
			"install-1",
		);
		expect(incidents).toHaveLength(1);
		expect(incidents[0].count).toBe(2);
		expect(incidents[0].firstSeen).toBe("2026-10-24T09:00:00.000Z");
		expect(incidents[0].lastSeen).toBe("2026-10-24T09:05:00.000Z");
	});

	test("ignores records that are not a problem", () => {
		expect(extractIncidents([record({ level: "info" })], "tenant-a")).toHaveLength(0);
		expect(extractIncidents([record({ level: "debug" })], "tenant-a")).toHaveLength(0);
	});

	test("takes the tenant from the caller, not from the record", () => {
		const incidents = extractIncidents([record()], "tenant-b");
		expect(incidents[0].tenantId).toBe("tenant-b");
	});

	test("carries the schema version", () => {
		const incidents = extractIncidents([record()], "tenant-a");
		expect(incidents[0].schemaVersion).toBe(INCIDENT_SCHEMA_VERSION);
		expect(isKnownIncidentSchema(incidents[0].schemaVersion)).toBe(true);
		expect(isKnownIncidentSchema(999)).toBe(false);
	});

	test("merges an incident into the stored one", () => {
		const first = extractIncidents([record()], "tenant-a")[0];
		const second = extractIncidents(
			[record({ ts: "2026-10-25T09:00:00.000Z" })],
			"tenant-a",
		)[0];
		const merged = mergeIncident(first, second);
		expect(merged.count).toBe(2);
		expect(merged.firstSeen).toBe(first.firstSeen);
		expect(merged.lastSeen).toBe("2026-10-25T09:00:00.000Z");
	});
});

describe("the incident store", () => {
	test("stores and reads the incidents of a tenant", () => {
		const dir = tempDir();
		const store = new IncidentStore({ dir });
		const incidents = extractIncidents(
			[
				{
					ts: "2026-10-24T09:00:00.000Z",
					level: "error",
					source: "harness",
					event: "run.failed",
					error: { name: "TypeError", message: "boom" },
				},
			],
			"tenant-a",
		);
		expect(store.append(incidents)).toBe(1);

		const result = store.query({ tenantId: "tenant-a" });
		expect(result.incidents).toHaveLength(1);
		expect(result.incidents[0].fingerprint).toBe(incidents[0].fingerprint);
	});

	test("never returns the incidents of another tenant", () => {
		const dir = tempDir();
		const store = new IncidentStore({ dir });
		store.append(
			extractIncidents(
				[
					{
						ts: "2026-10-24T09:00:00.000Z",
						level: "error",
						source: "harness",
						event: "run.failed",
						error: { name: "TypeError", message: "boom" },
					},
				],
				"tenant-a",
			),
		);
		expect(store.query({ tenantId: "tenant-b" }).incidents).toHaveLength(0);
		expect(store.query({ tenantId: "tenant-a" }).incidents).toHaveLength(1);
	});

	test("filters by severity and source", () => {
		const dir = tempDir();
		const store = new IncidentStore({ dir });
		const base = {
			ts: "2026-10-24T09:00:00.000Z",
			level: "error" as const,
			source: "harness",
			event: "run.failed",
			error: { name: "TypeError", message: "boom" },
		};
		store.append(extractIncidents([base], "tenant-a"));
		store.append(
			extractIncidents([{ ...base, level: "warn", event: "run.slow" }], "tenant-a"),
		);
		expect(store.query({ tenantId: "tenant-a" }).incidents).toHaveLength(2);
		expect(store.query({ tenantId: "tenant-a", severity: "error" }).incidents).toHaveLength(1);
		expect(store.query({ tenantId: "tenant-a", source: "other" }).incidents).toHaveLength(0);
	});
});

describe("the Qdrant incident writer", () => {
	class FakeQdrant {
		upserts: { collection: string; points: IncidentPoint[] }[] = [];
		searches: { collection: string; filter: Record<string, unknown>; limit: number }[] = [];
		points: IncidentPoint[] = [];
		fail = false;

		async upsert(collection: string, points: IncidentPoint[]): Promise<void> {
			if (this.fail) throw new Error("qdrant is down");
			this.upserts.push({ collection, points });
			this.points.push(...points);
		}

		async search(
			collection: string,
			filter: Record<string, unknown>,
			limit: number,
		): Promise<IncidentPayload[]> {
			this.searches.push({ collection, filter, limit });
			return this.points.slice(0, limit).map((point) => point.payload);
		}
	}

	const incident = () =>
		extractIncidents(
			[
				{
					ts: "2026-10-24T09:00:00.000Z",
					level: "error",
					source: "harness",
					event: "run.failed",
					error: { name: "TypeError", message: "boom" },
				},
			],
			"tenant-a",
		)[0];

	test("writes into the versioned collection with the tenant in the payload", async () => {
		const qdrant = new FakeQdrant();
		const writer = new IncidentQdrantWriter(qdrant);
		expect(await writer.upsert([incident()])).toBe(1);
		expect(qdrant.upserts[0].collection).toBe(INCIDENT_COLLECTION);
		expect(qdrant.upserts[0].points[0].payload.tenant_id).toBe("tenant-a");
		expect(qdrant.upserts[0].points[0].payload.schema_version).toBe(
			INCIDENT_SCHEMA_VERSION,
		);
	});

	test("scopes a search to the tenant", async () => {
		const qdrant = new FakeQdrant();
		const writer = new IncidentQdrantWriter(qdrant);
		await writer.upsert([incident()]);
		await writer.search("tenant-a", 10);
		expect(qdrant.searches[0].filter).toEqual(tenantFilter("tenant-a"));
	});

	test("never returns the incidents of another tenant", async () => {
		const qdrant = new FakeQdrant();
		const writer = new IncidentQdrantWriter(qdrant);
		await writer.upsert([incident()]);
		const results = await writer.search("tenant-b", 10);
		expect(results).toHaveLength(0);
	});

	test("a failing Qdrant never throws", async () => {
		const qdrant = new FakeQdrant();
		qdrant.fail = true;
		const writer = new IncidentQdrantWriter(qdrant);
		expect(await writer.upsert([incident()])).toBe(0);
		expect(writer.error).toContain("qdrant is down");
	});

	test("the point id is stable per tenant and fingerprint", () => {
		const one = incidentPointId("tenant-a", "abc123");
		expect(one).toBe(incidentPointId("tenant-a", "abc123"));
		expect(one).not.toBe(incidentPointId("tenant-b", "abc123"));
	});
});

describe("the incident query of the service", () => {
	function service(dir: string) {
		const credentialPath = join(dir, "log-ingest-credentials.json");
		writeFileSync(
			credentialPath,
			JSON.stringify({
				credentials: [
					{
						id: "laptop",
						tenantId: "tenant-a",
						label: "laptop",
						scopes: ["logs:write", "logs:read"],
						tokenHash: hashToken(TOKEN),
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			}),
		);
		const credentials = LogCredentialStore.load({ path: credentialPath, env: {} });
		const store = new IncidentStore({ dir: join(dir, "incidents") });
		const ingest = new LogIngestService({
			credentials,
			outbox: new LogOutbox({ dir: join(dir, "outbox") }),
			index: new LogIndexStore({ dir: join(dir, "index") }),
			incidents: store,
		});
		return { ingest, store };
	}

	const batch = (records: unknown[]) => ({
		schemaVersion: 2,
		batchId: "batch-1",
		app: "pi-harness",
		installationId: "install-1",
		sentAt: "2026-10-24T09:00:00.000Z",
		records,
	});

	test("derives the incidents of an accepted batch", () => {
		const dir = tempDir();
		const { ingest, store } = service(dir);
		const result = ingest.ingest(
			batch([
				{
					ts: "2026-10-24T09:00:00.000Z",
					level: "error",
					source: "harness",
					event: "run.failed",
					message: "boom",
				},
			]),
			TOKEN,
		);
		expect(result.status).toBe(202);
		expect(store.query({ tenantId: "tenant-a" }).incidents).toHaveLength(1);
	});

	test("the tenant of the request body is ignored", () => {
		const dir = tempDir();
		const { ingest, store } = service(dir);
		ingest.ingest(
			{
				...batch([
					{
						ts: "2026-10-24T09:00:00.000Z",
						level: "error",
						source: "harness",
						event: "run.failed",
						message: "boom",
					},
				]),
				tenantId: "tenant-b",
			},
			TOKEN,
		);
		expect(store.query({ tenantId: "tenant-a" }).incidents).toHaveLength(1);
		expect(store.query({ tenantId: "tenant-b" }).incidents).toHaveLength(0);
	});

	test("the query needs a credential", () => {
		const dir = tempDir();
		const { ingest } = service(dir);
		const result = ingest.queryIncidents({} as Omit<IncidentQueryParams, "tenantId">, undefined);
		expect(result.status).toBe(401);
	});

	test("the query is scoped to the tenant of the credential", () => {
		const dir = tempDir();
		const { ingest, store } = service(dir);
		store.append(
			extractIncidents(
				[
					{
						ts: "2026-10-24T09:00:00.000Z",
						level: "error",
						source: "harness",
						event: "run.failed",
						message: "boom",
					},
				],
				"tenant-b",
			),
		);
		const result = ingest.queryIncidents({}, TOKEN);
		expect(result.status).toBe(200);
		expect((result.body as { incidents: unknown[] }).incidents).toHaveLength(0);
	});
});
