import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import {
	PingPongDecisionEngine,
	analyzePingPongDecision,
	scanCodebaseComplexity,
} from "../src/ping-pong.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("PingPongDecisionEngine", () => {
	const engine = new PingPongDecisionEngine();

	it("runs PING-PONG for explicit plan-code-review phrasing", () => {
		const result = engine.analyze(
			"Good plan, then write down plan to wiki/ then I will ask Minimax to write code then you review",
		);

		equal(result.decision, "run_ping_pong");
		ok(result.reasons.some((reason) => reason.includes("explicit PING-PONG")));
	});

	it("runs PING-PONG for complex runtime implementation work", () => {
		const result = engine.analyze("implement daemon graph loop recovery across packages", {
			codebase: {
				fileCount: 1200,
				packageCount: 12,
				frameworkSignalCount: 8,
				hasTests: true,
				hasCiOrRelease: true,
			},
		});

		equal(result.decision, "run_ping_pong");
		ok(result.score >= result.thresholds.run);
	});

	it("keeps analysis-only questions inline", () => {
		const result = engine.analyze("analyze why the loop is quiet, do not edit code");

		equal(result.decision, "handle_inline");
		equal(result.score, 0);
	});

	it("can suggest PING-PONG for borderline code work", () => {
		const result = engine.analyze("add tests for parser", {
			codebase: { hasTests: true },
		});

		equal(result.decision, "suggest_ping_pong");
		ok(result.score >= result.thresholds.suggest);
		ok(result.score < result.thresholds.run);
	});

	it("allows explicit skip to override code-change wording", () => {
		const result = engine.analyze("fix the daemon bug but skip ping-pong for now");

		equal(result.decision, "handle_inline");
		equal(result.score, 0);
	});
});

describe("scanCodebaseComplexity", () => {
	it("extracts package, test, and release signals", () => {
		const root = mkdtempSync(join(tmpdir(), "ping-pong-scan-"));
		try {
			mkdirSync(join(root, "packages", "alpha"), { recursive: true });
			mkdirSync(join(root, "packages", "beta"), { recursive: true });
			mkdirSync(join(root, "test"), { recursive: true });
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({ scripts: { build: "tsc", release: "standard-version" } }),
			);
			writeFileSync(join(root, "tsconfig.json"), "{}", "utf8");
			writeFileSync(join(root, "test", "demo.test.ts"), "", "utf8");

			const result = scanCodebaseComplexity(root);

			ok(result.fileCount >= 3);
			equal(result.packageCount, 2);
			ok(result.frameworkSignalCount >= 2);
			equal(result.hasTests, true);
			equal(result.hasCiOrRelease, true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("analyzePingPongDecision", () => {
	it("uses the default engine", () => {
		const result = analyzePingPongDecision("ping-pong this implementation");
		equal(result.decision, "run_ping_pong");
	});
});
