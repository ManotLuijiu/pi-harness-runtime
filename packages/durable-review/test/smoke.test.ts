/// <reference types="node" />
/**
 * SQLite Smoke Test
 *
 * Verifies SQLite storage works correctly with Node's built-in sqlite.
 *
 * The storage needs `node:sqlite`. Node has that module, Bun does not, so
 * the tests are skipped with a reason where the module is missing.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { join } from "node:path";
import { mkdirSync, unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "test", "smoke.sqlite");

/** Whether this runtime has the SQLite module of Node. */
const sqliteAvailable = await (async () => {
	try {
		await import("node:sqlite");
		return true;
	} catch {
		return false;
	}
})();

const SKIP_WITHOUT_SQLITE = sqliteAvailable
	? false
	: "node:sqlite is not available in this runtime";
const itSqlite = sqliteAvailable ? it : it.skip;

/** Open the storage of the test database. */
async function openStorage(): Promise<{
	close: (ctx: unknown) => Promise<void>;
}> {
	const { openNodeSqliteStorage } = await import(
		"@earendil-works/pi-durable/storage/sqlite/node"
	);
	return (await openNodeSqliteStorage(TEST_DB_PATH)) as {
		close: (ctx: unknown) => Promise<void>;
	};
}

describe("SQLite Smoke Test", () => {
	before(() => {
		// Ensure directory exists
		const dir = TEST_DB_PATH.replace(/\/[^/]+$/, "");
		mkdirSync(dir, { recursive: true });
		// Clean up any existing test db
		if (existsSync(TEST_DB_PATH)) {
			try {
				unlinkSync(TEST_DB_PATH);
			} catch {
				// ignore
			}
		}
	});

	after(() => {
		// Cleanup
		if (existsSync(TEST_DB_PATH)) {
			try {
				unlinkSync(TEST_DB_PATH);
			} catch {
				// ignore
			}
		}
	});

	itSqlite("opens SQLite storage", { skip: SKIP_WITHOUT_SQLITE }, async () => {
		const storage = await openStorage();
		assert.ok(storage, "Storage should be defined");
		await storage.close(BACKGROUND_CONTEXT);
	});

	itSqlite(
		"creates and reopens database",
		{ skip: SKIP_WITHOUT_SQLITE },
		async () => {
			// First open
			const storage1 = await openStorage();
			await storage1.close(BACKGROUND_CONTEXT);

			// Second open - should work
			const storage2 = await openStorage();
			assert.ok(storage2, "Storage should be reopened");
			await storage2.close(BACKGROUND_CONTEXT);
		},
	);

	itSqlite(
		"persists data across reopen",
		{ skip: SKIP_WITHOUT_SQLITE },
		async () => {
			// Open and write
			const storage1 = await openStorage();
			await storage1.close(BACKGROUND_CONTEXT);

			// Reopen and verify
			const storage2 = await openStorage();
			assert.ok(storage2, "Storage should be reopened with data");
			await storage2.close(BACKGROUND_CONTEXT);
		},
	);
});
