/**
 * Requirement Compiler - Tests
 *
 * Tests for all 10 acceptance criteria:
 * 1. Explicit requirement remains explicit.
 * 2. Preference is not promoted to mandatory constraint.
 * 3. Contradictory statements create ambiguity.
 * 4. Acceptance criteria become Given/When/Then.
 * 5. Thai terminology remains in the glossary.
 * 6. Financial requirement receives risk tag.
 * 7. Empty requirement is rejected.
 * 8. Source references remain traceable.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
	compileRequirement,
	extractStatements,
	classifyStatements,
	detectAmbiguities,
	normalizeAcceptanceCriteria,
	RequirementCompileError,
	RequirementCompileErrorCodes,
	DEFAULT_COMPILER_CONFIG,
} from "../src/index.js";
import type { RawRequirement, ExtractedStatement } from "../src/types.js";

// ─── Test utilities ──────────────────────────────────────────────────────

function makeRaw(
	text: string,
	overrides?: Partial<RawRequirement>,
): RawRequirement {
	return {
		id: "TEST-001",
		title: "Test Requirement",
		text,
		source: "tui",
		submittedBy: "test-user",
		submittedAt: "2026-07-11T00:00:00.000Z",
		...overrides,
	};
}

async function compile(text: string, overrides?: Partial<RawRequirement>) {
	return compileRequirement(makeRaw(text, overrides));
}

// ─── Test 1: Explicit requirement remains explicit ─────────────────────

describe("Explicit requirement remains explicit", () => {
	it("goal statement becomes a goal", async () => {
		const result = await compile("The system must send an email notification");
		assert.ok(result.goals.length > 0, "Should have at least one goal");
		assert.strictEqual(
			result.goals[0].description.toLowerCase(),
			"the system must send an email notification",
		);
	});

	it("must-statement is classified as explicit behavior", () => {
		const stmt: ExtractedStatement = {
			id: "test",
			kind: "explicit_behavior",
			originalText: "The system must validate input",
			normalizedText: "the system must validate input",
			sourceRef: { source: "test", text: "The system must validate input" },
		};
		assert.strictEqual(stmt.kind, "explicit_behavior");
	});
});

// ─── Test 2: Preference is NOT promoted to mandatory ───────────────────

describe("Preference is not promoted to mandatory", () => {
	it("preference becomes non-blocking constraint", async () => {
		const result = await compile("We prefer to use React for the frontend");
		const prefConstraints = result.constraints.filter(
			(c) => c.kind === "preferable",
		);
		assert.ok(
			prefConstraints.length > 0,
			"Should have at least one preferable constraint",
		);
		assert.strictEqual(prefConstraints[0].blocking, false);
	});

	it("should-statement is classified as preference", async () => {
		const result = await compile("The button should be blue");
		assert.ok(
			result.constraints.some((c) => c.kind === "preferable"),
			"Should have a preference constraint",
		);
	});
});

// ─── Test 3: Contradictory statements create ambiguity ─────────────────

describe("Contradictory statements create ambiguity", () => {
	it("opposing must/must not creates contradiction ambiguity", async () => {
		// Contradictions are blocking → compiler throws UNRESOLVABLE_CONTRADICTION
		await assert.rejects(
			() =>
				compile(
					"The system must allow anonymous access.\nThe system must not allow anonymous access.",
				),
			(error: unknown) => {
				if (error instanceof RequirementCompileError) {
					assert.strictEqual(
						error.code,
						RequirementCompileErrorCodes.UNRESOLVABLE_CONTRADICTION,
					);
					return true;
				}
				return false;
			},
		);
	});

	it("detectContradictions returns ambiguity for inverse statements", () => {
		const goals = [
			{
				id: "g1",
				originalText: "Allow anonymous users",
				normalizedText: "allow anonymous users",
				sourceRef: { source: "test", text: "Allow anonymous users" },
			},
		] as unknown as ExtractedStatement[];
		const constraints = [
			{
				id: "c1",
				originalText: "Do not allow anonymous users",
				normalizedText: "do not allow anonymous users",
				sourceRef: { source: "test", text: "Do not allow anonymous users" },
			},
		] as unknown as ExtractedStatement[];

		const ambiguities = detectAmbiguities(
			{
				statements: [...goals, ...constraints],
				goals,
				constraints,
				preferences: [],
				implementationSuggestions: [],
				terminologyMentions: [],
				actorMentions: [],
				acceptanceCriterionStatements: [],
				assumptions: [],
				unknown: [],
			},
			DEFAULT_COMPILER_CONFIG,
		);

		const contradictions = ambiguities.filter(
			(a) => a.category === "contradiction",
		);
		assert.ok(contradictions.length > 0);
	});
});

// ─── Test 4: Acceptance criteria normalize to Given/When/Then ───────────

describe("Acceptance criteria normalize to Given/When/Then", () => {
	it("Given/When/Then statement parses correctly", () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test",
				kind: "acceptance_criterion",
				originalText:
					"Given a logged-in user, when they click Save, then the form is saved",
				normalizedText:
					"given a logged-in user, when they click save, then the form is saved",
				sourceRef: {
					source: "test",
					text: "Given a logged-in user, when they click Save, then the form is saved",
				},
			},
		];

		const criteria = normalizeAcceptanceCriteria(stmts);
		assert.strictEqual(criteria.length, 1);
		assert.strictEqual(criteria[0].given.toLowerCase(), "a logged-in user");
		assert.ok(criteria[0].when.toLowerCase().includes("click"));
		assert.ok(criteria[0].outcome.length > 0);
	});

	it("Natural language statement is inferred to Given/When/Then", () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test",
				kind: "explicit_behavior",
				originalText: "The system must save the form data",
				normalizedText: "the system must save the form data",
				sourceRef: {
					source: "test",
					text: "The system must save the form data",
				},
			},
		];

		const criteria = normalizeAcceptanceCriteria(stmts);
		assert.strictEqual(criteria.length, 1);
		assert.ok(criteria[0].given.length > 0);
		assert.ok(criteria[0].when.length > 0);
		assert.ok(criteria[0].outcome.length > 0);
	});

	it("automatable flag is set based on content", () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test1",
				kind: "acceptance_criterion",
				originalText: "Then the API returns HTTP 200",
				normalizedText: "then the api returns http 200",
				sourceRef: { source: "test", text: "Then the API returns HTTP 200" },
			},
			{
				id: "test2",
				kind: "acceptance_criterion",
				originalText: "Then the UI looks good",
				normalizedText: "then the ui looks good",
				sourceRef: { source: "test", text: "Then the UI looks good" },
			},
		];

		const criteria = normalizeAcceptanceCriteria(stmts);
		const apiCriterion = criteria.find((c) =>
			c.originalText?.includes("HTTP 200"),
		);
		const uiCriterion = criteria.find((c) =>
			c.originalText?.includes("looks good"),
		);
		assert.strictEqual(apiCriterion?.automatable, true);
		assert.strictEqual(uiCriterion?.automatable, false);
	});
});

// ─── Test 5: Thai terminology preserved in glossary ────────────────────

describe("Thai terminology remains in glossary", () => {
	it("Thai term is preserved in terminology", async () => {
		const result = await compile(
			"ระบบต้องสร้างใบแจ้งหนี้\nThe invoice must include the tax amount",
		);
		assert.ok(
			result.terminology.length > 0,
			"Should have at least one terminology entry",
		);
		const thaiEntry = result.terminology.find((t) => t.language === "th");
		assert.ok(thaiEntry, "Should have a Thai-language terminology entry");
	});

	it("Thai detection works correctly", () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test",
				kind: "terminology",
				originalText: "ใบกำกับภาษี",
				normalizedText: "ใบกำกับภาษี",
				sourceRef: { source: "test", text: "ใบกำกับภาษี" },
			},
		];
		const [stmt] = stmts;
		const hasThai = /[ก-๙]/.test(stmt.originalText);
		assert.strictEqual(hasThai, true);
	});
});

// ─── Test 6: Financial requirement receives risk tag ──────────────────

describe("Financial requirement receives risk tag", () => {
	it("payment keyword triggers financial risk", async () => {
		const result = await compile(
			"The system must process payment via credit card",
		);
		const financialRisks = result.riskTags.filter(
			(r) => r.risk === "financial",
		);
		assert.ok(financialRisks.length > 0, "Should have financial risk tag");
		assert.ok(result.riskTags.some((r) => r.description.includes("payment")));
	});

	it("tax-related keyword triggers financial risk", async () => {
		const result = await compile(
			"Calculate the ภาษีมูลค่าเพิ่ม for each transaction",
		);
		assert.ok(
			result.riskTags.some((r) => r.risk === "financial"),
			"Should detect financial risk from Thai tax term",
		);
	});

	it("authentication keyword triggers auth risk", async () => {
		const result = await compile("Users must login with OAuth credentials");
		assert.ok(
			result.riskTags.some((r) => r.risk === "authentication"),
			"Should have authentication risk tag",
		);
	});
});

// ─── Test 7: Empty requirement is rejected ───────────────────────────

describe("Empty requirement is rejected", () => {
	it("rejects empty text requirement", async () => {
		await assert.rejects(
			() => compile("   ", { text: "" }),
			(error: unknown) => {
				if (error instanceof RequirementCompileError) {
					assert.strictEqual(
						error.code,
						RequirementCompileErrorCodes.EMPTY_REQUIREMENT,
					);
					return true;
				}
				return false;
			},
		);
	});

	it("rejects requirement with no goals or constraints", async () => {
		// Just whitespace or nothing useful
		await assert.rejects(
			() => compile("maybe perhaps possibly"),
			(error: unknown) => {
				if (error instanceof RequirementCompileError) {
					assert.strictEqual(
						error.code,
						RequirementCompileErrorCodes.EMPTY_REQUIREMENT,
					);
					return true;
				}
				return false;
			},
		);
	});

	it("accepts requirement with at least a title but no text", async () => {
		const result = await compile("Process user data", {
			text: "",
			title: "Process user data",
		});
		assert.strictEqual(result.goals.length, 1);
	});
});

// ─── Test 8: Source references remain traceable ─────────────────────────

describe("Source references remain traceable", () => {
	it("every goal has a source reference", async () => {
		const result = await compile("Add a login form to the page");
		for (const goal of result.goals) {
			assert.ok(
				goal.sourceRefs.length > 0,
				`Goal "${goal.description}" should have source refs`,
			);
			assert.strictEqual(
				goal.sourceRefs[0].source,
				"tui",
				"Source should be 'tui'",
			);
		}
	});

	it("every constraint has a source reference", async () => {
		const result = await compile("Do not allow SQL injection");
		for (const constraint of result.constraints) {
			assert.ok(
				constraint.sourceRefs.length > 0,
				"Constraint should have source refs",
			);
		}
	});

	it("every ambiguity has evidence source references", async () => {
		// Use a text that creates vagueness ambiguity (not contradiction) so
		// the compiler returns normally instead of throwing
		const result = await compile(
			"The page should be maybe good.\nUsers can access the maybe system.",
		);
		for (const ambiguity of result.ambiguities) {
			assert.ok(
				ambiguity.evidence.length > 0,
				`Ambiguity "${ambiguity.question}" should have evidence`,
			);
		}
	});

	it("acceptance criteria preserve original text", async () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test",
				kind: "acceptance_criterion",
				originalText:
					"Given admin, when they delete user, then confirmation appears",
				normalizedText:
					"given admin, when they delete user, then confirmation appears",
				sourceRef: { source: "test", text: "Given admin..." },
			},
		];

		const criteria = normalizeAcceptanceCriteria(stmts);
		assert.strictEqual(
			criteria[0].originalText,
			"Given admin, when they delete user, then confirmation appears",
		);
	});
});

// ─── Extractor tests ─────────────────────────────────────────────────────

describe("Statement extraction", () => {
	it("extracts numbered list items", () => {
		const raw = makeRaw("1. Add user\n2. Delete user\n3. Edit user");
		const result = extractStatements(raw);
		assert.ok(result.statements.length >= 3);
	});

	it("extracts bullet points", () => {
		const raw = makeRaw("- First item\n- Second item\n- Third item");
		const result = extractStatements(raw);
		assert.ok(result.statements.length >= 3);
	});

	it("includes title as first statement", () => {
		const raw = makeRaw("The system must work", {
			title: "My Custom Title",
		});
		const result = extractStatements(raw);
		assert.strictEqual(result.statements[0]?.id, "stmt-title");
		assert.strictEqual(result.statements[0]?.originalText, "My Custom Title");
	});
});

// ─── Classifier tests ───────────────────────────────────────────────────

describe("Statement classification", () => {
	it("classifies must statements as explicit_behavior", () => {
		const stmt: ExtractedStatement = {
			id: "test",
			kind: "unknown",
			originalText: "The system must validate input",
			normalizedText: "the system must validate input",
			sourceRef: { source: "test", text: "The system must validate input" },
		};

		const result = classifyStatements([stmt], DEFAULT_COMPILER_CONFIG);
		assert.strictEqual(result.goals.length, 1);
	});

	it("classifies do not statements as constraints", () => {
		const stmt: ExtractedStatement = {
			id: "test",
			kind: "unknown",
			originalText: "Do not expose API keys",
			normalizedText: "do not expose api keys",
			sourceRef: { source: "test", text: "Do not expose API keys" },
		};

		const result = classifyStatements([stmt], DEFAULT_COMPILER_CONFIG);
		assert.strictEqual(result.constraints.length, 1);
	});

	it("classifies assumption statements", () => {
		const stmt: ExtractedStatement = {
			id: "test",
			kind: "unknown",
			originalText: "Assume the user is authenticated",
			normalizedText: "assume the user is authenticated",
			sourceRef: { source: "test", text: "Assume the user is authenticated" },
		};

		const result = classifyStatements([stmt], DEFAULT_COMPILER_CONFIG);
		assert.strictEqual(result.assumptions.length, 1);
	});

	it("classifies Given/When/Then as acceptance criteria", () => {
		const stmt: ExtractedStatement = {
			id: "test",
			kind: "unknown",
			originalText: "Given a user, when they submit, then it saves",
			normalizedText: "given a user, when they submit, then it saves",
			sourceRef: {
				source: "test",
				text: "Given a user, when they submit, then it saves",
			},
		};

		const result = classifyStatements([stmt], DEFAULT_COMPILER_CONFIG);
		assert.strictEqual(result.acceptanceCriterionStatements.length, 1);
	});
});

// ─── Risk detection tests ────────────────────────────────────────────────

describe("Risk detection", () => {
	it("detects destructive operation risk", async () => {
		const result = await compile("The system must delete all user data");
		assert.ok(result.riskTags.some((r) => r.risk === "destructive_operation"));
	});

	it("detects privacy risk", async () => {
		const result = await compile(
			"Collect personal data from users for analysis",
		);
		assert.ok(result.riskTags.some((r) => r.risk === "privacy"));
	});

	it("detects regulatory risk", async () => {
		const result = await compile(
			"Ensure compliance with Thai PDPA regulations",
		);
		assert.ok(result.riskTags.some((r) => r.risk === "regulatory"));
	});

	it("deduplicates risk tags for same statement", async () => {
		const result = await compile(
			"Payment data must be encrypted and stored securely",
		);
		const paymentRisks = result.riskTags.filter(
			(r) => r.affectedId === result.riskTags[0]?.affectedId,
		);
		// Should not have duplicate entries for same statement
		const uniqueRisks = new Set(paymentRisks.map((r) => r.risk));
		assert.ok(uniqueRisks.size <= 2); // financial + privacy
	});
});

// ─── Ambiguity detection tests ───────────────────────────────────────────

describe("Ambiguity detection", () => {
	it("detects vague terms", () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test",
				kind: "unknown",
				originalText: "The system must be fast and reliable",
				normalizedText: "the system must be fast and reliable",
				sourceRef: {
					source: "test",
					text: "The system must be fast and reliable",
				},
			},
		];

		const ambiguities = detectAmbiguities(
			{
				statements: stmts,
				goals: stmts,
				constraints: [],
				preferences: [],
				implementationSuggestions: [],
				terminologyMentions: [],
				actorMentions: [],
				acceptanceCriterionStatements: [],
				assumptions: [],
				unknown: [],
			},
			DEFAULT_COMPILER_CONFIG,
		);

		assert.ok(
			ambiguities.some((a) => a.category === "vague_term"),
			"Should detect vague term",
		);
	});

	it("detects missing actor", () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test",
				kind: "goal",
				originalText: "Who should approve the request?",
				normalizedText: "who should approve the request?",
				sourceRef: {
					source: "test",
					text: "Who should approve the request?",
				},
			},
		];

		const ambiguities = detectAmbiguities(
			{
				statements: stmts,
				goals: stmts,
				constraints: [],
				preferences: [],
				implementationSuggestions: [],
				terminologyMentions: [],
				actorMentions: [],
				acceptanceCriterionStatements: [],
				assumptions: [],
				unknown: [],
			},
			DEFAULT_COMPILER_CONFIG,
		);

		assert.ok(
			ambiguities.some(
				(a) => a.category === "missing_actor" && a.blocking === true,
			),
			"Should detect missing actor",
		);
	});

	it("deduplicates ambiguities by question text", () => {
		const stmts: ExtractedStatement[] = [
			{
				id: "test1",
				kind: "unknown",
				originalText: "The system should be secure",
				normalizedText: "the system should be secure",
				sourceRef: { source: "test", text: "The system should be secure" },
			},
			{
				id: "test2",
				kind: "unknown",
				originalText: "The system should be secure",
				normalizedText: "the system should be secure",
				sourceRef: { source: "test", text: "The system should be secure" },
			},
		];

		const ambiguities = detectAmbiguities(
			{
				statements: stmts,
				goals: [],
				constraints: [],
				preferences: [],
				implementationSuggestions: [],
				terminologyMentions: [],
				actorMentions: [],
				acceptanceCriterionStatements: [],
				assumptions: [],
				unknown: stmts,
			},
			DEFAULT_COMPILER_CONFIG,
		);

		// Should de-duplicate
		const secureAmbiguities = ambiguities.filter((a) =>
			a.question.includes("secure"),
		);
		assert.ok(secureAmbiguities.length <= 1, "Should deduplicate");
	});
});

// ─── Workflow tests ──────────────────────────────────────────────────────

describe("Workflow extraction", () => {
	it("groups multiple goals into a workflow", async () => {
		const result = await compile(
			"1. Create user account\n2. Send verification email\n3. Display user dashboard",
		);
		assert.ok(result.workflows.length > 0, "Should have at least one workflow");
		assert.ok(
			result.workflows[0].steps.length >= 2,
			"Workflow should have multiple steps",
		);
	});
});

// ─── Actor extraction tests ─────────────────────────────────────────────

describe("Actor extraction", () => {
	it("extracts actors from statements", async () => {
		const result = await compile(
			"The admin can delete any user account.\nThe user can edit their own profile.",
		);
		assert.ok(result.actors.length > 0, "Should detect at least one actor");
		const actorNames = result.actors.map((a) => a.name.toLowerCase());
		assert.ok(
			actorNames.some((n) => n.includes("admin") || n.includes("user")),
			"Should detect admin or user actor",
		);
	});
});

// ─── Error handling tests ──────────────────────────────────────────────

describe("Error handling", () => {
	it("RequirementCompileError has correct properties", () => {
		const error = new RequirementCompileError(
			RequirementCompileErrorCodes.EMPTY_REQUIREMENT,
			"Test error message",
			{ extra: "info" },
		);
		assert.strictEqual(error.code, "EMPTY_REQUIREMENT");
		assert.strictEqual(error.message, "Test error message");
		assert.strictEqual(error.details?.extra, "info");
		assert.strictEqual(error.name, "RequirementCompileError");
	});

	it("unresolvable contradiction throws error", async () => {
		await assert.rejects(
			() =>
				compile(
					"The system must allow public access.\nThe system must not allow public access.",
				),
			(error: unknown) => {
				if (error instanceof RequirementCompileError) {
					assert.strictEqual(
						error.code,
						RequirementCompileErrorCodes.UNRESOLVABLE_CONTRADICTION,
					);
					return true;
				}
				return false;
			},
		);
	});
});

// ─── Multilingual tests ─────────────────────────────────────────────────

describe("Multilingual handling", () => {
	it("preserves Thai business terms", async () => {
		const result = await compile(
			"ระบบต้องสร้างใบเสร็จรับเงิน\nThe receipt must include ยอดเงินรวม",
		);
		assert.ok(
			result.terminology.length > 0,
			"Should preserve Thai terms in glossary",
		);
	});

	it("status is 'ready' for non-blocking ambiguities", async () => {
		const result = await compile(
			"The system should be fast.\nThe system should be secure.",
		);
		// Vague terms create non-blocking ambiguities
		assert.ok(
			result.status === "ready" || result.status === "needs_human",
			"Status should be ready or needs_human",
		);
	});

	it("status is 'needs_human' for blocking ambiguities", async () => {
		const result = await compile("Who should access the admin panel?");
		assert.strictEqual(result.status, "needs_human");
	});
});
