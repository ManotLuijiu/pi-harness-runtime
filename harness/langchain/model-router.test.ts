import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
	routeRequest,
	routeRequestSmart,
	resolveModel,
} from "./model-router.js";

const TEST_ENV = {
	PLANNER_API_KEY: "pk-test-planner",
	PLANNER_MODEL: "gpt-5.6",
	PLANNER_BASE_URL: "https://api.openai.com/v1",
	GLM_API_KEY: "pk-test-glm",
	GLM_MODEL: "GLM-5.2",
	GLM_BASE_URL: "https://api.z.ai/api/v1",
	MINIMAX_API_KEY: "pk-test-minimax",
	MINIMAX_MODEL: "MiniMax-M2",
	MINIMAX_BASE_URL: "https://api.minimaxi.com/v1",
};

describe("resolveModel", () => {
	const original = process.env;

	beforeEach(() => {
		process.env = { ...original, ...TEST_ENV };
	});

	afterEach(() => {
		process.env = original;
	});

	it("resolves GLM family from env", () => {
		const r = resolveModel("glm");
		assert.equal(r.model, "GLM-5.2");
		assert.equal(r.baseURL, "https://api.z.ai/api/v1");
		assert.equal(r.apiKey, "pk-test-glm");
	});

	it("resolves PLANNER family from env", () => {
		const r = resolveModel("planner");
		assert.equal(r.model, "gpt-5.6");
		assert.equal(r.apiKey, "pk-test-planner");
	});

	it("resolves MINIMAX family from env", () => {
		const r = resolveModel("minimax");
		assert.equal(r.model, "MiniMax-M2");
		assert.equal(r.apiKey, "pk-test-minimax");
	});

	it("is case-insensitive", () => {
		const r = resolveModel("GLM");
		assert.equal(r.model, "GLM-5.2");
	});

	it("throws if API key is missing", () => {
		delete process.env.GLM_API_KEY;
		assert.throws(() => resolveModel("glm"), /GLM_API_KEY is not set/);
	});

	it("throws if MODEL is missing", () => {
		delete process.env.GLM_MODEL;
		assert.throws(() => resolveModel("glm"), /GLM_MODEL is not set/);
	});

	it("throws if BASE_URL is missing", () => {
		delete process.env.GLM_BASE_URL;
		assert.throws(() => resolveModel("glm"), /GLM_BASE_URL is not set/);
	});
});

describe("routeRequest", () => {
	const original = process.env;

	beforeEach(() => {
		process.env = { ...original, ...TEST_ENV };
	});

	afterEach(() => {
		process.env = original;
	});

	it("default: planner→PLANNER, reviewer→GLM, coder→MINIMAX", () => {
		const r = routeRequest("Implement a rate limiter");
		assert.equal(r.planner.model, "gpt-5.6");
		assert.equal(r.reviewer.model, "GLM-5.2");
		assert.equal(r.coder.model, "MiniMax-M2");
		assert.equal(r.cleanRequest, "Implement a rate limiter");
	});

	it("strips [role: family] directives from cleanRequest", () => {
		const r = routeRequest(
			"Fix the bug  [planner: gpt]  [reviewer: GLM]  [coder: MiniMax]",
		);
		assert.equal(r.cleanRequest, "Fix the bug");
	});

	it("override reviewer with GPT directive → PLANNER env", () => {
		const r = routeRequest("Implement feature X  [reviewer: gpt]");
		assert.equal(r.reviewer.model, "gpt-5.6");
		assert.equal(r.cleanRequest, "Implement feature X");
	});

	it("override planner with GLM directive", () => {
		const r = routeRequest("Plan this task  [planner: glm]");
		assert.equal(r.planner.model, "GLM-5.2");
	});

	it("override coder with GPT directive → PLANNER env", () => {
		const r = routeRequest("Write the code  [coder: gpt]");
		assert.equal(r.coder.model, "gpt-5.6");
	});

	it("multiple directives together", () => {
		const r = routeRequest(
			"Implement X  [planner: gpt]  [reviewer: GLM]  [coder: MiniMax]",
		);
		assert.equal(r.planner.model, "gpt-5.6");
		assert.equal(r.reviewer.model, "GLM-5.2");
		assert.equal(r.coder.model, "MiniMax-M2");
	});

	it("partial directive — only reviewer overridden", () => {
		const r = routeRequest("Do it  [reviewer: gpt]");
		assert.equal(r.reviewer.model, "gpt-5.6");
		assert.equal(r.planner.model, "gpt-5.6");
		assert.equal(r.coder.model, "MiniMax-M2");
	});

	it("unknown family throws — must be a recognised family name", () => {
		// FAMILY_MAP only knows: gpt, glm, minimax
		// unknown families are passed through as-is, causing readEnv to throw
		assert.throws(
			() => routeRequest("Do it  [reviewer: unknown-provider]"),
			/UNKNOWN-PROVIDER_API_KEY is not set/,
		);
	});
});

describe("routeRequestSmart — natural language hints", () => {
	const original = process.env;

	beforeEach(() => {
		process.env = { ...original, ...TEST_ENV };
	});

	afterEach(() => {
		process.env = original;
	});

	it("'use GLM as master reviewer' → reviewer→GLM", () => {
		const r = routeRequestSmart(
			"Implement a rate limiter. Use GLM as master reviewer.",
		);
		assert.equal(r.reviewer.model, "GLM-5.2");
	});

	it("'use GPT as reviewer' → reviewer→PLANNER", () => {
		const r = routeRequestSmart("Implement a rate limiter. Use GPT as reviewer.");
		assert.equal(r.reviewer.model, "gpt-5.6");
	});

	it("'[reviewer: GLM]' directive beats natural hint", () => {
		const r = routeRequestSmart(
			"Implement X. Use GPT as master reviewer.  [reviewer: GLM]",
		);
		// directive wins
		assert.equal(r.reviewer.model, "GLM-5.2");
		assert.equal(r.cleanRequest, "Implement X. Use GPT as master reviewer.");
	});

	it("'GPT as planner' → planner→PLANNER", () => {
		const r = routeRequestSmart("Plan the implementation. GPT as planner.");
		assert.equal(r.planner.model, "gpt-5.6");
	});

	it("strips directive comments but keeps natural hints", () => {
		const r = routeRequestSmart(
			"Fix the bug. Use GLM as master reviewer.  [reviewer: gpt]",
		);
		assert.equal(r.cleanRequest, "Fix the bug. Use GLM as master reviewer.");
		assert.equal(r.reviewer.model, "gpt-5.6"); // directive wins
	});

	it("defaults all three when no hints or directives", () => {
		const r = routeRequestSmart("Just do it.");
		assert.equal(r.planner.model, "gpt-5.6");
		assert.equal(r.reviewer.model, "GLM-5.2");
		assert.equal(r.coder.model, "MiniMax-M2");
	});
});
