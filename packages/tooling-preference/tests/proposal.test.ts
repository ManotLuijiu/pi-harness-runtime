import { describe, expect, it } from "bun:test";
import {
	buildToolingButtons,
	buildToolingImplementationPrompt,
	buildToolingProposalMessage,
	buildToolingRequestId,
	parseToolingTarget,
	TOOLING_ACTION,
} from "../src/proposal.ts";
import type { ToolingContext } from "../src/detect.ts";

const context: ToolingContext = {
	root: "/work/web",
	hasPackageJson: true,
	isJavaScriptTypeScript: true,
	isNextJs: true,
	isReact: true,
	usesBiome: false,
	usesEslint: true,
	usesPrettier: true,
	packageManager: "pnpm",
	frameworks: ["next"],
};

describe("buildToolingRequestId", () => {
	it("is stable for the same user and workspace", () => {
		const first = buildToolingRequestId("user-1", "/work/web");
		const second = buildToolingRequestId("user-1", "/work/web");
		expect(first).toBe(second);
	});

	it("differs per user and per workspace", () => {
		expect(buildToolingRequestId("user-1", "/work/web")).not.toBe(
			buildToolingRequestId("user-2", "/work/web"),
		);
		expect(buildToolingRequestId("user-1", "/work/web")).not.toBe(
			buildToolingRequestId("user-1", "/work/other"),
		);
	});

	it("holds no underscore, so the callback parser keeps it intact", () => {
		const requestId = buildToolingRequestId("user-1", "/work/web");
		expect(requestId).not.toContain("_");
		expect(requestId.startsWith("biome-")).toBe(true);
	});
});

describe("buildToolingButtons", () => {
	it("sends one action with a choice per button", () => {
		const requestId = buildToolingRequestId("user-1", "/work/web");
		const buttons = buildToolingButtons(requestId);
		expect(buttons).toHaveLength(2);
		for (const button of buttons) {
			expect(button.action).toBe(TOOLING_ACTION);
			expect(button.targetId).toContain(requestId);
		}
		expect(buttons[0].targetId.startsWith("yes-")).toBe(true);
		expect(buttons[1].targetId.startsWith("no-")).toBe(true);
	});

	it("keeps the action a single token", () => {
		expect(TOOLING_ACTION).not.toContain("_");
	});
});

describe("parseToolingTarget", () => {
	it("reads the choice and the request ID back", () => {
		const requestId = buildToolingRequestId("user-1", "/work/web");
		const [yes, no] = buildToolingButtons(requestId);
		expect(parseToolingTarget(yes.targetId)).toEqual({ choice: "yes", requestId });
		expect(parseToolingTarget(no.targetId)).toEqual({ choice: "no", requestId });
	});

	it("refuses a target that is not part of the proposal", () => {
		expect(parseToolingTarget("q-123")).toBeNull();
		expect(parseToolingTarget("maybe-biome-abc")).toBeNull();
		expect(parseToolingTarget("")).toBeNull();
		expect(parseToolingTarget(undefined)).toBeNull();
	});

	it("survives the callback data round trip", () => {
		const requestId = buildToolingRequestId("user-1", "/work/web");
		const [yes] = buildToolingButtons(requestId);
		const data = `${yes.action}_${yes.targetId}`;
		const [action, targetId] = data.split("_");
		expect(action).toBe(TOOLING_ACTION);
		expect(parseToolingTarget(targetId)?.requestId).toBe(requestId);
	});
});

describe("the wording", () => {
	it("names the detected tools and the frameworks", () => {
		const message = buildToolingProposalMessage(context);
		expect(message).toContain("Next.js");
		expect(message).toContain("ESLint");
		expect(message).toContain("Prettier");
		expect(message).toContain("Biome");
	});

	it("asks the agent to implement Biome after a yes", () => {
		const prompt = buildToolingImplementationPrompt(context, "/work/web");
		expect(prompt).toContain("/work/web");
		expect(prompt).toContain("@biomejs/biome");
		expect(prompt).toContain("pnpm add --save-dev");
		expect(prompt).toContain("Next.js");
	});
});
