/**
 * Review signals.
 *
 * A signal is only raised for a comprehensive review. An ordinary task-level
 * check (a type error of the file that is edited right now) stays actionable
 * and must not be deferred.
 */

import { describe, it, expect } from "bun:test";
import {
	detectReviewInvocation,
	dispatchAgentName,
	explicitReviewRequest,
	extractFiles,
	isComprehensiveReviewTool,
	isReviewCommand,
	mergeSignals,
	summarizeSignals,
} from "../src/signals.js";
import type { ReviewSignal } from "../src/types.js";

describe("isComprehensiveReviewTool", () => {
	it("knows the review tools", () => {
		expect(isComprehensiveReviewTool("code-reviewer")).toBe(true);
		expect(isComprehensiveReviewTool("code_reviewer")).toBe(true);
		expect(isComprehensiveReviewTool("differential-review")).toBe(true);
		expect(isComprehensiveReviewTool("semgrep")).toBe(true);
		expect(isComprehensiveReviewTool("codeql")).toBe(true);
	});

	it("matches a namespaced tool by its bare name", () => {
		expect(isComprehensiveReviewTool("mcp__pi__code-review")).toBe(true);
	});

	it("does not match a tool that only mentions a review", () => {
		expect(isComprehensiveReviewTool("read_audit_log")).toBe(false);
		expect(isComprehensiveReviewTool("review_status")).toBe(false);
		expect(isComprehensiveReviewTool("semgrep_scan")).toBe(false);
	});

	it("leaves the task-level checks alone", () => {
		expect(isComprehensiveReviewTool("lens_diagnostics")).toBe(false);
		expect(isComprehensiveReviewTool("bash")).toBe(false);
		expect(isComprehensiveReviewTool("edit")).toBe(false);
		expect(isComprehensiveReviewTool("todo")).toBe(false);
		expect(isComprehensiveReviewTool("read")).toBe(false);
	});

	it("accepts extra patterns from the deployment", () => {
		expect(isComprehensiveReviewTool("house_review", ["house_review"])).toBe(true);
	});
});

describe("isReviewCommand", () => {
	it("knows a review runner", () => {
		expect(isReviewCommand("bun run code-review")).toBe(true);
		expect(isReviewCommand("semgrep scan --config auto")).toBe(true);
		expect(isReviewCommand("npx differential-review")).toBe(true);
		expect(isReviewCommand("bun test && code-review")).toBe(true);
	});

	it("ignores an ordinary command", () => {
		expect(isReviewCommand("bun test")).toBe(false);
		expect(isReviewCommand("npx biome check index.ts")).toBe(false);
	});

	it("ignores a runner that is only mentioned", () => {
		expect(isReviewCommand("echo code-review")).toBe(false);
		expect(isReviewCommand("grep security-review README.md")).toBe(false);
		expect(isReviewCommand("# semgrep scan")).toBe(false);
		expect(isReviewCommand("cat notes.md | grep semgrep")).toBe(false);
	});
});

describe("dispatchAgentName", () => {
	it("reads the agent of a dispatch tool", () => {
		expect(dispatchAgentName("subagent", { agent: "code-reviewer" })).toBe("code-reviewer");
		expect(dispatchAgentName("subagent", { agent: "researcher" })).toBe("researcher");
		expect(dispatchAgentName("bash", { command: "ls" })).toBe("");
	});
});

describe("detectReviewInvocation", () => {
	it("recognizes a review tool", () => {
		const invocation = detectReviewInvocation("code-reviewer", { files: ["index.ts"] });
		expect(invocation?.source).toBe("code-reviewer");
		expect(invocation?.files).toEqual(["index.ts"]);
	});

	it("recognizes a reviewer that was dispatched as an agent", () => {
		const invocation = detectReviewInvocation("subagent", { agent: "code-reviewer" });
		expect(invocation?.source).toBe("code-reviewer");
	});

	it("recognizes a review runner in the shell", () => {
		const invocation = detectReviewInvocation("bash", {
			command: "bun run code-review --scope packages/notification",
		});
		expect(invocation?.source).toBe("bash");
		expect(invocation?.reason).toContain("code-review");
	});

	it("does not raise a signal for a task-level check", () => {
		expect(detectReviewInvocation("lens_diagnostics", { paths: ["index.ts"] })).toBeNull();
		expect(detectReviewInvocation("bash", { command: "npx tsc --noEmit" })).toBeNull();
		expect(detectReviewInvocation("edit", { path: "index.ts" })).toBeNull();
	});
});

describe("extractFiles", () => {
	it("reads the files of a tool input", () => {
		expect(extractFiles("code-reviewer", { files: ["a.ts", "b.ts"] })).toEqual(["a.ts", "b.ts"]);
	});

	it("reads the files of a shell command", () => {
		const files = extractFiles("bash", { command: "eslint packages/notification/index.ts" });
		expect(files).toContain("packages/notification/index.ts");
	});
});

describe("explicitReviewRequest", () => {
	it("sees an explicit request of the user", () => {
		expect(explicitReviewRequest("please review the whole diff now")).toBe(true);
		expect(explicitReviewRequest("run an audit of the repository")).toBe(true);
		expect(explicitReviewRequest("review the task diff")).toBe(true);
	});

	it("sees no request in an ordinary message", () => {
		expect(explicitReviewRequest("fix the failing test")).toBe(false);
		expect(explicitReviewRequest("")).toBe(false);
		expect(explicitReviewRequest("the review notes mention a stale cache")).toBe(false);
	});

	it("respects a negation", () => {
		expect(explicitReviewRequest("do not review yet, continue the implementation")).toBe(false);
		expect(explicitReviewRequest("no review for now")).toBe(false);
		expect(explicitReviewRequest("skip the audit")).toBe(false);
	});

	it("reads every sentence on its own", () => {
		expect(explicitReviewRequest("Do not review yet. Please review the diff afterwards.")).toBe(
			true,
		);
	});
});

describe("mergeSignals", () => {
	const signal: ReviewSignal = {
		source: "code-reviewer",
		files: ["index.ts"],
		reason: "a comprehensive review was requested",
		at: "2026-10-25T00:00:00.000Z",
	};

	it("records a signal once", () => {
		const once = mergeSignals([], signal);
		const twice = mergeSignals(once, signal);
		expect(twice).toHaveLength(1);
	});

	it("keeps a different signal", () => {
		const merged = mergeSignals(mergeSignals([], signal), {
			...signal,
			source: "semgrep",
		});
		expect(merged).toHaveLength(2);
	});

	it("summarizes the signals into one scope", () => {
		const merged = mergeSignals(mergeSignals([], signal), {
			source: "semgrep",
			files: ["other.ts"],
			reason: "a second source",
			at: "2026-10-25T00:01:00.000Z",
		});
		const summary = summarizeSignals(merged);
		expect(summary.sources).toEqual(["code-reviewer", "semgrep"]);
		expect(summary.files).toEqual(["index.ts", "other.ts"]);
		expect(summary.reason).toContain("a second source");
	});
});

// touched
