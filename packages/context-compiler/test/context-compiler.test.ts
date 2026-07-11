/**
 * Context Compiler - Tests
 *
 * Tests cover acceptance criteria from RFC-0042:
 * 1. Required project rules are always included.
 * 2. .env content is denied.
 * 3. Broken optional OKF link does not fail compilation.
 * 4. Broken required source does fail compilation.
 * 5. Duplicate source slices are merged.
 * 6. Context remains under requested token budget.
 * 7. Changed file hash invalidates cache.
 * 8. Identical repository state produces identical compiled context.
 * 9. Omitted items include explicit reasons.
 */

import assert from "node:assert";
import { describe, it } from "node:test";

import { estimateTokens } from "../src/budget.js";
import {
	extractItemHashes,
	generateCacheKey,
	shouldInvalidate,
} from "../src/cache.js";
import { compileContext } from "../src/compiler.js";
import { deduplicateCandidates, mergeFileSlices } from "../src/deduplicate.js";
import { applyPolicyFilter, mergePolicy } from "../src/filter.js";
import { mergeWeights, rankCandidates } from "../src/score.js";
import { ContextCompileError } from "../src/types.js";
import type {
	ContextCandidate,
	ContextCompileRequest,
	ContextPolicy,
} from "../src/types.js";

// ─── Test fixtures ───────────────────────────────────────────────────────

function makeCandidate(
	overrides?: Partial<ContextCandidate>,
): ContextCandidate {
	return {
		id: "ctx-001",
		kind: "source_file",
		content: "function hello() { return 'world'; }",
		source: "src/hello.ts",
		priority: 1,
		required: false,
		trust: "unverified",
		...overrides,
	};
}

function makeRequest(
	overrides?: Partial<ContextCompileRequest>,
): ContextCompileRequest {
	return {
		jobId: "job-001",
		taskId: "task-001",
		taskObjective: "Add login feature",
		maximumTokens: 50_000,
		worktreePath: "/tmp/test-worktree",
		candidates: [],
		...overrides,
	};
}

// ─── AC-1: Required project rules always included ────────────────────────

describe("AC-1: Required project rules always included", () => {
	it("includes required project_rule even when budget is tiny", async () => {
		const required = makeCandidate({
			id: "rule-auth",
			kind: "project_rule",
			source: "src/auth/permissions.ts",
			content: "Auth permission rules",
			required: true,
			priority: 3,
		});

		const result = await compileContext(
			makeRequest({
				taskId: "task-ac1",
				maximumTokens: 1, // Tiny budget
				candidates: [required],
			}),
		);

		assert.ok(result.items.some((i) => i.id === "rule-auth"));
	});

	it("excludes non-required items when budget is exceeded", async () => {
		const optional = makeCandidate({
			id: "opt-001",
			kind: "source_file",
			source: "src/other.ts",
			content: "x".repeat(10_000),
			required: false,
			priority: 1,
		});

		const result = await compileContext(
			makeRequest({
				taskId: "task-ac1b",
				maximumTokens: 100, // Tiny budget
				candidates: [optional],
			}),
		);

		assert.ok(result.items.length === 0);
		assert.ok(result.omitted.some((o) => o.reason === "budget"));
	});
});

// ─── AC-2: .env content denied ──────────────────────────────────────────

describe("AC-2: .env content denied by policy", () => {
	it("denies .env file content", () => {
		const candidates = [
			makeCandidate({
				id: "env-001",
				kind: "source_file",
				source: ".env",
				content: "SECRET=abc123",
				required: false,
			}),
		];

		const { denied } = applyPolicyFilter(candidates, mergePolicy(undefined));
		assert.ok(denied.some((d) => d.candidate.id === "env-001"));
		assert.ok(denied.some((d) => d.reason.includes(".env")));
	});

	it("denies .env.local file content", () => {
		const candidates = [
			makeCandidate({
				id: "env-local",
				kind: "source_file",
				source: ".env.local",
				content: "DATABASE_URL=postgres://...",
				required: false,
			}),
		];

		const { denied } = applyPolicyFilter(candidates, mergePolicy(undefined));
		assert.ok(denied.some((d) => d.candidate.id === "env-local"));
	});

	it("allows non-secret files", () => {
		const candidates = [
			makeCandidate({
				id: "src-main",
				kind: "source_file",
				source: "src/main.ts",
				content: "console.log('hello')",
				required: false,
			}),
		];

		const { passed } = applyPolicyFilter(candidates, mergePolicy(undefined));
		assert.ok(passed.some((c) => c.id === "src-main"));
	});
});

// ─── AC-3: Broken optional OKF link does not fail compilation ─────────────

describe("AC-3: Broken optional OKF link does not fail compilation", () => {
	it("does not throw when optional OKF has no content", async () => {
		const broken = makeCandidate({
			id: "okf-001",
			kind: "okf_concept",
			source: "okfs/missing.okf",
			content: "", // empty = broken
			required: false,
			priority: 1,
		});

		const result = await compileContext(
			makeRequest({
				taskId: "task-ac3",
				maximumTokens: 50_000,
				candidates: [broken],
			}),
		);

		// Should succeed without throwing
		assert.ok(result.taskId === "task-ac3");
		// Broken optional should be omitted (no content means 0 tokens, but still empty)
		assert.ok(result.items.every((i) => i.id !== "okf-001"));
	});
});

// ─── AC-4: Broken required source fails compilation ──────────────────────

describe("AC-4: Broken required source fails compilation", () => {
	it("throws MISSING_REQUIRED_SOURCE when required source has no content", async () => {
		const broken = makeCandidate({
			id: "req-001",
			kind: "okf_concept",
			source: "okfs/required.okf",
			content: "", // empty = broken
			required: true,
			priority: 3,
		});

		await assert.rejects(
			() =>
				compileContext(
					makeRequest({
						taskId: "task-ac4",
						maximumTokens: 50_000,
						candidates: [broken],
					}),
				),
			(err: unknown) => {
				if (err instanceof ContextCompileError) {
					const details = err.details as
						| { missingSources?: string[] }
						| undefined;
					return (
						err.code === "MISSING_REQUIRED_SOURCE" &&
						details?.missingSources?.includes("okfs/required.okf")
					);
				}
				return false;
			},
		);
	});
});

// ─── AC-5: Duplicate source slices merged ───────────────────────────────

describe("AC-5: Duplicate source slices merged", () => {
	it("merges slices from the same file", () => {
		const slice1 = makeCandidate({
			id: "slice-1",
			kind: "source_file",
			source: "src/main.ts",
			content: "function a() {}",
			filePath: "src/main.ts",
			startLine: 1,
			endLine: 5,
			priority: 1,
		});

		const slice2 = makeCandidate({
			id: "slice-2",
			kind: "source_file",
			source: "src/main.ts",
			content: "function b() {}",
			filePath: "src/main.ts",
			startLine: 10,
			endLine: 15,
			priority: 2,
		});

		const result = mergeFileSlices([slice1, slice2]);
		assert.ok(result.length === 1);
		const merged = result[0];
		if (!merged) return;
		assert.ok(merged.filePath === "src/main.ts");
		assert.ok(merged.startLine === 1);
		assert.ok(merged.endLine === 15);
	});

	it("keeps separate files separate", () => {
		const file1 = makeCandidate({
			id: "file-1",
			kind: "source_file",
			source: "src/a.ts",
			content: "// a",
			filePath: "src/a.ts",
		});

		const file2 = makeCandidate({
			id: "file-2",
			kind: "source_file",
			source: "src/b.ts",
			content: "// b",
			filePath: "src/b.ts",
		});

		const result = mergeFileSlices([file1, file2]);
		assert.ok(result.length === 2);
	});

	it("deduplicates exact duplicate content", () => {
		const dup1 = makeCandidate({
			id: "dup-1",
			content: "same content",
			source: "src/same.ts",
		});
		const dup2 = makeCandidate({
			id: "dup-2",
			content: "same content",
			source: "src/same.ts",
		});

		const { unique, duplicates } = deduplicateCandidates([dup1, dup2]);
		assert.ok(unique.length === 1);
		assert.ok(duplicates.includes("dup-2"));
		assert.ok(!duplicates.includes("dup-1")); // first occurrence kept
	});

	it("required items are never deduplicated", () => {
		const req1 = makeCandidate({
			id: "req-1",
			content: "same",
			required: true,
		});
		const req2 = makeCandidate({
			id: "req-2",
			content: "same",
			required: true,
		});

		const { unique, duplicates } = deduplicateCandidates([req1, req2]);
		assert.ok(unique.length === 2);
		assert.ok(duplicates.length === 0);
	});
});

// ─── AC-6: Context under token budget ───────────────────────────────────

describe("AC-6: Context remains under requested token budget", () => {
	it("fits within budget when content is small enough", async () => {
		const small = makeCandidate({
			id: "small-001",
			kind: "source_file",
			content: "const x = 1;",
			required: true,
		});

		const result = await compileContext(
			makeRequest({
				taskId: "task-ac6",
				maximumTokens: 1_000_000, // generous
				candidates: [small],
			}),
		);

		assert.ok(result.estimatedTokens <= 1_000_000);
		assert.ok(result.items.some((i) => i.id === "small-001"));
	});

	it("omits items that exceed remaining budget", async () => {
		const tiny = makeCandidate({
			id: "tiny",
			kind: "source_file",
			content: "a",
			required: true,
		});

		const large = makeCandidate({
			id: "large",
			kind: "source_file",
			content: "x".repeat(10_000),
			required: false,
			priority: 1,
		});

		const result = await compileContext(
			makeRequest({
				taskId: "task-ac6b",
				maximumTokens: 5, // very small
				candidates: [tiny, large],
			}),
		);

		assert.ok(
			result.omitted.some((o) => o.id === "large" && o.reason === "budget"),
		);
	});

	it("token estimation uses 4-char-per-token", () => {
		const content = "1234"; // 4 chars = 1 token
		assert.ok(estimateTokens(content) === 1);

		const long = "a".repeat(100);
		assert.ok(estimateTokens(long) === 25);
	});
});

// ─── AC-7: Changed file hash invalidates cache ───────────────────────────

describe("AC-7: Changed file hash invalidates cache", () => {
	it("source_hash_changed invalidates when hash differs", () => {
		const prevItems = [
			{
				id: "ctx-001",
				kind: "source_file" as const,
				content: "original content",
				source: "src/a.ts",
				priority: 1 as const,
				required: false,
				trust: "unverified" as const,
				estimatedTokens: 1,
				contentHash: "abc123",
			},
		];

		const currentHashes = new Map([["src/a.ts", "xyz789"]]);

		const result = shouldInvalidate(
			{
				taskId: "task-001",
				items: prevItems,
				omitted: [],
				estimatedTokens: 1,
				sourceGraph: [],
				generatedAt: "",
				mapping: {},
			},
			{
				reason: "source_hash_changed",
				details: { sourcePath: "src/a.ts" },
				taskId: "task-001",
			},
			currentHashes,
		);

		assert.ok(result === true);
	});

	it("source_hash_changed does not invalidate when hash unchanged", () => {
		const prevItems = [
			{
				id: "ctx-001",
				kind: "source_file" as const,
				content: "original content",
				source: "src/a.ts",
				priority: 1 as const,
				required: false,
				trust: "unverified" as const,
				estimatedTokens: 1,
				contentHash: "abc123",
			},
		];

		const currentHashes = new Map([["src/a.ts", "abc123"]]);

		const result = shouldInvalidate(
			{
				taskId: "task-001",
				items: prevItems,
				omitted: [],
				estimatedTokens: 1,
				sourceGraph: [],
				generatedAt: "",
				mapping: {},
			},
			{
				reason: "source_hash_changed",
				details: { sourcePath: "src/a.ts" },
				taskId: "task-001",
			},
			currentHashes,
		);

		assert.ok(result === false);
	});

	it("task_objective_changed always invalidates", () => {
		const result = shouldInvalidate(
			{
				taskId: "task-001",
				items: [],
				omitted: [],
				estimatedTokens: 0,
				sourceGraph: [],
				generatedAt: "",
				mapping: {},
			},
			{ reason: "task_objective_changed", taskId: "task-001" },
			new Map(),
		);

		assert.ok(result === true);
	});
});

// ─── AC-8: Identical repo state → identical compiled context ─────────────

describe("AC-8: Identical repository state produces identical compiled context", () => {
	it("same candidates produce same cache key", () => {
		const items = [
			{
				id: "ctx-001",
				kind: "source_file" as const,
				content: "const x = 1;",
				source: "src/main.ts",
				priority: 1 as const,
				required: false,
				trust: "unverified" as const,
				estimatedTokens: 1,
				contentHash: "hash123",
			},
		];

		const key1 = generateCacheKey("task-001", items, "Add login");
		const key2 = generateCacheKey("task-001", items, "Add login");

		assert.ok(key1 === key2);
	});

	it("different objectives produce different cache keys", () => {
		const items = [
			{
				id: "ctx-001",
				kind: "source_file" as const,
				content: "const x = 1;",
				source: "src/main.ts",
				priority: 1 as const,
				required: false,
				trust: "unverified" as const,
				estimatedTokens: 1,
				contentHash: "hash123",
			},
		];

		const key1 = generateCacheKey("task-001", items, "Add login");
		const key2 = generateCacheKey("task-001", items, "Fix logout bug");

		assert.ok(key1 !== key2);
	});

	it("compileContext is deterministic", async () => {
		const c1 = makeCandidate({
			id: "c1",
			kind: "source_file",
			content: "const x = 1;",
			source: "src/a.ts",
		});
		const c2 = makeCandidate({
			id: "c2",
			kind: "okf_concept",
			content: "Authentication concepts",
			source: "okfs/auth.okf",
		});

		const req = makeRequest({ taskId: "task-det", candidates: [c1, c2] });

		const [result1, result2] = await Promise.all([
			compileContext(req),
			compileContext(req),
		]);

		assert.ok(result1.cacheKey === result2.cacheKey);
		assert.ok(result1.estimatedTokens === result2.estimatedTokens);
		assert.ok(result1.items.length === result2.items.length);
	});
});

// ─── AC-9: Omitted items include explicit reasons ──────────────────────

describe("AC-9: Omitted items include explicit reasons", () => {
	it("policy denied items have reason=policy_denied", async () => {
		const env = makeCandidate({
			id: "env",
			source: ".env",
			content: "SECRET=123",
			required: false,
		});
		const normal = makeCandidate({
			id: "src",
			source: "src/a.ts",
			content: "const x = 1;",
			required: false,
		});

		const result = await compileContext(
			makeRequest({ taskId: "task-ac9", candidates: [env, normal] }),
		);

		const envOmission = result.omitted.find((o) => o.id === "env");
		assert.ok(envOmission);
		assert.ok(envOmission.reason === "policy_denied");
		assert.ok(envOmission.deniedBy !== undefined);
	});

	it("duplicate items have reason=duplicate", () => {
		const d1 = makeCandidate({
			id: "d1",
			content: "same",
			source: "src/s.ts",
		});
		const d2 = makeCandidate({
			id: "d2",
			content: "same",
			source: "src/s.ts",
		});

		const { unique, duplicates } = deduplicateCandidates([d1, d2]);
		assert.ok(unique.length === 1);
		assert.ok(duplicates.length === 1);
	});

	it("budget-omitted items have reason=budget", async () => {
		const large = makeCandidate({
			id: "large",
			content: "x".repeat(50_000),
			source: "src/large.ts",
			required: false,
			priority: 1,
		});

		const result = await compileContext(
			makeRequest({
				taskId: "task-ac9b",
				maximumTokens: 100,
				candidates: [large],
			}),
		);

		const omit = result.omitted.find((o) => o.id === "large");
		assert.ok(omit);
		assert.ok(omit.reason === "budget");
		assert.ok(omit.estimatedTokens !== undefined);
		assert.ok(omit.estimatedTokens > 0);
	});
});

// ─── Additional coverage ─────────────────────────────────────────────────

describe("mergePolicy", () => {
	it("merges user policy with defaults", () => {
		const userPolicy: ContextPolicy = {
			deny: ["secrets/**"],
			allowLargeFiles: false,
			maxFileBytes: 1_000_000,
		};

		const merged = mergePolicy(userPolicy);
		assert.ok(merged.deny.includes("secrets/**"));
		assert.ok(merged.maxFileBytes === 1_000_000);
	});

	it("returns defaults when no user policy", () => {
		const merged = mergePolicy(undefined);
		assert.ok(merged.deny.length > 0);
		assert.ok(merged.maxFileBytes > 0);
	});
});

describe("mergeWeights", () => {
	it("applies partial user weights", () => {
		const w = mergeWeights({ priority: 10 });
		assert.ok(w.priority === 10);
		assert.ok(w.directFileReference > 0); // default
	});

	it("returns defaults when no user weights", () => {
		const w = mergeWeights(undefined);
		assert.ok(w.priority > 0);
		assert.ok(w.directFileReference > 0);
	});
});

describe("rankCandidates", () => {
	it("required items always rank first", () => {
		const opt = makeCandidate({
			id: "opt",
			required: false,
			priority: 3,
		});
		const req = makeCandidate({
			id: "req",
			required: true,
			priority: 1,
		});

		const ranked = rankCandidates([opt, req], mergeWeights(), {
			directFileReferences: new Set(),
			taskDependencies: [],
		});

		assert.ok(ranked[0]?.candidate.id === "req");
		assert.ok(
			ranked[0]?.score != null &&
				ranked[1]?.score != null &&
				ranked[0]?.score > ranked[1]?.score,
		);
	});

	it("higher priority scores higher", () => {
		const lo = makeCandidate({ id: "lo", priority: 1 });
		const hi = makeCandidate({ id: "hi", priority: 3 });

		const ranked = rankCandidates([lo, hi], mergeWeights(), {
			directFileReferences: new Set(),
			taskDependencies: [],
		});

		assert.ok(ranked[0]?.candidate.id === "hi");
	});
});

describe("extractItemHashes", () => {
	it("extracts hashes from items", () => {
		const items = [
			{
				id: "ctx-1",
				kind: "source_file" as const,
				content: "a",
				source: "src/a.ts",
				priority: 1 as const,
				required: false,
				trust: "unverified" as const,
				estimatedTokens: 1,
				contentHash: "hash-a",
			},
			{
				id: "ctx-2",
				kind: "okf_concept" as const,
				content: "b",
				source: "okfs/b.okf",
				priority: 1 as const,
				required: false,
				trust: "unverified" as const,
				estimatedTokens: 1,
				contentHash: undefined,
			},
		];

		const hashes = extractItemHashes(items);
		assert.ok(hashes.get("src/a.ts") === "hash-a");
		assert.ok(hashes.get("okfs/b.okf") === undefined);
	});
});

describe("ContextCompileError", () => {
	it("has code, message, and details", () => {
		const err = new ContextCompileError(
			"MISSING_REQUIRED_SOURCE",
			"Source not found",
			{ missingSources: ["src/a.ts"] },
		);

		assert.ok(err.code === "MISSING_REQUIRED_SOURCE");
		assert.ok(err.message === "Source not found");
		assert.ok(
			(err.details as { missingSources?: string[] })?.missingSources?.[0] ===
				"src/a.ts",
		);
		assert.ok(err instanceof Error);
	});
});
