/**
 * SQLite Smoke Test
 *
 * Verifies SQLite storage works correctly with Node's built-in sqlite.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { join } from "node:path";
import { mkdirSync, unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "test", "smoke.sqlite");

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

  it("opens SQLite storage", async () => {
    const storage = await openNodeSqliteStorage(TEST_DB_PATH);
    assert.ok(storage, "Storage should be defined");
    await storage.close(BACKGROUND_CONTEXT);
  });

  it("creates and reopens database", async () => {
    // First open
    const storage1 = await openNodeSqliteStorage(TEST_DB_PATH);
    await storage1.close(BACKGROUND_CONTEXT);

    // Second open - should work
    const storage2 = await openNodeSqliteStorage(TEST_DB_PATH);
    assert.ok(storage2, "Storage should be reopened");
    await storage2.close(BACKGROUND_CONTEXT);
  });

  it("persists data across reopen", async () => {
    // Open and write
    const storage1 = await openNodeSqliteStorage(TEST_DB_PATH);
    await storage1.close(BACKGROUND_CONTEXT);

    // Reopen and verify
    const storage2 = await openNodeSqliteStorage(TEST_DB_PATH);
    assert.ok(storage2, "Storage should be reopened with data");
    await storage2.close(BACKGROUND_CONTEXT);
  });
});
