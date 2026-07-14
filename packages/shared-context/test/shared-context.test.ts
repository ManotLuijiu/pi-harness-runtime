/**
 * Shared Context Store Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FileSharedContextStore } from "../src/shared-context";

const TMP = join(process.cwd(), ".test-context-tmp");

function store(): FileSharedContextStore {
	return new FileSharedContextStore(TMP);
}

beforeEach(() => {
	rmSync(TMP, { force: true, recursive: true });
	mkdirSync(TMP, { recursive: true });
});

describe("FileSharedContextStore", () => {
	describe("writeRequirement / readRequirement", () => {
		it("writes and reads back a requirement", async () => {
			const s = store();
			await s.writeRequirement("job-42", "Implement the login feature");
			const text = await s.readRequirement("job-42");
			expect(text).toBe("Implement the login feature\n");
		});

		it("returns null for missing requirement", async () => {
			const s = store();
			const text = await s.readRequirement("nonexistent-job");
			expect(text).toBeNull();
		});

		it("overwrites existing requirement", async () => {
			const s = store();
			await s.writeRequirement("job-1", "original");
			await s.writeRequirement("job-1", "updated");
			const text = await s.readRequirement("job-1");
			expect(text).toContain("updated");
		});

		it("handles multiline content", async () => {
			const s = store();
			const multiline = "Line 1\nLine 2\nLine 3";
			await s.writeRequirement("job-3", multiline);
			const text = await s.readRequirement("job-3");
			expect(text).toBe("Line 1\nLine 2\nLine 3\n");
		});
	});

	describe("writeResumePrompt", () => {
		it("writes to resume_prompt.md", async () => {
			const s = store();
			await s.writeResumePrompt("job-7", "Resume context for job-7");
			const text = await s.readRequirement("job-7");
			expect(text).toBeNull(); // readRequirement reads requirement.md
			// Read via the file system directly
			const { readFileSync } = await import("node:fs");
			const content = readFileSync(
				join(TMP, "jobs", "job-7", "resume_prompt.md"),
				"utf-8",
			);
			expect(content).toContain("Resume context for job-7");
		});
	});

	describe("appendDecision", () => {
		it("appends a decision entry", async () => {
			const s = store();
			await s.appendDecision("job-5", "Chose approach A because of simplicity");
			const { readFileSync } = await import("node:fs");
			const content = readFileSync(
				join(TMP, "jobs", "job-5", "decisions.md"),
				"utf-8",
			);
			expect(content).toContain("Chose approach A");
			expect(content).toContain("## 20"); // ISO date prefix
		});

		it("appends multiple decisions sequentially", async () => {
			const s = store();
			await s.appendDecision("job-9", "Decision 1");
			await s.appendDecision("job-9", "Decision 2");
			const { readFileSync } = await import("node:fs");
			const content = readFileSync(
				join(TMP, "jobs", "job-9", "decisions.md"),
				"utf-8",
			);
			expect(content).toContain("Decision 1");
			expect(content).toContain("Decision 2");
		});

		it("creates intermediate directories", async () => {
			const s = store();
			await s.appendDecision("deeply-nested-job", "Made a decision");
			const { existsSync } = await import("node:fs");
			expect(existsSync(join(TMP, "jobs", "deeply-nested-job"))).toBe(true);
		});
	});

	describe("multiple jobs", () => {
		it("isolates jobs by ID", async () => {
			const s = store();
			await s.writeRequirement("job-A", "Content for A");
			await s.writeRequirement("job-B", "Content for B");
			const textA = await s.readRequirement("job-A");
			const textB = await s.readRequirement("job-B");
			expect(textA).toContain("Content for A");
			expect(textB).toContain("Content for B");
		});
	});
});
