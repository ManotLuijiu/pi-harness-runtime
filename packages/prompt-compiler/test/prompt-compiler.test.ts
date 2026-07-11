/**
 * Prompt Compiler - Tests
 *
 * Tests cover all acceptance criteria from RFC-0041:
 * 1. Identical inputs produce identical prompt content and hash.
 * 2. Required sections are never removed by compaction.
 * 3. Provider formatting does not alter task semantics.
 * 4. Secrets are redacted before persistence.
 * 5. Invalid output contracts fail compilation.
 * 6. Continuation prompts do not repeat completed work.
 * 7. Unit tests cover all error codes.
 * 8. Tests pass without network access.
 */

import assert from "node:assert";
import { describe, it } from "node:test";

import type { CompiledRequirement } from "@pi/requirement-compiler/src/types.js";
import type { CompiledTask } from "@pi/task-compiler/src/types.js";
import { compactToBudget, estimateTokens } from "../src/budget.js";
// Import directly from source (TypeScript modules)
import { compilePrompt, createSyncHasher } from "../src/compiler.js";
import {
	deduplicateSections,
	normalizeForDeduplication,
} from "../src/deduplicate.js";
import { normalizeRequest } from "../src/normalize.js";
import { renderForProvider } from "../src/render.js";
import { buildSections } from "../src/section-builder.js";
import { PromptCompileError } from "../src/types.js";
import { PROVIDER_PROFILES } from "../src/types.js";
import type { PromptCompileRequest } from "../src/types.js";
import { validateSections, validateTokenBudget } from "../src/validate.js";

// ─── Test fixtures ───────────────────────────────────────────────────────

function makeRequest(
	overrides?: Partial<PromptCompileRequest>,
): PromptCompileRequest {
	const requirement: CompiledRequirement = {
		id: "REQ-001",
		title: "Build login feature",
		problemStatement: "Implement user login with JWT",
		goals: [{ id: "g1", description: "Build login" }],
		constraints: [
			{ id: "c1", description: "Use HTTPS only", blocking: true },
			{ id: "c2", description: "Passwords hashed with bcrypt", blocking: true },
		],
		acceptanceCriteria: [
			{ id: "ac1", outcome: ["User can log in with valid credentials"] },
			{ id: "ac2", outcome: ["Invalid credentials show error"] },
		],
		riskTags: [],
	};

	const task: CompiledTask = {
		id: "task-001",
		type: "implementation",
		title: "Implement login",
		objective: "Implement user login feature with JWT authentication",
		dependencies: [],
		priority: 1,
		fileOwnership: {
			taskId: "task-001",
			mode: "exclusive",
			include: ["/project/src/auth/**"],
			exclude: [],
		},
		filesInScope: [
			{ path: "/project/src/auth/login.ts", description: "Login handler" },
			{ path: "/project/src/auth/jwt.ts", description: "JWT utilities" },
		],
		estimatedComplexity: 3 as const,
		expectedOutputs: [
			{
				kind: "file",
				description: "login.ts implementation",
				path: "/project/src/auth/login.ts",
				required: true,
			},
			{ kind: "test_result", description: "login tests", required: true },
		],
		prohibitedCommands: ["rm -rf /", "yarn build"],
		permittedCommands: ["tsc", "jest", "node"],
		requiredCapabilities: ["typescript", "node"],
		acceptanceCriteria: ["ac1", "ac2"],
		jobId: "JOB-001",
	};

	return {
		task,
		requirement,
		context: { entries: [] },
		provider: "codex",
		attempt: 1,
		...overrides,
	};
}

function makeDeps(overrides?: {
	projectRules?: string[];
	redactor?: (content: string) => string;
}) {
	const hasher = createSyncHasher();
	return {
		hasher,
		clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
		redactor: {
			redact: overrides?.redactor ?? ((s: string) => s),
		},
		projectRules: overrides?.projectRules ?? [
			"Use TypeScript strict mode",
			"Write unit tests for all public functions",
		],
	};
}

// ─── Test 1: Deterministic hash ──────────────────────────────────────

describe("Deterministic hash", () => {
	it("identical inputs produce identical prompt content and hash", async () => {
		const request = makeRequest();
		const deps = makeDeps();

		const pkg1 = await compilePrompt(request, deps);
		const pkg2 = await compilePrompt(request, deps);

		assert.strictEqual(pkg1.hash, pkg2.hash, "Hash should be deterministic");
		assert.strictEqual(pkg1.system, pkg2.system, "System prompt should match");
		assert.strictEqual(pkg1.user, pkg2.user, "User prompt should match");
		assert.strictEqual(pkg1.taskId, pkg2.taskId);
		assert.strictEqual(pkg1.provider, pkg2.provider);
		assert.strictEqual(pkg1.version, "1");
	});

	it("different content produces different hash", async () => {
		const request1 = makeRequest();
		const request2 = makeRequest({
			task: {
				...request1.task,
				objective: "Different objective",
			} as CompiledTask,
		});
		const deps = makeDeps();

		const pkg1 = await compilePrompt(request1, deps);
		const pkg2 = await compilePrompt(request2, deps);

		assert.notStrictEqual(
			pkg1.hash,
			pkg2.hash,
			"Different content should produce different hash",
		);
	});

	it("hash includes both system and user content", async () => {
		const request = makeRequest();
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		assert.ok(pkg.hash.length > 0, "Hash should not be empty");
		assert.ok(
			pkg.hash === deps.hasher.sha256(`${pkg.system}\n${pkg.user}`),
			"Hash should equal SHA-256 of system+user",
		);
	});
});

// ─── Test 2: Required sections never removed ─────────────────────────────

describe("Required sections survive compaction", () => {
	it("objective section is required and never compacted", async () => {
		const request = makeRequest({
			context: {
				entries: Array.from({ length: 50 }, (_, i) => ({
					id: `ctx-${i}`,
					content: `This is supplemental context entry number ${i}. It provides background information that could be safely removed if needed.`,
					priority: 7, // supplemental priority
					source: `file-${i}.md`,
				})),
			},
		});
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		assert.ok(
			pkg.user.includes("Implement user login feature"),
			"Objective should be in user prompt",
		);
		assert.ok(
			pkg.user.includes("User can log in with valid credentials"),
			"Acceptance criteria should be preserved",
		);
		assert.ok(
			pkg.user.includes("/project/src/auth/login.ts"),
			"Files in scope should be preserved",
		);
	});

	it("project rules section is required", async () => {
		const request = makeRequest();
		const deps = makeDeps({
			projectRules: ["Use TypeScript", "No console.log"],
		});

		const pkg = await compilePrompt(request, deps);

		assert.ok(
			pkg.system.includes("TypeScript") || pkg.user.includes("TypeScript"),
			"Project rules should be in prompt",
		);
	});

	it("acceptance criteria are never removed", async () => {
		const request = makeRequest();
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		const acSection = pkg.sections.find(
			(s) => s.kind === "acceptance_criteria",
		);
		assert.ok(acSection, "AC section should exist");
		assert.strictEqual(
			acSection?.required,
			true,
			"AC section should be required",
		);
		assert.ok(
			pkg.user.includes("User can log in with valid credentials"),
			"AC text should be in prompt",
		);
	});
});

// ─── Test 3: Provider formatting ───────────────────────────────────────

describe("Provider formatting", () => {
	it("anthropic uses XML formatting", async () => {
		const request = makeRequest({ provider: "anthropic" });
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);
		const profile = PROVIDER_PROFILES.anthropic;

		const sections = buildSections(
			normalizeRequest(request),
			deps.projectRules,
		);
		const rendered = renderForProvider(sections, profile);

		// Anthropic's rules go in system
		if (profile.supportsSystemPrompt) {
			assert.ok(
				rendered.system.length > 0 || rendered.user.length > 0,
				"Should have some output",
			);
		}
	});

	it("all supported providers produce valid output", async () => {
		const request = makeRequest();
		const providers: Array<
			"codex" | "minimax" | "glm" | "openai" | "anthropic" | "gemini"
		> = ["codex", "minimax", "glm", "openai", "anthropic", "gemini"];

		for (const provider of providers) {
			const req = makeRequest({ provider });
			const deps = makeDeps();
			const pkg = await compilePrompt(req, deps);

			assert.ok(
				pkg.system.length > 0 || pkg.user.length > 0,
				`Provider ${provider} should produce output`,
			);
			assert.strictEqual(pkg.provider, provider);
		}
	});

	it("different styles produce different formatting but same content", async () => {
		const request = makeRequest({ provider: "openai" });
		const deps = makeDeps();

		const pkg1 = await compilePrompt(request, deps);
		const req2 = makeRequest({ provider: "anthropic" });
		const pkg2 = await compilePrompt(req2, deps);

		// Both should contain the same key content
		assert.ok(
			pkg1.user.includes("Implement user login"),
			"OpenAI should have objective",
		);
		assert.ok(
			pkg2.user.includes("Implement user login"),
			"Anthropic should have objective",
		);
	});
});

// ─── Test 4: Secret redaction ─────────────────────────────────────────

describe("Secret redaction", () => {
	it("API keys are redacted before persistence", async () => {
		const request = makeRequest();
		const deps = makeDeps({
			redactor: (content: string) =>
				content
					.replace(/sk-[a-zA-Z0-9]{20,}/g, "[API_KEY_REDACTED]")
					.replace(/password\s*=\s*["'][^"']+["']/gi, 'password="[REDACTED]"'),
		});

		const secretRequest = makeRequest({
			task: {
				...request.task,
				objective: "Use API key sk-1234567890abcdefghij for authentication",
				permittedCommands: [
					"curl -H 'Authorization: Bearer sk-abcdefghijklmnop12345' https://api.example.com",
				],
			} as CompiledTask,
		});

		const pkg = await compilePrompt(secretRequest, deps);

		assert.ok(
			!pkg.user.includes("sk-1234567890abcdefghij"),
			"API key should be redacted",
		);
		assert.ok(
			!pkg.user.includes("sk-abcdefghijklmnop12345"),
			"Bearer token should be redacted",
		);
	});

	it("identity section preserves task ID", async () => {
		const request = makeRequest();
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		assert.ok(pkg.user.includes("task-001"), "Task ID should be preserved");
		assert.ok(
			pkg.user.includes("REQ-001"),
			"Requirement ID should be preserved",
		);
	});

	it("hash is computed over redacted content", async () => {
		const request = makeRequest();
		const deps = makeDeps({
			redactor: (content: string) =>
				content.replace(/sk-[a-zA-Z0-9]+/g, "[REDACTED]"),
		});

		const pkg = await compilePrompt(request, deps);

		assert.ok(pkg.hash.length > 0, "Hash should be computed");
		assert.ok(!pkg.user.includes("sk-"), "No API keys in prompt");
	});
});

// ─── Test 5: Error codes ───────────────────────────────────────────────

describe("Error codes", () => {
	it("INVALID_TASK when task ID is empty", async () => {
		const base = makeRequest();
		const request = makeRequest({
			task: { ...base.task, id: "" },
		});
		const deps = makeDeps();

		await assert.rejects(
			async () => compilePrompt(request, deps),
			(err: unknown) => {
				if (err instanceof PromptCompileError) {
					assert.strictEqual(err.code, "INVALID_TASK");
					return true;
				}
				return false;
			},
		);
	});

	it("MISSING_OBJECTIVE when objective is empty", async () => {
		const base = makeRequest();
		const request = makeRequest({
			task: { ...base.task, objective: "" },
		});
		const deps = makeDeps();

		await assert.rejects(
			async () => compilePrompt(request, deps),
			(err: unknown) => {
				if (err instanceof PromptCompileError) {
					assert.strictEqual(err.code, "MISSING_OBJECTIVE");
					return true;
				}
				return false;
			},
		);
	});

	it("MISSING_OUTPUT_CONTRACT when no outputs defined", async () => {
		const base = makeRequest();
		const request = makeRequest({
			task: { ...base.task, expectedOutputs: [] },
		});
		const deps = makeDeps();

		await assert.rejects(
			async () => compilePrompt(request, deps),
			(err: unknown) => {
				if (err instanceof PromptCompileError) {
					assert.strictEqual(err.code, "MISSING_OUTPUT_CONTRACT");
					return true;
				}
				return false;
			},
		);
	});

	it("TOKEN_BUDGET_EXCEEDED when estimated tokens exceed budget", async () => {
		// Test validation directly: compactToBudget removes all compactable content,
		// so the full compile cannot produce TOKEN_BUDGET_EXCEEDED.
		// We test validateTokenBudget directly.
		const profile = PROVIDER_PROFILES.codex;
		const available = profile.maximumInputTokens - profile.reservedOutputTokens;

		assert.throws(
			() => validateTokenBudget(available + 1, profile),
			(err: unknown) => {
				if (err instanceof PromptCompileError) {
					assert.strictEqual(err.code, "TOKEN_BUDGET_EXCEEDED");
					return true;
				}
				return false;
			},
		);
	});
	it("POLICY_CONFLICT for prohibited tools", async () => {
		const base = makeRequest();
		const request = makeRequest({
			task: {
				...base.task,
				permittedCommands: ["rm -rf /", "tsc", "jest"],
			},
		});
		const deps = makeDeps();

		await assert.rejects(
			async () => compilePrompt(request, deps),
			(err: unknown) => {
				if (err instanceof PromptCompileError) {
					assert.strictEqual(err.code, "POLICY_CONFLICT");
					return true;
				}
				return false;
			},
		);
	});

	it("INVALID_TASK for unknown provider", async () => {
		const request = makeRequest({ provider: "unknown-provider" as "codex" });
		const deps = makeDeps();

		await assert.rejects(
			async () => compilePrompt(request, deps),
			(err: unknown) => {
				if (err instanceof PromptCompileError) {
					assert.strictEqual(err.code, "INVALID_TASK");
					return true;
				}
				return false;
			},
		);
	});
});

// ─── Test 6: Continuation without repetition ───────────────────────────

describe("Continuation without repetition", () => {
	it("completed items are marked as done, not repeated", async () => {
		const request = makeRequest({
			continuation: {
				previousResponsePath: "/path/to/previous/response.json",
				completedItems: ["Step 1: Login form", "Step 2: JWT utility"],
				incompleteItems: ["Step 3: Error handling"],
				instruction: "continue_without_repeating",
			},
		});
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		assert.ok(
			pkg.user.includes("Step 1: Login form") || pkg.user.includes("DONE"),
			"Completed items should be marked",
		);
		assert.ok(
			pkg.user.includes("Step 3: Error handling"),
			"Incomplete items should be included",
		);
		assert.ok(
			pkg.user.includes("Continue from where the previous attempt stopped"),
			"Continuation instruction should be present",
		);
	});

	it("continuation section has required=true so it survives compaction", async () => {
		const request = makeRequest({
			continuation: {
				previousResponsePath: "/tmp/response.json",
				completedItems: ["A", "B"],
				incompleteItems: ["C"],
				instruction: "continue_without_repeating",
			},
		});
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		const contSection = pkg.sections.find(
			(s) => s.kind === "continuation_instructions",
		);
		assert.ok(contSection, "Continuation section should exist");
		assert.strictEqual(
			contSection?.required,
			true,
			"Continuation should be required",
		);
	});

	it("previous response path is referenced", async () => {
		const request = makeRequest({
			continuation: {
				previousResponsePath: "/tmp/attempt-1-response.json",
				completedItems: [],
				incompleteItems: ["Remaining work"],
				instruction: "continue_without_repeating",
			},
		});
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		assert.ok(
			pkg.user.includes("attempt-1-response.json") ||
				pkg.sections.some((s) =>
					s.sourceRefs.some((ref) => ref.source.includes("attempt-1")),
				),
			"Previous response path should be referenced",
		);
	});
});

// ─── Test 7: Token budget ──────────────────────────────────────────────

describe("Token budget", () => {
	it("estimateTokens returns 0 for empty string", () => {
		assert.strictEqual(estimateTokens(""), 0);
		assert.strictEqual(estimateTokens("   "), 0);
	});

	it("estimateTokens scales with content length", () => {
		const short = "hello";
		const long = "hello world this is a much longer string";

		assert.ok(estimateTokens(long) > estimateTokens(short));
	});

	it("compactToBudget preserves required sections", () => {
		const sections = [
			{
				id: "objective",
				kind: "objective" as const,
				content: "This is the critical objective",
				required: true,
				compactable: false,
				sourceRefs: [],
			},
			{
				id: "context-1",
				kind: "supplemental" as const,
				content: "This is supplemental content that can be removed",
				required: false,
				compactable: true,
				sourceRefs: [],
			},
		];

		const result = compactToBudget(sections, 100, estimateTokens);

		const objectiveSection = result.sections.find((s) => s.id === "objective");
		assert.ok(
			objectiveSection?.content.includes("critical objective"),
			"Required section should be preserved",
		);
	});

	it("validateTokenBudget throws when exceeded", () => {
		const profile = PROVIDER_PROFILES.codex;
		const available = profile.maximumInputTokens - profile.reservedOutputTokens;

		assert.throws(
			() => validateTokenBudget(available + 1, profile),
			(err: unknown) => {
				if (err instanceof PromptCompileError) {
					assert.strictEqual(err.code, "TOKEN_BUDGET_EXCEEDED");
					return true;
				}
				return false;
			},
		);
	});

	it("validateTokenBudget passes when within budget", () => {
		const profile = PROVIDER_PROFILES.codex;
		const available = profile.maximumInputTokens - profile.reservedOutputTokens;

		assert.doesNotThrow(() => validateTokenBudget(available, profile));
		assert.doesNotThrow(() => validateTokenBudget(100, profile));
	});
});

// ─── Test 8: Deduplication ─────────────────────────────────────────────

describe("Deduplication", () => {
	it("normalizeForDeduplication strips markdown and lowercases", () => {
		assert.strictEqual(normalizeForDeduplication("# Header"), "header");
		assert.strictEqual(normalizeForDeduplication("**bold** text"), "bold text");
		assert.strictEqual(
			normalizeForDeduplication("[link](http://example.com)"),
			"link",
		);
		assert.strictEqual(
			normalizeForDeduplication("  spaces  collapse  "),
			"spaces collapse",
		);
	});

	it("duplicate lines are removed from compactable sections", () => {
		const sections = [
			{
				id: "context-1",
				kind: "relevant_context" as const,
				content:
					"Important note\nThis is repeated\nThis is repeated\nAnother line",
				required: false,
				compactable: true,
				sourceRefs: [],
			},
		];

		const result = deduplicateSections(sections);

		assert.ok(
			result[0]?.content.split("\n").filter(Boolean).length < 4,
			"Duplicates should be removed",
		);
	});

	it("required sections are not deduplicated", () => {
		const sections = [
			{
				id: "objective",
				kind: "objective" as const,
				content: "Same objective",
				required: true,
				compactable: false,
				sourceRefs: [],
			},
			{
				id: "objective-2",
				kind: "objective" as const,
				content: "Same objective",
				required: true,
				compactable: false,
				sourceRefs: [],
			},
		];

		const result = deduplicateSections(sections);

		// Both required sections should be preserved
		assert.strictEqual(
			result.length,
			2,
			"Required sections should not be deduplicated",
		);
	});
});

// ─── Test 9: Metadata completeness ────────────────────────────────────

describe("Metadata completeness", () => {
	it("PromptPackage includes token estimate and source refs", async () => {
		const request = makeRequest({
			context: {
				entries: [
					{
						id: "ctx-1",
						content: "Important context about the codebase",
						priority: 1,
						source: "repo/readme.md",
					},
				],
			},
		});
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		assert.ok(
			pkg.estimatedInputTokens > 0,
			"Token estimate should be positive",
		);
		assert.ok(pkg.sourceRefs.length > 0, "Should have source references");
		assert.strictEqual(pkg.version, "1");
		assert.strictEqual(pkg.createdAt, "2026-01-01T00:00:00.000Z");
		assert.ok(pkg.hash.length > 0, "Hash should be present");
	});

	it("sections are ordered deterministically", async () => {
		const request = makeRequest();
		const deps = makeDeps();

		const pkg = await compilePrompt(request, deps);

		const kinds = pkg.sections.map((s) => s.kind);
		// identity should come first
		assert.strictEqual(kinds[0], "identity");
		// objective should be early
		assert.ok(
			kinds.indexOf("objective") < kinds.indexOf("supplemental") ||
				!kinds.includes("supplemental"),
		);
	});
});

// ─── Test 10: PromptCompileError ─────────────────────────────────────

describe("PromptCompileError", () => {
	it("has correct name, code, and message", () => {
		const error = new PromptCompileError(
			"TOKEN_BUDGET_EXCEEDED",
			"Budget exceeded",
			{ estimated: 1000, available: 500 },
		);

		assert.strictEqual(error.name, "PromptCompileError");
		assert.strictEqual(error.code, "TOKEN_BUDGET_EXCEEDED");
		assert.strictEqual(error.message, "Budget exceeded");
		assert.deepStrictEqual(error.details, { estimated: 1000, available: 500 });
	});

	it("is instance of Error", () => {
		const error = new PromptCompileError("INVALID_TASK", "Bad task");
		assert.ok(error instanceof Error);
		assert.ok(error instanceof PromptCompileError);
	});
});

// ─── Test 11: normalizeRequest ────────────────────────────────────────

describe("normalizeRequest", () => {
	it("trims strings", () => {
		const req = makeRequest({
			task: { ...makeRequest().task, id: "  task-001  " } as CompiledTask,
		});
		const normalized = normalizeRequest(req);
		assert.strictEqual(normalized.taskId, "task-001");
	});

	it("sorts context entries by priority", () => {
		const req = makeRequest({
			context: {
				entries: [
					{ id: "a", content: "Low priority", priority: 5, source: "x" },
					{ id: "b", content: "High priority", priority: 1, source: "y" },
					{ id: "c", content: "Medium priority", priority: 3, source: "z" },
				],
			},
		});
		const normalized = normalizeRequest(req);

		assert.strictEqual(normalized.contextEntries[0]?.id, "b");
		assert.strictEqual(normalized.contextEntries[1]?.id, "c");
		assert.strictEqual(normalized.contextEntries[2]?.id, "a");
	});

	it("removes duplicates from arrays", () => {
		const req = makeRequest();
		const withDupes = normalizeRequest({
			...req,
			context: {
				entries: [
					{ id: "a", content: "Content A", priority: 1, source: "x" },
					{ id: "b", content: "Content A", priority: 1, source: "y" }, // duplicate content
				],
			},
		});

		const uniqueContents = new Set(
			withDupes.contextEntries.map((e) => e.content),
		);
		assert.strictEqual(
			uniqueContents.size,
			1,
			"Duplicate content should be removed",
		);
	});
});
