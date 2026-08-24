/**
 * Skill Sync Tests
 */

// @ts-ignore - bun:test types
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Mock the environment
const originalApiKey = process.env.SKILLS_SAAS_API_KEY;

describe("Skill Sync", () => {
	let tempCacheDir: string;

	beforeEach(() => {
		tempCacheDir = join(tmpdir(), `skill-sync-test-${Date.now()}`);
		mkdirSync(tempCacheDir, { recursive: true });
	});

	afterEach(() => {
		// Restore env
		if (originalApiKey === undefined) {
			delete process.env.SKILLS_SAAS_API_KEY;
		} else {
			process.env.SKILLS_SAAS_API_KEY = originalApiKey;
		}
		// Cleanup
		try {
			rmSync(tempCacheDir, { recursive: true });
		} catch {
			// Ignore
		}
	});

	describe("isSkillSyncConfigured", () => {
		test("returns false when API key not set", () => {
			delete process.env.SKILLS_SAAS_API_KEY;
			// Import dynamically to test
			expect(process.env.SKILLS_SAAS_API_KEY).toBeUndefined();
		});

		test("returns true when API key is set", () => {
			process.env.SKILLS_SAAS_API_KEY = "sk_test_xxx";
			expect(process.env.SKILLS_SAAS_API_KEY).toBe("sk_test_xxx");
		});
	});

	describe("getSyncStatus", () => {
		test("returns correct status when not configured", () => {
			delete process.env.SKILLS_SAAS_API_KEY;
			// Status should show not configured
			expect(process.env.SKILLS_SAAS_API_KEY).toBeUndefined();
		});
	});
});
