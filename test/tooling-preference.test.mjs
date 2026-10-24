/**
 * The tooling proposal (Biome.js instead of ESLint/Prettier) must reach the
 * user with buttons the runtime can read back.
 *
 * The proposal travels through the callback data of the notification
 * package, and that data is parsed by splitting on "_": an action with an
 * underscore or a request ID with an underscore would break the answer and
 * the proposal could never be resolved. The shipped packages ship their
 * compiled output (`dist/`), so this test exercises the dist and asserts
 * that it is in sync with the source.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const toolingRoot = join(here, "..", "packages", "tooling-preference");
const notificationRoot = join(here, "..", "packages", "notification");

const {
	TOOLING_ACTION,
	buildToolingButtons,
	buildToolingRequestId,
	buildToolingUserKey,
	parseToolingTarget,
	ToolingRequestRegistry,
	detectToolingContext,
	evaluateBiomeProposalEligibility,
	detectChangedJsTsFiles,
	selectQualityCheck,
	runQualityCheck,
	formatQualityCheckStatus,
} = await import(join(toolingRoot, "dist", "index.js"));

const { parseCallbackData } = await import(
	join(notificationRoot, "dist", "telegram-webhook-handler.js")
);

test("the proposal buttons are read back by the runtime parser", () => {
	const requestId = buildToolingRequestId("u-abc", "/work/web");
	const buttons = buildToolingButtons(requestId);
	assert.equal(buttons.length, 2);

	for (const button of buttons) {
		// The runtime sends the action and the target as one string.
		const data = `${button.action}_${button.targetId}`;
		const parsed = parseCallbackData(data);
		assert.equal(parsed.action, TOOLING_ACTION);
		assert.equal(parsed.targetId, button.targetId);
	}
});

test("the action is a single token, so the parser keeps it intact", () => {
	// The parser splits on "_": an action with an underscore would be cut
	// in two and the button would answer a different question.
	assert.equal(TOOLING_ACTION.includes("_"), false);
	assert.equal(TOOLING_ACTION, "biome");
});

test("the request ID survives the callback data", () => {
	const requestId = buildToolingRequestId("u-abc", "/work/web");
	assert.equal(requestId.includes("_"), false);

	const [yes, no] = buildToolingButtons(requestId);
	const parsedYes = parseToolingTarget(parseCallbackData(`${yes.action}_${yes.targetId}`).targetId);
	const parsedNo = parseToolingTarget(parseCallbackData(`${no.action}_${no.targetId}`).targetId);

	assert.equal(parsedYes.choice, "yes");
	assert.equal(parsedYes.requestId, requestId);
	assert.equal(parsedNo.choice, "no");
	assert.equal(parsedNo.requestId, requestId);
});

test("a foreign button never resolves a proposal", () => {
	assert.equal(parseToolingTarget("q-123"), null);
	assert.equal(parseToolingTarget("maybe-biome-abc"), null);
	assert.equal(parseToolingTarget(""), null);
});

test("the first answer wins", () => {
	const registry = new ToolingRequestRegistry();
	const request = {
		requestId: buildToolingRequestId("u-abc", "/work/web"),
		workspaceRoot: "/work/web",
		userKey: "u-abc",
	};
	assert.equal(registry.register(request), true);

	const first = registry.claim(request.requestId, "yes", "telegram");
	assert.equal(first.resolution.preference, "prefer_biome");
	// The second click finds nothing.
	assert.equal(registry.claim(request.requestId, "no", "line"), null);
	assert.equal(registry.resolutionOf(request.requestId).preference, "prefer_biome");
});

test("a workspace that already uses Biome is never asked", () => {
	const root = mkdtempSync(join(tmpdir(), "tooling-proposal-"));
	try {
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				name: "web",
				devDependencies: { eslint: "^9.0.0", "@biomejs/biome": "^2.4.7" },
			}),
			"utf8",
		);
		writeFileSync(join(root, "tsconfig.json"), "{}", "utf8");

		const context = detectToolingContext(root);
		assert.equal(context.usesBiome, true);
		assert.equal(evaluateBiomeProposalEligibility(context).eligible, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a JavaScript/TypeScript workspace with ESLint is asked", () => {
	const root = mkdtempSync(join(tmpdir(), "tooling-proposal-"));
	try {
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ name: "web", devDependencies: { eslint: "^9.0.0" } }),
			"utf8",
		);
		writeFileSync(join(root, "tsconfig.json"), "{}", "utf8");

		const context = detectToolingContext(root);
		assert.equal(context.isJavaScriptTypeScript, true);
		assert.equal(evaluateBiomeProposalEligibility(context).eligible, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the user key never holds the identity of the user", () => {
	const key = buildToolingUserKey("123456789");
	assert.equal(key.includes("123456789"), false);
	assert.equal(buildToolingUserKey("123456789"), key);
	assert.notEqual(buildToolingUserKey("123456789"), buildToolingUserKey("987654321"));
	assert.equal(buildToolingUserKey("  "), "default");
});

test("the compiled proposal is in sync with its source", () => {
	const source = readFileSync(join(toolingRoot, "src", "proposal.ts"), "utf8");
	const dist = readFileSync(join(toolingRoot, "dist", "proposal.js"), "utf8");
	assert.match(source, /export const TOOLING_ACTION = "biome";/);
	assert.match(
		dist,
		/TOOLING_ACTION = "biome"/,
		"the compiled proposal carries the tooling action - rebuild packages/tooling-preference",
	);
});

test("the quality check runs on the changed files of the workspace", () => {
	const root = mkdtempSync(join(tmpdir(), "tooling-check-"));
	try {
		execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				name: "web",
				scripts: { lint: "node -e \"console.log('lint ok')\"" },
			}),
			"utf8",
		);
		writeFileSync(join(root, "app.ts"), "export const a = 1;\n");

		const changed = detectChangedJsTsFiles(root);
		assert.deepEqual(changed.files, ["app.ts"]);

		const context = detectToolingContext(root);
		const plan = selectQualityCheck({
			context,
			preference: "use_project_tools",
			files: changed.files,
		});
		assert.equal(plan.tool, "project");

		const result = runQualityCheck(plan, { cwd: root, timeoutMs: 60_000 });
		assert.equal(result.ran, true);
		assert.equal(result.passed, true);
		assert.match(result.output, /lint ok/);
		assert.equal(formatQualityCheckStatus(result), "[TOOL] project lint: 1 file(s), ok");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
